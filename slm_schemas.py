"""Constrain and validate the fields consumed by the existing App."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Emotion = Literal["Joy", "Sadness", "Anger", "Fear", "Anticipation", "Surprise", "Disgust", "Trust"]
Risk = Literal["none", "low", "moderate", "high"]
Action = Literal["none", "encourage_support", "urgent_help"]
Text = Annotated[str, Field(min_length=1, max_length=1500)]
Score = Annotated[int, Field(ge=0, le=100)]


class StrictResult(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Scores(StrictResult):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)
    Joy: Score
    Sadness: Score
    Anger: Score
    Fear: Score
    Anticipation: Score
    Surprise: Score
    Disgust: Score
    Trust: Score


class Reasons(StrictResult):
    Joy: Text
    Sadness: Text
    Anger: Text
    Fear: Text
    Anticipation: Text
    Surprise: Text
    Disgust: Text
    Trust: Text


class EmotionResult(StrictResult):
    emotions: Scores
    dominant_emotions: Annotated[list[Emotion], Field(min_length=1, max_length=3)]
    emotional_intensity: Annotated[int, Field(ge=0, le=3)]
    risk_level: Risk
    recommend_professional_help: bool
    safety_action: Action
    analysis_notes: Text
    emotion_reasons: Reasons

    @model_validator(mode="after")
    def positive_scores(self):
        if sum(self.emotions.model_dump().values()) <= 0:
            raise ValueError("Empty emotion distribution")
        return self


class StressorTag(StrictResult):
    tag: Literal["time", "schoolwork", "future", "relationships", "family", "health", "money", "self_image", "other"]
    reason: Text


class BufferTag(StrictResult):
    tag: Literal["family_support", "friend_support", "rest", "routine", "exercise", "none"]
    reason: Text


class JoyTag(StrictResult):
    tag: Literal["friend_time", "family_time", "achievement", "relief", "rest", "gratitude", "other"]
    reason: Text


class TagsResult(StrictResult):
    stressor_tags: Annotated[list[StressorTag], Field(max_length=2)]
    buffer_tags: Annotated[list[BufferTag], Field(max_length=2)]
    joy_tags: Annotated[list[JoyTag], Field(max_length=2)]
    one_line_summary: Text


class SupportResult(StrictResult):
    comfort: Text
    suggestions: Annotated[list[Text], Field(min_length=3, max_length=3)]
    blessing: Text
    risk_level: Risk
    safety_action: Action
