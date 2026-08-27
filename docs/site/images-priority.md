# Images — the short list, and how to actually get them out of Gemini

`images.md` is the full 84-slot backlog. **Don't work from it.** The design (round 1, `Open BRX Site.dc.html`)
carries readability with type, badges, blocks, and built-in SVG diagrams, and uses only nine slots. This
sheet is the working list: **12 images in two tiers**, with prompts rewritten for how Gemini's image
model actually behaves, and a workflow that starts from a real photo of *your* guns — which is the
part that will make the site look real.

## Why the first-round prompts will under-deliver, and what changes

The 38 prompts in `images.md` are written like design specs: hex codes, long negative lists, "technical-
editorial style". Gemini's image model (Nano Banana / Imagen) mostly ignores hex values, treats long
negative lists as noise, and produces its best work from **a short scene description in plain sentences
+ one reference image**. So:

- **Describe the scene like a photographer, not a stylesheet.** "Very dark navy-black studio background"
  beats `#0c1016`. "One cool electric-blue rim light" beats "accent #39b4ff".
- **One negative clause, at the end**: "No text, logos, or watermarks." That's all it needs.
- **Give it a reference image whenever the subject is the BRX.** Text-only prompts will invent a generic
  sci-fi rifle. An attached photo pins the shape. This is the single biggest lever.
- **Ask for the aspect ratio in words** ("wide 16:9 landscape", "square") — or set it in the UI.
- **Generate 4, pick 1, then iterate on that image** with edit prompts ("keep everything, make the
  background darker", "remove the stray highlight on the stock") rather than re-rolling from scratch.

## The source-image workflow (recommended for every hardware image)

**Use your own phone photos as the source, not Google-search images.** Two reasons: a photo you found
belongs to whoever shot it, and an AI edit of it is still derived from their photo — not something to
publish on a site that's careful about credit. And your guns are *right there*. Google-search images are
fine as a **private reference for you** (to see angles that work), but the images that ship should
descend from your camera.

Shooting brief (10 minutes, phone camera, any room):
- Dark, plain surface (a black T-shirt or a dark tabletop is fine). One lamp, off to one side. No flash.
- Shoot each subject from the angle the slot needs (below). Fill the frame; tap to focus on the body.
- Also shoot one **clean, evenly-lit, slightly boring** three-quarter view of the tagger and one of the
  headset — those are the masters for background removal and relighting.
- Sticker labels: tape over or angle away.

Then in Gemini, attach the photo and use an **edit prompt** (this is where Gemini is strong):

> **Master relight (tagger):** "Using the attached photo, keep the laser-tag rifle exactly as it is —
> same shape, proportions, buttons, ports, and surface details. Replace the background with a very dark
> navy-black studio backdrop with a soft graphite gradient. Relight it as a premium product photo: soft
> key light from the upper left, a thin cool electric-blue rim light along the top edge, gentle shadow
> under the body. Keep the image sharp and realistic. No text, logos, or watermarks."

> **Master relight (headset):** same wording with "laser-tag headset"; add "the small sensor domes on the
> band should catch a faint cool-blue glow".

> **Isolate on transparent/plain:** "Keep the product identical. Remove the background entirely and
> replace it with flat, uniform near-black. No added reflections or shadows." (For hotspot overlays and
> card thumbnails — the site adds its own treatment.)

> **Make a hero from a real shot:** "Using the attached photo as the exact subject, place the rifle on a
> dark outdoor table at dusk with a laptop glowing faintly blue beside it, shallow depth of field, cool
> desaturated colours, a hint of mist. Keep the rifle identical to the photo. Wide 16:9 landscape. No
> text, logos, or watermarks."

If an edit drifts the product's shape, say so directly in the next turn: "The reload handle changed —
restore it exactly as in the original photo." Gemini's edit mode is good at targeted corrections.

## Tier 1 — the seven images the site needs to launch

| # | Slot | What | How |
|---|---|---|---|
| 1 | **HOME-01** | Home hero, 21:9 | Generate (prompt A) — or, better, a real dusk shot of your guns + laptop, hero-ised with the edit prompt above |
| 2 | **HW-02** | Anatomy render for hotspots, 16:9, tagger three-quarter right side | **Your photo** → *Isolate on plain* → *Master relight*. Must be accurate; never generated from text. |
| 3 | **HW-03** | Headset, front three-quarter, 4:3 | Your photo → Master relight (headset) |
| 4 | **HOME-03** | Manual-hub flat lay, overhead, 4:3 | Your photo (overhead, tagger + headset side by side) → Master relight |
| 5 | **HOME-05** | Manual door thumb, 1:1 — headset sensor-dome macro | Your macro photo → edit prompt B; fallback generate (prompt B′) |
| 6 | **HOME-04** | Platform door thumb, 16:9 — laptop + guns at dusk | Your photo → "Make a hero from a real shot"; fallback generate (prompt C) |
| 7 | **FIX-07 a/b/c** | Headset re-pair procedure, 3 phone photos, 4:3 | Your photos only: (a) thumb holding the headset button; (b) thumb on RIGHT of the D-pad while the power switch is flipped; (c) finger on the trigger. Light cleanup only — no relighting that hides the hands. |

## Tier 2 — the five that add polish (do after launch)

| # | Slot | What | How |
|---|---|---|---|
| 8 | Section hub thumbs ×6 (new: `HUB-01…06`) | one 16:9 thumb per manual section, a matching set | Generate as a set (prompt D, one line swapped per section) — or crop six details from your relit masters (LED bank, port cluster, sight, headset domes, USB cable in port, opened battery bay). Crops will look more coherent than six generations. |
| 9 | **GAME-02** | six weapon-class silhouettes, 1:1 | Generate as a set (prompt E). Icons are where Gemini is reliable. |
| 10 | **HW-04** | LED-bank close-up, 16:9 | Your macro of the three-LED bank, lit → Master relight |
| 11 | **SND-02** | USB port + cable, 4:3 | Your photo → Master relight |
| 12 | **HOME-07** | logo mark | Generate (prompt F), then trace to SVG |

Everything else in `images.md` is deferred. The SVG diagrams (HOME-02, DEV-*, PLAT-*) are built in the
site, not generated, and don't need Gemini at all.

## Prompts (text-to-image, no reference photo)

**A · HOME-01, home hero (21:9)**
> A cinematic night scene on an open grass field. Three players stand far apart in silhouette, each
> holding a black rifle-shaped laser-tag gun with a phone mounted on top; the phone screens glow a dim
> red-amber, barely lighting their hands. In the far distance a laptop glows faint blue on a folding
> table. Low mist, long shadows, very dark navy-black sky, cool desaturated colour. Realistic, moody,
> shot on a full-frame camera at night. No faces visible. Very wide 21:9 panoramic. No text, logos, or
> watermarks.

**B′ · HOME-05, sensor-dome macro (1:1, fallback if your macro doesn't work)**
> Extreme close-up macro photograph of a single small translucent dome sensor set into a matte black
> plastic headband. The dome glows softly from inside with a cool electric-blue light. Fine surface
> texture on the plastic, shallow depth of field, very dark graphite background. Square. No text, logos,
> or watermarks.

**C · HOME-04, platform door (16:9, fallback)**
> A laptop on a folding camp table outdoors at dusk, screen glowing electric blue with an abstract,
> unreadable grid of rows. Two black rifle-shaped laser-tag guns rest beside it. Shallow depth of field,
> cool desaturated colour, very dark navy-black surroundings, a little mist. Realistic photograph. Wide
> 16:9. No text, logos, or watermarks.

**D · Section hub thumbs (16:9, run six times swapping the bracketed line)**
> A dark, minimal close-up photograph on a very dark navy-black background with one cool electric-blue
> rim light. Subject: [a row of three small LEDs glowing on matte black plastic / a micro-USB port and
> a charging port on matte black plastic with a cable just inserted / a rifle's iron sight and a small
> clear lens at the muzzle / a black headband with translucent dome sensors / a sound-wave ripple frozen
> in dark air above a small speaker grille / a small screwdriver beside an opened battery bay]. Shallow
> depth of field, realistic, quiet, lots of dark negative space. Wide 16:9. No text, logos, or watermarks.

**E · GAME-02 weapon-class icons (1:1, run six times swapping the bracket)**
> A single flat icon of a [assault rifle / compact submachine gun / long scoped marksman rifle / heavy
> support rifle with a glowing coil / shoulder-fired launcher / rifle stock swung with a motion arc],
> side profile facing right, centred, drawn as a clean solid silhouette in electric blue with a thin
> lighter rim highlight, on a very dark navy-black square background. Same scale, same angle, same
> lighting as the rest of the set. Minimal, geometric. No text, logos, or watermarks.

**F · HOME-07 logo mark (1:1)**
> A minimal flat logo mark: a thin circular gun-sight reticle whose left side opens into a square
> bracket shape, drawn as a single electric-blue stroke, centred on a plain very dark navy-black
> background with lots of empty space. Geometric, no gradients. No letters, text, or watermarks.

## What to send back

Name files by slot (`HW-02.png`, `FIX-07a.jpg`, `HUB-03.png`) and drop them in `docs/manual/img/` — the
repo stays self-contained and the site build picks them up by ID. Keep the untouched originals of your
photos too (`docs/manual/img/raw/`), so a better edit can be made later without a reshoot.
