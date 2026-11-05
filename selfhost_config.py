"""Shared environment loading for the API, inference pipeline and CLI checks."""
import os
from pathlib import Path

from dotenv import load_dotenv


def load_settings() -> None:
    explicit = os.getenv("EMOTIONAL_ISLAND_ENV_FILE")
    env_path = Path(explicit).expanduser() if explicit else Path(__file__).with_name(".env")
    if explicit and not env_path.is_file():
        raise RuntimeError("EMOTIONAL_ISLAND_ENV_FILE 指定的設定檔不存在。")
    load_dotenv(env_path, override=False)
