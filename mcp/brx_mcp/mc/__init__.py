"""Mission Control (M-MC) server package — spec: docs/spec/mission-control.md, contracts.md (A5).

Lanes (each module is one workstream; bind to the shapes in `types.py` and the Protocols in
`interfaces.py`, never to another lane's internals):

  compile.py   M-MODES  compile(config, player) -> FrameBundle; tutorial_frames; cues; validate
  net.py       M-NET    NetServer (WebSocket, envelopes, dedup, hydrate hook, status, t_recv, ack)
  state.py     M-MC     match state machine (phases, roster, player_num), the hydrate answer
  scoring.py   M-MC     exact attribution, assists, accuracy, medals, match_id parking
  store.py     M-MC     SQLite event log (t, t_recv, match_id, parked)
  armory.py    M-ARMORY list/enroll/rename/scan()/bind_player adapter over usbconsole/ble
  api.py       M-MC     HTTP JSON API + UI WebSocket feed + static serving of webapp/mc/dist
  __main__.py  entry:   python -m brx_mcp.mc [--host 0.0.0.0 --port 8765]

Run the UI dev server from webapp/mc (`npm run dev`) against this API, or build it
(`npm run build`) and let api.py serve webapp/mc/dist.
"""
