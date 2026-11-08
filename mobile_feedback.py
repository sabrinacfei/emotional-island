"""Authenticated cloud classification + phone feedback commits. No generative API calls."""
import asyncio
import hashlib
import hmac
import math
from datetime import datetime, timedelta, timezone
from typing import Literal

import jwt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from slm_schemas import Scores
from safety_policy import decide
from safety_rules import detect_safety_risk
from modernbert_chunking import LABELS


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    content: str = Field(min_length=1, max_length=12000)
    date_label: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class PhoneClassificationInput(Input):
    classification: dict


class NativeGeneration(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
    execution: Literal["on-device"]
    runtime: Literal["llama.rn@0.13.0-rc.9"]
    model: Literal["qwen3.5-4b-q4_k_m"]
    sha256: Literal["a9d0a3e1d8c91732a3812becd31f8d4a8ff57414903f226306069f0437e2ac50"]
    tokens_predicted: int = Field(ge=1, le=528)
    duration_ms: float = Field(gt=0)
    tokens_per_second: float | None
    stopped_eos: bool
    raw_text: str = Field(min_length=1, max_length=12000)


class Cause(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["stressor", "buffer", "joy"]
    topic: str = Field(min_length=1, max_length=40)
    explanation: str = Field(min_length=1, max_length=180)
    evidence: str = Field(min_length=2, max_length=160)
    emotions: list[Literal["Anger", "Anticipation", "Disgust", "Fear", "Joy", "Sadness", "Surprise", "Trust"]] = Field(min_length=1, max_length=3)


class PhoneSupport(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    status: Literal["completed", "local_safety"]
    comfort: str = Field(min_length=1, max_length=700)
    suggestions: list[str] = Field(max_length=2)
    blessing: str = Field(max_length=160)
    risk_level: Literal["none", "low", "moderate", "high"]
    response_mode: Literal["SUPPORT_MODE", "SAFE_MODE"]
    safety_action: Literal["none", "encourage_support", "urgent_help"]
    context: dict[str, str] | None
    generation: NativeGeneration | None
    causes: list[Cause] = Field(default_factory=list, max_length=3)


class Commit(Input):
    entry_id: str = Field(pattern=r"^[A-Za-z0-9_-]{8,100}$")
    kind: Literal["fragment", "daily"]
    date_label: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    receipt_token: str | None = Field(max_length=512000)
    support: PhoneSupport


def digest(content: str) -> str:
    return hashlib.sha256(content.strip().encode("utf-8")).hexdigest()


def router(current_user, save_entry, secret: str, classifier=None, require_final=None) -> APIRouter:
    api = APIRouter(prefix="/mobile", tags=["Phone SLM"])

    @api.post("/emotions/on-device")
    async def register_phone(data: PhoneClassificationInput, uid=Depends(current_user)):
        if not data.content.strip() or not data.date_label:
            raise HTTPException(422, "正式分類需要每日日記日期與定稿內容。")
        revision = await require_final(uid, data.date_label, data.content) if require_final else digest(data.content)
        floor = detect_safety_risk(data.content)
        if floor == 'high':
            return {"backend":"modernbert","classification_available":False,"scores":None,"receipt_token":None,"risk_floor":"high"}
        try:
            from phone_classifier import validate_phone_classification
            result,trace=validate_phone_classification(data.classification,digest(data.content))
        except (ValueError,KeyError,TypeError,FileNotFoundError):
            raise HTTPException(422, "手機分類紀錄與定稿內容或模型版本不符。") from None
        analysis={k:result[k] for k in ("probabilities","top_3","labels","token_count","chunk_count","chunks","aggregation","truncated")}
        now=datetime.now(timezone.utc)
        receipt=jwt.encode({"sub":str(uid),"aud":"phone-emotions-v1","exp":now+timedelta(hours=24),
            "iat":now,"date_label":data.date_label,"final_revision":revision,"input_sha256":digest(data.content),
            "scores":result['scores'],"risk_floor":floor,"classifier":"modernbert-lora","analysis":analysis,
            "classifier_execution":"on-device","classifier_provenance":"client_reported_native_classifier",
            "classifier_trace":trace},secret,algorithm='HS256')
        return {"backend":"modernbert","classification_available":True,"scores":result['scores'],"analysis":analysis,
                "receipt_token":receipt,"risk_floor":floor,"classifier_execution":"on-device","classifier_trace":trace}
    @api.post("/emotions")
    async def classify(data: Input, uid=Depends(current_user)):
        if not data.content.strip() or not data.date_label:
            raise HTTPException(422, "正式分類需要每日日記日期與定稿內容。")
        revision = await require_final(uid, data.date_label, data.content) if require_final else digest(data.content)
        floor = detect_safety_risk(data.content)
        if floor == "high":
            return {"backend": "modernbert", "classification_available": False, "scores": None,
                    "receipt_token": None, "risk_floor": "high"}
        try:
            provider = classifier
            if provider is None:
                from classifier_gateway import predict
                provider = predict
            prior = await asyncio.to_thread(provider, data.content.strip())
            scores = Scores.model_validate(prior["scores"]).model_dump()
            if not prior.get("available") or prior.get("backend") != "modernbert" or sum(scores.values()) != 100:
                raise ValueError("Invalid classifier result")
            analysis = {k: prior[k] for k in ("probabilities", "top_3", "labels", "token_count", "chunk_count", "chunks", "aggregation", "truncated")}
            probabilities = analysis["probabilities"]
            if (set(probabilities) != set(scores) or any(not math.isfinite(v) or not 0 <= v <= 1 for v in probabilities.values())
                    or abs(sum(probabilities.values()) - 1) > 1e-4 or tuple(analysis["labels"]) != LABELS
                    or analysis["truncated"] or analysis["chunk_count"] != len(analysis["chunks"]) or analysis["token_count"] < 1):
                raise ValueError("Incomplete full-diary analysis")
        except Exception:
            raise HTTPException(503, "ModernBERT 情緒分類暫時無法完成，請稍後重試。") from None
        now = datetime.now(timezone.utc)
        # The commit consumes the server's scores, never client-supplied replacements.
        receipt = jwt.encode({"sub": str(uid), "aud": "phone-emotions-v1", "exp": now + timedelta(hours=24),
                              "iat": now, "date_label": data.date_label, "final_revision": revision, "input_sha256": digest(data.content), "scores": scores,
                              "risk_floor": floor, "classifier": "modernbert-lora", "analysis": analysis}, secret, algorithm="HS256")
        return {"backend": "modernbert", "classification_available": True, "scores": scores,
                "receipt_token": receipt, "risk_floor": floor, "preprocessing_max_tokens": 128, "analysis": analysis}

    @api.post("/diaries")
    async def commit(data: Commit, uid=Depends(current_user)):
        floor = detect_safety_risk(data.content)
        scores = None
        analysis = None
        classifier_execution = None
        classifier_trace = None
        classifier_provenance = None
        if data.kind == "fragment" and data.receipt_token:
            raise HTTPException(422, "小日記不接受正式分類結果。")
        if data.kind == "daily" and require_final:
            await require_final(uid, data.date_label, data.content)
        if data.receipt_token:
            try:
                receipt = jwt.decode(data.receipt_token, secret, algorithms=["HS256"], audience="phone-emotions-v1",
                                     options={"require": ["sub", "exp", "input_sha256", "scores", "risk_floor", "classifier", "analysis"]})
                if (receipt["sub"] != str(uid) or receipt.get("date_label") != data.date_label or receipt["classifier"] != "modernbert-lora"
                        or not hmac.compare_digest(receipt["input_sha256"], digest(data.content))):
                    raise ValueError("Classifier receipt does not match diary/user")
                scores = Scores.model_validate(receipt["scores"]).model_dump()
                analysis = receipt["analysis"]
                classifier_execution = receipt.get("classifier_execution", "cloud")
                classifier_trace = receipt.get("classifier_trace")
                classifier_provenance = receipt.get("classifier_provenance", "server_executed_classifier")
                if sum(scores.values()) != 100:
                    raise ValueError("Invalid classifier distribution")
                floor = decide(floor, receipt["risk_floor"]).risk_level
            except Exception:
                raise HTTPException(409, "分類紀錄已過期或與日記不符，請重新分析。") from None
        elif data.kind == "daily" and floor != "high":
            raise HTTPException(409, "缺少有效的 ModernBERT 分類紀錄。")
        route = decide(floor, data.support.risk_level)
        if route.risk_level != data.support.risk_level or route.response_mode != data.support.response_mode or route.safety_action != data.support.safety_action:
            raise HTTPException(422, "安全模式不一致，未儲存為完成結果。")
        if ((route.risk_level == "high") != (data.support.status == "local_safety")
                or any(not s.strip() or len(s) > 160 for s in data.support.suggestions)):
            raise HTTPException(422, "回饋狀態不一致。")
        if (data.support.status == "completed") != (data.support.generation is not None):
            raise HTTPException(422, "缺少本機生成紀錄，或固定安全回應被錯誤標示為模型生成。")
        context_keys = {"event_context", "emotional_context", "main_concern", "coping_already_tried", "support_preference"}
        if route.risk_level != "high" and (not data.support.context or set(data.support.context) != context_keys
                or any(not v.strip() or len(v) > 180 for v in data.support.context.values())):
            raise HTTPException(422, "語境資料不完整。")
        if data.kind == "fragment" and data.support.causes:
            raise HTTPException(422, "小日記不建立正式情緒成因。")
        if any(c.evidence not in data.content for c in data.support.causes):
            raise HTTPException(422, "情緒成因缺少原文依據。")
        support = data.support.model_dump()
        if route.risk_level == "high":
            # Fixed server copy as well: do not persist arbitrary high-risk free generation.
            support.update(comfort="現在先以你的安全為優先。若有立即危險，請聯絡當地緊急服務，並請可信任的人陪伴你尋求專業協助。",
                           suggestions=["先前往有人陪伴的安全地方，遠離可能造成傷害的物品或環境。"], blessing="")
        result = {**support, "scores": scores, "classification_available": scores is not None,
                  "response_mode": route.response_mode, "safety_check_status": "screened",
                  "safety_decision": route.model_dump(), "inference_source": "phone-qwen3.5-4b" if data.support.generation else "fixed-safety",
                  "inference_provenance": "client_reported_native_trace" if data.support.generation else "fixed_template",
                  "classifier_source": "modernbert-lora" if scores else None, "classifier_analysis": analysis,
                  "classifier_execution":classifier_execution,"classifier_trace":classifier_trace,
                  "classifier_provenance":classifier_provenance}
        return await save_entry(uid, data, result)

    return api
