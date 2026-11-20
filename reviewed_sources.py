"""Owner-reviewed source overlays with immutable model provenance and revision backups."""
import hashlib
import json
from datetime import date, datetime, timezone
from typing import Literal
from fastapi import Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ReturnDocument
from mobile_feedback import SourceDetails, EmotionSource, daily_source_fields

REVIEW_FIELDS = ('causes', 'emotion_sources', 'source_analysis_version', 'emotion_reasons', 'stressor_tags', 'buffer_tags', 'joy_tags', 'analysis_notes', 'one_line_summary', 'summary', 'source_review')


def source_revision(record):
    value = {key: record.get(key) for key in REVIEW_FIELDS}
    value['final_content'] = record.get('final_content')
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()


class EvidenceAnnotation(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    emotion: Literal['Joy', 'Sadness', 'Anger', 'Fear', 'Anticipation', 'Surprise', 'Disgust', 'Trust']
    level: Literal['direct', 'inferred', 'unconfirmed']
    explanation: str = Field(min_length=1, max_length=240)
    evidence: list[str] = Field(default_factory=list, max_length=3)


class ReviewedSources(SourceDetails):
    content: str = Field(min_length=1, max_length=12000)
    emotion_sources: list[EmotionSource] = Field(max_length=8)
    review_id: str = Field(pattern=r'^[A-Za-z0-9_-]{8,100}$')
    expected_revision: str = Field(pattern=r'^[a-f0-9]{64}$')
    annotations: list[EvidenceAnnotation] = Field(min_length=8, max_length=8)
    summary: str = Field(min_length=1, max_length=500)
    change: str = Field(min_length=1, max_length=1000)
    note: str = Field(min_length=1, max_length=500)

    def verify_review(self):
        self.verify_evidence(self.content)
        levels = {item.emotion: item for item in self.annotations}
        if len(levels) != 8:
            raise HTTPException(422, '八類情緒需各有一筆證據狀態。')
        bound = {source.emotion for source in self.emotion_sources}
        for item in self.annotations:
            if any(not 2 <= len(text.strip()) <= 600 or text not in self.content for text in item.evidence):
                raise HTTPException(422, '人工核對仍需使用可比對的中文原文。')
            if item.level == 'unconfirmed':
                if item.emotion in bound or any(item.emotion in c.emotions for c in self.causes):
                    raise HTTPException(422, '缺少依據的情緒不可綁定來源。')
            elif not item.evidence or item.emotion not in bound:
                raise HTTPException(422, '直接或推論來源需有原文與對應情緒說明。')


class DemoScope(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    month: str = Field(pattern=r'^\d{4}-\d{2}$')
    dates: list[str] = Field(min_length=1, max_length=31)

    def validated_dates(self):
        try:
            dates = sorted(set(date.fromisoformat(day).isoformat() for day in self.dates))
        except ValueError:
            raise HTTPException(422, '展示日期不正確。') from None
        if any(not day.startswith(self.month + '-') for day in dates):
            raise HTTPException(422, '展示日期需屬於指定月份。')
        return dates


def within_demo_scope(row, scope):
    if not scope or row.get('data_origin') != 'generated-example':
        return True
    label = row.get('date_label') or ''
    return not label.startswith(scope.get('month', '') + '-') or label in scope.get('dates', [])


def register_review_routes(api, db, current_user, serialize, workflow):
    async def record_for(uid, day):
        try:
            date.fromisoformat(day)
        except ValueError:
            raise HTTPException(422, '日期格式不符。') from None
        diary = await db.daily_diaries.find_one({'userId': uid, 'date_label': day, 'workflow_status': 'analyzed'})
        record = await db.emotion_analyses.find_one({'_id': diary.get('analysisId'), 'userId': uid, 'date_label': day}) if diary else None
        if not record:
            raise HTTPException(409, '請先完成該日的日記與分類。')
        return record

    @api.get('/daily/{day}/source-review')
    async def get_review(day: str, uid=Depends(current_user)):
        record = await record_for(uid, day)
        return {'revision': source_revision(record), 'record': serialize(record)}

    @api.put('/daily/{day}/source-review')
    async def save_review(day: str, data: ReviewedSources, uid=Depends(current_user)):
        data.verify_review()
        await workflow.require_final(uid, day, data.content)
        record = await record_for(uid, day)
        if (record.get('source_review') or {}).get('review_id') == data.review_id:
            return serialize(record)
        if source_revision(record) != data.expected_revision:
            raise HTTPException(409, '分析內容已變更，請重新讀取後核對。')
        annotations = {item.emotion: item.model_dump() for item in data.annotations}
        causes = [item.model_dump() for item in data.causes]
        fields = daily_source_fields(causes, [item.model_dump(exclude_none=True, exclude_defaults=True) for item in data.emotion_sources], data.source_analysis_version)
        now = datetime.now(timezone.utc)
        fields.update(analysis_notes=data.change, one_line_summary=data.summary, summary=data.summary,
                      source_review={'origin': 'human-reviewed', 'review_id': data.review_id,
                                     'reviewed_at': now.isoformat(), 'reviewer_user_id': str(uid),
                                     'note': data.note, 'annotations': annotations})
        audit = {'userId': uid, 'date_label': day, 'review_id': data.review_id, 'created_at': now,
                 'before': {key: record.get(key) for key in REVIEW_FIELDS}, 'after': fields,
                 'model_generation_preserved': True, 'scores_preserved': True, 'status': 'prepared'}
        await db.daily_source_reviews.insert_one(audit)
        query = {'_id': record['_id'], 'userId': uid, 'causes': record.get('causes', []), 'emotion_sources': record.get('emotion_sources'), 'source_review': record.get('source_review')}
        updated = await db.emotion_analyses.find_one_and_update(query, {'$set': fields}, return_document=ReturnDocument.AFTER)
        if not updated:
            raise HTTPException(409, '來源同時被更新，原始核對草稿已保留。')
        await db.daily_source_reviews.update_one({'userId': uid, 'review_id': data.review_id}, {'$set': {'status': 'applied'}})
        return serialize(updated)

    @api.get('/demo-scope')
    async def get_demo_scope(uid=Depends(current_user)):
        settings = await db.daily_diary_settings.find_one({'userId': uid}) or {}
        return {'scope': settings.get('demo_scope')}

    @api.put('/demo-scope')
    async def save_demo_scope(data: DemoScope, uid=Depends(current_user)):
        scope = {'month': data.month, 'dates': data.validated_dates()}
        await db.daily_diary_settings.update_one({'userId': uid}, {'$set': {'demo_scope': scope}}, upsert=True)
        return {'scope': scope, 'records_deleted': 0}
