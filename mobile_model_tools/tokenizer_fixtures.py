from pathlib import Path
import json,random,os
from tokenizers import Tokenizer
integration=Path(__file__).resolve().parents[1]
root=integration.parent if integration.name=='app_integration' else integration
adapter=Path(os.getenv('MODERNBERT_ADAPTER_DIR',str(integration/'cloud_model_adapter')))
t=Tokenizer.from_file(str(adapter/'tokenizer.json'))
texts=['Hello world!','今天很開心，但也擔心明天。','Cafe\u0301 café e\u0301','🙂👩‍👩‍👧‍👦🏳️‍🌈🦋','\r\n\t  a   b\n\n',' hello [MASK] world','[CLS]joy[SEP][unused1]','<|endoftext|>\n<|padding|>',"I can't believe we're done. It's amazing!",'１２３\u00a0全形\u2003中文\u2028換行','a'*1024,'   ', '','ＡＢＣ，中文！English? [UNK]']
random.seed(42)
words=['今天','sadness','開心','擔心','joy','[MASK]','\n',' ',"don't",'🙂','café','\t','報告','１２３','\u00a0']
texts += [''.join(random.choices(words,k=random.randint(1,50))) for _ in range(200)]
data=[{'name':f'fixture-{i}','text':text,'ids':t.encode(text,add_special_tokens=False).ids} for i,text in enumerate(texts)]
(root/'.mobile_modernbert_work_20261108/tokenizer-fixtures.json').write_text(json.dumps(data,ensure_ascii=False))
print('Tokenizer fixtures',len(data))
