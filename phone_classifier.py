"""Validate a client-reported native result, without rerunning cloud inference.

The server can validate structure, model version, aggregation and diary binding.
It does not attest that an untrusted client actually executed the model.
"""
from pathlib import Path
import json
import math
from modernbert_chunking import LABELS, aggregate

MANIFEST = Path(__file__).with_name('modernbert_phone_manifest.json')


def validate_phone_classification(value: dict, input_sha256: str) -> tuple[dict, dict]:
    if not isinstance(value, dict) or set(value) != {'analysis', 'trace'}:
        raise ValueError('Invalid phone classification envelope')
    manifest = json.loads(MANIFEST.read_text())
    trace, analysis = value['trace'], value['analysis']
    if (not isinstance(trace, dict) or set(trace) != {'execution','runtime','model','model_sha256','tokenizer_sha256','input_sha256','duration_ms','load_ms'}
            or trace['execution'] != 'on-device' or trace['runtime'] != 'coreml'
            or any(trace.get(key) != manifest[key] for key in ['model','model_sha256','tokenizer_sha256'])
            or trace['input_sha256'] != input_sha256
            or any(type(trace[key]) not in (int,float) or not math.isfinite(trace[key]) or trace[key] < 0 for key in ['duration_ms','load_ms'])
            or trace['duration_ms'] <= 0 or trace['load_ms'] > trace['duration_ms']):
        raise ValueError('Phone classification trace does not match the diary/model')
    if not isinstance(analysis, dict) or analysis.get('truncated') is not False or analysis.get('labels') != list(LABELS):
        raise ValueError('Invalid phone classification analysis')
    chunks = analysis.get('chunks')
    if not isinstance(chunks,list) or not 1 <= len(chunks) <= 512 or analysis.get('chunk_count') != len(chunks):
        raise ValueError('Invalid phone classifier windows')
    normalized, rows = [], []
    for i, chunk in enumerate(chunks):
        if (not isinstance(chunk,dict) or any(type(chunk.get(key)) is not int for key in ['index','start_token','end_token','effective_tokens','input_tokens'])
                or chunk['index'] != i or chunk['input_tokens'] != 128 or not 0 < chunk['effective_tokens'] <= 126
                or (i == 0 and chunk['start_token'] != 0)
                or (i and chunk['start_token'] != chunks[i-1]['end_token']-32)):
            raise ValueError('Invalid phone classifier window bounds')
        probabilities = chunk.get('probabilities')
        if not isinstance(probabilities,dict) or set(probabilities) != {k.title() for k in LABELS}:
            raise ValueError('Invalid phone window probabilities')
        row=[probabilities[k.title()] for k in LABELS]
        if any(type(v) not in (int,float) for v in row):
            raise ValueError('Invalid phone window probability types')
        # Only dimensions are reconstructed here, never tokenized text or model inputs.
        normalized.append({k:chunk[k] for k in ['index','start_token','end_token','effective_tokens']}
                          | {'input_ids':[0]*128,'configured_overlap_tokens':32})
        rows.append(row)
    result=aggregate(normalized,rows,list(LABELS))
    if result['token_count'] > 48000 or result['token_count'] != analysis.get('token_count'):
        raise ValueError('Invalid original token count')
    for key,value in result['probabilities'].items():
        given=analysis.get('probabilities',{}).get(key)
        if type(given) not in (int,float) or not math.isfinite(given) or abs(value-given)>1e-6:
            raise ValueError('Phone distribution differs from its windows')
    if analysis.get('scores') != result['scores']:
        raise ValueError('Phone display scores differ from its probabilities')
    for given,expected in zip(chunks,result['chunks']):
        weight=given.get('aggregation_weight')
        if type(weight) not in (int,float) or not math.isfinite(weight) or abs(weight-expected['aggregation_weight'])>1e-7:
            raise ValueError('Incorrect phone overlap weights')
    given_aggregation=analysis.get('aggregation',{})
    for key in ['method','overlap_tokens','unique_content_tokens','processed_content_tokens','max_input_tokens','special_and_padding_tokens_in_weight']:
        if given_aggregation.get(key) != result['aggregation'][key]:
            raise ValueError('Incorrect phone aggregation metadata')
    return result,trace
