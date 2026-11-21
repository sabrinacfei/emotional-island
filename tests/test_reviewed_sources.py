import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from fastapi import FastAPI, APIRouter, Header, HTTPException
from fastapi.testclient import TestClient
from reviewed_sources import ReviewedSources, source_revision, register_review_routes, within_demo_scope, DemoScope

RAW='原本負擔很重。同事肯定後，心情輕鬆了一些。'


def payload(record):
    annotations=[dict(emotion=e,level='direct' if e=='Trust' else 'unconfirmed',explanation='同事支持帶來安心。' if e=='Trust' else '目前無法從日記中確認具體原因。',evidence=[RAW] if e=='Trust' else []) for e in ['Joy','Sadness','Anger','Fear','Anticipation','Surprise','Disgust','Trust']]
    return dict(content=RAW,causes=[dict(type='buffer',topic='同事支持',explanation='同事肯定後，沉重心情緩和。',evidence=RAW,emotions=['Trust'])],emotion_sources=[dict(emotion='Trust',explanation='同事支持帶來安心。',evidence=RAW)],source_analysis_version='emotion-evidence-v5',review_id='test_review_version_1',expected_revision=source_revision(record),annotations=annotations,summary='同事支持緩和負擔。',change='原本沉重的心情有所緩和。',note='人工核對測試，保留模型原文。')


class ReviewedSourceTests(unittest.TestCase):
    def setUp(self):
        self.record=dict(_id='analysis-1',userId='owner',date_label='2026-11-24',final_content=RAW,causes=[],emotion_sources=[],scores={'Trust':.8,'Joy':.2},generation={'execution':'on-device','raw_text':'original model output'})
        self.db=SimpleNamespace(daily_diaries=SimpleNamespace(find_one=AsyncMock(return_value={'analysisId':'analysis-1'})),emotion_analyses=SimpleNamespace(find_one=AsyncMock(return_value=self.record),find_one_and_update=AsyncMock(return_value={**self.record,'source_review':{'origin':'human-reviewed'}})),daily_source_reviews=SimpleNamespace(insert_one=AsyncMock(),update_one=AsyncMock()),daily_diary_settings=SimpleNamespace(find_one=AsyncMock(return_value={}),update_one=AsyncMock()))
        async def current_user(authorization: str | None=Header(default=None)):
            if authorization!='Bearer owner-session':raise HTTPException(401,'Authentication required')
            return 'owner'
        self.workflow=SimpleNamespace(require_final=AsyncMock())
        api=APIRouter(prefix='/mobile');register_review_routes(api,self.db,current_user,lambda x:x,self.workflow)
        app=FastAPI();app.include_router(api);self.client=TestClient(app,headers={'Authorization':'Bearer owner-session'})

    def test_review_keeps_model_scores_and_generation_and_backs_up_original(self):
        response=self.client.put('/mobile/daily/2026-11-24/source-review',json=payload(self.record))
        self.assertEqual(response.status_code,200)
        query,update=self.db.emotion_analyses.find_one_and_update.await_args.args
        self.assertEqual(query['userId'],'owner')
        self.assertNotIn('scores',update['$set']);self.assertNotIn('generation',update['$set']);self.assertNotIn('classifier_trace',update['$set'])
        self.assertEqual(update['$set']['source_review']['origin'],'human-reviewed')
        audit=self.db.daily_source_reviews.insert_one.await_args.args[0]
        self.assertEqual(audit['before']['causes'],[]);self.assertEqual(audit['after']['causes'][0]['type'],'buffer')
        self.assertTrue(audit['model_generation_preserved'])

    def test_explicit_display_estimate_preserves_actual_model_output(self):
        body=payload(self.record)
        values=dict(Surprise=16,Anger=13,Disgust=10,Fear=14,Anticipation=12,Joy=12,Sadness=10,Trust=13)
        body['display_scores']=values
        self.assertEqual(self.client.put('/mobile/daily/2026-11-24/source-review',json=body).status_code,200)
        fields=self.db.emotion_analyses.find_one_and_update.await_args.args[1]['$set']
        self.assertNotIn('scores',fields)
        self.assertEqual(fields['source_review']['display_scores'],values)
        self.assertEqual(fields['source_review']['display_scores_origin'],'owner-provided-estimate')
        body['display_scores']['Joy']=11
        self.assertEqual(self.client.put('/mobile/daily/2026-11-24/source-review',json=body).status_code,422)

    def test_stale_revision_cannot_overwrite_new_sources(self):
        body=payload(self.record);body['expected_revision']='0'*64
        self.assertEqual(self.client.put('/mobile/daily/2026-11-24/source-review',json=body).status_code,409)
        self.db.emotion_analyses.find_one_and_update.assert_not_awaited()

    def test_invalid_evidence_and_unconfirmed_emotion_bindings_are_rejected(self):
        body=payload(self.record);body['annotations'][0]['evidence']=['不在日記中的原文']
        self.assertEqual(self.client.put('/mobile/daily/2026-11-24/source-review',json=body).status_code,422)
        body=payload(self.record);body['annotations'][-1]['level']='unconfirmed'
        self.assertEqual(self.client.put('/mobile/daily/2026-11-24/source-review',json=body).status_code,422)
        self.db.emotion_analyses.find_one_and_update.assert_not_awaited()

    def test_retry_same_review_does_not_create_another_revision(self):
        self.record['source_review']={'review_id':'test_review_version_1','origin':'human-reviewed'}
        response=self.client.put('/mobile/daily/2026-11-24/source-review',json=payload(self.record))
        self.assertEqual(response.status_code,200);self.db.daily_source_reviews.insert_one.assert_not_awaited()

    def test_authentication_and_unknown_fields_are_enforced(self):
        body=payload(self.record)
        self.assertEqual(self.client.put('/mobile/daily/2026-11-24/source-review',json=body,headers={'Authorization':'Bearer other'}).status_code,401)
        body['scores']={'Joy':1}
        self.assertEqual(self.client.put('/mobile/daily/2026-11-24/source-review',json=body).status_code,422)

    def test_demo_scope_hides_only_out_of_scope_generated_examples_without_deleting(self):
        scope={'month':'2026-11','dates':['2026-11-01','2026-11-24']}
        self.assertTrue(within_demo_scope({'date_label':'2026-11-24','data_origin':'generated-example'},scope))
        self.assertFalse(within_demo_scope({'date_label':'2026-11-16','data_origin':'generated-example'},scope))
        self.assertTrue(within_demo_scope({'date_label':'2026-11-16','data_origin':'user-diary'},scope))
        self.assertEqual(self.client.put('/mobile/demo-scope',json=scope).status_code,200)
        self.assertEqual(self.db.daily_diary_settings.update_one.await_args.args[1]['$set']['demo_scope'],scope)
        self.assertEqual(self.client.put('/mobile/demo-scope',json={'month':'2026-11','dates':['2026-12-01']}).status_code,422)


if __name__=='__main__':unittest.main()

class RouteRegistrationTests(unittest.TestCase):
    def test_workflow_registers_review_routes_exactly_once(self):
        from mobile_workflow_api import router
        api=router(SimpleNamespace(),lambda:'owner',lambda x:x)
        paths=[(r.path,tuple(sorted(r.methods)))for r in api.routes]
        self.assertEqual(len(paths),len(set(paths)))
