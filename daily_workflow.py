"""Daily state transitions. No language model runs on the server in phone mode."""
import hashlib
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

DEFAULTS = {"generate_time": "21:00", "confirmation_time": "08:00",
            "allow_auto_finalize": False, "timezone": "Asia/Taipei", "edit_window_minutes": 30}


def validate_settings(values):
    result = {**DEFAULTS, **values}
    try:
        for key in ("generate_time", "confirmation_time"):
            if time.fromisoformat(result[key]).strftime("%H:%M") != result[key]:
                raise ValueError()
        ZoneInfo(result["timezone"])
    except (ValueError, TypeError, ZoneInfoNotFoundError):
        raise HTTPException(422, "請選擇有效時間與 IANA 時區。") from None
    if not isinstance(result["allow_auto_finalize"], bool):
        raise HTTPException(422, "自動定稿設定必須為布林值。")
    return result


def schedule(day, settings):
    settings = validate_settings(settings)
    zone = ZoneInfo(settings["timezone"])
    scheduled = datetime.combine(date.fromisoformat(day), time.fromisoformat(settings["generate_time"]), zone)
    deadline = datetime.combine(date.fromisoformat(day), time.fromisoformat(settings["confirmation_time"]), zone)
    if deadline <= scheduled:
        deadline += timedelta(days=1)
    return scheduled.astimezone(timezone.utc), deadline.astimezone(timezone.utc)


def aware(value):
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def version(content):
    return hashlib.sha256(content.strip().encode()).hexdigest()


class DailyWorkflow:
    def __init__(self, db):
        self.db = db

    async def settings(self, uid):
        doc = await self.db.daily_diary_settings.find_one({"userId": uid}) or {}
        return validate_settings(doc)

    async def ensure(self, uid, day, now=None, early=False):
        now = now or datetime.now(timezone.utc)
        settings = await self.settings(uid)
        scheduled, deadline = schedule(day, settings)
        if now < scheduled and not early:
            return await self.db.daily_diaries.find_one({"userId": uid, "date_label": day})
        fragments = await self.db.conversations.find({"userId": uid, "date_label": day, "type": "fragment"}).sort("timestamp", 1).to_list(None)
        if not fragments:
            return None
        # Unique user/date index makes repeated scheduler and foreground requests idempotent.
        doc = await self.db.daily_diaries.find_one_and_update(
            {"userId": uid, "date_label": day}, {"$setOnInsert": {
                "userId": uid, "date_label": day, "fragment_ids": [x["_id"] for x in fragments],
                "draft_content": "", "status": "editing", "workflow_status": "pending_aggregation",
                "scheduled_at": scheduled, "confirmation_deadline": deadline, "editable_until": deadline,
                "timezone": settings["timezone"], "created_at": now, "updated_at": now,
            }}, upsert=True, return_document=ReturnDocument.AFTER)
        # Legacy drafts remain readable; never overwrite an original or an existing analysis.
        if not doc.get("workflow_status"):
            state = "analyzed" if doc.get("analysisId") else "pending_aggregation"
            await self.db.daily_diaries.update_one({"_id": doc["_id"], "workflow_status": {"$exists": False}},
                {"$set": {"workflow_status": state, "confirmation_deadline": deadline, "timezone": settings["timezone"]}})
            doc = await self.db.daily_diaries.find_one({"_id": doc["_id"]})
        if (doc.get("workflow_status") == "awaiting_confirmation"
                and doc.get("source_diary_ids") != [str(x["_id"]) for x in fragments]):
            await self.db.daily_diaries.update_one({"_id": doc["_id"], "workflow_status": "awaiting_confirmation"},
                {"$set": {"workflow_status": "pending_aggregation", "previous_draft": doc.get("draft_content", ""), "updated_at": now}})
            doc = await self.db.daily_diaries.find_one({"_id": doc["_id"]})
        if (doc.get("workflow_status") == "awaiting_confirmation" and settings["allow_auto_finalize"]
                and now >= aware(doc.get("confirmation_deadline", deadline))):
            doc = await self.confirm(uid, day, doc["draft_content"], auto=True)
        return doc

    async def sources(self, uid, day):
        rows = await self.db.conversations.find({"userId": uid, "date_label": day, "type": "fragment"}).sort("timestamp", 1).to_list(None)
        return [{"id": str(x["_id"]), "content": x["content"], "timestamp": aware(x["timestamp"]).isoformat()} for x in rows]

    async def draft(self, uid, day, content, source_ids):
        doc = await self.ensure(uid, day, early=True)
        if not doc:
            raise HTTPException(409, "此日期沒有小日記。")
        if doc.get("workflow_status") != "pending_aggregation":
            if doc.get("draft_content") == content.strip():
                return doc
            raise HTTPException(409, "草稿狀態已更新，請重新讀取。")
        sources = await self.sources(uid, day)
        if source_ids != [x["id"] for x in sources]:
            raise HTTPException(409, "小日記已新增或更新，請重新整理完整來源。")
        if not content.strip() or len(content) > 12000:
            raise HTTPException(422, "草稿內容長度不符。")
        await self.db.daily_diaries.update_one({"_id": doc["_id"], "workflow_status": "pending_aggregation"}, {"$set": {
            "draft_content": content.strip(), "fragment_ids": [x["_id"] for x in await self.db.conversations.find(
                {"userId": uid, "date_label": day, "type": "fragment"}).sort("timestamp", 1).to_list(None)],
            "source_diary_ids": source_ids, "workflow_status": "awaiting_confirmation", "draft_source": "phone-qwen3.5-4b",
            "generated_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}})
        return await self.db.daily_diaries.find_one({"_id": doc["_id"]})

    async def confirm(self, uid, day, content, auto=False):
        doc = await self.db.daily_diaries.find_one({"userId": uid, "date_label": day})
        if not doc or doc.get("workflow_status") == "pending_aggregation":
            raise HTTPException(409, "請先完成每日草稿。")
        if doc.get("workflow_status") in {"finalized_pending_analysis", "analyzed"}:
            if doc.get("final_content") != content.strip():
                raise HTTPException(409, "此日期已定稿，請勿以舊草稿覆蓋。")
            return doc
        sources = await self.sources(uid, day)
        if doc.get("source_diary_ids") != [x["id"] for x in sources]:
            await self.db.daily_diaries.update_one({"_id": doc["_id"], "workflow_status": "awaiting_confirmation"},
                {"$set": {"workflow_status": "pending_aggregation", "previous_draft": doc.get("draft_content", "")}})
            raise HTTPException(409, "小日記已新增，請重新整理後再確認。")
        if not content.strip() or len(content) > 12000:
            raise HTTPException(422, "日記內容長度不符。")
        now = datetime.now(timezone.utc)
        await self.db.daily_diaries.update_one({"_id": doc["_id"], "workflow_status": "awaiting_confirmation"}, {"$set": {
            "status": "finalized", "workflow_status": "finalized_pending_analysis", "final_content": content.strip(),
            "final_revision": version(content), "finalized_at": now, "auto_finalized": auto, "updated_at": now}})
        result = await self.db.daily_diaries.find_one({"_id": doc["_id"]})
        if result.get("final_content") != content.strip():
            raise HTTPException(409, "另一項操作已定稿，請重新讀取。")
        return result

    async def require_final(self, uid, day, content):
        doc = await self.db.daily_diaries.find_one({"userId": uid, "date_label": day})
        if (not doc or doc.get("workflow_status") not in {"finalized_pending_analysis", "analyzed"}
                or doc.get("final_revision") != version(content)):
            raise HTTPException(409, "正式分類僅接受已確認定稿的每日日記。")
        return doc["final_revision"]
