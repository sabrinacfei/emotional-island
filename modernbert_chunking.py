"""Non-overlapping tokenizer chunks and effective-token weighted probabilities."""
import math

LABELS = ("anger", "anticipation", "disgust", "fear", "joy", "sadness", "surprise", "trust")
MAX_INPUT_TOKENS = 128


def tokenize_chunks(text: str, tokenizer) -> list[dict]:
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Diary must not be empty")
    encoded = tokenizer(text, add_special_tokens=True, truncation=True, max_length=MAX_INPUT_TOKENS,
                        stride=0, return_overflowing_tokens=True, return_special_tokens_mask=True, padding=False)
    chunks, offset = [], 0
    for ids, mask, special in zip(encoded["input_ids"], encoded["attention_mask"], encoded["special_tokens_mask"]):
        count = sum(a for a, s in zip(mask, special) if not s)
        if not 0 < count <= MAX_INPUT_TOKENS or len(ids) > MAX_INPUT_TOKENS or len(ids) != len(mask) or len(ids) != len(special):
            raise ValueError("Invalid tokenizer chunk")
        chunks.append({"index": len(chunks), "start_token": offset, "end_token": offset + count,
                       "effective_tokens": count, "input_ids": ids, "attention_mask": mask})
        offset += count
    expected = len(tokenizer(text, add_special_tokens=False, truncation=False)["input_ids"])
    if not chunks or offset != expected:
        raise ValueError("Chunk coverage does not match original tokens")
    return chunks


def aggregate(chunks: list[dict], probabilities: list[list[float]], labels: list[str]) -> dict:
    if tuple(labels) != LABELS or len(chunks) != len(probabilities) or not chunks:
        raise ValueError("Unexpected classifier labels or chunk count")
    total = sum(c["effective_tokens"] for c in chunks)
    if total <= 0:
        raise ValueError("Empty token weights")
    for row in probabilities:
        if len(row) != 8 or any(not math.isfinite(p) or p < 0 or p > 1 for p in row) or abs(sum(row) - 1) > 1e-4:
            raise ValueError("Invalid model probabilities")
    values = [sum(c["effective_tokens"] * row[i] for c, row in zip(chunks, probabilities)) / total for i in range(8)]
    # Numerical drift only. No emotion is overwritten by the language model.
    values = [p / sum(values) for p in values]
    distribution = {label.title(): p for label, p in zip(labels, values)}
    floors = [math.floor(p * 100) for p in values]
    remainder = 100 - sum(floors)
    for i in sorted(range(8), key=lambda i: values[i] * 100 - floors[i], reverse=True)[:remainder]:
        floors[i] += 1
    scores = {label.title(): n for label, n in zip(labels, floors)}
    order = sorted(range(8), key=lambda i: values[i], reverse=True)
    details = [{"index": c["index"], "start_token": c["start_token"], "end_token": c["end_token"],
                "effective_tokens": c["effective_tokens"], "input_tokens": len(c["input_ids"]),
                "probabilities": {label.title(): p for label, p in zip(labels, row)}} for c, row in zip(chunks, probabilities)]
    return {"probabilities": distribution, "scores": scores,
            "top_3": [{"emotion": labels[i].title(), "probability": values[i], "score": floors[i]} for i in order[:3]],
            "top_emotion": labels[order[0]].title(), "top_probability": values[order[0]],
            "labels": labels, "token_count": total, "chunk_count": len(chunks), "chunks": details,
            "aggregation": {"method": "effective_token_weighted_mean", "overlap_tokens": 0,
                            "max_input_tokens": MAX_INPUT_TOKENS, "special_and_padding_tokens_in_weight": False},
            "truncated": False}
