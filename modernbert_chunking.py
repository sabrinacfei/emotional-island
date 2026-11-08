"""Overlapping token windows with coverage-normalized probability aggregation."""
import math

LABELS = ("anger", "anticipation", "disgust", "fear", "joy", "sadness", "surprise", "trust")
MAX_INPUT_TOKENS = 128
OVERLAP_TOKENS = 32


def tokenize_chunks(text: str, tokenizer, overlap_tokens: int = OVERLAP_TOKENS) -> list[dict]:
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Diary must not be empty")
    capacity = MAX_INPUT_TOKENS - tokenizer.num_special_tokens_to_add(pair=False)
    if type(overlap_tokens) is not int or not 0 <= overlap_tokens < capacity:
        raise ValueError("Overlap must be smaller than the content-token capacity")
    encoded = tokenizer(text, add_special_tokens=True, truncation=True, max_length=MAX_INPUT_TOKENS,
                        stride=overlap_tokens, return_overflowing_tokens=True,
                        return_special_tokens_mask=True, padding=False)
    original = tokenizer(text, add_special_tokens=False, truncation=False)["input_ids"]
    if not (len(encoded["input_ids"]) == len(encoded["attention_mask"]) == len(encoded["special_tokens_mask"])):
        raise ValueError("Tokenizer chunk counts do not match")
    chunks, covered_end = [], 0
    for ids, mask, special in zip(encoded["input_ids"], encoded["attention_mask"], encoded["special_tokens_mask"]):
        content = [token for token, a, s in zip(ids, mask, special) if a and not s]
        count = len(content)
        if not 0 < count <= MAX_INPUT_TOKENS or len(ids) > MAX_INPUT_TOKENS or len(ids) != len(mask) or len(ids) != len(special):
            raise ValueError("Invalid tokenizer chunk")
        start = covered_end - overlap_tokens if chunks else 0
        end = start + count
        if start < 0 or end <= covered_end or end > len(original) or content != original[start:end]:
            raise ValueError("Tokenizer windows do not match the original token sequence")
        chunks.append({"index": len(chunks), "start_token": start, "end_token": end,
                       "effective_tokens": count, "configured_overlap_tokens": overlap_tokens,
                       "input_ids": ids, "attention_mask": mask})
        covered_end = end
    if not chunks or covered_end != len(original):
        raise ValueError("Chunk coverage does not match original tokens")
    _, weights, _ = _coverage_weights(chunks)
    for chunk, weight in zip(chunks, weights):
        chunk["aggregation_weight"] = weight
    return chunks


def _coverage_weights(chunks: list[dict]) -> tuple[int, list[float], int]:
    """Share each original token's unit length across the windows covering it.

    This corrects repeated length weights, not the model's semantic errors. Each
    window is still classified as a whole, with its overlapping context present.
    """
    if not chunks:
        raise ValueError("No classifier windows")
    previous_start, previous_end, observed_overlap = -1, 0, 0
    for i, chunk in enumerate(chunks):
        start, end = chunk["start_token"], chunk["end_token"]
        if (type(start) is not int or type(end) is not int or chunk["index"] != i
                or not 0 <= start < end or start <= previous_start or end <= previous_end
                or start > previous_end or chunk["effective_tokens"] != end - start
                or end - start > MAX_INPUT_TOKENS):
            raise ValueError("Invalid or incomplete classifier window ranges")
        observed_overlap = max(observed_overlap, previous_end - start)
        previous_start, previous_end = start, end
    # Difference counts and a reciprocal-coverage prefix sum keep this O(tokens + windows).
    changes = [0] * (previous_end + 1)
    for chunk in chunks:
        changes[chunk["start_token"]] += 1
        changes[chunk["end_token"]] -= 1
    prefix, coverage = [0.0], 0
    for change in changes[:-1]:
        coverage += change
        if coverage <= 0:
            raise ValueError("Missing original tokens in classifier windows")
        prefix.append(prefix[-1] + 1.0 / coverage)
    weights = [prefix[c["end_token"]] - prefix[c["start_token"]] for c in chunks]
    if not math.isclose(math.fsum(weights), previous_end, rel_tol=1e-9, abs_tol=1e-7):
        raise ValueError("Window weights do not preserve original token length")
    return previous_end, weights, observed_overlap


def aggregate(chunks: list[dict], probabilities: list[list[float]], labels: list[str]) -> dict:
    if tuple(labels) != LABELS or len(chunks) != len(probabilities) or not chunks:
        raise ValueError("Unexpected classifier labels or chunk count")
    total, weights, observed_overlap = _coverage_weights(chunks)
    configured_overlap = chunks[0].get("configured_overlap_tokens", observed_overlap)
    if (type(configured_overlap) is not int or not observed_overlap <= configured_overlap < MAX_INPUT_TOKENS
            or any(c.get("configured_overlap_tokens", configured_overlap) != configured_overlap for c in chunks)):
        raise ValueError("Inconsistent classifier overlap configuration")
    for row in probabilities:
        if len(row) != 8 or any(not math.isfinite(p) or p < 0 or p > 1 for p in row) or abs(sum(row) - 1) > 1e-4:
            raise ValueError("Invalid model probabilities")
    values = [math.fsum(weight * row[i] for weight, row in zip(weights, probabilities)) / total for i in range(8)]
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
                "aggregation_weight": weight,
                "overlap_tokens": (chunks[i-1]["end_token"] - c["start_token"]) if i else 0,
                "new_tokens": c["end_token"] - (chunks[i-1]["end_token"] if i else 0),
                "probabilities": {label.title(): p for label, p in zip(labels, row)}}
               for i, (c, row, weight) in enumerate(zip(chunks, probabilities, weights))]
    return {"probabilities": distribution, "scores": scores,
            "top_3": [{"emotion": labels[i].title(), "probability": values[i], "score": floors[i]} for i in order[:3]],
            "top_emotion": labels[order[0]].title(), "top_probability": values[order[0]],
            "labels": labels, "token_count": total, "chunk_count": len(chunks), "chunks": details,
            "aggregation": {"method": "overlap_coverage_weighted_mean" if configured_overlap else "effective_token_weighted_mean",
                            "overlap_tokens": configured_overlap, "observed_overlap_tokens": observed_overlap,
                            "weighting": "inverse_token_coverage", "weight_sum": math.fsum(weights),
                            "unique_content_tokens": total,
                            "processed_content_tokens": sum(c["effective_tokens"] for c in chunks),
                            "max_input_tokens": MAX_INPUT_TOKENS, "special_and_padding_tokens_in_weight": False},
            "truncated": False}
