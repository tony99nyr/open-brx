# Gun audio queue scenarios

The simulator is `app/tools/gun-audio-sim.mjs`. Run `node app/tools/audio-scenarios.mjs` to print every table below. The model has no shield hum state.

## Gun model

| Rule | Evidence | Model |
|---|---|---|
| Token-4 FIFO | MEASURED 2026-09-24, Tactix-FE30 | Clips play first in, first out. |
| One `$PLAYX` | MEASURED 2026-09-24 | Stops only the current clip. |
| Two or more `$PLAYX` in one write | MEASURED 2026-09-25 | Can clear the whole queue. |
| Zero-gap burst loss | MEASURED 2026-09-25 | A four-clip burst dropped one clip. |
| Dropped clip position | ASSUMPTION | The model drops clip two, VA6E in the measured burst. |
| Phone PLAY gap | UNPROVEN | `PLAY_GAP_MS = 150`. A 100 ms send_batch gap dropped no clip in the earlier bench run. |
| Native death scream | ASSUMPTION | The scream joins the same FIFO when the phone hears lethal HP. |
| Token-1 interrupt | MEASURED 2026-09-11 | A token-1 clip interrupts the current clip. |
| Frame spacing inside one write | ESTIMATE | The model uses 10 ms, except the literal zero-gap test. |

Clip lengths come from `mcp/brx_mcp/data/sound_catalog.json`. The tests check those values.

## Scenarios

Latency measures from the event to the clip start. A dropped clip was not played. A flushed clip was in the queue when a multi-stop write cleared it.

### fifo-3s: FIFO clips 3.5 s apart

| Cue | Want | Event (s) | Latency (ms) | Fate |
|---|---|---|---|---|
| VA6D | want | 0.00 | 0 | full |
| VA6E | want | 3.50 | 0 | full |
| VAA | want | 7.00 | 0 | full |

### zero-gap-burst: Zero-gap four-clip burst

| Cue | Want | Event (s) | Latency (ms) | Fate |
|---|---|---|---|---|
| VA6D | want | 0.00 | 0 | full |
| VA6E | want | 0.00 | n/a | dropped (burst drop position is an assumption) |
| VB0P | want | 0.00 | 1943 | full |
| VAA | want | 0.00 | 4919 | full |

### multi-stop-clear: Three stops in one write clear the queue

| Cue | Want | Event (s) | Latency (ms) | Fate |
|---|---|---|---|---|
| VA6D | want | 0.00 | 0 | cut after 1500 ms of 1943 |
| VA6E | want | 0.10 | n/a | cleared from queue by a multi-stop write |
| VB0P | want | 0.20 | n/a | cleared from queue by a multi-stop write |
| VAA | want | 0.30 | n/a | cleared from queue by a multi-stop write |

### single-stop-current: One stop cuts only the current clip

| Cue | Want | Event (s) | Latency (ms) | Fate |
|---|---|---|---|---|
| VA6D | want | 0.00 | 0 | cut after 500 ms of 1943 |
| VA6E | want | 0.10 | 400 | full |

### death-stops-spaced: Two death stops, one write each, 150 ms apart

| Cue | Want | Event (s) | Latency (ms) | Fate |
|---|---|---|---|---|
| VA6D | want | 0.00 | 0 | cut after 100 ms of 1943 |
| VA6E | want | 0.05 | 50 | cut after 150 ms of 2675 |
| scream | native | 0.07 | 175 | full |

## Findings and changes

- FIFO order held for clips sent 3.5 s apart.
- The measured zero-gap burst played VA6D, VB0P and VAA. The model marks VA6E as the assumed dropped clip.
- Three stops in one write cleared every clip, including queued VAA.
- A single stop cut the current clip. The next queued clip then played.
- Two death stops in separate writes, 150 ms apart, let the scream play. A two-stop write cleared the scream in the model.
- The F375 engine test crosses low health, delays the `$PLAY` for the reserved gap, then applies death. The engine cancels the pending `VA86` write.
- F347 ships t23 EMPTY. The historical A10 hum blocked the FIFO, and `$PLAYX` did not stop it.

## Sitting A results, 2026-09-25

1. `$PLAYX` did not stop the hum. Shield 0 stopped it and released the queued line.
2. Empty t23 had no hum. VAA played at once at 3 s, 25 s and after a refill.
3. FIFO held for lines 3.5 s apart. A zero-gap four-clip burst dropped VA6E in both runs.
4. Three `$PLAYX` frames in one write cleared every clip, including VAA.
5. An idle stop did nothing. VAA played in full 200 ms later.
6. With empty t23, `$SFLASH` then a stop-plus-line write played VAA. The F348 spawn burst played VAI at once.
