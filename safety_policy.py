"""Application response routing, not a clinically validated risk assessment."""
from typing import Literal

from pydantic import ConfigDict, model_validator

from slm_client import SelfHostedGenerationError
from slm_schemas import Risk, Action, StrictResult

RISK_RANK = {"none": 0, "low": 1, "moderate": 2, "high": 3}
MODES = {"none": "SUPPORT_MODE", "low": "SAFE_MODE", "moderate": "SAFE_MODE", "high": "SAFE_MODE"}
ACTIONS = {"none": "none", "low": "encourage_support", "moderate": "encourage_support", "high": "urgent_help"}


class SafetyPolicyError(SelfHostedGenerationError):
    pass


class SafetyDecision(StrictResult):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)
    risk_level: Risk
    response_mode: Literal["SUPPORT_MODE", "SAFE_MODE"]
    safety_action: Action
    allow_cloud_feedback: bool

    @model_validator(mode="after")
    def consistent_route(self):
        if (self.response_mode != MODES[self.risk_level]
                or self.safety_action != ACTIONS[self.risk_level]
                or self.allow_cloud_feedback != (self.risk_level != "high")):
            raise ValueError("Inconsistent safety route")
        return self


def decide(*signals: str) -> SafetyDecision:
    if not signals or any(signal not in RISK_RANK for signal in signals):
        raise SafetyPolicyError("安全判斷資料不完整，未放行 GPT 回饋。")
    risk = max(signals, key=RISK_RANK.get)
    return SafetyDecision(risk_level=risk, response_mode=MODES[risk],
                          safety_action=ACTIONS[risk], allow_cloud_feedback=risk != "high")


def record_decision(analysis: dict, decision: SafetyDecision) -> None:
    analysis.update({"risk_level": decision.risk_level, "response_mode": decision.response_mode,
                     "safety_action": decision.safety_action,
                     "recommend_professional_help": decision.risk_level in {"moderate", "high"},
                     "safety_check_status": "screened", "safety_decision": decision.model_dump()})


class UrgentSafetyDetected(SafetyPolicyError):
    def __init__(self, decision: SafetyDecision):
        self.decision = decision
        super().__init__("已切換本機安全回應，未呼叫 GPT。")
