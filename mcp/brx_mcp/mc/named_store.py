"""Shared errors and validation for named Mission Control stores."""
from __future__ import annotations

from .types import NAME_MAX


class StoreError(ValueError):
    def __init__(self, status: int, msg: str):
        super().__init__(msg)
        self.status = status


def check_name(name: object, item: str) -> str:
    if not isinstance(name, str) or not name.strip():
        raise StoreError(400, f"NAME REQUIRED: TYPE A NAME FOR THIS {item.upper()}")
    name = " ".join(name.split())
    if len(name) > NAME_MAX:
        raise StoreError(400, f"NAME TOO LONG: KEEP IT TO {NAME_MAX} CHARACTERS OR FEWER")
    return name
