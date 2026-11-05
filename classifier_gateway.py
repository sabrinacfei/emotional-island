"""Explicit local or user-owned ModernBERT worker. Never fall back to the old model."""
import os
from urllib.parse import urlparse


def predict(text: str) -> dict:
    mode = os.getenv("MOBILE_CLASSIFIER_BACKEND", "local").strip().lower()
    if mode == "local":
        from modernbert_backend import predict as local_predict
        return local_predict(text)
    if mode != "remote":
        raise ValueError("MOBILE_CLASSIFIER_BACKEND must be local or remote")
    import requests
    url = os.environ["MODERNBERT_WORKER_URL"].strip()
    parsed = urlparse(url)
    allowed = os.getenv("MODERNBERT_WORKER_ALLOWED_HOST", "sabrinaxie-emotional-island-neural-api.hf.space").strip().lower()
    if parsed.scheme != "https" or parsed.hostname != allowed or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("ModernBERT worker must use the explicitly configured HTTPS host")
    headers = {}
    token = os.getenv("MODERNBERT_WORKER_TOKEN", "").strip()
    if token:
        headers["Authorization"] = "Bearer " + token
    with requests.Session() as session:
        session.trust_env = False
        response = session.post(url, json={"text": text}, headers=headers, timeout=(10, 100), allow_redirects=False)
    if response.status_code != 200 or len(response.content) > 2_000_000:
        raise RuntimeError("ModernBERT worker unavailable")
    result = response.json()
    if not isinstance(result, dict) or result.get("backend") != "modernbert" or result.get("available") is not True:
        raise RuntimeError("Worker did not return the trained ModernBERT result")
    return result
