from pathlib import Path
import json,hashlib

integration=Path(__file__).resolve().parents[1]
assets=integration/'EmotionApp2/modules/on-device-diagnostics/ios/Assets'
manifest=json.loads((assets/'modernbert-manifest.json').read_text())
compiled=assets/'ModernBERT.mlmodelc'
assert compiled.is_dir()
manifest['compiled_files']={str(p.relative_to(compiled)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(compiled.rglob('*')) if p.is_file()}
assert manifest['compiled_files']
(assets/'modernbert-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(integration/'modernbert_phone_manifest.json').write_text(json.dumps({k:v for k,v in manifest.items() if k!='compiled_files'},indent=2)+'\n')
ts=integration/'EmotionApp2/src/onDevice/modernbert'
ts.mkdir(parents=True,exist_ok=True)
(ts/'model.ts').write_text('export const PHONE_CLASSIFIER = Object.freeze('+json.dumps({k:manifest[k] for k in ['model','runtime','model_sha256','tokenizer_sha256','max_input_tokens','overlap_tokens']},indent=2)+');\n')
print(json.dumps({'compiled_files':len(manifest['compiled_files']),'model_bytes':sum(p.stat().st_size for p in compiled.rglob('*') if p.is_file()),'model_sha256':manifest['model_sha256']}))
