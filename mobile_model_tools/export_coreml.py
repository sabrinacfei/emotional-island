"""Export the exact trained encoder + merged LoRA + mean pool + head for iPhone."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import sys
import time
import gc

INTEGRATION=Path(__file__).resolve().parents[1]
ROOT=INTEGRATION.parent if INTEGRATION.name=='app_integration' else INTEGRATION
ADAPTER=Path(os.getenv('MODERNBERT_ADAPTER_DIR',str(INTEGRATION/'cloud_model_adapter')))
WORK=ROOT/'.mobile_modernbert_work_20261108'
OUT=INTEGRATION/'results/mobile-modernbert-20261108'
ASSETS=INTEGRATION/'EmotionApp2/modules/on-device-diagnostics/ios/Assets'
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',NEURAL_DEVICE='cpu',
                  MODERNBERT_ADAPTER_DIR=str(ADAPTER))
sys.path.insert(0,str(INTEGRATION))
import numpy as np
import torch
import coremltools as ct
from modernbert_backend import _load_bundle,predict
from modernbert_chunking import LABELS,tokenize_chunks

for p in [WORK,OUT,ASSETS]:p.mkdir(parents=True,exist_ok=True)
torch.set_num_threads(4)
encoder,head,tokenizer,labels,device=_load_bundle()
print('Loaded trained bundle',flush=True)
base=encoder.merge_and_unload(safe_merge=True).float().eval()

class MobileClassifier(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.encoder=base
        self.head=head.float().eval()
        positions=torch.arange(128)
        self.register_buffer('positions',positions.unsqueeze(0))
        self.register_buffer('local_allowed',(positions[:,None]-positions[None,:]).abs()<=base.config.sliding_window)

    def forward(self,input_ids,attention_mask):
        # Explicit additive masks avoid exporter-dependent dynamic mask generation.
        allowed=attention_mask[:,None,None,:].to(torch.bool)
        full=torch.where(allowed,0.0,-10000.0)
        local=torch.where(allowed & self.local_allowed[None,None,:,:],0.0,-10000.0)
        hidden=self.encoder(input_ids=input_ids,position_ids=self.positions,
                            attention_mask={'full_attention':full,'sliding_attention':local}).last_hidden_state
        mask=attention_mask.unsqueeze(-1).to(hidden.dtype)
        pooled=(hidden*mask).sum(dim=1)/mask.sum(dim=1).clamp(min=1)
        return torch.softmax(self.head(pooled).float(),dim=-1)

model=MobileClassifier().eval()
texts=['I am so happy and proud of finishing my presentation!',
       'I feel sad and disappointed, but I am also hopeful about tomorrow.',
       '今天完成報告很開心，但也有一點擔心成績。',
       'Cafe\u0301🙂\n我只是想被聽見，不需要建議。',
       ('I smiled after the presentation, but I was worried about tomorrow. '*30)]
fixtures=[]
max_merge_error=0.0
for text in texts:
    reference=predict(text)
    chunks=tokenize_chunks(text,tokenizer)
    for chunk in chunks:
        length=len(chunk['input_ids'])
        ids=torch.tensor([chunk['input_ids']+[tokenizer.pad_token_id]*(128-length)],dtype=torch.int32)
        mask=torch.tensor([chunk['attention_mask']+[0]*(128-length)],dtype=torch.int32)
        with torch.inference_mode():actual=model(ids,mask).numpy()[0]
        expected=np.array([chunk['probabilities'][label.title()] for label in labels]) if 'probabilities' in chunk else np.array([reference['chunks'][chunk['index']]['probabilities'][label.title()] for label in labels])
        error=float(np.max(np.abs(actual-expected)))
        max_merge_error=max(error,max_merge_error)
        fixtures.append({'text':text,'index':chunk['index'],'input_ids':ids.numpy().tolist()[0],
                         'attention_mask':mask.numpy().tolist()[0], 'probabilities':actual.tolist()})
print('Merge/padding/mask max error',max_merge_error,flush=True)
assert max_merge_error<1e-5,max_merge_error
trace=torch.jit.trace(model,(ids,mask),check_trace=False)
print('Tracing complete; converting Core ML',flush=True)
ml=ct.convert(trace,inputs=[ct.TensorType(name='input_ids',shape=(1,128),dtype=np.int32),
                          ct.TensorType(name='attention_mask',shape=(1,128),dtype=np.int32)],
              outputs=[ct.TensorType(name='probabilities',dtype=np.float32)],
              convert_to='mlprogram',compute_precision=ct.precision.FLOAT16,
              minimum_deployment_target=ct.target.iOS15,compute_units=ct.ComputeUnit.CPU_AND_GPU,
              skip_model_load=True)
ml.short_description='Trained ModernBERT + merged LoRA, masked mean pooling and Plutchik eight-class head.'
ml.user_defined_metadata['labels']=json.dumps(list(labels))
package=WORK/'ModernBERT.mlpackage'
ml.save(str(package))
print('Core ML export saved',flush=True)
_load_bundle.cache_clear()
del encoder,head,base,model,trace,ml
gc.collect()
ml=ct.models.MLModel(str(package),compute_units=ct.ComputeUnit.CPU_AND_GPU)
checks=[]
for fixture in fixtures:
    started=time.perf_counter()
    output=ml.predict({'input_ids':np.array([fixture['input_ids']],dtype=np.int32),
                       'attention_mask':np.array([fixture['attention_mask']],dtype=np.int32)})['probabilities'][0]
    difference=float(np.max(np.abs(output-np.array(fixture['probabilities']))))
    assert difference<0.006,difference
    assert np.argmax(output)==np.argmax(fixture['probabilities'])
    checks.append({'max_absolute_difference':difference,'seconds':time.perf_counter()-started})
    fixture['coreml_probabilities']=output.tolist()
    print('Core ML parity',checks[-1],flush=True)
weights=package/'Data/com.apple.CoreML/weights/weight.bin'
weight_sha=hashlib.sha256(weights.read_bytes()).hexdigest()
tokenizer_file=ADAPTER/'tokenizer.json'
manifest={'schema':'modernbert-phone-v1','model':'modernbert-lora-coreml-fp16-v1',
          'runtime':'coreml','model_sha256':weight_sha,
          'tokenizer_sha256':hashlib.sha256(tokenizer_file.read_bytes()).hexdigest(),
          'labels':list(labels),'max_input_tokens':128,'overlap_tokens':32,
          'pad_token_id':tokenizer.pad_token_id,'cls_token_id':tokenizer.cls_token_id,'sep_token_id':tokenizer.sep_token_id,
          'input_dtype':'int32','output':'probabilities','base_revision':json.loads((ADAPTER/'provenance.json').read_text())['base_revision']}
(WORK/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(ASSETS/'modernbert-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
with tokenizer_file.open('rb') as source,(ASSETS/'modernbert-tokenizer.json').open('wb') as target:
    shutil.copyfileobj(source,target)
(OUT/'conversion-parity.json').write_text(json.dumps({'synthetic':True,'merged_and_padded_max_error':max_merge_error,
            'coreml_checks':checks,'fp16_tolerance':0.006,'all_argmax_equal':True,'manifest':manifest},indent=2)+'\n')
(WORK/'parity-fixtures.json').write_text(json.dumps(fixtures,ensure_ascii=False)+'\n')
print(json.dumps({'export_complete':True,'weights_bytes':weights.stat().st_size,'model_sha256':weight_sha}),flush=True)
