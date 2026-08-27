"""UI/phone view shapes built from contracts rows (API.md `WeaponView`) — one builder for HTTP + the wire."""
from __future__ import annotations


def weapon_view(w: dict) -> dict:
    """contracts §3 `Weapon` → API.md `WeaponView` (dmg/rpm/rng are 0–100 bars). A10 adds `tags` + `role`."""
    st = w.get("stats", {}) or {}
    mag = st.get("mag") or 0
    return {"weapon_id": w["weapon_id"], "name": w["name"], "cls": w.get("cls", ""), "desc": w.get("desc", ""),
            "clip": mag, "mags": ((st.get("reserve") or 0) // max(mag or 1, 1)),
            "reserve": st.get("reserve"), "reload_s": round((st.get("reload_ms") or 0) / 1000, 1),
            "dmg": st.get("dmg", st.get("damage", 50)), "rpm": st.get("rof", st.get("rpm", 50)),
            "rng": st.get("rng", st.get("range_pct", 50)),
            "verified": bool(w.get("verified")),
            "tags": list(w.get("tags") or []), "role": w.get("role", ""),
            "htk": st.get("htk"), "ttk_ms": st.get("ttk_ms"),                    # A10 (htk: hits to drop a 115 pool)
            **({"caution": w["caution"]} if w.get("caution") else {})}           # A10: known live problem
