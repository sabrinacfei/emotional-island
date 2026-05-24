"""
database.py — MongoDB 資料庫模組

Collection 架構：
  users             → 使用者基本資料
  conversations     → 使用者日記 / AI 回覆
  emotion_analyses  → 單筆情緒分析結果（對應一篇日記）
  emotion_trends    → 多日情緒趨勢（每日/週/月彙整）

關聯關係：
  users (userId)
    └─ conversations (conversationId)
         └─ emotion_analyses
    └─ emotion_trends
"""

import os
from datetime import datetime, timezone
from dotenv import load_dotenv
from pymongo import MongoClient, ASCENDING
from pymongo.collection import Collection
from bson import ObjectId

load_dotenv()

# ──────────────────────────────────────────
# 連線初始化
# ──────────────────────────────────────────

_client: MongoClient = None


def get_db():
    """取得資料庫連線（Singleton）。"""
    global _client
    if _client is None:
        uri = os.getenv("MONGODB_URI")
        if not uri:
            raise EnvironmentError("請在 .env 設定 MONGODB_URI")
        _client = MongoClient(uri)
    return _client["emotion_diary"]   # ← 資料庫名稱，可自行修改


def init_indexes():
    """
    建立常用查詢索引（第一次啟動時執行一次即可）。
    已存在的索引 MongoDB 會自動跳過，不會重複建立。
    """
    db = get_db()

    # conversations：常依 userId 查詢所有日記
    db["conversations"].create_index([("userId", ASCENDING)])

    # emotion_analyses：常依 userId / conversationId 查詢
    db["emotion_analyses"].create_index([("userId", ASCENDING)])
    db["emotion_analyses"].create_index([("conversationId", ASCENDING)])

    # emotion_trends：常依 userId + 時間範圍查詢趨勢
    db["emotion_trends"].create_index([
        ("userId", ASCENDING),
        ("date", ASCENDING)
    ])

    print(" MongoDB 索引初始化完成")


# ──────────────────────────────────────────
# users Collection
# ──────────────────────────────────────────

def create_user(username: str, email: str) -> str:
    """
    新增使用者。
    回傳新建的 userId（字串格式的 ObjectId）。
    """
    db = get_db()
    doc = {
        "username": username,
        "email": email,
        "createdAt": datetime.now(timezone.utc),
    }
    result = db["users"].insert_one(doc)
    return str(result.inserted_id)


def get_user_by_id(user_id: str) -> dict | None:
    """依 userId 取得使用者資料。"""
    db = get_db()
    return db["users"].find_one({"_id": ObjectId(user_id)})


def get_user_by_email(email: str) -> dict | None:
    """依 email 取得使用者資料（登入用）。"""
    db = get_db()
    return db["users"].find_one({"email": email})


# ──────────────────────────────────────────
# conversations Collection
# ──────────────────────────────────────────

def save_conversation(user_id: str, diary: str, feedback: str, mode: str) -> str:
    """
    儲存一篇日記與 AI 回覆。
    回傳 conversationId（字串格式的 ObjectId）。

    欄位說明：
      userId    → 哪位使用者
      diary     → 使用者原始輸入
      feedback  → AI 回覆內容
      mode      → SAFE_MODE / SUPPORT_MODE
      createdAt → 建立時間（UTC）
    """
    db = get_db()
    doc = {
        "userId": user_id,
        "diary": diary,
        "feedback": feedback,
        "mode": mode,
        "createdAt": datetime.now(timezone.utc),
    }
    result = db["conversations"].insert_one(doc)
    return str(result.inserted_id)


def get_conversations_by_user(user_id: str, limit: int = 20) -> list[dict]:
    """取得某使用者最近 N 篇日記（依時間倒序）。"""
    db = get_db()
    cursor = (
        db["conversations"]
        .find({"userId": user_id})
        .sort("createdAt", -1)
        .limit(limit)
    )
    return _serialize(list(cursor))


# ──────────────────────────────────────────
# emotion_analyses Collection
# ──────────────────────────────────────────

def save_emotion_analysis(
    user_id: str,
    conversation_id: str,
    emotion: dict,
    tags: dict,
) -> str:
    """
    儲存單筆情緒分析結果。

    emotion 結構（來自 analyze_emotion()）：
      emotions, dominant_emotions, emotional_intensity,
      risk_level, recommend_professional_help,
      safety_action, analysis_notes

    tags 結構（來自 tag_diary()）：
      stressor_tags, buffer_tags, joy_tags, one_line_summary

    回傳新建文件的 _id（字串）。
    """
    db = get_db()
    doc = {
        "userId": user_id,
        "conversationId": conversation_id,

        # 情緒分析結果
        "emotions": emotion.get("emotions", {}),
        "dominantEmotions": emotion.get("dominant_emotions", []),
        "emotionalIntensity": emotion.get("emotional_intensity", 0),
        "riskLevel": emotion.get("risk_level", "none"),
        "recommendProfessionalHelp": emotion.get("recommend_professional_help", False),
        "safetyAction": emotion.get("safety_action", "none"),
        "analysisNotes": emotion.get("analysis_notes", ""),

        # 後台標籤（同一筆一起存，避免多餘的跨 Collection join）
        "stressorTags": tags.get("stressor_tags", []),
        "bufferTags": tags.get("buffer_tags", []),
        "joyTags": tags.get("joy_tags", []),
        "oneLineSummary": tags.get("one_line_summary", ""),

        "createdAt": datetime.now(timezone.utc),
    }
    result = db["emotion_analyses"].insert_one(doc)
    return str(result.inserted_id)


def get_analyses_by_user(user_id: str, limit: int = 30) -> list[dict]:
    """取得某使用者最近 N 筆情緒分析（依時間倒序）。"""
    db = get_db()
    cursor = (
        db["emotion_analyses"]
        .find({"userId": user_id})
        .sort("createdAt", -1)
        .limit(limit)
    )
    return _serialize(list(cursor))


def get_analysis_by_conversation(conversation_id: str) -> dict | None:
    """依 conversationId 取得對應的情緒分析。"""
    db = get_db()
    doc = db["emotion_analyses"].find_one({"conversationId": conversation_id})
    return _serialize_one(doc)


# ──────────────────────────────────────────
# emotion_trends Collection
# ──────────────────────────────────────────

def upsert_daily_trend(user_id: str, date_str: str, emotion: dict, tags: dict):
    """
    更新（或新增）某天的情緒趨勢彙整。
    date_str 格式：'YYYY-MM-DD'

    每天只保留一筆，多次呼叫會累加 entryCount，
    情緒分數會更新為當天最後一筆（簡化版；如需平均值可另行擴充）。
    """
    db = get_db()
    now = datetime.now(timezone.utc)

    db["emotion_trends"].update_one(
        {"userId": user_id, "date": date_str},
        {
            "$set": {
                "emotions": emotion.get("emotions", {}),
                "dominantEmotions": emotion.get("dominant_emotions", []),
                "avgIntensity": emotion.get("emotional_intensity", 0),
                "riskLevel": emotion.get("risk_level", "none"),
                "stressorTags": tags.get("stressor_tags", []),
                "bufferTags": tags.get("buffer_tags", []),
                "joyTags": tags.get("joy_tags", []),
                "updatedAt": now,
            },
            "$setOnInsert": {
                "userId": user_id,
                "date": date_str,
                "createdAt": now,
            },
            "$inc": {"entryCount": 1},  # 記錄當天寫了幾篇
        },
        upsert=True,
    )


def get_trends_by_user(user_id: str, start_date: str, end_date: str) -> list[dict]:
    """
    取得某使用者在指定日期範圍內的情緒趨勢。
    start_date / end_date 格式：'YYYY-MM-DD'
    回傳依日期升序排列的趨勢列表，前端直接拿來畫圖。
    """
    db = get_db()
    cursor = (
        db["emotion_trends"]
        .find({
            "userId": user_id,
            "date": {"$gte": start_date, "$lte": end_date},
        })
        .sort("date", ASCENDING)
    )
    return _serialize(list(cursor))


# ──────────────────────────────────────────
# 工具函式
# ──────────────────────────────────────────

def _serialize_one(doc: dict | None) -> dict | None:
    """將 MongoDB 文件的 ObjectId 轉為字串，方便 JSON 序列化。"""
    if doc is None:
        return None
    doc["_id"] = str(doc["_id"])
    return doc


def _serialize(docs: list[dict]) -> list[dict]:
    return [_serialize_one(d) for d in docs]


# ──────────────────────────────────────────
# 整合進 pipeline 的主要函式
# ──────────────────────────────────────────

def save_pipeline_result(user_id: str, diary: str, result: dict) -> dict:
    """
    一次將 run_pipeline() 的結果存入三個 Collection。
    回傳各文件的 ID，方便後續查詢。

    呼叫方式：
        from database import save_pipeline_result
        ids = save_pipeline_result(user_id, diary, result)
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # 1. conversations
    conversation_id = save_conversation(
        user_id=user_id,
        diary=diary,
        feedback=result["feedback"],
        mode=result["mode"],
    )

    # 2. emotion_analyses
    analysis_id = save_emotion_analysis(
        user_id=user_id,
        conversation_id=conversation_id,
        emotion=result["emotion"],
        tags=result["tags"],
    )

    # 3. emotion_trends（每天 upsert，累計當天所有日記）
    upsert_daily_trend(
        user_id=user_id,
        date_str=today,
        emotion=result["emotion"],
        tags=result["tags"],
    )

    print(f" 已存入 MongoDB")
    print(f"   conversationId : {conversation_id}")
    print(f"   analysisId     : {analysis_id}")
    print(f"   趨勢日期        : {today}")

    return {
        "conversationId": conversation_id,
        "analysisId": analysis_id,
        "trendDate": today,
    }