"""Integration contracts against a dedicated local MongoDB, with classifier/native doubles."""
import os
from pathlib import Path
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import Mock
from fastapi.testclient import TestClient
from pymongo import MongoClient
from bson import ObjectId

os.environ.update(MONGODB_URL='mongodb://127.0.0.1:27029', DATABASE_NAME='workflow_acceptance_20261106', JWT_SECRET='synthetic-workflow-test-secret-only', PHONE_SLM_ONLY='1')
fixture=Path(__file__).with_name('empty-test.env'); fixture.touch()
os.environ['EMOTIONAL_ISLAND_ENV_FILE']=str(fixture)
import main
import classifier_gateway
from modernbert_chunking import aggregate, LABELS
from daily_workflow import schedule

SCORES=dict(Anger=10,Anticipation=0,Disgust=0,Fear=30,Joy=0,Sadness=60,Surprise=0,Trust=0)
RAW='今天報告受到批評，覺得委屈。只想被傾聽。'
CONTEXT=dict(event_context='報告受到批評。',emotional_context='委屈。',main_concern='被理解。',coping_already_tried='未提及',support_preference='只想被傾聽。')
TRACE=dict(execution='on-device',runtime='llama.rn@0.13.0-rc.9',model='qwen3.5-4b-q4_k_m',sha256='a9d0a3e1d8c91732a3812becd31f8d4a8ff57414903f226306069f0437e2ac50',tokens_predicted=10,duration_ms=200.,tokens_per_second=50.,stopped_eos=True,raw_text='{"comfort":"synthetic fixture"}')
SUPPORT=dict(status='completed',comfort='這份委屈可以慢慢說。',suggestions=[],blessing='',risk_level='none',response_mode='SUPPORT_MODE',safety_action='none',context=CONTEXT,generation=TRACE,causes=[])

class WorkflowIntegration(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  main.post_expo_push_messages=lambda _: {'data': []}
  result=aggregate([dict(index=0,start_token=0,end_token=1,effective_tokens=1,input_ids=[1,2,3])],[[SCORES[k.title()]/100 for k in LABELS]],list(LABELS))
  cls.classifier=Mock(return_value=dict(backend='modernbert',available=True,**result))
  cls.original_classifier=classifier_gateway.predict
  classifier_gateway.predict=cls.classifier
  cls.mongo=MongoClient(os.environ['MONGODB_URL'],serverSelectionTimeoutMS=3000)
  cls.db=cls.mongo[os.environ['DATABASE_NAME']]
  cls.client=TestClient(main.app);cls.client.__enter__()
 @classmethod
 def tearDownClass(cls):
  cls.client.__exit__(None,None,None);cls.mongo.close()
  classifier_gateway.predict=cls.original_classifier
 def setUp(self):
  self.uid=ObjectId();self.token=main.create_token(str(self.uid))
  self.headers={'Authorization':'Bearer '+self.token}
  self.day=(datetime.now(timezone.utc)-timedelta(days=2)).date().isoformat()
  self.classifier.reset_mock()
 def post(self,path,data):
  return self.client.post(path,json=data,headers=self.headers)
 def fragment(self,entry='synthetic_fragment_1',text=RAW):
  return self.post('/mobile/fragments',dict(entry_id=entry,content=text,created_at=self.day+'T12:00:00+00:00'))
 def draft(self):
  self.fragment()
  sources=self.client.get('/mobile/daily/'+self.day+'/sources',headers=self.headers).json()['sources']
  return self.post('/mobile/daily/'+self.day+'/draft',dict(content=RAW,source_ids=[x['id'] for x in sources]))
 def final(self):
  self.draft();return self.post('/mobile/daily/'+self.day+'/confirm',dict(content=RAW))
 def test_fragment_saved_without_classifier_formal_analysis_or_tree(self):
  self.assertEqual(self.fragment().status_code,200)
  self.assertEqual(self.fragment().status_code,200)
  self.assertEqual(self.db.conversations.count_documents({'userId':self.uid}),1)
  self.assertEqual(self.db.emotion_analyses.count_documents({'userId':self.uid}),0)
  self.assertEqual(self.db.emotion_trends.count_documents({'userId':self.uid}),0)
  self.classifier.assert_not_called()
 def test_fragment_support_never_requires_or_accepts_classifier_receipt(self):
  self.fragment()
  payload=dict(entry_id='synthetic_fragment_1',kind='fragment',content=RAW,date_label=None,receipt_token=None,support=SUPPORT)
  self.assertEqual(self.post('/mobile/diaries',payload).status_code,200)
  doc=self.db.conversations.find_one({'userId':self.uid})
  self.assertEqual(doc['support_status'],'completed');self.assertIsNone(doc['scores'])
  payload['receipt_token']='anything';self.assertEqual(self.post('/mobile/diaries',payload).status_code,422)
  self.classifier.assert_not_called()
 def test_classification_requires_matching_final_daily_content(self):
  self.assertEqual(self.post('/mobile/emotions',dict(content=RAW,date_label=self.day)).status_code,409)
  self.draft()
  self.assertEqual(self.post('/mobile/emotions',dict(content=RAW,date_label=self.day)).status_code,409)
  self.post('/mobile/daily/'+self.day+'/confirm',dict(content=RAW))
  self.assertEqual(self.post('/mobile/emotions',dict(content=RAW+'changed',date_label=self.day)).status_code,409)
  self.assertEqual(self.post('/mobile/emotions',dict(content=RAW,date_label=self.day)).status_code,200)
  self.assertEqual(self.classifier.call_count,1)
 def test_confirm_retry_and_formal_commit_create_one_daily_analysis(self):
  self.final()
  self.assertEqual(self.post('/mobile/daily/'+self.day+'/confirm',dict(content=RAW)).status_code,200)
  receipt=self.post('/mobile/emotions',dict(content=RAW,date_label=self.day)).json()['receipt_token']
  support={**SUPPORT,'causes':[dict(type='stressor',topic='報告評價',explanation='報告被批評與委屈感同時出現。',evidence='報告受到批評',emotions=['Sadness'])]}
  payload=dict(entry_id='synthetic_daily_123',kind='daily',content=RAW,date_label=self.day,receipt_token=receipt,support=support)
  self.assertEqual(self.post('/mobile/diaries',payload).status_code,200)
  payload['entry_id']='synthetic_daily_retry';self.assertEqual(self.post('/mobile/diaries',payload).status_code,200)
  self.assertEqual(self.db.daily_diaries.count_documents({'userId':self.uid}),1)
  self.assertEqual(self.db.emotion_analyses.count_documents({'userId':self.uid}),1)
  self.assertEqual(self.db.emotion_trends.count_documents({'userId':self.uid}),1)
  self.assertEqual(self.db.daily_diaries.find_one({'userId':self.uid})['workflow_status'],'analyzed')
  history=self.client.get('/history',headers=self.headers).json()
  trends=self.client.get('/trends',headers=self.headers).json()
  weekly=self.client.get('/mobile/weekly/'+self.day,headers=self.headers).json()
  self.assertEqual(len(history),1);self.assertEqual(len(trends),1)
  self.assertEqual(history[0]['scores'],trends[0]['average_scores'])
  self.assertEqual(weekly['analyzed_days'],1)
  self.assertEqual(weekly['days'][0]['analysis']['scores'],history[0]['scores'])
  self.assertTrue(all(x['analysis'] is None for x in weekly['days'][1:]))
  self.assertEqual(weekly['recurring_factors'][0]['occurrences'][0]['evidence'],'報告受到批評')
  refresh='/mobile/daily/'+self.day+'/refresh-sources'
  source=dict(emotion='Sadness',explanation='被批評後感到委屈。',evidence='覺得委屈')
  self.assertEqual(self.post(refresh,dict(content=RAW,emotion_sources=[{**source,'evidence':'沒有寫過'}])).status_code,422)
  self.assertEqual(self.post(refresh,dict(content=RAW+'不同',emotion_sources=[source])).status_code,409)
  updated=self.post(refresh,dict(content=RAW,emotion_sources=[source])).json()
  self.assertEqual(updated['emotion_sources'],[source])
  self.assertEqual(updated['stressor_tags'],history[0]['stressor_tags'])
  self.assertEqual(updated['final_content'],history[0]['final_content'])
  self.assertEqual(updated['scores'],history[0]['scores'])
 def test_closed_app_has_pending_aggregation_not_fake_generated_draft(self):
  self.fragment()
  for _ in range(2):
   r=self.client.get('/mobile/daily/pending',headers=self.headers);self.assertEqual(r.status_code,200)
  doc=self.db.daily_diaries.find_one({'userId':self.uid})
  self.assertEqual(doc['workflow_status'],'pending_aggregation');self.assertEqual(doc['draft_content'],'')
  self.assertEqual(self.db.daily_diaries.count_documents({'userId':self.uid}),1)
 def test_auto_finalization_requires_permission_and_completed_draft(self):
  self.db.daily_diary_settings.insert_one(dict(userId=self.uid,generate_time='21:00',confirmation_time='08:00',allow_auto_finalize=True,timezone='Asia/Taipei'))
  self.fragment();self.client.get('/mobile/daily/pending',headers=self.headers)
  self.assertEqual(self.db.daily_diaries.find_one({'userId':self.uid})['workflow_status'],'pending_aggregation')
  self.draft()
  for _ in range(2):self.client.get('/mobile/daily/pending',headers=self.headers)
  doc=self.db.daily_diaries.find_one({'userId':self.uid})
  self.assertEqual(doc['workflow_status'],'finalized_pending_analysis');self.assertTrue(doc['auto_finalized'])
  self.classifier.assert_not_called()
 def test_no_auto_finalization_without_permission(self):
  self.draft();self.client.get('/mobile/daily/pending',headers=self.headers)
  self.assertEqual(self.db.daily_diaries.find_one({'userId':self.uid})['workflow_status'],'awaiting_confirmation')
 def test_new_fragment_before_automatic_deadline_requeues_instead_of_breaking_pending(self):
  self.db.daily_diary_settings.insert_one(dict(userId=self.uid,generate_time='21:00',confirmation_time='08:00',allow_auto_finalize=True,timezone='Asia/Taipei'))
  self.draft();self.fragment('synthetic_fragment_2','晚上和朋友聊天。')
  response=self.client.get('/mobile/daily/pending',headers=self.headers)
  self.assertEqual(response.status_code,200)
  self.assertEqual(response.json()['pending'][0]['workflow_status'],'pending_aggregation')
  self.classifier.assert_not_called()
 def test_added_fragment_invalidates_unconfirmed_draft(self):
  self.draft();self.fragment('synthetic_fragment_2','晚上和朋友聊天。')
  self.assertEqual(self.post('/mobile/daily/'+self.day+'/confirm',dict(content=RAW)).status_code,409)
  self.assertEqual(self.db.daily_diaries.find_one({'userId':self.uid})['workflow_status'],'pending_aggregation')
 def test_missing_days_are_null_and_user_data_is_isolated(self):
  self.fragment()
  other={'Authorization':'Bearer '+main.create_token(str(ObjectId()))}
  r=self.client.get('/mobile/daily/'+self.day+'/sources',headers=other)
  self.assertEqual(r.json()['sources'],[])
  r=self.client.get('/mobile/weekly/'+self.day,headers=self.headers)
  self.assertEqual(len(r.json()['days']),7)
  self.assertTrue(all(x['analysis'] is None for x in r.json()['days']))
 def test_cross_midnight_and_timezone_schedule(self):
  start,end=schedule('2026-11-06',dict(generate_time='23:00',confirmation_time='08:00',timezone='Asia/Taipei'))
  self.assertEqual((end-start).total_seconds(),9*3600)
  self.assertEqual(end.isoformat(),'2026-11-07T00:00:00+00:00')
 def test_authentication_and_invalid_zone(self):
  self.assertIn(self.client.post('/mobile/fragments',json={}).status_code,[401,403])
  r=self.client.patch('/daily-diary/settings',headers=self.headers,json={'timezone':'invalid/zone'})
  self.assertEqual(r.status_code,422)

if __name__=='__main__':unittest.main()
