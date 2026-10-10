"""The phone's source text, for tests that assert a pattern is ABSENT from it.

The engine no longer lives in `app/src/engine.js` alone (reconcile.js, powerup-player.js, ammo.js, lanes.js and
more), so a negative scrape of engine.js passes while the same pattern sits in a sibling file.

    from _phone_src import phone_sources
    for path, text in phone_sources().items(): ...
"""
import pathlib

APP_SRC = pathlib.Path(__file__).resolve().parents[2] / "app" / "src"


def phone_sources(root=None):
    """Map of `app/src/**/*.js` path (relative, posix) to its text. Generated `*.gen.js` files are left out."""
    root = pathlib.Path(root) if root is not None else APP_SRC
    return {p.relative_to(root).as_posix(): p.read_text(encoding="utf-8")
            for p in sorted(root.rglob("*.js")) if not p.name.endswith(".gen.js")}
