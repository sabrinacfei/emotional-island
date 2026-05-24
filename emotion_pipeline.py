import json
import os
import re
import requests
import importlib.util
from functools import lru_cache
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI()

MODEL = "gpt-5-nano"
MODEL_FEEDBACK = "gpt-4o-mini"
BASE_DIR = Path(__file__).resolve().parent
PREDICT_SCRIPT_PATH = Path(os.getenv("PREDICT_SCRIPT_PATH", BASE_DIR / "predict_sentence_json.py"))
DEFAULT_MODEL_DIR = Path(os.getenv("PLUTCHIK_MODEL_DIR", BASE_DIR / "plutchik_human_poslog_data42_model17"))

EMOTION_KEYS = ["Joy", "Sadness", "Anger", "Fear", "Anticipation", "Surprise", "Disgust", "Trust"]
NN_LABEL_MAP = {
    "anger": "Anger",
    "anticipation": "Anticipation",
    "disgust": "Disgust",
    "fear": "Fear",
    "joy": "Joy",
    "sadness": "Sadness",
    "surprise": "Surprise",
    "trust": "Trust",
}

# Optional companion API endpoint used by legacy analysis helpers.
API_BASE = os.getenv("PIPELINE_API_BASE", "http://localhost:8001")

EMERGENCY_RESOURCES = """
【台灣緊急心理資源】
• 自殺防治專線：1925（安心專線，24小時）
• 生命線：1980（24小時）
"""

HIGH_RISK_PATTERNS = [
    "自殺", "結束生命", "結束這一切", "不想活", "不想再活", "想死", "去死",
    "遺書", "寫好信", "割腕", "跳樓", "吞藥", "上吊", "傷害自己", "傷害別人",
    "殺了", "同歸於盡",
]
MODERATE_RISK_PATTERNS = [
    "想消失", "消失算了", "活著好累", "撐不下去", "撐不住", "沒有意義",
    "好絕望", "快崩潰", "不想醒來",
]
LOW_RISK_PATTERNS = ["我很沒用", "討厭自己", "一無是處", "沒有人在乎", "好痛苦"]


def detect_safety_risk(text: str) -> str:
    compact = re.sub(r"\s+", "", text or "")
    if any(k in compact for k in HIGH_RISK_PATTERNS):
        return "high"
    if any(k in compact for k in MODERATE_RISK_PATTERNS):
        return "moderate"
    if any(k in compact for k in LOW_RISK_PATTERNS):
        return "low"
    return "none"


@lru_cache(maxsize=1)
def _load_predict_module():
    if not PREDICT_SCRIPT_PATH.exists():
        raise FileNotFoundError(f"Missing inference script: {PREDICT_SCRIPT_PATH}")
    spec = importlib.util.spec_from_file_location("plutchik_predict_sentence_json", PREDICT_SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load inference script: {PREDICT_SCRIPT_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.DEFAULT_MODEL_DIR = DEFAULT_MODEL_DIR
    return module


@lru_cache(maxsize=1)
def _load_neural_bundle():
    if not DEFAULT_MODEL_DIR.exists():
        raise FileNotFoundError(f"Missing model directory: {DEFAULT_MODEL_DIR}")
    module = _load_predict_module()
    device = module.pick_device("auto")
    bundle = module.load_model(DEFAULT_MODEL_DIR, device)
    return module, bundle, device


def get_neural_prior(text: str) -> dict:
    try:
        module, bundle, device = _load_neural_bundle()
        result = module.predict_sentence(text, bundle, device)
        probabilities = {
            NN_LABEL_MAP[k]: float(v)
            for k, v in (result.get("probabilities") or {}).items()
            if k in NN_LABEL_MAP
        }
        total = sum(probabilities.values()) or 1.0
        scores = {k: round((probabilities.get(k, 0.0) / total) * 100) for k in EMOTION_KEYS}
        drift = 100 - sum(scores.values())
        if scores:
            top_key = max(scores, key=scores.get)
            scores[top_key] += drift
        return {
            "available": True,
            "model_dir": str(DEFAULT_MODEL_DIR),
            "predicted_emotions": [
                NN_LABEL_MAP[x]
                for x in result.get("predicted_emotions", [])
                if x in NN_LABEL_MAP
            ],
            "top_emotion": NN_LABEL_MAP.get(result.get("top_emotion"), result.get("top_emotion")),
            "top_probability": result.get("top_probability"),
            "probabilities": probabilities,
            "scores": scores,
        }
    except BaseException as exc:
        return {
            "available": False,
            "model_dir": str(DEFAULT_MODEL_DIR),
            "error": str(exc),
        }


def to_json(text: str) -> dict:
    """
    嘗試從模型輸出中解析 JSON，失敗時回傳 None。
    會先嘗試整段解析，再嘗試抓第一個 {...} 區塊，增加成功率。
    """
    # 先嘗試直接解析（模型有時輸出純 JSON）
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass

    # 再嘗試從文字中抓出 JSON 區塊（貪婪，抓最大的）
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        return None
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        pass

    # 最後嘗試抓第一個 {...}（非貪婪）
    match = re.search(r"\{.*?\}", text, re.S)
    if not match:
        return None
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return None


def _safe_fallback_analysis() -> dict:
    """
    當情緒分析 JSON 解析失敗時，回傳預設的安全降級結果。
    預設為 moderate，確保使用者得到支持性回應而非空白。
    """
    return {
        "emotions": {
            "Joy": 0, "Sadness": 30, "Anger": 0,
            "Fear": 20, "Anticipation": 0, "Surprise": 0,
            "Disgust": 0, "Trust": 50
        },
        "dominant_emotions": ["Sadness"],
        "emotional_intensity": 1,
        "risk_level": "moderate",
        "recommend_professional_help": True,
        "safety_action": "encourage_support",
        "analysis_notes": "（系統分析異常，已啟動保護模式）",
        "emotion_reasons": {
            "Joy": "系統分析異常，無法判定喜悅來源。",
            "Sadness": "系統分析異常，無法判定悲傷來源。",
            "Anger": "系統分析異常，無法判定憤怒來源。",
            "Fear": "系統分析異常，無法判定恐懼來源。",
            "Anticipation": "系統分析異常，無法判定期待來源。",
            "Surprise": "系統分析異常，無法判定驚訝來源。",
            "Disgust": "系統分析異常，無法判定厭惡來源。",
            "Trust": "系統分析異常，無法判定信任來源。"
        }
    }


def _high_risk_safe_analysis() -> dict:
    reasons = {
        key: "安全模式已啟動：文字含有高風險訊號，系統不展開具體細節，只保留必要的安全提醒。"
        for key in EMOTION_KEYS
    }
    return {
        "emotions": {
            "Joy": 0,
            "Sadness": 45,
            "Anger": 0,
            "Fear": 35,
            "Anticipation": 0,
            "Surprise": 0,
            "Disgust": 0,
            "Trust": 20,
        },
        "dominant_emotions": ["Sadness", "Fear", "Trust"],
        "emotional_intensity": 3,
        "risk_level": "high",
        "recommend_professional_help": True,
        "safety_action": "urgent_help",
        "analysis_notes": "安全模式已啟動。現在最重要的是讓身邊可信任的人知道你的狀態，或立即使用緊急支持資源。",
        "emotion_reasons": reasons,
        "neural_prior": {"available": False, "reason": "high_risk_safe_mode"},
    }


def normalize_emotion_result(result: dict, neural_prior: dict | None = None) -> dict:
    emotions = result.get("emotions") or {}
    clean = {}
    for key in EMOTION_KEYS:
        try:
            clean[key] = max(0, float(emotions.get(key, 0)))
        except (TypeError, ValueError):
            clean[key] = 0
    total = sum(clean.values())
    if total <= 0:
        prior_scores = (neural_prior or {}).get("scores") or {}
        clean = {key: float(prior_scores.get(key, 0)) for key in EMOTION_KEYS}
        total = sum(clean.values())
    if total <= 0:
        clean = _safe_fallback_analysis()["emotions"]
        total = sum(clean.values())

    normalized = {key: round((value / total) * 100) for key, value in clean.items()}
    drift = 100 - sum(normalized.values())
    top_key = max(normalized, key=normalized.get)
    normalized[top_key] += drift
    result["emotions"] = normalized

    dominant = result.get("dominant_emotions") or []
    dominant = [x for x in dominant if x in EMOTION_KEYS]
    if not dominant:
        dominant = [k for k, v in sorted(normalized.items(), key=lambda kv: kv[1], reverse=True) if v > 0][:3]
    result["dominant_emotions"] = dominant[:3]

    reasons = result.get("emotion_reasons") or result.get("emotionReasons") or {}
    if not isinstance(reasons, dict):
        reasons = {}
    for key in EMOTION_KEYS:
        if not reasons.get(key):
            reasons[key] = "這筆分析沒有儲存此情緒的具體原因，前端不會自行補寫。"
    result["emotion_reasons"] = reasons
    if neural_prior is not None:
        result["neural_prior"] = neural_prior
    return result


def analyze_emotion(diary: str) -> dict:
    safety_risk = detect_safety_risk(diary)
    if safety_risk == "high":
        return _high_risk_safe_analysis()

    neural_prior = get_neural_prior(diary)
    neural_block = json.dumps(neural_prior, ensure_ascii=False, indent=2)
    prompt = f"""
你是情緒分析模組。只輸出 JSON（繁體中文），不要多餘文字。

情緒只能用：
Joy, Sadness, Anger, Fear, Anticipation, Surprise, Disgust, Trust

你會收到一個「神經網路先驗」：
- 如果 available=true，請把 probabilities/scores 視為第一階段模型判斷，不要忽略。
- LLM 的任務是根據日記語境校正比例、補足情緒原因與安全欄位。
- 若神經網路先驗與日記語境衝突，請保留可解釋的校正，不要無理由大幅改動。
- emotion_reasons 必須貼近日記具體事件或語句，不可用「整體日常狀態」「可能來自日記內容」這類空話。
- 若某情緒分數很低或為 0，原因要說明「沒有明顯出現」的文本理由。

請輸出：
1) emotions：百分比（整數，加總=100）
2) dominant_emotions：1~3 個
3) emotional_intensity：0~3
4) risk_level：none/low/moderate/high
   - none：一般負面情緒、壓力、受傷、生氣、焦慮（但無自傷/傷人/失控意圖）
   - low：有明顯絕望/強烈自我否定，但沒有自傷/傷人計畫或立即性
   - moderate：提到自傷/自殺/傷害他人「念頭」或疑似失控，但不明確立即
   - high：有自傷/自殺/傷人計畫、立即危險、或明確求救
5) recommend_professional_help：true/false（僅 moderate/high 或長期嚴重影響才 true）
6) safety_action：none/encourage_support/urgent_help
   - none：一般陪伴即可
   - encourage_support：鼓勵找信任的人/陪伴資源
   - urgent_help：若有立即危險，提醒立刻尋求緊急協助
7) analysis_notes：1~2句，描述情緒脈絡即可（不要診斷）
8) emotion_reasons：必須包含 8 種情緒各自的原因說明。
   - 每個 key 都要存在：Joy, Sadness, Anger, Fear, Anticipation, Surprise, Disgust, Trust。
   - reason 必須根據日記內容或情緒脈絡推論，不可以寫「整體日常狀態」、「可能來自日記內容」這類空話。
   - 若該情緒分數為 0，也要簡短說明為什麼沒有明顯出現，例如「日記主要描述壓力與疲憊，沒有明確喜悅事件」。

格式：
{{
  "emotions": {{"Joy":0,"Sadness":0,"Anger":0,"Fear":0,"Anticipation":0,"Surprise":0,"Disgust":0,"Trust":0}},
  "dominant_emotions": [],
  "emotional_intensity": 0,
  "risk_level": "none",
  "recommend_professional_help": false,
  "safety_action": "none",
  "analysis_notes": "",
  "emotion_reasons": {{
    "Joy": "",
    "Sadness": "",
    "Anger": "",
    "Fear": "",
    "Anticipation": "",
    "Surprise": "",
    "Disgust": "",
    "Trust": ""
  }}
}}

安全初篩風險：{safety_risk}

神經網路先驗：
{neural_block}

日記：
{diary}
""".strip()

    res = client.responses.create(model=MODEL, input=prompt)
    result = to_json(res.output_text)

    if result is None:
        print("[警告] 情緒分析 JSON 解析失敗，已啟動安全降級。")
        fallback = _safe_fallback_analysis()
        fallback["neural_prior"] = neural_prior
        return fallback

    # 確保前端每一個柱狀圖點下去都有 emotion_reasons 可讀，且分數正規化為 100%。
    return normalize_emotion_result(result, neural_prior)


def tag_diary(diary: str) -> dict:
    if detect_safety_risk(diary) == "high":
        return {
            "stressor_tags": [{"tag": "other", "reason": "安全模式已啟動，系統不展開高風險內容細節。"}],
            "buffer_tags": [{"tag": "none", "reason": "目前優先提供安全資源提示。"}],
            "joy_tags": [],
            "one_line_summary": "安全模式已啟動，今天的內容以安全支持為優先。",
        }

    prompt = f"""
你是標籤分類模組。只輸出 JSON，不要多餘文字或說明。

從以下日記分析三類標籤，每類最多 2 個，沒有則回傳空陣列。
reason 用一句話概括原因，不要抄原文，不要包含人名。

可用標籤：
- stressor_tags：time / schoolwork / future / relationships / family / health / money / self_image / other
- buffer_tags：family_support / friend_support / rest / routine / exercise / none
- joy_tags：friend_time / family_time / achievement / relief / rest / gratitude / other

輸出格式（嚴格照這個 JSON，不要加其他文字）：
{{
  "stressor_tags": [{{"tag": "...", "reason": "..."}}],
  "buffer_tags": [{{"tag": "...", "reason": "..."}}],
  "joy_tags": [{{"tag": "...", "reason": "..."}}],
  "one_line_summary": "一句話摘要整篇日記的情緒脈絡"
}}

日記：
{diary}
""".strip()

    res = client.responses.create(model=MODEL, input=prompt)
    result = to_json(res.output_text)
    if result is None:
        return {"stressor_tags": [], "buffer_tags": [], "joy_tags": [], "one_line_summary": "（標籤解析失敗）"}
    return result


def summarize_daily_fragments(entries: list[dict]) -> str:
    lines = []
    for i, item in enumerate(entries, 1):
        ts = item.get("timestamp")
        if hasattr(ts, "strftime"):
            label = ts.strftime("%H:%M")
        else:
            label = f"第{i}則"
        lines.append(f"{label}：{item.get('content', '')}")
    source = "\n".join(lines)
    if not source.strip():
        return ""

    prompt = f"""
你是小島精靈的日記整理助手。請把使用者今天多則小日記整合成一篇「當日日記」。

規則：
- 使用第一人稱或貼近使用者的日記語氣。
- 保留具體事件、情緒轉折與重要脈絡，不要加入原文沒有的事件。
- 不做情緒分析，不下診斷，不給建議。
- 200~450 字，繁體中文。

今天的小日記：
{source}
""".strip()
    try:
        res = client.responses.create(model=MODEL, input=prompt)
        text = res.output_text.strip()
        return text or source
    except Exception as exc:
        print(f"[警告] LLM 統整小日記失敗：{exc}")
        return "\n\n".join(line.split("：", 1)[-1] for line in lines)


def quick_support(diary: str) -> dict:
    risk_level = detect_safety_risk(diary)
    if risk_level == "high":
        return {
            "comfort": "謝謝你把這些說出來，這需要很大的勇氣。現在最重要的是讓身邊一個你信任的人知道你的狀態。",
            "suggestions": ["先待在安全、有人能找到你的地方", "立刻聯絡一位信任的人陪你", "若有立即危險，請打 1925、1980 或 119"],
            "blessing": "如果現在找不到人，1925 安心專線與 1980 生命線都可以直接撥打，不需要準備好才求助。",
            "risk_level": "high",
            "safety_action": "urgent_help",
        }

    prompt = f"""
請用「心情小島的小島精靈」語氣回覆使用者剛寫下的小日記。

重要：
- 這一步只做即時陪伴，不做情緒分析、不分類、不推論診斷。
- comfort：1~2句安慰，具體接住使用者的狀態。
- suggestions：3個很小、現在可以做的事情，例如喝水、休息、深呼吸、伸展、洗臉。
- blessing：1句小島精靈的溫柔祝福。
- 不要提心理師/諮商，除非內容有安全風險。

只輸出 JSON：
{{
  "comfort": "",
  "suggestions": [],
  "blessing": "",
  "risk_level": "{risk_level}",
  "safety_action": "none"
}}

小日記：
{diary}
""".strip()
    try:
        res = client.responses.create(model=MODEL_FEEDBACK, input=prompt)
        result = to_json(res.output_text)
        if result:
            result["risk_level"] = risk_level
            result.setdefault("safety_action", "encourage_support" if risk_level in ["low", "moderate"] else "none")
            result.setdefault("suggestions", ["喝一點水", "慢慢吸氣吐氣三次", "讓肩膀放鬆一下"])
            return result
    except Exception as exc:
        print(f"[警告] 小日記即時陪伴生成失敗：{exc}")

    return {
        "comfort": "謝謝你願意把這段心情交給小島精靈，能說出來就已經很不容易了。",
        "suggestions": ["喝一點水", "慢慢吸氣吐氣三次", "讓眼睛休息一分鐘"],
        "blessing": "小島精靈會先把這段心情收好，等今晚再陪你整理成今天的故事。",
        "risk_level": risk_level,
        "safety_action": "encourage_support" if risk_level in ["low", "moderate"] else "none",
    }


def user_feedback(diary: str, analysis: dict, mode: str) -> str:
    risk_level = analysis.get("risk_level", "none")
    safety_action = analysis.get("safety_action", "none")
    urgent = (safety_action == "urgent_help")

    emergency_note = ""
    if risk_level == "high":
        emergency_note = f"""
請在回覆最後另起一行，直接附上以下資源區塊，不要改寫、不要省略：
{EMERGENCY_RESOURCES}
"""

    if mode == "SAFE_MODE":
        if risk_level == "high":
            extra_rules = f"""
【high 風險專用規則】
- 絕對不要提及、複述、暗示使用者日記中的任何具體行為或計畫。
- 不要描述或放大使用者的負面情緒狀態（例如：沉重、疲憊、痛苦、無法承擔）。
- 不要用「我能感受到」「你一定很累」「真的很不容易」等語句。
- 不要說「你並不孤單」「總有人在乎你」「想想你的家人朋友」等過度安慰的話。
- 語氣平靜、簡短、直接，像一個穩定的朋友，不煽情、不說教。
- 開場只用一句：謝謝你說出來，然後直接引導找人或打專線。
- 「請好好照顧自己」「照顧好自己」「保重」等空泛安慰語句都不要。
- 可以給予勇氣肯定（例如：「一切都會好的」「你很勇敢」「我相信你」），但不要延伸或放大情緒。
{emergency_note}
"""
        elif risk_level == "moderate":
            extra_rules = """
- 允許提到「找信任的人陪著／聊聊」
- 可用選擇性語氣提及專業資源（不要強迫）
- 不要複述日記中的具體負面行為描述
"""
        else:
            extra_rules = """
- 允許提到「找信任的人陪著／聊聊」
- 不要提諮商/心理師/專業資源
"""
    else:
        extra_rules = """
- 絕對不要提諮商/心理師/專業資源
- 只做情緒理解、陪伴、以及一個超小步驟
"""

    low_note = ""
    if risk_level == "low":
        low_note = "- 這位使用者有明顯的自我否定或絕望感，請語氣更溫柔，陪伴感加強，但不需要提專業資源。"

    if risk_level == "high":
        structure = """
回覆結構（約2~3段，不要有條列符號）：

【嚴格禁止的開場與措辭】
- 不要說「我能感受到你此刻的心情」
- 不要說「或許這一切讓你覺得無法承擔」
- 不要說「真的很不容易」「真的很沉重」「一定很累很痛」
- 不要描述或反映使用者的痛苦狀態
- 不要說「請記得你並不孤單」「總有人在乎你」「想想你的家人朋友」

【正確做法】
第一句：謝謝你把這些說出來，這需要很大的勇氣。（就這樣，不要延伸）
接著：直接、簡單地說，現在最重要的一件事，是讓身邊一個你信任的人知道你現在的狀態，可以是朋友、家人，或者任何你覺得安全的人。
最後：如果現在找不到人，1925 和 1980 隨時都有人接，不需要準備好才打。
"""
    else:
        structure = """
回覆結構（約3段）：
1) 用一句話反映對方狀態（具體，不空泛）
2) 接住情緒（允許他這樣感受）
3) 給一個很小、很容易做到的下一步（例如：呼吸、寫下1句、喝水、洗臉、傳訊息給朋友等）

注意：
- 日記中已發生的事件（如朋友聚餐、家人陪伴）只能用來理解情緒脈絡，不能當成「建議」或「下一步」重複提出
- 所有建議的行動必須是使用者「還沒做」的事
"""

    prompt = f"""
請寫一段「像朋友說的話」的回饋（繁體中文）。

共同原則：
- 溫柔、自然、不說教
- 不下診斷、不貼標籤
- 不要用「你應該」「你必須」
- 先理解，再陪伴
{low_note}
{structure}

重要規則：
- 如果 risk_level=none 或 low，【絕對不要】提諮商/心理師/專業資源。
- 如果 risk_level=moderate，才可以用「選擇性語氣」提到：可以找信任的人聊聊、或考慮找專業談談（但不要強迫）。
- 如果 risk_level=high，【絕對不要】複述或暗示日記中任何具體行為，只做陪伴與引導。

額外規則：
{extra_rules}

當前風險等級：{risk_level}
是否需要緊急安全提醒：{"是" if urgent else "否"}

日記：
{diary}
""".strip()

    res = client.responses.create(model=MODEL_FEEDBACK, input=prompt)
    return res.output_text.strip()


def determine_mode(risk_level: str) -> str:
    """
    根據風險等級決定回應模式。
    low 也進入 SAFE_MODE，提供更強的陪伴支持。
    """
    if risk_level in ["low", "moderate", "high"]:
        return "SAFE_MODE"
    return "SUPPORT_MODE"


def save_to_api(user_id: str, conversation_id: str, emotion: dict) -> bool:
    """
    將情緒分析結果透過 FastAPI 存進 MongoDB。
    回傳 True 表示成功，False 表示失敗（不中斷主流程）。
    """
    try:
        payload = {
            "userId": user_id,
            "conversationId": conversation_id,
            "scores": {k: v / 100 for k, v in emotion.get("emotions", {}).items()},  # 百分比轉小數
            "summary": emotion.get("analysis_notes", "")
        }
        res = requests.post(f"{API_BASE}/analyses", json=payload, timeout=5)
        if res.status_code == 201:
            print(f"✅ 已存入 MongoDB（analysis_id: {res.json().get('analysis_id')}）")
            return True
        else:
            print(f"[警告] API 回傳非預期狀態碼：{res.status_code}，{res.text}")
            return False
    except requests.exceptions.ConnectionError:
        print("[警告] 無法連線到 FastAPI，請確認 uvicorn 是否已啟動（uvicorn main:app --reload）")
        return False
    except Exception as e:
        print(f"[警告] 存入 MongoDB 失敗：{e}")
        return False


def run_pipeline(diary: str, user_id: str, conversation_id: str) -> dict:
    """
    完整流程：
    1. analyze_emotion()  — 情緒分析（含錯誤降級）
    2. tag_diary()        — 後台標籤（使用者不會看到）
    3. determine_mode()   — 根據風險等級決定回應模式
    4. user_feedback()    — 生成 AI 回饋
    5. save_to_api()      — 透過 FastAPI 存進 MongoDB
    """
    print("=== 情緒分析 ===")
    emotion = analyze_emotion(diary)
    print(json.dumps(emotion, ensure_ascii=False, indent=2))

    risk_level = emotion.get("risk_level", "moderate")
    mode = determine_mode(risk_level)

    tags = tag_diary(diary)
    print("\n=== 後台標籤 ===")
    print(json.dumps(tags, ensure_ascii=False, indent=2))

    print(f"\n=== 回應模式：{mode}（風險等級：{risk_level}）===")
    feedback = user_feedback(diary, emotion, mode)
    print("\n=== 使用者回饋 ===")
    print(feedback)

    save_to_api(user_id, conversation_id, emotion)

    return {
        "emotion": emotion,
        "tags": tags,
        "mode": mode,
        "feedback": feedback
    }


if __name__ == "__main__":
    TEST_USER_ID = "6a0ea00c84a64ca664a4d765" 
    TEST_CONVERSATION_ID = "6a0ea00c84a64ca664a4d765" 

    diary = """今天其實沒有發生什麼特別大的事，但心裡一直有一種說不上來的疲憊感。

        早上醒來的時候，明明身體已經休息了，心卻好像還停留在昨天的壓力裡。很多事情一件一件堆在腦中，學校的事、專題的事、未來的事，還有一些人際上的小情緒，雖然每一件看起來都不算嚴重，但加在一起就讓人有點喘不過氣。

        我發現自己最近很容易對自己不滿意。好像只要做得不夠快、不夠好，就會開始懷疑自己是不是不夠努力。可是今天突然想到，也許我不是不努力，而是真的有點累了。一直逼自己前進，卻忘了自己也需要被好好照顧。

        下午的時候，有一瞬間我只是安靜地坐著，沒有滑手機，也沒有急著做下一件事。那一刻我才感覺到，其實我很久沒有認真聽自己的心了。我不是沒有情緒，只是平常太習慣把它們壓下去，然後告訴自己「沒事，撐一下就好」。

        但今天我想允許自己不要那麼堅強。

        也許我可以慢一點，也許我可以承認自己會害怕、會累、會不安。這些都不代表我很糟，只代表我是人。我希望自己不要只在完成事情的時候才覺得有價值，而是在普通、疲憊、甚至狀態不好的時候，也能相信自己仍然值得被愛。

        今天的我沒有解決所有問題，但至少我願意誠實面對自己的狀態。這也算是一種進步吧。

        希望明天的我，可以帶著今天的覺察，溫柔一點地對待自己。"""

    run_pipeline(diary, user_id=TEST_USER_ID, conversation_id=TEST_CONVERSATION_ID)
