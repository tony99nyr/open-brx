---
name: ui-storyboard
description: Build an Open BRX storyboard gallery so Tony can make a UI design call from frozen renders of the REAL phone HUD or Mission Control, without playing every scenario in a game. Sequences over time, every relevant state, both widths and both skins, options side by side, clash storyboards for layered UI, and the open questions at the top; the page goes to C:\Users\Tony\brx-<topic>\ and you stop for Tony's pick. Use whenever the user says "storyboard", "gallery", "show me the options", "how do these interact", "do these clash", "what does X look like when Y happens", or before any HUD or MC design choice that Tony must make (alert style, medal art, layout, timing, what overlays what). Not a quality audit of finished screens (that is ui-vqa).
---

# UI storyboard

Tony (2026-09-25): "These storyboards are super helpful. Easy to visualize and make calls without having
to sim every scenario in game." A storyboard is a static HTML page of screenshots. It answers a design
question with the real UI, so the call Tony makes is a call about the product, not about a mockup.

The reference generator is `app/tools/alert-gallery.mjs` (the HUD alert lanes). Copy its shape.

## 1. Render the real UI, never a mockup

- Phone HUD: build the app (`cd app && npm run build`), serve `app/www` on a free port, and open
  `/?demo&stage=<stage>` in Playwright Chromium. The stages are the ones `npm run ui:stage` jumps to
  (defined in `app/src/demo.js`; `app/tools/stage.mjs` serves them). Drive events with the page's demo hooks (`window.brxDemo.*`).
- Mission Control: the demo MC (`cd mcp && ../.venv/bin/python -m brx_mcp.mc --demo --fake-net --no-auth
  --ephemeral`) on a free port, or the console's `?mock` for states the demo cannot reach.
- A proposal that is not built yet goes behind a stage or a flag, so the gallery still renders real code.
  Say "stage only, the shipped UI is unchanged" at the top when that is the case.
- Fail the run on any `pageerror`. A gallery built on a broken page is a false answer.

## 2. What goes on the page

In this order:

1. **Title and one paragraph:** what the page shows, the build time and the base commit.
2. **The open questions,** numbered, each with the choice Tony must make ("A, B or C?").
3. **Changed since your notes** (after the first round): Tony's notes verbatim, each with where the
   page answers it. Keep the notes in the generator (a `CHANGED` table), not only on the page.
4. **Storyboards over time:** a real sequence, for example a six-kill spree 1 s apart, with a frame at
   each moment that matters. Time the frames from a real event on the page (a MutationObserver stamp),
   not from page load. Under each strip, print what the voice SAID beside what the screen SHOWED.
5. **Single moments:** each relevant state as one row of cells.
6. **Options side by side:** A, B and C in the same state, at the same size, with the same labels.
7. **Before and after** when the change replaces something that ships.

Every storyboard and every moment renders at both screen-gate widths (891×411 and 667×375, the
`VIEWS` in `app/tools/screens.mjs`) and in both skins (day and night). MC has one theme: use its
supported widths instead.

## 3. Clash and interaction storyboards

Layered UI is where the design questions hide. For every pair of layers that can be up at once, render
them at the same moment: a kill hero over STUNNED or TAKING FIRE, a lead badge and a hill capture on
the kill tick, three or four medals on the small width over the ammo number, a feed row and a takeover.
Label each frame with what is on screen and what the user needs to read first. If a clash has no stage
yet, add one; the stage stays as a screens gate later.

## 4. Publish to Tony and stop

- Write the page and its PNGs to `/mnt/c/Users/Tony/brx-<topic>/` (Windows: `C:\Users\Tony\brx-<topic>\index.html`).
  Screenshots never go in the repo.
- Keep the generator in `app/tools/<topic>-gallery.mjs`, with the output folder as `argv[2]` and the
  Windows folder as the default. It asserts nothing; `app/tools/screens.mjs` is the gate.
- Send Tony the Windows path and the open questions. Then STOP. Do not build the option you prefer.

## 5. After the pick

- The gallery becomes the approved source of truth for that design. Link it from the FOLLOWUPS row or
  the design doc.
- When the design changes, regenerate the gallery from `main`, not from a branch, so it shows what ships.
- After each round of notes, add the notes to `CHANGED` and regenerate. Answer each note on the page.
- When the design is built, turn each approved moment into a screens gate that fails first.

## Rules

- **Original art only.** The repository is public. Never copy third-party assets (another game's medal
  art, icons, fonts, sounds or layouts). Say "original designs" on the page when the subject invites a
  comparison.
- No headset sticker ids, real player names or device addresses in shots or captions. Use the demo names.
- Free ports only (listen on 0). Never bind a literal port or use Tony's running MC.
- British English, short plain sentences, no em dashes, on the page and in captions.
