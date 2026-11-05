"""Shared text rules for response routing; not a clinical risk assessment."""
import re

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


