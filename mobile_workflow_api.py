"""Authenticated fragment/draft/final and weekly read APIs. No third-party LLM."""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from pymongo import ReturnDocument
from daily_workflow import DailyWorkflow


class Fragment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    entry_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,100}$")
    content: str = Field(min_length=1, max_length=12000)
    created_at: datetime


class Draft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=12000)
    source_ids: list[str] = Field(min_length=1)


class Final(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1, max_length=12000)


def weekly_summary(start, analyses):
    first = date.fromisoformat(start)
    by_date = {x["date_label"]: x for x in analyses if x.get("classification_available") is True}
    days, factors = [], {}
    for offset in range(7):
        day = (first + timedelta(days=offset)).isoformat()
        row = by_date.get(day)
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
        return serialize(await workflow.draft(uid, day, data.content, data.source_ids))

    @api.post("/daily/{day}/confirm")
    async def confirm(day: str, data: Final, uid=Depends(current_user)):
        valid_day(day)
        return serialize(await workflow.confirm(uid, day, data.content))

    @api.get("/weekly/{start}")
    async def weekly(start: str, uid=Depends(current_user)):
        end = valid_day(start) + timedelta(days=6)
        rows = await db.emotion_analyses.find({"userId": uid, "analysis_type": "daily",
            "date_label": {"$gte": start, "$lte": end.isoformat()}}).sort("analyzed_at", 1).to_list(None)
        result = weekly_summary(start, [serialize(x) for x in rows])
        return result

    return api
