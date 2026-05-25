#!/usr/bin/env python3
"""Import historical diary fragments through the authenticated API pipeline."""

from __future__ import annotations

import argparse
import getpass
import json
from pathlib import Path
import urllib.error
import urllib.request


DEFAULT_API_URL = "https://emotional-island-api.onrender.com"
DEFAULT_FIXTURE = Path(__file__).with_name("demo_two_weeks_2026_05.json")


def request_json(api_url: str, path: str, payload: dict, token: str | None = None) -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        f"{api_url.rstrip('/')}{path}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=240) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        details = exc.read().decode("utf-8")
        raise RuntimeError(f"{path} failed ({exc.code}): {details}") from exc


def main() -> None:
    parser = argparse.ArgumentParser(description="Import two historical diary weeks into one account.")
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--email", default="test@test.com")
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument(
        "--reanalyze-only",
        action="store_true",
        help="Keep existing diary text and overwrite only daily analyses and trends.",
    )
    args = parser.parse_args()

    password = getpass.getpass(f"Password for {args.email}: ")
    auth = request_json(args.api_url, "/login", {"email": args.email, "password": password})
    token = auth["token"]
    days = json.loads(args.fixture.read_text(encoding="utf-8"))["days"]

    if args.reanalyze_only:
        completed = 0
        for day in days:
            result = request_json(
                args.api_url,
                "/diary/reanalyze-finalized-days",
                {"date_labels": [day["date_label"]]},
                token,
            )
            analysis = result["results"][0]
            neural = analysis.get("neural_prior") or {}
            neural_status = "NN OK" if neural.get("available") else "NN unavailable"
            emotions = ", ".join(analysis.get("dominant_emotions") or [])
            print(f"{analysis['date_label']}: {neural_status} | {emotions}")
            completed += 1
        print(f"Reanalyzed {completed} days for {args.email}.")
        return

    for day in days:
        result = request_json(
            args.api_url,
            "/diary/import-historical-day",
            {**day, "replace_existing": True},
            token,
        )
        analysis = result.get("analysis") or {}
        emotions = ", ".join(analysis.get("dominant_emotions") or [])
        summary = analysis.get("one_line_summary") or analysis.get("summary") or ""
        print(f"{day['date_label']}: {emotions} | {summary}")

    print(f"Imported and analyzed {len(days)} days for {args.email}.")


if __name__ == "__main__":
    main()
