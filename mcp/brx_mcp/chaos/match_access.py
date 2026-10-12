"""Guarded reads of the current Session match for chaos evidence."""
from __future__ import annotations


def match_head(session):
    match = session.match
    return match.head if match is not None else None


def match_scorer(session):
    match = session.match
    return match.scorer if match is not None else None
