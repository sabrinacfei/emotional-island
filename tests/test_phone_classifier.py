"""Protocol tests use synthetic probabilities, not evidence of native execution."""
import copy
import json
import unittest
from unittest.mock import AsyncMock, Mock
from fastapi import FastAPI
from fastapi.testclient import TestClient
from mobile_feedback import router,digest
from modernbert_chunking import LABELS,aggregate
from phone_classifier import MANIFEST,validate_phone_classification

TEXT='今天完成報告後很開心，但也擔心明天。'

def fixture():
    manifest=json.loads(MANIFEST.read_text())
    chunks=[dict(index=0,start_token=0,end_token=126,effective_tokens=126,input_ids=[0]*128,configured_overlap_tokens=32),
            dict(index=1,start_token=94,end_token=140,effective_tokens=46,input_ids=[0]*128,configured_overlap_tokens=32)]
    analysis=aggregate(chunks,[[.05,.10,.05,.10,.40,.20,.05,.05],[.05,.10,.05,.30,.10,.30,.05,.05]],list(LABELS))
    trace={'execution':'on-device','runtime':'coreml','model':manifest['model'],'model_sha256':manifest['model_sha256'],
           'tokenizer_sha256':manifest['tokenizer_sha256'],'input_sha256':digest(TEXT),'duration_ms':100.,'load_ms':20.}
    return {'analysis':analysis,'trace':trace}

class PhoneClassifierTests(unittest.TestCase):
    def test_coverage_and_probability_validation_without_cloud_inference(self):
        result,trace=validate_phone_classification(fixture(),digest(TEXT))
        self.assertEqual(result['token_count'],140)
        self.assertEqual([c['aggregation_weight'] for c in result['chunks']],[110.,30.])
        self.assertAlmostEqual(sum(result['probabilities'].values()),1)
        self.assertEqual(sum(result['scores'].values()),100)

    def test_wrong_diary_and_model_identity_are_rejected(self):
        for key,value in [('input_sha256','0'*64),('model_sha256','0'*64),('tokenizer_sha256','0'*64),('execution','cloud'),('model','other')]:
            data=fixture();data['trace'][key]=value
            with self.assertRaises(ValueError):validate_phone_classification(data,digest(TEXT))

    def test_incomplete_coverage_and_wrong_overlap_are_rejected(self):
        for key,value in [('start_token',95),('end_token',139),('effective_tokens',47),('input_tokens',126),('index',5)]:
            data=fixture();data['analysis']['chunks'][1][key]=value
            with self.assertRaises(ValueError):validate_phone_classification(data,digest(TEXT))

    def test_aggregate_or_display_replacements_are_rejected(self):
        for kind in ['probabilities','scores','weight','metadata']:
            data=fixture()
            if kind=='probabilities':data['analysis']['probabilities']['Joy']+=.1
            if kind=='scores':data['analysis']['scores']['Joy']+=1
            if kind=='weight':data['analysis']['chunks'][0]['aggregation_weight']=126
            if kind=='metadata':data['analysis']['aggregation']['overlap_tokens']=0
            with self.assertRaises(ValueError):validate_phone_classification(data,digest(TEXT))

    def test_nan_and_unknown_labels_are_rejected(self):
        for kind in ['nan','labels','truncated','duration']:
            data=fixture()
            if kind=='nan':data['analysis']['chunks'][0]['probabilities']['Joy']=float('nan')
            if kind=='labels':data['analysis']['labels']=list(reversed(LABELS))
            if kind=='truncated':data['analysis']['truncated']=True
            if kind=='duration':data['trace']['duration_ms']=-1
            with self.assertRaises(ValueError):validate_phone_classification(data,digest(TEXT))

    def test_authenticated_registration_issues_bound_receipt_without_provider_call(self):
        save=AsyncMock();provider=Mock(side_effect=AssertionError('Cloud inference must not run'))
        finalized=AsyncMock(return_value='final-revision')
        app=FastAPI();app.include_router(router(lambda:'synthetic-user',save,'synthetic-test-secret-only',provider,finalized))
        client=TestClient(app)
        response=client.post('/mobile/emotions/on-device',json={'content':TEXT,'date_label':'2026-11-08','classification':fixture()})
        self.assertEqual(response.status_code,200,response.text)
        result=response.json();self.assertTrue(result['receipt_token'])
        self.assertEqual(result['classifier_execution'],'on-device')
        finalized.assert_awaited_once_with('synthetic-user','2026-11-08',TEXT)
        provider.assert_not_called();save.assert_not_called()

    def test_high_risk_registration_skips_scores(self):
        app=FastAPI();provider=Mock(side_effect=AssertionError('No cloud inference'))
        app.include_router(router(lambda:'synthetic-user',AsyncMock(),'synthetic-test-secret-only',provider))
        response=TestClient(app).post('/mobile/emotions/on-device',json={'content':'這是合成測試：我今晚想結束生命。','date_label':'2026-11-08','classification':fixture()})
        self.assertEqual(response.status_code,200)
        self.assertFalse(response.json()['classification_available']);provider.assert_not_called()

    def test_phone_receipt_commits_native_provenance_and_canonical_scores(self):
        from test_mobile_feedback import TRACE,CONTEXT
        save=AsyncMock(return_value={'synced':True});provider=Mock(side_effect=AssertionError('No cloud inference'))
        app=FastAPI();app.include_router(router(lambda:'synthetic-user',save,'synthetic-test-secret-only',provider))
        client=TestClient(app)
        registered=client.post('/mobile/emotions/on-device',json={'content':TEXT,'date_label':'2026-11-08','classification':fixture()}).json()
        support={'status':'completed','comfort':'這份努力值得被看見。','suggestions':[],'blessing':'','risk_level':'none',
                 'response_mode':'SUPPORT_MODE','safety_action':'none','context':CONTEXT,'generation':TRACE}
        response=client.post('/mobile/diaries',json={'content':TEXT,'date_label':'2026-11-08','entry_id':'phone_local_12345','kind':'daily',
            'receipt_token':registered['receipt_token'],'support':support})
        self.assertEqual(response.status_code,200,response.text)
        result=save.await_args.args[2]
        self.assertEqual(result['scores'],fixture()['analysis']['scores'])
        self.assertEqual(result['classifier_execution'],'on-device')
        self.assertEqual(result['classifier_provenance'],'client_reported_native_classifier')
        self.assertEqual(result['classifier_trace']['model_sha256'],fixture()['trace']['model_sha256'])
        provider.assert_not_called()

    def test_missing_final_date_is_rejected(self):
        app=FastAPI();app.include_router(router(lambda:'synthetic-user',AsyncMock(),'synthetic-test-secret-only'))
        self.assertEqual(TestClient(app).post('/mobile/emotions/on-device',json={'content':TEXT,'classification':fixture()}).status_code,422)

if __name__=='__main__':unittest.main()

class TranslatedClassificationTests(unittest.TestCase):
    def translation(self):
        from mobile_feedback import PHONE_SLM_DIGESTS
        model='qwen3.5-4b-q4_k_m'
        return dict(version='zh-en-faithful-v1',target_language='en',model=model,model_sha256=PHONE_SLM_DIGESTS[model],
                    text='I am happy after finishing my report, but worried about tomorrow.',
                    segments=[dict(source=TEXT,english='I am happy after finishing my report, but worried about tomorrow.')])

    def test_registration_binds_english_classifier_trace_and_original_chinese_diary(self):
        from mobile_feedback import ClassificationTranslation
        source=self.translation(); ClassificationTranslation(**source).verify_source(TEXT)
        data=fixture(); data['trace']['input_sha256']=digest(source['text'])
        app=FastAPI();app.include_router(router(lambda:'synthetic-user',AsyncMock(),'synthetic-test-secret-only'))
        client=TestClient(app)
        body=dict(content=TEXT,date_label='2026-11-08',classification=data,translation=source)
        response=client.post('/mobile/emotions/on-device',json=body)
        self.assertEqual(response.status_code,200,response.text)
        import jwt
        receipt=jwt.decode(response.json()['receipt_token'],'synthetic-test-secret-only',algorithms=['HS256'],audience='phone-emotions-v1')
        self.assertEqual(receipt['input_sha256'],digest(TEXT))
        self.assertEqual(receipt['classifier_trace']['input_sha256'],digest(source['text']))
        self.assertEqual(receipt['classification_translation'],source)
        for field in ['text','source','hash']:
            import copy
            bad=copy.deepcopy(body)
            if field=='text':bad['translation']['text']+=' changed'
            if field=='source':bad['translation']['segments'][0]['source']='別人的日記'
            if field=='hash':bad['classification']['trace']['input_sha256']=digest(TEXT)
            self.assertEqual(client.post('/mobile/emotions/on-device',json=bad).status_code,422)

    def test_translated_commit_accepts_missing_primary_evidence_without_changing_scores(self):
        from test_mobile_feedback import TRACE,CONTEXT
        source=self.translation();data=fixture();data['trace']['input_sha256']=digest(source['text'])
        save=AsyncMock(return_value={"synced":True})
        app=FastAPI();app.include_router(router(lambda:'synthetic-user',save,'synthetic-test-secret-only'))
        client=TestClient(app)
        receipt=client.post('/mobile/emotions/on-device',json=dict(content=TEXT,date_label='2026-11-08',classification=data,translation=source)).json()['receipt_token']
        support=dict(status='completed',comfort='我聽見你的感受。',suggestions=[],blessing='',risk_level='none',response_mode='SUPPORT_MODE',safety_action='none',context=CONTEXT,generation=TRACE,source_analysis_version='emotion-evidence-v4',emotion_sources=[])
        body=dict(content=TEXT,date_label='2026-11-08',entry_id='translated_daily_123',kind='daily',receipt_token=receipt,support=support)
        self.assertEqual(client.post('/mobile/diaries',json=body).status_code,200)
        self.assertEqual(save.await_args.args[2]['emotion_sources'],[])
        self.assertEqual(save.await_args.args[2]['scores'],data['analysis']['scores'])
        dominant=max(data['analysis']['probabilities'],key=data['analysis']['probabilities'].get)
        support['emotion_sources']=[dict(emotion=dominant,explanation='明天的事情讓我擔心。' if dominant=='Fear' else '完成報告讓我開心。',evidence=TEXT)]
        self.assertEqual(client.post('/mobile/diaries',json=body).status_code,200)
        self.assertEqual(save.await_args.args[2]['classification_translation'],source)
        self.assertEqual(save.await_args.args[2]['scores'],data['analysis']['scores'])
        support['emotion_sources'][0].update(coping_note='戴耳機仍無法專心。',additional_evidence=['原文沒有的句子。'])
        self.assertEqual(client.post('/mobile/diaries',json=body).status_code,422)
