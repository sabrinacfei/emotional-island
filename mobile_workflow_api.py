"""Authenticated fragment/draft/final and weekly read APIs. No third-party LLM."""
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from pymongo import ReturnDocument
from daily_workflow import DailyWorkflow
from mobile_feedback import EmotionSource, SourceDetails, daily_source_fields
from slm_schemas import Scores


class Fragment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entry_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,100}$")
    content: str = Field(min_length=1, max_length=12000)
    created_at: datetime


class Draft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=12000)
    source_ids: list[str] = Field(min_length=1)
    draft_source: Literal["phone-qwen3.5-2b", "phone-qwen3.5-4b"] = "phone-qwen3.5-4b"


class Final(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=12000)


class SourceRefresh(SourceDetails):
    content: str = Field(min_length=1, max_length=12000)
    emotion_sources: list[EmotionSource] = Field(max_length=8)


def has_classification(row):
    scores = row.get("scores") or {}
    return row.get("classification_available") is not False and isinstance(scores, dict) and any(
        type(value) in (int, float) and 0 < value <= 100
        for key, value in scores.items() if key in Scores.model_fields
    )


def weekly_summary(start, analyses):
    first = date.fromisoformat(start)
    by_date = {x["date_label"]: x for x in analyses}
    days, factors = [], {}
    for offset in range(7):
        day = (first + timedelta(days=offset)).isoformat()
        row = by_date.get(day)
        if row and not has_classification(row):
            row = None
        days.append({"date": day, "status": "analyzed" if row else "missing", "analysis": row})
        if not row:
            continue
        for item in row.get("causes", []):
            if not item.get("evidence") or item["evidence"] not in row.get("final_content", ""):
                continue
            key = (item["type"], item["topic"].strip())
            factor = factors.setdefault(key, {"type": key[0], "topic": key[1], "occurrences": []})
            factor["occurrences"].append({"date": day, "emotions": item["emotions"], "event": item["explanation"], "evidence": item["evidence"]})
    return {"week_start": start, "week_end": days[-1]["date"], "days": days,
            "analyzed_days": sum(x["status"] == "analyzed" for x in days),
            "recurring_factors": sorted(factors.values(), key=lambda x: -len({y["date"] for y in x["occurrences"]})),
            "interpretation": "事件與分類結果的共同出現，不代表因果關係。"}


def router(db, current_user, serialize):
    api = APIRouter(prefix="/mobile", tags=["Daily workflow"])
    workflow = DailyWorkflow(db)

    def valid_day(day):
        try:
            return date.fromisoformat(day)
        except ValueError:
            raise HTTPException(422, "日期格式不符。") from None

    @api.post("/fragments")
    async def save_fragment(data: Fragment, uid=Depends(current_user)):
        if not data.content.strip() or data.created_at.tzinfo is None or data.created_at > datetime.now(timezone.utc) + timedelta(minutes=5):
            raise HTTPException(422, "內容或記錄時間不符。")
        settings = await workflow.settings(uid)
        day = data.created_at.astimezone(ZoneInfo(settings["timezone"])).date().isoformat()
        doc = await db.conversations.find_one_and_update({"userId": uid, "mobile_entry_id": data.entry_id}, {"$setOnInsert": {
            "userId": uid, "mobile_entry_id": data.entry_id, "type": "fragment", "content": data.content.strip(),
            "date_label": day, "timestamp": data.created_at, "created_at": datetime.now(timezone.utc),
            "status": "saved", "support_status": "pending", "processing_mode": "phone_slm_v1"}},
            upsert=True, return_document=ReturnDocument.AFTER)
        if doc.get("content") != data.content.strip() or doc.get("type") != "fragment":
            raise HTTPException(409, "記錄識別碼已用於其他內容。")
        return {"saved": True, "fragment": serialize(doc)}

    @api.get("/daily/pending")
    async def pending(uid=Depends(current_user)):
        # Scan actual recorded dates so missed jobs survive a phone/server being asleep for days.
        labels = await db.conversations.distinct("date_label", {"userId": uid, "type": "fragment"})
        for day in sorted(labels):
            await workflow.ensure(uid, day)
        rows = await db.daily_diaries.find({"userId": uid, "workflow_status": {"$in": [
            "pending_aggregation", "awaiting_confirmation", "finalized_pending_analysis"]}}).sort("date_label", 1).to_list(None)
        return {"pending": [serialize(x) for x in rows]}

    @api.get("/daily/{day}/sources")
    async def sources(day: str, uid=Depends(current_user)):
        valid_day(day)
        doc = await workflow.ensure(uid, day, early=True)
        return {"daily": serialize(doc) if doc else None, "sources": await workflow.sources(uid, day)}

    @api.post("/daily/{day}/draft")
    async def draft(day: str, data: Draft, uid=Depends(current_user)):
        valid_day(day)
        return serialize(await workflow.draft(uid, day, data.content, data.source_ids, data.draft_source))

    @api.post("/daily/{day}/confirm")
    async def confirm(day: str, data: Final, uid=Depends(current_user)):
        valid_day(day)
        return serialize(await workflow.confirm(uid, day, data.content))

    @api.post("/daily/{day}/refresh-sources")
    async def refresh_sources(day: str, data: SourceRefresh, uid=Depends(current_user)):
        valid_day(day)
        await workflow.require_final(uid, day, data.content)
        data.verify_evidence(data.content)
        diary = await db.daily_diaries.find_one({"userId": uid, "date_label": day, "workflow_status": "analyzed"})
        if not diary or not diary.get("analysisId"):
            raise HTTPException(409, "請先完成當日分析。")
        query = {"_id": diary["analysisId"], "userId": uid, "date_label": day, "final_content": data.content,
                 "processing_mode": "phone_slm_v1", "classification_available": True, "risk_level": {"$ne": "high"}}
        record = await db.emotion_analyses.find_one(query)
        if not record:
            raise HTTPException(409, "此日記目前無法補充情緒來源。")
        causes = [item.model_dump() for item in data.causes]
        categories = {item["type"] for item in causes}
        causes.extend(c for c in record.get("causes", [])
                      if c["type"] not in categories and c.get("evidence") and c["evidence"] in data.content)
        fields = daily_source_fields(causes, [item.model_dump() for item in data.emotion_sources])
        updated = await db.emotion_analyses.find_one_and_update(query, {"$set": fields}, return_document=ReturnDocument.AFTER)
        if not updated:
            raise HTTPException(409, "當日分析已變更，請重新開啟。")
        return serialize(updated)

    @api.get("/weekly/{start}")
    async def weekly(start: str, uid=Depends(current_user)):
        end = valid_day(start) + timedelta(days=6)
        rows = await db.emotion_analyses.find({"userId": uid,
            "$or": [{"analysis_type": "daily"}, {"daily_content": {"$exists": True}}, {"final_content": {"$exists": True}}],
            "date_label": {"$gte": start, "$lte": end.isoformat()}}).sort([("analyzed_at", 1), ("_id", 1)]).to_list(None)
        result = weekly_summary(start, [serialize(x) for x in rows])
        return result

    return api
