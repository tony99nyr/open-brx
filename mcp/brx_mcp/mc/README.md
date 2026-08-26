# Mission Control server (M-MC)

The match host: roster, armory, mode config, per-player `FrameBundle` compilation, the M-NET WebSocket
server the phone/Companion nodes join, start sequencing, victim-side scoring and the recap. Serves the
built web UI (`webapp/mc/dist`) on the same port.

```
cd mcp && python -m brx_mcp.mc            # prints http://<lan-ip>:8765/#tok=…  and  ws://<lan-ip>:8766/ws
python -m brx_mcp.mc --demo               # FakeArmory (no BLE) — UI walkthrough
python -m brx_mcp.mc --fake-net           # 8 simulated nodes in-process
python -m brx_mcp.mc --no-auth            # bench only: no operator token
python -m brx_mcp.mc.mock_node ws://<ip>:8766/ws --gun GUN-A --tail 3D4F   # phoneless node + REPL
```

- **`API.md`** — the server ⇄ web-UI contract (REST + `/ui-ws` snapshot), incl. the operator-token rule.
- **`docs/spec/contracts.md`** §5 — the node ⇄ MC wire (`envelope.py`, `net.py`); amendments A1–A8.
- **`docs/spec/mission-control.md`** — the module spec; `docs/spec/modes.md` — what `compile.py` emits.
- **`docs/field-runbook-mc.md`** — match-day procedure.

Modules: `state.py` (Session/phases/readiness), `scoring.py`, `compile.py` + `weapons.json`
(`golden_bundle.json` is the frozen reference bundle), `net.py` (NetServer, A8 takeover rules), `armory.py`
(bleak scan-only; `fakes.py` for demo), `store.py` (session persistence + CSV), `api.py` + `__main__.py`.
Tests: `mcp/tests/test_mc_*.py` (`python3 run_tests.py`).
