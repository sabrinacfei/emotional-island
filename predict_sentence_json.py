#!/usr/bin/env python3
"""Run one-sentence Plutchik emotion inference and print JSON.

Examples:
  python predict_sentence_json.py --text "I am excited but a little scared."
  echo "I miss my old friend." | python predict_sentence_json.py
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

try:
    import numpy as np
    import torch
    import torch.nn as nn
    from transformers import AutoModel, AutoTokenizer
except ModuleNotFoundError as exc:  # pragma: no cover - depends on local environment
    raise SystemExit(
        f"Missing Python package `{exc.name}`. Install the project inference dependencies first, "
        "for example: pip install torch transformers peft numpy"
    ) from exc

try:
    from peft import LoraConfig, TaskType, get_peft_model
except Exception as exc:  # pragma: no cover - depends on local environment
    LoraConfig = None
    TaskType = None
    get_peft_model = None
    PEFT_IMPORT_ERROR = exc
else:
    PEFT_IMPORT_ERROR = None


LABELS = [
    "anger",
    "anticipation",
    "disgust",
    "fear",
    "joy",
    "sadness",
    "surprise",
    "trust",
]


class PlutchikClassifier(nn.Module):
    def __init__(
        self,
        encoder: nn.Module,
        hidden_size: int,
        pooling: str = "cls_mean_max",
        dropout: float = 0.25,
    ):
        super().__init__()
        self.encoder = encoder
        self.pooling = pooling

        if pooling in {"cls", "mean"}:
            pooled_size = hidden_size
        elif pooling == "cls_mean":
            pooled_size = hidden_size * 2
        elif pooling == "cls_mean_max":
            pooled_size = hidden_size * 3
        else:
            raise ValueError(f"Unsupported pooling: {pooling}")

        self.head = nn.Sequential(
            nn.LayerNorm(pooled_size),
            nn.Dropout(dropout),
            nn.Linear(pooled_size, 512),
            nn.GELU(),
            nn.LayerNorm(512),
            nn.Dropout(dropout),
            nn.Linear(512, len(LABELS)),
        )

    @staticmethod
    def masked_mean(hidden: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        mask = mask.unsqueeze(-1).to(dtype=hidden.dtype)
        return (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1.0)

    @staticmethod
    def masked_max(hidden: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        mask = mask.unsqueeze(-1).bool()
        masked = hidden.masked_fill(~mask, torch.finfo(hidden.dtype).min)
        return masked.max(dim=1).values

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        outputs = self.encoder(input_ids=input_ids, attention_mask=attention_mask)
        hidden = outputs.last_hidden_state
        cls = hidden[:, 0]

        if self.pooling == "cls":
            pooled = cls
        elif self.pooling == "mean":
            pooled = self.masked_mean(hidden, attention_mask)
        elif self.pooling == "cls_mean":
            pooled = torch.cat([cls, self.masked_mean(hidden, attention_mask)], dim=-1)
        else:
            pooled = torch.cat(
                [
                    cls,
                    self.masked_mean(hidden, attention_mask),
                    self.masked_max(hidden, attention_mask),
                ],
                dim=-1,
            )

        head_dtype = next(self.head.parameters()).dtype
        return self.head(pooled.to(dtype=head_dtype))


def apply_thresholds(
    probs: np.ndarray,
    thresholds: np.ndarray,
    force_at_least_one: bool,
    max_labels: int | None,
) -> np.ndarray:
    pred = (probs > thresholds).astype(int)

    if force_at_least_one:
        empty = np.where(pred.sum(axis=1) == 0)[0]
        if len(empty):
            best = np.argmax(probs[empty], axis=1)
            pred[empty, best] = 1

    if max_labels is not None:
        too_many = np.where(pred.sum(axis=1) > max_labels)[0]
        for row in too_many:
            keep = np.argsort(probs[row])[-max_labels:]
            new_row = np.zeros(pred.shape[1], dtype=int)
            new_row[keep] = 1
            pred[row] = new_row

    return pred


DEFAULT_MODEL_DIR = Path(os.getenv(
    "PLUTCHIK_MODEL_DIR",
    Path(__file__).resolve().parent / "plutchik_human_poslog_data42_model17",
))


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def load_torch_state(path: Path, device: torch.device) -> dict[str, torch.Tensor]:
    try:
        return torch.load(path, map_location=device, weights_only=True)
    except TypeError:
        return torch.load(path, map_location=device)


def pick_device(device_name: str) -> torch.device:
    if device_name == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device_name == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested, but torch.cuda.is_available() is false.")
    return torch.device(device_name)


def read_text(text_arg: str | None) -> str:
    if text_arg is not None:
        return text_arg.strip()
    if not sys.stdin.isatty():
        return sys.stdin.read().strip()

    print("Input sentence: ", end="", file=sys.stderr, flush=True)
    return sys.stdin.readline().strip()


def build_encoder(config: dict):
    backbone = config.get("backbone") or config.get("model_name") or "microsoft/deberta-v3-large"
    encoder = AutoModel.from_pretrained(backbone)

    if not config.get("use_lora", True):
        return encoder
    if get_peft_model is None:
        raise RuntimeError(f"Install `peft` to load this LoRA model: {PEFT_IMPORT_ERROR}")

    target_modules = config.get("target_modules", "query_proj,key_proj,value_proj,dense")
    if isinstance(target_modules, str):
        target_modules = [x.strip() for x in target_modules.split(",") if x.strip()]

    lora_config = LoraConfig(
        task_type=TaskType.FEATURE_EXTRACTION,
        r=int(config.get("lora_r", 32)),
        lora_alpha=int(config.get("lora_alpha", 64)),
        lora_dropout=float(config.get("lora_dropout", 0.15)),
        target_modules=target_modules,
        bias="none",
        use_rslora=bool(config.get("use_rslora", True)),
    )
    return get_peft_model(encoder, lora_config)


def load_model(model_dir: Path, device: torch.device):
    config_path = model_dir / "run_config.json"
    if not config_path.exists():
        raise FileNotFoundError(f"Missing run config: {config_path}")
    config = load_json(config_path)

    tokenizer_path = model_dir / "tokenizer"
    tokenizer_source = tokenizer_path if tokenizer_path.exists() else config.get("backbone")
    tokenizer = AutoTokenizer.from_pretrained(
        tokenizer_source,
        use_fast=not bool(config.get("slow_tokenizer", False)),
    )

    encoder = build_encoder(config)
    encoder_config = getattr(encoder, "config", None) or getattr(getattr(encoder, "base_model", None), "config", None)
    if encoder_config is None:
        raise RuntimeError("Could not find encoder hidden_size from the loaded model config.")
    hidden_size = encoder_config.hidden_size
    model = PlutchikClassifier(
        encoder=encoder,
        hidden_size=hidden_size,
        pooling=config.get("pooling", "cls_mean_max"),
        dropout=float(config.get("head_dropout", 0.35)),
    )

    state_path = model_dir / "model_state_dict.pt"
    if not state_path.exists():
        raise FileNotFoundError(f"Missing model weights: {state_path}")
    model.load_state_dict(load_torch_state(state_path, device))
    model.to(device)
    model.eval()

    threshold_path = model_dir / "thresholds.npy"
    if threshold_path.exists():
        thresholds = np.load(threshold_path).astype(np.float32)
    else:
        thresholds = np.array(config.get("thresholds", [0.5] * len(LABELS)), dtype=np.float32)

    return SimpleNamespace(
        model=model,
        tokenizer=tokenizer,
        thresholds=thresholds,
        config=config,
    )


@torch.no_grad()
def predict_sentence(text: str, bundle: SimpleNamespace, device: torch.device) -> dict:
    max_length = int(bundle.config.get("max_length", 128))
    encoded = bundle.tokenizer(
        [text],
        truncation=True,
        padding=True,
        max_length=max_length,
        return_tensors="pt",
    )
    encoded = {key: value.to(device) for key, value in encoded.items()}

    logits = bundle.model(
        input_ids=encoded["input_ids"],
        attention_mask=encoded["attention_mask"],
    )
    probs = torch.sigmoid(logits.float()).cpu().numpy()

    max_labels = bundle.config.get("max_labels", 4)
    predicted = apply_thresholds(
        probs,
        bundle.thresholds,
        force_at_least_one=bool(bundle.config.get("force_at_least_one", True)),
        max_labels=None if max_labels is None else int(max_labels),
    )[0]

    probabilities = {label: round(float(probs[0, i]), 6) for i, label in enumerate(LABELS)}
    thresholds = {label: round(float(bundle.thresholds[i]), 6) for i, label in enumerate(LABELS)}
    predicted_emotions = [label for i, label in enumerate(LABELS) if predicted[i] == 1]
    top_index = int(np.argmax(probs[0]))

    return {
        "text": text,
        "predicted_emotions": predicted_emotions,
        "top_emotion": LABELS[top_index],
        "top_probability": probabilities[LABELS[top_index]],
        "probabilities": probabilities,
        "thresholds": thresholds,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text", help="Sentence to classify. If omitted, reads stdin or prompts interactively.")
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--compact", action="store_true", help="Print one-line JSON.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    text = read_text(args.text)
    if not text:
        raise SystemExit("Please provide a non-empty sentence with --text or stdin.")

    device = pick_device(args.device)
    bundle = load_model(args.model_dir, device)
    result = predict_sentence(text, bundle, device)
    print(json.dumps(result, ensure_ascii=False, indent=None if args.compact else 2))


if __name__ == "__main__":
    main()
