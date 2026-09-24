"""Chaos scenarios. Every module in this folder whose name does not start with `_` is imported, and
each one registers its scenarios with `registry.scenario(Scenario(...))`.

Copy `_template.py` to a new file to add one (docs/chaos-testing.md).
"""
from __future__ import annotations

import importlib
import pkgutil

for _m in pkgutil.iter_modules(__path__):
    if not _m.name.startswith("_"):
        importlib.import_module(f"{__name__}.{_m.name}")
