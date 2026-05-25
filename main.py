from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from bson.errors import InvalidId
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager, suppress
from typing import List, Dict, Optional, Any
from pydantic import BaseModel, EmailStr, Field, ConfigDict
import bcrypt
import hmac
import jwt
import os
import asyncio
import json
import re
import urllib.request
import urllib.error
from dotenv import load_dotenv

# ──────────────────────────────────────────
# 設定
# ──────────────────────────────────────────

load_dotenv()

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "emotion_tracker_db")
JWT_SECRET  = os.getenv("JWT_SECRET", "your-secret-key-change-in-production")
JWT_EXPIRE_DAYS = 30
APP_TZ = timezone(timedelta(hours=8))
DEFAULT_DAILY_SETTINGS = {
    "generate_time": "21:00",
    "edit_window_minutes": 30,
}
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
CRON_SECRET = os.getenv("CRON_SECRET", "")

mongo_client = AsyncIOMotorClient(MONGODB_URL)
db = mongo_client[DATABASE_NAME]
bearer = HTTPBearer()


# ──────────────────────────────────────────
# Pydantic Models
# ──────────────────────────────────────────

class RegisterInput(BaseModel):
    username: str
    email: EmailStr
    password: str

class LoginInput(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    username: str
    email: EmailStr
    created_at: datetime
    avatar: Optional[str] = None
    onboarding_seen: Optional[bool] = None
    birth_date: Optional[str] = None
    phone: Optional[str] = None
    identity_completed: Optional[bool] = None
    push_enabled: Optional[bool] = None

class CreateAnalysisInput(BaseModel):
    conversation_id: str = Field(alias="conversationId")
    scores: Dict[str, float]
    summary: str
    model_config = ConfigDict(populate_by_name=True)

class DiaryInput(BaseModel):
    content: str

class HistoricalFragmentInput(BaseModel):
    time_label: str
    content: str

class HistoricalDayImportInput(BaseModel):
    date_label: str
    fragments: List[HistoricalFragmentInput]
    replace_existing: bool = True

class HistoricalReanalysisInput(BaseModel):
    date_labels: List[str]

class DailyDiaryFinalizeInput(BaseModel):
    final_content: str

class DailyDiarySettingsPatch(BaseModel):
    generate_time: Optional[str] = None
    edit_window_minutes: Optional[int] = None

class NotificationReadInput(BaseModel):
    ids: Optional[List[str]] = None

class PushTokenInput(BaseModel):
    token: str
    platform: Optional[str] = None
    device_id: Optional[str] = None

class ChangeEmailInput(BaseModel):
    new_email: EmailStr
    password: str

class ChangePasswordInput(BaseModel):
    current_password: str
    new_password: str

class VerifyPasswordInput(BaseModel):
    email: Optional[EmailStr] = None
    password: str

class ResetPasswordByPhoneInput(BaseModel):
    email: EmailStr
    phone: str
    new_password: str


# ──────────────────────────────────────────
# 工具函式
# ──────────────────────────────────────────

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

def normalize_email(email: str) -> str:
    return str(email).strip().lower()

def validate_account_email(email: str) -> str:
    normalized = normalize_email(email)
    if not normalized.endswith("@test.com"):
        raise HTTPException(status_code=400, detail="請使用 @test.com")
    return normalized

def validate_account_password(password: str) -> str:
    if (
        len(password) < 8
        or not re.search(r"[A-Z]", password)
        or not re.search(r"[a-z]", password)
        or not re.search(r"\d", password)
    ):
        raise HTTPException(status_code=400, detail="密碼不得少於8位且必須包含英文大小寫、數字")
    return password

def normalize_phone(phone: str) -> str:
    normalized = re.sub(r"[\s\-()]", "", str(phone or ""))
    if not re.fullmatch(r"09\d{8}", normalized):
        raise HTTPException(status_code=400, detail="請用09開頭，輸入正確手機號碼，共10位")
    return normalized

def validate_birth_date(value: str) -> str:
    try:
        birthday = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="出生年月日格式需為 YYYY-MM-DD")
    if birthday > datetime.now(APP_TZ).date():
        raise HTTPException(status_code=400, detail="出生年月日不可晚於今天")
    return birthday.isoformat()

def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def decode_token(token: str) -> str:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token 已過期，請重新登入")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="無效的 Token")

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> ObjectId:
    user_id = decode_token(credentials.credentials)
    try:
        return ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=401, detail="無效的使用者 ID")

def require_cron_secret(x_cron_secret: Optional[str] = Header(default=None)) -> None:
    if not CRON_SECRET:
        raise HTTPException(status_code=503, detail="排程密鑰尚未設定")
    if not x_cron_secret or not hmac.compare_digest(x_cron_secret, CRON_SECRET):
        raise HTTPException(status_code=401, detail="無效的排程密鑰")

def json_ready(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [json_ready(v) for v in value]
    if isinstance(value, dict):
        return {k: json_ready(v) for k, v in value.items()}
    return value

def serialize_doc(doc: dict) -> dict:
    if not doc:
        return None
    out = dict(doc)
    if "_id" in out:
        out["id"] = str(out.pop("_id"))
    return json_ready(out)

def post_expo_push_messages(messages: list[dict]) -> dict:
    if not messages:
        return {"data": []}
    payload = json.dumps(messages).encode("utf-8")
    req = urllib.request.Request(
        EXPO_PUSH_URL,
        data=payload,
        headers={
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        return {"error": f"Expo HTTP {exc.code}", "details": body}
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"[push] Expo push failed: {exc}")
        return {"error": str(exc)}

async def send_push_to_user(uid: ObjectId, notification_doc: dict) -> dict:
    tokens = await db.push_tokens.find({"userId": uid, "disabled": {"$ne": True}}).to_list(20)
    if not tokens:
        return {"ok": False, "sent": 0, "error": "no_registered_device"}
    title = notification_doc.get("title") or "小島精靈通知"
    body = notification_doc.get("message") or "你有一則新的心情提醒。"
    data = {
        "notificationId": str(notification_doc.get("_id", "")),
        "type": notification_doc.get("type"),
        "targetScreen": notification_doc.get("targetScreen"),
        "targetParams": json_ready(notification_doc.get("targetParams") or {}),
    }
    messages = []
    for item in tokens:
        token = item.get("token")
        if token:
            messages.append({
                "to": token,
                "sound": "default",
                "title": title,
                "body": body,
                "data": data,
            })
    responses: list[dict] = []
    for i in range(0, len(messages), 100):
        responses.append(await asyncio.to_thread(post_expo_push_messages, messages[i:i + 100]))
    tickets = [ticket for response in responses for ticket in response.get("data", [])]
    errors = [response.get("error") for response in responses if response.get("error")]
    errors.extend(
        ticket.get("message") or ticket.get("details", {}).get("error", "Expo 拒絕此推播")
        for ticket in tickets
        if ticket.get("status") == "error"
    )
    outcome = {
        "ok": not errors,
        "sent": len(messages),
        "tickets": tickets,
        "errors": errors,
        "sent_at": datetime.now(timezone.utc),
    }
    notification_id = notification_doc.get("_id")
    if isinstance(notification_id, ObjectId):
        await db.notifications.update_one(
            {"_id": notification_id, "userId": uid},
            {"$set": {
                "push_status": "sent" if outcome["ok"] else "failed",
                "push_result": json_ready(outcome),
            }},
        )
    return json_ready(outcome)

def today_label() -> str:
    return datetime.now(APP_TZ).strftime("%Y-%m-%d")

def parse_local_date(date_label: str) -> datetime:
    try:
        return datetime.strptime(date_label, "%Y-%m-%d").replace(tzinfo=APP_TZ)
    except ValueError:
        raise HTTPException(status_code=400, detail="日期格式需為 YYYY-MM-DD")

def parse_generate_time(value: str) -> tuple[int, int]:
    try:
        hour, minute = value.split(":")
        h, m = int(hour), int(minute)
    except Exception:
        raise HTTPException(status_code=400, detail="生成時間格式需為 HH:MM")
    if h < 0 or h > 23 or m < 0 or m > 59:
        raise HTTPException(status_code=400, detail="生成時間超出範圍")
    return h, m

def historical_fragment_timestamp(date_label: str, time_label: str) -> datetime:
    day = parse_local_date(date_label)
    hour, minute = parse_generate_time(time_label)
    return day.replace(hour=hour, minute=minute).astimezone(timezone.utc)

def scheduled_at(date_label: str, generate_time: str) -> datetime:
    base = parse_local_date(date_label)
    h, m = parse_generate_time(generate_time)
    return base.replace(hour=h, minute=m, second=0, microsecond=0)

def as_aware_utc(value: Any) -> Optional[datetime]:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)

def cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "*")
    origins = [item.strip() for item in raw.split(",") if item.strip()]
    return origins or ["*"]

def current_month_week_range(local_now: datetime) -> tuple[int, int, int]:
    day = local_now.day
    if day <= 7:
        return 1, 1, 7
    if day <= 14:
        return 2, 8, 14
    if day <= 21:
        return 3, 15, 21
    last = (local_now.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    return 4, 22, last.day

async def create_notification(
    uid: ObjectId,
    notification_type: str,
    title: str,
    message: str,
    action_text: str,
    target_screen: str,
    target_params: Optional[dict] = None,
    dedup_key: Optional[str] = None,
    severity: str = "info",
) -> Optional[dict]:
    now = datetime.now(timezone.utc)
    key = dedup_key or f"{notification_type}:{now.date().isoformat()}"
    doc = {
        "userId": uid,
        "type": notification_type,
        "title": title,
        "message": message,
        "actionText": action_text,
        "targetScreen": target_screen,
        "targetParams": target_params or {},
        "severity": severity,
        "dedup_key": key,
        "read": False,
        "created_at": now,
        "updated_at": now,
    }
    existing = await db.notifications.find_one({"userId": uid, "dedup_key": key})
    if existing:
        return None
    try:
        result = await db.notifications.insert_one(doc)
        doc["_id"] = result.inserted_id
        asyncio.create_task(send_push_to_user(uid, doc))
        return doc
    except Exception:
        return None

async def record_achievement(uid: ObjectId, key: str, increment: int = 1) -> Optional[dict]:
    now = datetime.now(timezone.utc)
    current = await db.achievements.find_one({"userId": uid, "key": key})
    old_count = int(current.get("count", 0)) if current else 0
    new_count = old_count + increment
    await db.achievements.update_one(
        {"userId": uid, "key": key},
        {"$set": {"count": new_count, "updated_at": now}, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )

    popup_asset = {
        "first_planting": "First＿planting.png",
        "watering": "water.png",
        "growing": "growing.png",
        "self_care": "Self-care.png",
    }.get(key)
    title = {
        "first_planting": "初次種植",
        "watering": "持續澆灌",
        "growing": "茁壯成長",
        "self_care": "自我關懷",
    }.get(key, key)

    should_popup = key == "first_planting" and old_count == 0 and new_count >= 1
    should_popup = should_popup or (key != "first_planting" and new_count > 0 and new_count % 10 == 0)
    if should_popup and popup_asset:
        popup = {
            "userId": uid,
            "key": key,
            "title": title,
            "asset": popup_asset,
            "count": new_count,
            "read": False,
            "created_at": now,
        }
        result = await db.achievement_popups.insert_one(popup)
        popup["_id"] = result.inserted_id
        return popup
    return None

async def ensure_profile_notifications(uid: ObjectId) -> None:
    user = await db.users.find_one({"_id": uid})
    if not user:
        return
    if not user.get("birth_date") or not user.get("phone"):
        await create_notification(
            uid,
            "IDENTITY_INCOMPLETE",
            "還沒綁定身份嗎？",
            "快去完成綁定吧！補上生日與手機後，也能收到生日祝福與使用手機找回密碼。",
            "完成個人資料",
            "PersonalInfoScreen",
            {},
            "identity-incomplete",
        )
    birthday = user.get("birth_date")
    local_now = datetime.now(APP_TZ)
    if not birthday or birthday[5:] != local_now.strftime("%m-%d"):
        return
    year = local_now.year
    await create_notification(
        uid,
        "BIRTHDAY_GREETING",
        "生日快樂！",
        "今天是屬於你的日子。小島精靈祝你生日快樂，願你的心情被溫柔照顧。",
        "回到小島",
        "HomeScreen",
        {},
        f"birthday-greeting:{year}",
    )
    popup_key = f"birthday-popup:{year}"
    exists = await db.achievement_popups.find_one({"userId": uid, "dedup_key": popup_key})
    if not exists:
        await db.achievement_popups.insert_one({
            "userId": uid,
            "key": "birthday",
            "title": "生日快樂",
            "asset": "HBD.png",
            "dedup_key": popup_key,
            "read": False,
            "created_at": datetime.now(timezone.utc),
        })

async def get_daily_settings_doc(uid: ObjectId) -> dict:
    doc = await db.daily_diary_settings.find_one({"userId": uid})
    if doc:
        return doc
    now = datetime.now(timezone.utc)
    doc = {
        "userId": uid,
        **DEFAULT_DAILY_SETTINGS,
        "created_at": now,
        "updated_at": now,
    }
    result = await db.daily_diary_settings.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc

async def get_fragments_for_date(uid: ObjectId, date_label: str) -> list[dict]:
    return await db.conversations.find({
        "userId": uid,
        "date_label": date_label,
        "type": "fragment",
    }).sort("timestamp", 1).to_list(200)

async def compose_daily_draft(fragments: list[dict]) -> str:
    entries = [
        {
            "content": f.get("content", ""),
            "timestamp": f.get("timestamp"),
        }
        for f in fragments
        if f.get("content")
    ]
    if not entries:
        return ""
    try:
        from emotion_pipeline import summarize_daily_fragments

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, summarize_daily_fragments, entries)
    except Exception as e:
        print(f"[警告] 統整日記生成失敗，使用原文串接：{e}")
        parts = []
        for item in entries:
            ts = item.get("timestamp")
            label = ts.astimezone(APP_TZ).strftime("%H:%M") if isinstance(ts, datetime) else "小日記"
            parts.append(f"{label}：{item['content']}")
        return "\n\n".join(parts)

async def update_trend_safely(uid: ObjectId, date_str: str, scores: Dict[str, float], timestamp: datetime):
    existing = await db.emotion_trends.find_one({"userId": uid, "date_label": date_str})
    if existing:
        new_count = existing["count"] + 1
        new_avg = {
            k: round(((existing["average_scores"].get(k, 0.0) * existing["count"]) + v) / new_count, 2)
            for k, v in scores.items()
        }
        await db.emotion_trends.update_one(
            {"_id": existing["_id"]},
            {"$set": {"average_scores": new_avg, "count": new_count, "updated_at": timestamp}}
        )
    else:
        await db.emotion_trends.insert_one({
            "userId": uid,
            "date_label": date_str,
            "average_scores": scores,
            "count": 1,
            "updated_at": timestamp
        })

async def set_daily_trend(uid: ObjectId, date_str: str, scores: Dict[str, float], timestamp: datetime):
    await db.emotion_trends.update_one(
        {"userId": uid, "date_label": date_str},
        {"$set": {"average_scores": scores, "count": 1, "updated_at": timestamp}},
        upsert=True,
    )

async def finalize_daily_diary(
    uid: ObjectId,
    date_label: str,
    final_content: str,
    auto: bool = False,
    emit_notifications: bool = True,
    strict_analysis: bool = False,
) -> dict:
    if not final_content.strip():
        raise HTTPException(status_code=400, detail="日記內容不可為空")

    daily_doc = await db.daily_diaries.find_one({"userId": uid, "date_label": date_label})
    now = datetime.now(timezone.utc)
    if not daily_doc:
        result = await db.daily_diaries.insert_one({
            "userId": uid,
            "date_label": date_label,
            "fragment_ids": [],
            "draft_content": final_content.strip(),
            "status": "editing",
            "generated_at": now,
            "editable_until": now,
            "created_at": now,
            "updated_at": now,
        })
        daily_doc = await db.daily_diaries.find_one({"_id": result.inserted_id})

    try:
        from emotion_pipeline import analyze_emotion, tag_diary, user_feedback, determine_mode

        loop = asyncio.get_event_loop()
        emotion = await loop.run_in_executor(None, analyze_emotion, final_content)
        if emotion.get("analysis_available") is False:
            neural_error = (emotion.get("neural_prior") or {}).get(
                "error",
                "遠端神經網路模型目前無法提供分析",
            )
            raise HTTPException(
                status_code=503,
                detail=f"神經網路模型暫時無法分析：{neural_error}",
            )
        tags = await loop.run_in_executor(None, tag_diary, final_content)

        risk_level = emotion.get("risk_level", "none")
        mode = determine_mode(risk_level)
        feedback = await loop.run_in_executor(None, user_feedback, final_content, emotion, mode)

    except HTTPException:
        raise
    except Exception as e:
        if strict_analysis:
            raise HTTPException(status_code=503, detail=f"完整分析失敗：{e}") from e
        print(f"[警告] 當日日記 AI 分析失敗：{e}")
        emotion = {
            "emotions": {},
            "dominant_emotions": [],
            "emotional_intensity": 0,
            "risk_level": "none",
            "analysis_notes": "分析失敗",
            "emotion_reasons": {},
        }
        tags = {"stressor_tags": [], "buffer_tags": [], "joy_tags": [], "one_line_summary": ""}
        risk_level = "none"
        feedback = "謝謝你願意把今天留下來，小島精靈已經先替你收好。"

    raw_scores = emotion.get("emotions", {}) or {}
    scores = {
        k: round((v / 100) if v > 1 else v, 2)
        for k, v in raw_scores.items()
    }

    analysis_doc = {
        "userId": uid,
        "conversationId": daily_doc["_id"],
        "dailyDiaryId": daily_doc["_id"],
        "analysis_type": "daily",
        "date_label": date_label,
        "daily_content": final_content.strip(),
        "final_content": final_content.strip(),
        "scores": scores,
        "emotions_raw": raw_scores,
        "neural_prior": emotion.get("neural_prior", {}),
        "dominant_emotions": emotion.get("dominant_emotions", []),
        "risk_level": risk_level,
        "emotional_intensity": emotion.get("emotional_intensity", 0),
        "recommend_professional_help": emotion.get("recommend_professional_help", False),
        "safety_action": emotion.get("safety_action", "none"),
        "analysis_notes": emotion.get("analysis_notes", ""),
        "emotion_reasons": emotion.get("emotion_reasons", {}) or emotion.get("emotionReasons", {}),
        "stressor_tags": tags.get("stressor_tags", []),
        "buffer_tags": tags.get("buffer_tags", []),
        "joy_tags": tags.get("joy_tags", []),
        "one_line_summary": tags.get("one_line_summary", ""),
        "summary": tags.get("one_line_summary", "") or emotion.get("analysis_notes", ""),
        "feedback": feedback,
        "auto_finalized": auto,
        "analyzed_at": now,
        "updated_at": now,
    }

    existing_daily_analysis = await db.emotion_analyses.find_one({
        "userId": uid,
        "date_label": date_label,
        "analysis_type": "daily",
    })
    analysis_id = daily_doc.get("analysisId")
    is_new_tree = not analysis_id and not existing_daily_analysis
    if analysis_id:
        await db.emotion_analyses.update_one({"_id": analysis_id}, {"$set": analysis_doc})
    else:
        if existing_daily_analysis:
            analysis_id = existing_daily_analysis["_id"]
            await db.emotion_analyses.update_one({"_id": analysis_id}, {"$set": analysis_doc})
        else:
            inserted = await db.emotion_analyses.insert_one(analysis_doc)
            analysis_id = inserted.inserted_id

    await db.daily_diaries.update_one(
        {"_id": daily_doc["_id"]},
        {"$set": {
            "final_content": final_content.strip(),
            "status": "finalized",
            "analysisId": analysis_id,
            "feedback": feedback,
            "finalized_at": now,
            "updated_at": now,
        }},
    )
    await set_daily_trend(uid, date_label, scores, now)

    if is_new_tree:
        await record_achievement(uid, "first_planting", 1)
        await record_achievement(uid, "watering", 1)
        if emit_notifications:
            await create_notification(
                uid,
                "TREE_GROWN",
                "新的心情樹長出來了",
                "你今天的心情樹已經長出來了。它代表你今天經歷過的心情。",
                "查看當日樹",
                "DayTreeScreen",
                {"date": date_label, "analysisId": str(analysis_id)},
                f"tree-grown:{date_label}",
            )
    if not auto:
        await record_achievement(uid, "self_care", 1)
    if risk_level == "high" and emit_notifications:
        await create_notification(
            uid,
            "HIGH_RISK_ALERT",
            "小島精靈很在意你現在的狀態",
            "如果你有傷害自己的念頭，請立刻聯絡身邊可信任的人，或撥打 1925 安心專線、1980 生命線。",
            "查看支持資源",
            "SupportResourceScreen",
            {"date": date_label},
            f"high-risk:{date_label}",
            "urgent",
        )
    if emit_notifications:
        await create_notification(
            uid,
            "DAY_ANALYSIS_READY",
            "今天的心情分析完成了",
            "要不要看看小島精靈從你的日記裡讀到了什麼？",
            "查看當日分析",
            "DayAnalysisScreen",
            {"date": date_label, "analysisId": str(analysis_id)},
            f"analysis-ready:{date_label}",
        )

    saved = await db.emotion_analyses.find_one({"_id": analysis_id})
    return serialize_doc(saved)

async def ensure_daily_diary_for_date(uid: ObjectId, date_label: str) -> Optional[dict]:
    settings = await get_daily_settings_doc(uid)
    current_local = datetime.now(APP_TZ)
    due_time = scheduled_at(date_label, settings.get("generate_time", "21:00"))
    daily_doc = await db.daily_diaries.find_one({"userId": uid, "date_label": date_label})

    if not daily_doc and current_local >= due_time:
        fragments = await get_fragments_for_date(uid, date_label)
        if fragments:
            draft = await compose_daily_draft(fragments)
            now = datetime.now(timezone.utc)
            editable_until_local = current_local + timedelta(
                minutes=int(settings.get("edit_window_minutes", 30))
            )
            result = await db.daily_diaries.insert_one({
                "userId": uid,
                "date_label": date_label,
                "fragment_ids": [f["_id"] for f in fragments],
                "draft_content": draft,
                "status": "editing",
                "generated_at": now,
                "editable_until": editable_until_local.astimezone(timezone.utc),
                "created_at": now,
                "updated_at": now,
            })
            daily_doc = await db.daily_diaries.find_one({"_id": result.inserted_id})
            await create_notification(
                uid,
                "DAILY_DIARY_EDITABLE",
                "今日統整日記已產生",
                "小島精靈已經幫你整理好今天的心情日記了，你還可以在時間內修改內容。",
                "去編輯",
                "DailyDiaryEditScreen",
                {"date": date_label},
                f"daily-editable:{date_label}",
            )

    if daily_doc and daily_doc.get("status") == "editing":
        editable_until = daily_doc.get("editable_until")
        if isinstance(editable_until, datetime) and editable_until.tzinfo is None:
            editable_until = editable_until.replace(tzinfo=timezone.utc)
        if isinstance(editable_until, datetime) and datetime.now(timezone.utc) >= editable_until:
            await finalize_daily_diary(uid, date_label, daily_doc.get("draft_content", ""), auto=True)
            daily_doc = await db.daily_diaries.find_one({"userId": uid, "date_label": date_label})

    return daily_doc

async def process_daily_for_user(uid: ObjectId, date_label: str):
    try:
        daily_doc = await ensure_daily_diary_for_date(uid, date_label)
        if not daily_doc:
            return
        if daily_doc.get("status") == "editing":
            editable_until = as_aware_utc(daily_doc.get("editable_until"))
            if editable_until:
                remaining = editable_until - datetime.now(timezone.utc)
                if timedelta(0) < remaining <= timedelta(minutes=5):
                    await create_notification(
                        uid,
                        "DAILY_DIARY_EXPIRING",
                        "今日統整日記快要定稿囉",
                        "如果還想修改，可以現在看一下。",
                        "去編輯",
                        "DailyDiaryEditScreen",
                        {"date": date_label},
                        f"daily-expiring:{date_label}",
                    )
    except Exception as e:
        print(f"[警告] 每日統整排程失敗 user={uid} date={date_label}: {e}")

async def create_hourly_diary_reminder(uid: ObjectId, local_now: Optional[datetime] = None) -> bool:
    """At each completed local hour, remind once if no fragment was written."""
    current_local = local_now or datetime.now(APP_TZ)
    hour_end = current_local.replace(minute=0, second=0, microsecond=0)
    hour_start = hour_end - timedelta(hours=1)
    user = await db.users.find_one({"_id": uid}, {"created_at": 1})
    created_at = as_aware_utc(user.get("created_at")) if user else None
    if created_at and created_at >= hour_end.astimezone(timezone.utc):
        return False
    has_fragment = await db.conversations.find_one({
        "userId": uid,
        "type": "fragment",
        "timestamp": {
            "$gte": hour_start.astimezone(timezone.utc),
            "$lt": hour_end.astimezone(timezone.utc),
        },
    })
    if has_fragment:
        return False
    notification = await create_notification(
        uid,
        "HOURLY_DIARY_REMINDER",
        "想和小島精靈說說話嗎？",
        "今天有什麼事情可以跟我分享的嗎？快來紀錄吧！",
        "寫一則小日記",
        "DiaryScreen",
        {},
        f"hourly-no-diary:{hour_start.strftime('%Y-%m-%d-%H')}",
    )
    return notification is not None

async def build_context_notifications(uid: ObjectId):
    await ensure_profile_notifications(uid)
    local_now = datetime.now(APP_TZ)
    date_label = local_now.strftime("%Y-%m-%d")
    settings = await get_daily_settings_doc(uid)
    daily = await ensure_daily_diary_for_date(uid, date_label)
    fragments = await get_fragments_for_date(uid, date_label)
    due_time = scheduled_at(date_label, settings.get("generate_time", "21:00"))

    if not fragments and not daily:
        await create_notification(
            uid,
            "NO_DIARY_TODAY",
            "今天還沒種下心情樹",
            "今天還沒有留下心情足跡，小島精靈在等你分享一點點心情。",
            "去寫日記",
            "DiaryScreen",
            {},
            f"no-diary:{date_label}",
        )

    if fragments and not daily and due_time - timedelta(minutes=30) <= local_now < due_time:
        await create_notification(
            uid,
            "DAILY_DIARY_SOON",
            "再過一下就要整理今天的心情了",
            "如果還有想補充的事，可以先寫下來喔。",
            "補一則小日記",
            "DiaryScreen",
            {},
            f"daily-soon:{date_label}",
        )

    if daily and daily.get("status") == "editing":
        await create_notification(
            uid,
            "DAILY_DIARY_EDITABLE",
            "今日統整日記已產生",
            "小島精靈已經幫你整理好今天的心情日記了，你還可以在時間內修改內容。",
            "去編輯",
            "DailyDiaryEditScreen",
            {"date": date_label},
            f"daily-editable:{date_label}",
        )
        editable_until = as_aware_utc(daily.get("editable_until"))
        if editable_until and timedelta(0) < editable_until - datetime.now(timezone.utc) <= timedelta(minutes=5):
            await create_notification(
                uid,
                "DAILY_DIARY_EXPIRING",
                "今日統整日記快要定稿囉",
                "如果還想修改，可以現在看一下。",
                "去編輯",
                "DailyDiaryEditScreen",
                {"date": date_label},
                f"daily-expiring:{date_label}",
            )

    recent = await db.emotion_analyses.find({"userId": uid}).sort("date_label", -1).to_list(14)
    if recent:
        latest = recent[0]
        if latest.get("risk_level") == "high":
            await create_notification(
                uid,
                "HIGH_RISK_ALERT",
                "小島精靈很在意你現在的狀態",
                "如果你有傷害自己的念頭，請立刻聯絡身邊可信任的人，或撥打 1925 安心專線、1980 生命線。",
                "查看支持資源",
                "SupportResourceScreen",
                {"date": latest.get("date_label")},
                f"high-risk:{latest.get('date_label')}",
                "urgent",
            )

        scored = [norm_doc for norm_doc in recent[:5] if norm_doc.get("scores")]
        if scored:
            neg_total = 0
            for item in scored:
                scores = item.get("scores", {})
                scale = 100 if any(0 < v <= 1 for v in scores.values()) else 1
                neg_total += sum((scores.get(k, 0) * scale) for k in ["Sadness", "Fear", "Anger"])
            neg_avg = neg_total / max(1, len(scored))
            if neg_avg >= 90:
                await create_notification(
                    uid,
                    "MOOD_TREND_ALERT",
                    "最近好像承受了不少壓力",
                    "小島精靈發現你最近比較常出現低落或不安，也許可以回頭看看這幾天的心情變化。",
                    "查看趨勢",
                    "CalendarScreen",
                    {},
                    f"mood-trend:{latest.get('date_label')}",
                )

        week_no, start_day, end_day = current_month_week_range(local_now)
        month_prefix = local_now.strftime("%Y-%m-")
        available_days = {
            int(str(item.get("date_label", "0000-00-00"))[-2:])
            for item in recent
            if str(item.get("date_label", "")).startswith(month_prefix)
        }
        if all(day in available_days for day in range(start_day, end_day + 1)):
            await create_notification(
                uid,
                "WEEK_READY",
                f"第 {week_no} 週心情旅程完成了",
                "小島精靈幫你整理出一週的情緒變化。",
                "查看週狀態",
                "WeeklyAnalysisScreen",
                {"week": week_no, "year": local_now.year, "month": local_now.month, "startDay": start_day, "endDay": end_day},
                f"week-ready:{local_now.year}-{local_now.month:02d}-{week_no}",
            )

async def run_due_daily_jobs() -> dict:
    users = await db.users.find({}, {"_id": 1}).to_list(500)
    local_now = datetime.now(APP_TZ)
    labels = {
        local_now.strftime("%Y-%m-%d"),
        (local_now - timedelta(days=1)).strftime("%Y-%m-%d"),
    }
    checked = 0
    hourly_reminders = 0
    for user in users:
        uid = user["_id"]
        for date_label in labels:
            checked += 1
            await process_daily_for_user(uid, date_label)
        try:
            if await create_hourly_diary_reminder(uid, local_now):
                hourly_reminders += 1
            await build_context_notifications(uid)
        except Exception as e:
            print(f"[警告] 背景通知建立失敗 user={uid}: {e}")
    return {
        "ok": True,
        "users_checked": len(users),
        "dates_checked": checked,
        "hourly_reminders_created": hourly_reminders,
        "run_at": local_now.isoformat(),
    }

async def daily_scheduler_loop():
    while True:
        await run_due_daily_jobs()
        await asyncio.sleep(60)


# ──────────────────────────────────────────
# App 初始化
# ──────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.users.create_index("email", unique=True)
    await db.emotion_trends.create_index([("userId", 1), ("date_label", 1)], unique=True)
    await db.conversations.create_index([("userId", 1), ("date_label", 1), ("type", 1)])
    await db.daily_diaries.create_index([("userId", 1), ("date_label", 1)], unique=True)
    await db.daily_diary_settings.create_index("userId", unique=True)
    await db.emotion_analyses.create_index([("userId", 1), ("date_label", 1), ("analysis_type", 1)])
    await db.notifications.create_index([("userId", 1), ("dedup_key", 1)], unique=True)
    await db.notifications.create_index([("userId", 1), ("read", 1), ("created_at", -1)])
    await db.push_tokens.create_index("token", unique=True)
    await db.push_tokens.create_index([("userId", 1), ("updated_at", -1)])
    await db.favorites.create_index([("userId", 1), ("analysisId", 1)], unique=True)
    await db.achievements.create_index([("userId", 1), ("key", 1)], unique=True)
    await db.achievement_popups.create_index([("userId", 1), ("read", 1), ("created_at", -1)])
    scheduler_task = asyncio.create_task(daily_scheduler_loop())
    try:
        yield
    finally:
        scheduler_task.cancel()
        with suppress(asyncio.CancelledError):
            await scheduler_task
    mongo_client.close()

app = FastAPI(title="Emotion Tracker API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {"ok": True, "service": "emotional-island-api"}

@app.post("/tasks/daily-diary/run")
async def trigger_due_daily_jobs(_: None = Depends(require_cron_secret)):
    return await run_due_daily_jobs()


# ──────────────────────────────────────────
# 認證 API
# ──────────────────────────────────────────

@app.post("/register", status_code=201)
async def register(data: RegisterInput):
    email = validate_account_email(str(data.email))
    validate_account_password(data.password)
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="此 Email 已被註冊")
    user_doc = {
        "username": data.username,
        "email": email,
        "password_hash": hash_password(data.password),
        "avatar": "boy",
        "onboarding_seen": False,
        "identity_completed": False,
        "created_at": datetime.now(timezone.utc)
    }
    result = await db.users.insert_one(user_doc)
    await create_notification(
        result.inserted_id,
        "IDENTITY_INCOMPLETE",
        "還沒綁定身份嗎？",
        "快去完成綁定吧！補上生日與手機後，也能收到生日祝福與使用手機找回密碼。",
        "完成個人資料",
        "PersonalInfoScreen",
        {},
        "identity-incomplete",
    )
    token = create_token(str(result.inserted_id))
    return {
        "message": "註冊成功",
        "token": token,
        "user": {"id": str(result.inserted_id), "username": data.username, "email": email, "avatar": "boy", "onboarding_seen": False}
    }


@app.post("/login")
async def login(data: LoginInput):
    user = await db.users.find_one({"email": normalize_email(str(data.email))})
    if not user or not verify_password(data.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="帳號密碼錯誤")
    token = create_token(str(user["_id"]))
    return {
        "token": token,
        "user": {"id": str(user["_id"]), "username": user["username"], "email": user["email"], "avatar": user.get("avatar", "boy"), "onboarding_seen": user.get("onboarding_seen", False)}
    }


@app.patch("/me")
async def update_profile(data: dict, uid: ObjectId = Depends(get_current_user)):
    allowed = {}
    if "username" in data and data["username"].strip():
        allowed["username"] = data["username"].strip()
    if "avatar" in data and str(data["avatar"]).strip():
        allowed["avatar"] = str(data["avatar"]).strip()
    if "onboarding_seen" in data:
        allowed["onboarding_seen"] = bool(data["onboarding_seen"])
    if "birth_date" in data:
        allowed["birth_date"] = validate_birth_date(str(data["birth_date"]))
    if "phone" in data:
        allowed["phone"] = normalize_phone(str(data["phone"]))
    if not allowed:
        raise HTTPException(status_code=400, detail="沒有可更新的欄位")
    if "birth_date" in allowed or "phone" in allowed:
        current = await db.users.find_one({"_id": uid})
        allowed["identity_completed"] = bool(
            allowed.get("birth_date", current.get("birth_date"))
            and allowed.get("phone", current.get("phone"))
        )
    allowed["updated_at"] = datetime.now(timezone.utc)
    await db.users.update_one({"_id": uid}, {"$set": allowed})
    if allowed.get("identity_completed"):
        await db.notifications.update_many(
            {"userId": uid, "type": "IDENTITY_INCOMPLETE"},
            {"$set": {"dismissed": True, "read": True, "dismissed_at": datetime.now(timezone.utc)}},
        )
        await ensure_profile_notifications(uid)
    user = await db.users.find_one({"_id": uid})
    out = serialize_doc(user)
    out.pop("password_hash", None)
    return out


@app.get("/me", response_model=UserResponse)
async def get_me(uid: ObjectId = Depends(get_current_user)):
    user = await db.users.find_one({"_id": uid})
    if not user:
        raise HTTPException(status_code=404, detail="找不到使用者")
    return serialize_doc(user)

@app.post("/me/change-email")
async def change_email(data: ChangeEmailInput, uid: ObjectId = Depends(get_current_user)):
    user = await db.users.find_one({"_id": uid})
    if not user or not verify_password(data.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="密碼錯誤")
    email = validate_account_email(str(data.new_email))
    existing = await db.users.find_one({"email": email, "_id": {"$ne": uid}})
    if existing:
        raise HTTPException(status_code=400, detail="此帳號已被使用")
    await db.users.update_one({"_id": uid}, {"$set": {"email": email, "updated_at": datetime.now(timezone.utc)}})
    return {"ok": True, "email": email}

@app.post("/me/change-password")
async def change_password(data: ChangePasswordInput, uid: ObjectId = Depends(get_current_user)):
    user = await db.users.find_one({"_id": uid})
    if not user or not verify_password(data.current_password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="原密碼錯誤")
    validate_account_password(data.new_password)
    await db.users.update_one(
        {"_id": uid},
        {"$set": {"password_hash": hash_password(data.new_password), "updated_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}

@app.post("/me/verify-password")
async def verify_current_password(data: VerifyPasswordInput, uid: ObjectId = Depends(get_current_user)):
    user = await db.users.find_one({"_id": uid})
    email_matches = not data.email or normalize_email(str(data.email)) == normalize_email(user.get("email", "")) if user else False
    if not user or not email_matches or not verify_password(data.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="帳號密碼錯誤")
    return {"ok": True}

@app.post("/password/reset-by-phone")
async def reset_password_by_phone(data: ResetPasswordByPhoneInput):
    email = normalize_email(str(data.email))
    phone = normalize_phone(data.phone)
    validate_account_password(data.new_password)
    user = await db.users.find_one({"email": email, "phone": phone})
    if not user:
        raise HTTPException(status_code=400, detail="帳號或綁定手機不符")
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": hash_password(data.new_password), "updated_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True, "message": "密碼已重新設定，請使用新密碼登入"}

@app.post("/push-token")
async def register_push_token(data: PushTokenInput, uid: ObjectId = Depends(get_current_user)):
    token = data.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="缺少推播 token")
    now = datetime.now(timezone.utc)
    await db.push_tokens.update_one(
        {"token": token},
        {
            "$set": {
                "userId": uid,
                "token": token,
                "platform": data.platform,
                "device_id": data.device_id,
                "disabled": False,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    await db.users.update_one({"_id": uid}, {"$set": {"push_enabled": True, "updated_at": now}})
    return {"ok": True}

@app.get("/push-token/status")
async def get_push_token_status(uid: ObjectId = Depends(get_current_user)):
    count = await db.push_tokens.count_documents({"userId": uid, "disabled": {"$ne": True}})
    return {"enabled": count > 0, "device_count": count}

@app.post("/push-token/test")
async def test_push_notification(uid: ObjectId = Depends(get_current_user)):
    outcome = await send_push_to_user(uid, {
        "type": "PUSH_TEST",
        "title": "小島精靈已連線",
        "message": "手機通知已開啟，之後重要的心情提醒會來到這裡。",
        "targetScreen": "HomeScreen",
        "targetParams": {},
    })
    if outcome.get("error") == "no_registered_device":
        raise HTTPException(status_code=400, detail="此帳號尚未綁定手機推播權限，請先允許通知後再試一次。")
    return outcome


# ──────────────────────────────────────────
# 小日記 API（先陪伴，不立即分析）
# ──────────────────────────────────────────

@app.post("/diary", status_code=201)
async def create_diary(data: DiaryInput, uid: ObjectId = Depends(get_current_user)):
    """
    使用者可一天寫多則小日記。這裡只儲存與回覆安慰/小建議，
    不做正式情緒分析；正式分析會在每日統整日記完成後產生。
    """
    if not data.content.strip():
        raise HTTPException(status_code=400, detail="日記內容不可為空")

    now = datetime.now(timezone.utc)
    date_str = datetime.now(APP_TZ).strftime("%Y-%m-%d")

    try:
        from emotion_pipeline import quick_support

        loop = asyncio.get_event_loop()
        support = await loop.run_in_executor(None, quick_support, data.content)
    except Exception as e:
        print(f"[警告] 小日記陪伴回覆失敗：{e}")
        support = {
            "comfort": "謝謝你願意把這段心情交給小島精靈，今天先讓自己慢一點也可以。",
            "suggestions": ["喝一點水", "做三次慢慢的深呼吸", "讓眼睛休息一分鐘"],
            "blessing": "小島精靈會先把這段心情收好，晚點再陪你整理成今天的故事。",
            "risk_level": "none",
            "safety_action": "none",
        }

    conv_doc = {
        "userId": uid,
        "type": "fragment",
        "status": "saved",
        "date_label": date_str,
        "content": data.content.strip(),
        "ai_response": support.get("comfort", ""),
        "comfort": support.get("comfort", ""),
        "suggestions": support.get("suggestions", []),
        "blessing": support.get("blessing", ""),
        "risk_level": support.get("risk_level", "none"),
        "safety_action": support.get("safety_action", "none"),
        "timestamp": now,
        "created_at": now,
    }
    conv_result = await db.conversations.insert_one(conv_doc)
    fragment_count = await db.conversations.count_documents({
        "userId": uid,
        "type": "fragment",
        "date_label": date_str,
    })

    return {
        "message": "小日記已儲存，小島精靈先陪你一下",
        "fragmentId": str(conv_result.inserted_id),
        "conversationId": str(conv_result.inserted_id),
        "date_label": date_str,
        "fragment_count": fragment_count,
        **support,
    }


@app.get("/diary")
async def get_diary(uid: ObjectId = Depends(get_current_user)):
    docs = await db.conversations.find({"userId": uid}).sort("timestamp", -1).to_list(100)
    return [serialize_doc(d) for d in docs]

@app.post("/diary/import-historical-day")
async def import_historical_day(
    data: HistoricalDayImportInput,
    uid: ObjectId = Depends(get_current_user),
):
    """
    匯入目前登入帳號的歷史小日記，並讓正式統整/分析流程產生當日資料。
    這個端點用於展示資料回填，不發送歷史日期的提醒推播。
    """
    target_day = parse_local_date(data.date_label).date()
    if target_day >= datetime.now(APP_TZ).date():
        raise HTTPException(status_code=400, detail="歷史匯入日期必須早於今天")
    if len(data.fragments) not in [3, 4]:
        raise HTTPException(status_code=400, detail="每一天需提供 3 或 4 則小日記")

    prepared_fragments = []
    for index, fragment in enumerate(data.fragments, start=1):
        content = fragment.content.strip()
        if not 50 <= len(content) <= 100:
            raise HTTPException(
                status_code=400,
                detail=f"第 {index} 則小日記須為 50 至 100 字，目前為 {len(content)} 字",
            )
        prepared_fragments.append({
            "content": content,
            "timestamp": historical_fragment_timestamp(data.date_label, fragment.time_label),
        })

    existing_fragments = await db.conversations.count_documents({
        "userId": uid,
        "type": "fragment",
        "date_label": data.date_label,
    })
    existing_daily = await db.daily_diaries.find_one({"userId": uid, "date_label": data.date_label})
    if (existing_fragments or existing_daily) and not data.replace_existing:
        raise HTTPException(status_code=409, detail="這一天已有日記資料，請確認是否覆蓋")

    if data.replace_existing:
        await db.conversations.delete_many({
            "userId": uid,
            "type": "fragment",
            "date_label": data.date_label,
        })

    imported_at = datetime.now(timezone.utc)
    result = await db.conversations.insert_many([
        {
            "userId": uid,
            "type": "fragment",
            "status": "saved",
            "source": "historical_import",
            "date_label": data.date_label,
            "content": fragment["content"],
            "timestamp": fragment["timestamp"],
            "created_at": fragment["timestamp"],
            "imported_at": imported_at,
        }
        for fragment in prepared_fragments
    ])
    fragments = await get_fragments_for_date(uid, data.date_label)
    draft_content = await compose_daily_draft(fragments)
    if not draft_content.strip():
        raise HTTPException(status_code=500, detail="當日統整日記產生失敗")

    if existing_daily:
        await db.daily_diaries.update_one(
            {"_id": existing_daily["_id"], "userId": uid},
            {"$set": {
                "fragment_ids": result.inserted_ids,
                "draft_content": draft_content,
                "status": "editing",
                "generated_at": imported_at,
                "editable_until": imported_at,
                "updated_at": imported_at,
            }},
        )
    else:
        await db.daily_diaries.insert_one({
            "userId": uid,
            "date_label": data.date_label,
            "fragment_ids": result.inserted_ids,
            "draft_content": draft_content,
            "status": "editing",
            "generated_at": imported_at,
            "editable_until": imported_at,
            "created_at": imported_at,
            "updated_at": imported_at,
        })

    analysis = await finalize_daily_diary(
        uid,
        data.date_label,
        draft_content,
        auto=True,
        emit_notifications=False,
    )
    return {
        "date_label": data.date_label,
        "fragment_count": len(prepared_fragments),
        "daily_content": draft_content,
        "analysis": analysis,
    }

@app.post("/diary/reanalyze-finalized-days")
async def reanalyze_finalized_days(
    data: HistoricalReanalysisInput,
    uid: ObjectId = Depends(get_current_user),
):
    """
    以既有完整日記重新執行情緒分析，只覆寫分析與趨勢。
    不重建小日記、不新增通知，也不增加成就次數。
    """
    date_labels = sorted(set(data.date_labels))
    if not date_labels:
        raise HTTPException(status_code=400, detail="請提供至少一個要重新分析的日期")
    if len(date_labels) > 31:
        raise HTTPException(status_code=400, detail="單次最多重新分析 31 天")

    today = datetime.now(APP_TZ).date()
    results = []
    for date_label in date_labels:
        target_day = parse_local_date(date_label).date()
        if target_day >= today:
            raise HTTPException(status_code=400, detail="重新分析日期必須早於今天")

        daily_doc = await db.daily_diaries.find_one({"userId": uid, "date_label": date_label})
        if not daily_doc:
            raise HTTPException(status_code=404, detail=f"{date_label} 找不到完整日記")
        final_content = (
            daily_doc.get("final_content")
            or daily_doc.get("draft_content")
            or ""
        ).strip()
        if not final_content:
            raise HTTPException(status_code=400, detail=f"{date_label} 沒有可分析的日記內容")

        analysis = await finalize_daily_diary(
            uid,
            date_label,
            final_content,
            auto=True,
            emit_notifications=False,
            strict_analysis=True,
        )
        results.append({
            "date_label": date_label,
            "analysisId": analysis.get("_id"),
            "dominant_emotions": analysis.get("dominant_emotions", []),
            "neural_prior": analysis.get("neural_prior", {}),
        })

    return {"reanalyzed": len(results), "results": results}


# ──────────────────────────────────────────
# 今日統整日記 API
# ──────────────────────────────────────────

@app.get("/daily-diary/today/status")
async def get_today_daily_diary_status(uid: ObjectId = Depends(get_current_user)):
    date_str = today_label()
    daily = await ensure_daily_diary_for_date(uid, date_str)
    fragments = await get_fragments_for_date(uid, date_str)
    settings = await get_daily_settings_doc(uid)
    due_time = scheduled_at(date_str, settings.get("generate_time", "21:00"))

    return {
        "date": date_str,
        "fragment_count": len(fragments),
        "daily_diary": serialize_doc(daily) if daily else None,
        "settings": serialize_doc(settings),
        "scheduled_at": due_time.isoformat(),
        "is_due": datetime.now(APP_TZ) >= due_time,
    }


@app.get("/daily-diary/settings")
async def get_daily_diary_settings(uid: ObjectId = Depends(get_current_user)):
    return serialize_doc(await get_daily_settings_doc(uid))


@app.patch("/daily-diary/settings")
async def update_daily_diary_settings(data: DailyDiarySettingsPatch, uid: ObjectId = Depends(get_current_user)):
    patch = {}
    if data.generate_time is not None:
        parse_generate_time(data.generate_time)
        patch["generate_time"] = data.generate_time
    if data.edit_window_minutes is not None:
        if data.edit_window_minutes not in [15, 30, 45, 60, 90, 120]:
            raise HTTPException(status_code=400, detail="可編輯時間需為 15、30、45、60、90 或 120 分鐘")
        patch["edit_window_minutes"] = data.edit_window_minutes
    if not patch:
        return serialize_doc(await get_daily_settings_doc(uid))

    patch["updated_at"] = datetime.now(timezone.utc)
    await db.daily_diary_settings.update_one(
        {"userId": uid},
        {"$set": patch, "$setOnInsert": {"created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )
    return serialize_doc(await get_daily_settings_doc(uid))


@app.post("/daily-diary/{date_label}/finalize")
async def finalize_daily_diary_endpoint(
    date_label: str,
    data: DailyDiaryFinalizeInput,
    uid: ObjectId = Depends(get_current_user),
):
    parse_local_date(date_label)
    daily_doc = await ensure_daily_diary_for_date(uid, date_label)
    if daily_doc:
        if daily_doc.get("status") == "finalized":
            raise HTTPException(status_code=403, detail="今天的統整日記已定稿，不能再編輯")
        editable_until = as_aware_utc(daily_doc.get("editable_until"))
        if editable_until and datetime.now(timezone.utc) >= editable_until:
            await finalize_daily_diary(uid, date_label, daily_doc.get("draft_content", ""), auto=True)
            raise HTTPException(status_code=403, detail="可編輯時間已結束，系統已自動定稿並產生分析")
    return await finalize_daily_diary(uid, date_label, data.final_content)


# ──────────────────────────────────────────
# 通知、收藏、成就 API
# ──────────────────────────────────────────

@app.get("/notifications")
async def get_notifications(uid: ObjectId = Depends(get_current_user)):
    await build_context_notifications(uid)
    query = {"userId": uid, "dismissed": {"$ne": True}}
    docs = await db.notifications.find(query).sort("created_at", -1).to_list(50)
    unread_count = await db.notifications.count_documents({**query, "read": False})
    return {
        "unread_count": unread_count,
        "notifications": [serialize_doc(doc) for doc in docs],
    }

@app.post("/notifications/read")
async def mark_notifications_read(data: NotificationReadInput, uid: ObjectId = Depends(get_current_user)):
    query: dict = {"userId": uid, "read": False}
    if data.ids:
        obj_ids = []
        for item in data.ids:
            try:
                obj_ids.append(ObjectId(item))
            except InvalidId:
                continue
        query["_id"] = {"$in": obj_ids}
    result = await db.notifications.update_many(query, {"$set": {"read": True, "read_at": datetime.now(timezone.utc)}})
    return {"updated": result.modified_count}

@app.post("/notifications/clear")
async def clear_notifications(uid: ObjectId = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    result = await db.notifications.update_many(
        {"userId": uid, "dismissed": {"$ne": True}},
        {"$set": {"dismissed": True, "read": True, "read_at": now, "dismissed_at": now}},
    )
    return {"cleared": result.modified_count}

@app.delete("/notifications/{notification_id}")
async def dismiss_notification(notification_id: str, uid: ObjectId = Depends(get_current_user)):
    try:
        oid = ObjectId(notification_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="通知 ID 格式錯誤")
    now = datetime.now(timezone.utc)
    result = await db.notifications.update_one(
        {"_id": oid, "userId": uid},
        {"$set": {"dismissed": True, "read": True, "read_at": now, "dismissed_at": now}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="找不到通知")
    return {"dismissed": True}

@app.get("/favorites")
async def get_favorites(uid: ObjectId = Depends(get_current_user)):
    docs = await db.favorites.find({"userId": uid}).sort("created_at", -1).to_list(100)
    output = []
    for fav in docs:
        analysis = await db.emotion_analyses.find_one({"_id": fav.get("analysisId"), "userId": uid})
        item = serialize_doc(fav)
        item["analysis"] = serialize_doc(analysis) if analysis else None
        output.append(item)
    return output

@app.post("/favorites/{analysis_id}/toggle")
async def toggle_favorite(analysis_id: str, uid: ObjectId = Depends(get_current_user)):
    try:
        oid = ObjectId(analysis_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="無效的分析 ID")
    analysis = await db.emotion_analyses.find_one({"_id": oid, "userId": uid})
    if not analysis:
        raise HTTPException(status_code=404, detail="找不到這天的心情樹")

    existing = await db.favorites.find_one({"userId": uid, "analysisId": oid})
    if existing:
        await db.favorites.delete_one({"_id": existing["_id"]})
        return {"favorited": False}

    now = datetime.now(timezone.utc)
    fav_doc = {
        "userId": uid,
        "analysisId": oid,
        "date_label": analysis.get("date_label"),
        "mood": (analysis.get("dominant_emotions") or ["Joy"])[0],
        "summary": analysis.get("summary") or analysis.get("one_line_summary", ""),
        "created_at": now,
    }
    result = await db.favorites.insert_one(fav_doc)
    await record_achievement(uid, "growing", 1)
    await create_notification(
        uid,
        "TREE_COLLECTED",
        "這棵心情樹已收藏",
        "小島精靈已經幫你把這天的樹放進我的收藏。",
        "查看收藏",
        "FavoritesScreen",
        {},
        f"favorite:{analysis_id}",
    )
    fav_doc["_id"] = result.inserted_id
    return {"favorited": True, "favorite": serialize_doc(fav_doc)}

@app.get("/achievements")
async def get_achievements(uid: ObjectId = Depends(get_current_user)):
    defaults = ["first_planting", "watering", "growing", "self_care"]
    docs = await db.achievements.find({"userId": uid}).to_list(50)
    counts = {doc["key"]: int(doc.get("count", 0)) for doc in docs}
    achievements = [{"key": key, "count": counts.get(key, 0)} for key in defaults]
    popups = await db.achievement_popups.find({"userId": uid, "read": False}).sort("created_at", 1).to_list(10)
    return {
        "achievements": achievements,
        "popups": [serialize_doc(p) for p in popups],
    }

@app.post("/achievements/read")
async def mark_achievements_read(data: NotificationReadInput, uid: ObjectId = Depends(get_current_user)):
    query: dict = {"userId": uid, "read": False}
    if data.ids:
        obj_ids = []
        for item in data.ids:
            try:
                obj_ids.append(ObjectId(item))
            except InvalidId:
                continue
        query["_id"] = {"$in": obj_ids}
    result = await db.achievement_popups.update_many(query, {"$set": {"read": True, "read_at": datetime.now(timezone.utc)}})
    return {"updated": result.modified_count}


# ──────────────────────────────────────────
# 情緒分析 API
# ──────────────────────────────────────────

@app.get("/history")
async def get_history(uid: ObjectId = Depends(get_current_user)):
    daily_query = {"userId": uid, "$or": [{"analysis_type": "daily"}, {"daily_content": {"$exists": True}}, {"final_content": {"$exists": True}}]}
    docs = await db.emotion_analyses.find(daily_query).sort("date_label", -1).to_list(100)
    if not docs:
        docs = await db.emotion_analyses.find({"userId": uid}).sort("analyzed_at", -1).to_list(100)
    return [serialize_doc(doc) for doc in docs]


@app.get("/trends")
async def get_trends(uid: ObjectId = Depends(get_current_user)):
    docs = await db.emotion_trends.find({"userId": uid}).sort("date_label", 1).to_list(100)
    result = []
    for doc in docs:
        latest = await db.emotion_analyses.find_one(
            {"userId": uid, "date_label": doc["date_label"], "$or": [{"analysis_type": "daily"}, {"daily_content": {"$exists": True}}, {"final_content": {"$exists": True}}]},
            sort=[("analyzed_at", -1)]
        )
        if latest:
            doc["dominant_emotions"] = latest.get("dominant_emotions", [])
            doc["stressor_tags"]     = latest.get("stressor_tags", [])
            doc["buffer_tags"]       = latest.get("buffer_tags", [])
            doc["joy_tags"]          = latest.get("joy_tags", [])
            doc["emotion_reasons"]   = latest.get("emotion_reasons", {})
            doc["analysis_notes"]    = latest.get("analysis_notes", "")
            doc["one_line_summary"]  = latest.get("one_line_summary", "")
        else:
            doc["dominant_emotions"] = []
            doc["stressor_tags"]     = []
            doc["buffer_tags"]       = []
            doc["joy_tags"]          = []
            doc["emotion_reasons"]   = {}
            doc["analysis_notes"]    = ""
            doc["one_line_summary"]  = ""

        result.append(serialize_doc(doc))
    return result
