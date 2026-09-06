# Open BRX site — image manifest + Gemini prompts
Generated from `docs/manual/*.md` image tables. **84 slots**: **38 to generate (Gemini)** · **29 real photos (shoot list)** · **17 diagrams to build as SVG/HTML in the site**.

## How to use this file

- **File naming:** save every asset as `<ID>.<ext>` (e.g. `HW-03.png`, `GAME-02-assault.png` for set members).
  The content files reference slots by ID; the site builder maps ID → file.
- **Shared art direction** (already baked into every prompt): technical-editorial, premium dark-mode
  manual; ground near-black navy `#0c1016` with a subtle graphite gradient; cool desaturated palette with
  one electric-blue accent `#39b4ff` and occasional amber `#ffb020`; clean vector-like lines or restrained
  photoreal lighting; **no text, labels, logos, brand names, or watermarks** (labels are HTML overlays).
- **Gemini tips:** paste one prompt per generation; generate 2–4 candidates and keep the cleanest;
  for the icon **sets** (GAME-02 weapon classes, GAME-08 modes) run the template once per bracketed
  variant in a single session so lighting/scale stay consistent; if text sneaks in, add "absolutely no
  letters or numbers anywhere" and regenerate; upscale hero images to ≥2400 px wide.
- **Why the split:** an image model cannot render the actual BRX accurately, and the site must never show
  a fake "product photo". Anything that depicts the real tagger/headset/grenade/ports is a **REAL PHOTO**
  slot for the owner's shoot list; Gemini gets atmosphere, abstract diagrams, icons, and generic-tagger
  illustrations.
- **Diagrams marked SVG** are specified box-by-box in the section file; build them in the site so they
  stay crisp, themeable, and editable.

## Summary by section

| Section file | Generate | Real photo | SVG | Total |
|---|---|---|---|---|
| `00-home.md` | 5 | 1 | 1 | 7 |
| `01-hardware.md` | 5 | 6 | 0 | 11 |
| `02-operation.md` | 5 | 5 | 0 | 10 |
| `03-gameplay.md` | 7 | 4 | 3 | 14 |
| `04-sound.md` | 5 | 2 | 0 | 7 |
| `05-fix-and-mod.md` | 4 | 8 | 0 | 12 |
| `06-developer.md` | 2 | 0 | 8 | 10 |
| `07-platform.md` | 5 | 3 | 5 | 13 |
| **Total** | **38** | **29** | **17** | **84** |

## A · Gemini generation batch (copy prompts as-is)
Priority order: hero/atmosphere first (HOME-01, HOME-04, PLAT-*, section heroes), then the icon sets, then per-page diagrams.

### 00-home.md

#### HOME-01 · 21:9
- **Where:** `/` hero
- **Shows:** Night game: 3–4 silhouetted players spread across a dark field, each with a faint red/amber glow from a phone mounted on a black rifle-style tagger; the base is a distant laptop glow. Mood: tense, cinematic, no faces.
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Wide cinematic night scene on an open field: three or four silhouetted players spread far apart, each holding a modern black rifle-style laser-tag tagger with a small phone mounted on the forearm glowing dim red-amber; a faint blue laptop glow at a distant base table; mist, long shadows, near-black navy sky (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and dim amber (#ffb020) HUD glow; restrained photoreal lighting; no faces visible; NO text, NO labels, NO logos, NO brand names, NO watermarks; 21:9.

#### HOME-04 · 16:9
- **Where:** `/` platform door card
- **Shows:** Laptop on a folding table outdoors at dusk with two black rifle-style taggers beside it, screen glowing blue with a scoreboard-like grid (unreadable).
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. A laptop on a folding camp table outdoors at dusk, screen glowing electric blue (#39b4ff) with an abstract grid of unreadable rows; two modern black rifle-style laser-tag taggers resting beside it; shallow depth of field; near-black navy ambient (#0c1016), cool desaturated palette, restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9.

#### HOME-05 · 1:1
- **Where:** `/` manual door card
- **Shows:** Close macro of a black laser-tag headset sensor dome with a soft electric-blue LED glow, technical and clean.
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Extreme macro of a single translucent sensor dome on a black laser-tag headset band, lit from within by a soft electric-blue (#39b4ff) LED, fine surface texture, dark graphite background (#0c1016) with subtle gradient, cool desaturated palette; restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 1:1.

#### HOME-06 · 16:9
- **Where:** `/credits`
- **Shows:** Abstract "standing on shoulders": layered translucent circuit-trace sheets in blue and graphite.
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Abstract composition of three layered translucent sheets etched with fine circuit traces, stacked with depth, edges catching electric-blue (#39b4ff) rim light, one thin amber (#ffb020) trace; near-black navy background (#0c1016) with subtle graphite gradient; clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9.

#### HOME-07 · 1:1
- **Where:** site-wide
- **Shows:** Favicon / mark: a minimal geometric mark suggesting a sight reticle merged with an open bracket.
- **Kind:** GENERATE (then vectorise)

> Minimal flat logo mark on a plain near-black navy background (#0c1016): a circular sight reticle whose left side opens into a square bracket shape, single electric-blue (#39b4ff) stroke, geometric, centered, lots of negative space; NO text, NO letters, NO gradients, NO watermarks; 1:1.

### 01-hardware.md

#### HW-02 · 16:9
- **Where:** Tagger, part by part — anatomy diagram
- **Shows:** Clean unlabeled side-profile render of a rifle-style tagger; hotspots for trigger, reload handle, ALT, SELECT, LEFT/RIGHT, power switch, emitter, body sensor, LED bank, sight, speaker, charging port, micro-USB. Labels overlaid in HTML as hotspots.
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a modern black rifle-style laser-tag tagger in exact side profile, right side facing the viewer, rendered as a crisp technical illustration with thin electric-blue edge highlights, a small three-LED bank on the receiver, a compact optical sight on top, a short charging-handle style lever on the side, and a barrel-tip emitter lens. Plenty of empty margin around the object for callout lines.

#### HW-04 · 21:9
- **Where:** Lights — headset states strip
- **Shows:** Five identical small headset icons in a row, each with a different LED state: rainbow cycle, solid blue, dark, green blink, green hold. Labels overlaid in HTML.
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; wide 21:9 strip. Subject: five identical minimalist front-view icons of a black laser-tag headset with a ring of sensor domes, evenly spaced in a row. Left to right the ring glows: a soft rainbow gradient; solid electric blue; completely unlit; a bright green pulse with a subtle blur; steady bright green. Consistent flat lighting, generous spacing between icons.

#### HW-08 · 16:9
- **Where:** Generations — two radios
- **Shows:** Abstract diagram: two tagger silhouettes, one emitting a wide classic-Bluetooth wave pattern, one emitting sparse BLE-style pulses; a phone silhouette between them. Labels overlaid in HTML.
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: two simplified silhouettes of a black rifle-style laser-tag tagger facing inward from the left and right edges, a minimalist smartphone outline centred between them. From the left tagger, dense continuous concentric amber radio arcs; from the right tagger, sparse short electric-blue radio pulses. Thin line-art, generous negative space.

#### HW-09 · 16:9
- **Where:** IR and sensors — waveform
- **Shows:** Illustration of a coded IR pulse train: one long sync pulse followed by a series of long and short marks, drawn as a clean oscilloscope-style trace. Labels overlaid in HTML.
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a single horizontal oscilloscope-style digital trace in electric blue on a faint grid: starting with one wide pulse about four units long, then about twenty-five narrower pulses alternating between two widths (one unit and two units) with equal one-unit gaps, ending in a very short pulse. One amber highlight band over the wide first pulse. Crisp, minimal, no other elements.

#### HW-10 · 21:9
- **Where:** Lights — gun LED gauge
- **Shows:** Three-frame strip of the gun's three-LED bank: all three lit, then two, then one, same colour throughout; segment-gauge feel. Labels overlaid in HTML.
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; wide 21:9 strip. Subject: three identical close-up crops of a small three-LED indicator bank set into matte black textured plastic, in a row. Frame one: all three LEDs glowing violet. Frame two: two LEDs glowing violet, the third dark. Frame three: one LED glowing violet, the other two dark. Soft realistic bloom around lit LEDs.

### 02-operation.md

#### OPS-03 · 16:9
- **Where:** The On-Gun Menu · after button holds
- **Shows:** Diagram: the control cluster of a rifle-style tagger with seven callout leader lines to blank label plates (trigger, ALT, SELECT, LEFT, RIGHT, reload handle, power switch).
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a simplified line-art side view of a modern black rifle-style laser-tag tagger, drawn as a clean technical illustration; seven thin electric-blue leader lines run from the trigger, a small orange side button, a centre button, two directional buttons, a side reload lever and a rear power slider out to empty rounded rectangular plates at the edges, ready for overlaid labels.

#### OPS-04 · 16:9
- **Where:** Indoor vs Outdoor · after the compare table
- **Shows:** Split atmosphere image: left half a dim indoor arena with soft blue LED glow on a headset silhouette, right half an open field at dusk with a faint IR beam line reaching far.
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a vertical split composition — left, a dim indoor arena interior with a silhouetted black laser-tag headset with sensor domes glowing soft electric blue close to the camera; right, a wide open grassy field at dusk with a single faint straight beam of light travelling far into the distance toward a tiny amber point; a thin vertical seam divides the halves.

#### OPS-05 · 16:9
- **Where:** Sighting the Laser · after the distance table
- **Shows:** Diagram: a tagger on the left, a headset target on the right at distance, a straight beam between them, and a small green flash ring on the headset dome.
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a minimal technical diagram — a simplified black rifle-style laser-tag tagger in profile at the far left, a simplified black laser-tag headset with sensor domes at the far right, a perfectly straight thin electric-blue beam connecting muzzle to headset dome, a small concentric ring pulse where the beam meets the dome, and faint tick marks along the beam suggesting distance.

#### OPS-08 · 21:9
- **Where:** Running a Native Game · end of page
- **Shows:** Diagram: a match timeline as a horizontal band — lobby, start, play with hit/kill ticks, death and respawn gap, end — with only colour and shape, labels overlaid later.
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; wide 21:9 banner. Subject: an abstract horizontal timeline band — a thin electric-blue line runs left to right; a small hollow circle near the start, a solid circle marking the start, a run of tiny upward tick marks, one amber gap in the line with a dotted bridge over it, more ticks, and a solid end cap; small empty rounded label plates float above five points, ready for overlaid text.

#### OPS-09 · 16:9
- **Where:** Range & Line of Sight · hero
- **Shows:** Atmosphere: a player silhouette with a headset at long range across a field under harsh midday sun versus the same scene in shade, hinting at IR reach.
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a wide low-angle field at the edge of a treeline; a distant human silhouette wearing a black laser-tag headset with small sensor domes stands half in harsh amber sunlight and half in cool blue shade; a faint thin beam of light reaches toward the silhouette from the camera's position and fades where the sunlight is strongest.

### 03-gameplay.md

#### GAME-01 · 16:9
- **Where:** overview / hero
- **Shows:** Two silhouetted players in an indoor arena, one firing — a faint beam of light between them, headset domes catching it
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); restrained photoreal lighting. Two silhouetted figures in a dim indoor arena holding futuristic rifle-shaped laser taggers, each wearing a slim headband headset with two small dome sensors; a thin electric-blue beam of light travels from one tagger toward the other's headset, which glows faintly at the point of impact; volumetric haze, low camera angle; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9.

#### GAME-02 · 1:1
- **Where:** weapons / class icon set
- **Shows:** Six silhouette icons, one per class in the roster: Assault (rifle), CQB (compact SMG/shotgun), Marksman (long scoped rifle), Support (bulky energy rifle), Power (launcher/cannon), Melee (rifle butt in a swing arc)
- **Kind:** GENERATE (set of 6, one prompt each with the class swapped)

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; a single electric-blue accent (#39b4ff). One flat silhouette-style icon of a generic futuristic [ASSAULT RIFLE / COMPACT SUBMACHINE GUN / LONG SCOPED MARKSMAN RIFLE / BULKY ENERGY RIFLE WITH GLOWING COIL / SHOULDER-FIRED LAUNCHER CANNON / RIFLE STOCK MID-SWING WITH A MOTION ARC], side profile facing right, centered, same scale and lighting across the set, clean vector-like edges with a thin blue rim light; NO text, NO labels, NO logos, NO brand names, NO watermarks; 1:1.

#### GAME-03 · 16:9
- **Where:** weapons / hero
- **Shows:** Row of five abstract weapon silhouettes at identical scale, cadence dots under each suggesting fire rate
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; cool desaturated palette, single electric-blue accent (#39b4ff), occasional amber (#ffb020). Five generic futuristic laser-tagger silhouettes in a horizontal row at identical scale, side profile, with an abstract row of small dots beneath each one at different spacings suggesting fire cadence; clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9.

#### GAME-04 · 16:9
- **Where:** weapons / fire-mode table
- **Shows:** Abstract timing strips: a continuous pulse train (full auto), single pulses, groups of three, and a rising charge curve ending in one pulse
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016); electric-blue (#39b4ff) waveform strokes with an amber (#ffb020) highlight on one. Four stacked horizontal timing strips: an even continuous pulse train, widely spaced single pulses, pulses in tight groups of three with gaps, and a smooth rising ramp that ends in a single tall pulse; clean vector-like lines, no axes; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9.

#### GAME-05 · 16:9
- **Where:** weapons / overheat callout
- **Shows:** A weapon silhouette with a heat gauge climbing from blue to amber and a shimmer of heat at the barrel
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient. A generic futuristic laser-tagger silhouette in side profile with a vertical segmented gauge beside it filling from electric-blue (#39b4ff) at the bottom to amber (#ffb020) at the top, and subtle heat shimmer rising from the barrel; clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9.

#### GAME-08 · 1:1
- **Where:** modes / icon set
- **Shows:** Eleven mode icons as one consistent set: FFA, TDM, Generals, Supremacy, Survival/Infection, Swarm, CTF, Domination, KotH, Battle Royale, Extraction
- **Kind:** GENERATE (set of 11, one prompt each with the motif swapped)

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016); flat line-icon style with a single electric-blue accent (#39b4ff) and one amber (#ffb020) detail. One circular badge icon containing a simple abstract motif: [crossed swords for free-for-all / two opposing shield halves for team deathmatch / a star insignia with a small figure for generals / three interlocking hexagons for supremacy / a biohazard-like trefoil made of simple arcs for infection / a hive cell cluster for swarm / a flag on a pole for capture the flag / three linked map pins for domination / a hill contour with a crown for king of the hill / a shrinking concentric ring for battle royale / an upward arrow through a ring for extraction]; identical stroke weight and badge size across the set; NO text, NO labels, NO logos, NO brand names, NO watermarks; 1:1.

#### GAME-13 · 1:1
- **Where:** grenade-modes / colour wheel
- **Shows:** Five-segment colour wheel (red, green, blue, yellow, white) around a grenade silhouette, two segments marked with a small radiating "beacon" glyph
- **Kind:** GENERATE
- **Source:** docs/reference/grenade.md

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient. A simple rounded grenade-like cylinder silhouette in the centre with a small button on top, surrounded by a ring divided into five equal segments coloured muted red, green, blue, yellow and white; two of the segments carry a tiny radiating-arcs glyph beside them; clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 1:1.

### 04-sound.md

#### SND-01 · 16:9
- **Where:** How it works · after the tiers table
- **Shows:** A single command splitting into two parallel channels — a short percussive "effect" waveform and a longer "voice" waveform — both feeding one speaker cone
- **Kind:** GENERATE
- **Source:** protocol/session-findings-2026-08.md §7o

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: an abstract signal diagram — one thin line entering from the left splits into two parallel horizontal lanes; the upper lane carries a short, sharp electric-blue waveform burst, the lower lane a longer, softer amber waveform resembling speech; both lanes converge on the right into a minimalist speaker cone drawn in fine grey outline, emitting faint concentric arcs. Generous negative space, thin 1px lines, subtle glow on the blue burst only.

#### SND-02 · 16:9
- **Where:** Voice packs · after the character-pack cards
- **Shows:** A "slot rack": a horizontal row of seventeen identical sockets, about ten filled with small glowing chips, the rest empty
- **Kind:** GENERATE
- **Source:** protocol/callsign-extract/protocol-classes.md

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: an isometric rack of seventeen identical rectangular sockets in a single row, machined dark graphite; roughly ten sockets hold small flat chips lit with a soft electric-blue edge glow, one chip lit amber, the remaining sockets empty and shadowed. Shallow depth of field, restrained studio lighting from upper left, no characters, no faces.

#### SND-03 · 16:9
- **Where:** Sound bank · after the sample table
- **Shows:** A treemap of the bank: nested rectangles proportional to the family counts in the category table (VA largest, then N, M, U, VB, A, W, D, H, X, R, SW …), voice families in blue, SFX families in greys, one amber block
- **Kind:** GENERATE
- **Source:** protocol/callsign-extract/Sounds.json

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a clean treemap infographic made of about thirty nested rectangles of varying sizes separated by thin 2px dark gutters; one large rectangle occupies roughly a sixth of the area, a dozen medium blocks, many tiny slivers along one edge. About a third of the blocks are tinted in graded electric-blue, the rest in graded cool greys, and exactly one small block is amber. Flat, precise, no text inside blocks, no legend.

#### SND-06 · 16:9
- **Where:** Volume · end of page
- **Shows:** A loudness scale 0–100 with two highlighted markers (69 and 100) and a shaded inaudible zone at the low end
- **Kind:** GENERATE
- **Source:** protocol/brx-protocol.md, docs/experiment-log.md #6

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a wide horizontal gauge bar spanning the frame, thin graphite track; the left 45 percent is hatched in dim grey to read as a dead zone; two slim vertical markers glow — one electric-blue at about 69 percent of the track, one amber at the far right end. Minimal, precise, lots of negative space, no numerals.

#### SND-07 · 16:9
- **Where:** How it works · hero
- **Shows:** Abstract hero: a tagger silhouette in profile with sound arcs leaving the speaker, half the arcs originating from inside the gun and half arriving from a small phone-shaped glyph off-frame
- **Kind:** GENERATE
- **Source:** docs/sound-architecture.md

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a generic futuristic rifle-shaped device in dark matte grey, seen in profile from the left, rendered as a fine outline with restrained rim light; from a small speaker grille on its body a fan of thin concentric arcs radiates outward in electric blue; a second, thinner set of amber arcs travels toward the device from a small rounded rectangle glyph at the far right edge. No people, no readable markings, no real-world brand geometry.

### 05-fix-and-mod.md

#### FIX-01 · 16:9
- **Where:** Diagnose / hero
- **Shows:** Section opener: a laser-tag tagger and headset on a dark workbench with a small screwdriver, multimeter probes and a coiled cable — "we're going to fix this" mood
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a modern black rifle-style laser-tag tagger lying on a dark workbench beside a matching black headband-style sensor headset, a precision screwdriver, two multimeter probes and a coiled cable; a thin electric-blue rim light traces the tagger's edges; one small amber status LED glows on the headset; shallow depth of field, overhead three-quarter angle.

#### FIX-05 · 16:9
- **Where:** Pairing / survives-a-drop compare
- **Shows:** Diagram: two columns of "state" tokens — one column persists through a Bluetooth-link break, a subset also persists through a power cycle
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: an abstract diagram of a rifle-shaped silhouette at left connected by a dotted wireless link to a small device silhouette; the link is broken by a lightning-shaped gap in electric blue, while a second, amber power-switch icon sits below; six small rounded tokens hover over the rifle, four outlined in blue (kept) and two fading to grey (lost); minimal, iconographic, generous negative space.

#### FIX-10 · 16:9
- **Where:** Hits, sound & battery / IR ladder
- **Shows:** Illustration of IR range in sun vs. shade: two figures, one in harsh sunlight with a short beam, one in shade with a long beam
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a split scene — left half a stylised figure holding a rifle-style laser-tag tagger under a large amber sun, emitting a short, diffused electric-blue beam that fades quickly; right half the same figure under a tree canopy at dusk emitting a long, crisp electric-blue beam reaching the far edge; flat iconographic figures, minimal ground line.

#### FIX-12 · 16:9
- **Where:** Community / hero
- **Shows:** Abstract "network of owners" art: a cluster of small tagger silhouettes connected by faint lines to a central glowing node
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a constellation of small, simplified rifle-style laser-tag tagger silhouettes scattered across the frame, joined by thin dotted electric-blue lines converging on one softly glowing central node; a few nodes accented amber; the feel of a knowledge network, sparse and elegant.

### 06-developer.md

#### DEV-01 · 16:9
- **Where:** Transport — hero
- **Shows:** Atmospheric hero: a laser-tag rifle silhouette in profile, low-key, with a faint oscilloscope-style serial pulse train sweeping across the lower third and soft concentric radio arcs emanating from the receiver; a single amber dot for the IR emitter.
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a sleek futuristic laser-tag rifle in side profile, rim-lit in electric blue, with thin concentric radio arcs radiating from its rear and a crisp oscilloscope pulse train (long and short pulses) glowing along the bottom edge; one small amber point of light at the muzzle; shallow depth of field, matte surfaces, no visible branding.

#### DEV-10 · 16:9
- **Where:** Serial console page — header
- **Shows:** Atmosphere: a micro-USB cable plugged into the side of a matte device, a faint terminal glow reflecting on the surface; extreme close-up, shallow focus.
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: extreme close-up of a micro-USB cable seated in the port of a matte dark polymer device, a faint electric-blue glow spilling from an out-of-focus terminal screen in the background, one small amber status LED beside the port, shallow depth of field, no readable characters anywhere.

### 07-platform.md

#### PLAT-01 · 16:9
- **Where:** `/platform` hero background
- **Shows:** Night game: players scattered across a dark field, dim HUD glow from phones on rifle forearms, faint IR-sight glints
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a wide night-time field seen low from behind a crouching player holding a modern black rifle-style laser-tag tagger with a phone mounted on the forearm, its screen a dim electric-blue glow; four or five other silhouetted players scattered at different distances across dark grass, each with a faint blue phone glow; a single amber light at a distant base; cold moonlight rim-lighting, mist near the ground, cinematic depth.

#### PLAT-02 · 16:9
- **Where:** `/platform/build-tiers` header, and a homepage secondary hero
- **Shows:** Daylight outdoor field: a small group in a sunlit park with taggers, one player checking a forearm-mounted phone
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: an overcast daylight park edge with trees, a small group of adults in casual outdoor clothing holding modern black rifle-style laser-tag taggers with slim head-sensor headbands; the nearest player glances at a phone mounted on the tagger's forearm rail; muted desaturated greens and greys, one electric-blue accent on the phone screen, restrained photoreal light, shallow depth of field.

#### PLAT-03 · 16:9
- **Where:** `/platform/pieces` Mission Control spec-sheet; homepage "mission control" scene
- **Shows:** Laptop on a folding table at the edge of a field at dusk, a dark operator console on screen, a small battery router beside it, taggers racked behind
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: a laptop open on a folding camp table at dusk at the edge of a field, its screen showing an abstract dark dashboard of blue rows and bars (no readable text), a small pocket-sized battery Wi-Fi router with one amber LED beside it, several black rifle-style laser-tag taggers leaning on a rack behind, an operator's hands at the keyboard, cool blue screen glow against a deep navy sky.

#### PLAT-04 · 16:9
- **Where:** `/platform/modes` Extraction hero
- **Shows:** Extraction mood: one player kneeling at a glowing beacon in the open, channelling, while distant silhouettes converge
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: night, a lone player kneeling beside a small box-shaped beacon pulsing amber light on open ground, holding a black rifle-style laser-tag tagger and looking over their shoulder; three or four silhouetted figures converging from the treeline in the distance with faint blue glows; tense, exposed, cinematic, ground mist, strong amber-vs-blue contrast.

#### PLAT-13 · 16:9
- **Where:** `/platform/pieces` Companion spec-sheet
- **Shows:** Generic product render of a small slim module clipped to the side of a rifle-style tagger body, one status LED
- **Kind:** GENERATE

> Technical-editorial style for a premium dark-mode product manual. Background near-black navy (#0c1016) with subtle graphite gradient; palette cool and desaturated with a single electric-blue accent (#39b4ff) and occasional amber (#ffb020); clean vector-like lines or restrained photoreal lighting; NO text, NO labels, NO logos, NO brand names, NO watermarks; 16:9. Subject: close-up three-quarter product render of a modern black rifle-style laser-tag tagger body with a small slim matte-black clip-on electronics module attached low on the side, out of the sight line, a single electric-blue status LED lit, a tiny USB-C port visible, no wires between module and tagger; studio rim light, restrained, premium hardware-catalogue feel.

## B · Real-photo shoot list (owner shoots; Gemini must not fake these)
Shoot on a matte black surface, soft diffused key light, 4:3 unless noted; also capture a 16:9 crop-safe version of every hero. Keep sticker labels out of frame or tape over them.

| ID | Section | Where | Shot brief |
|---|---|---|---|
| HOME-03 | `00-home.md` | `/manual` header | Shot brief: overhead, 4:3, matte black backdrop, gun horizontal, headset beside it, soft diffused key light from top-left, no props. |
| HW-01 | `01-hardware.md` | Overview — hero | The full tagger, three-quarter view from the right (reload handle side), headset resting beside it on a dark surface; low key lighting so the LED bank and sight are visible. |
| HW-03 | `01-hardware.md` | Headset — hero | The headset alone, front three-quarter, LEDs lit in a team colour (pre-game state) so the domes and RGB ring read clearly. |
| HW-05 | `01-hardware.md` | Tagger — ports | Macro of the port area: charging jack and micro-USB programming port side by side, with the SELECT button in frame. |
| HW-06 | `01-hardware.md` | Battery — pack and connector | The removed 7.4 V pack with its 2-pin connector, laid next to the open battery bay and the 8.4 V charger plug; connector pins clearly visible for the polarity note. |
| HW-07 | `01-hardware.md` | Accessories — grenade | The smart grenade with safety clip, top button and IR windows visible; LED lit green (ready). USB-C port in frame. |
| HW-11 | `01-hardware.md` | Spec sheet — what's in the box | Top-down flat lay: tagger, headset, charger, reload handle, quick manual, optional grenade and phone bracket arranged on a dark surface. |
| OPS-01 | `02-operation.md` | Quick Start · hero | — (photograph: dark surface, single soft key light from the left, tagger at 3/4 angle, headset in front; no stickers or labels visible) |
| OPS-02 | `02-operation.md` | Charging & Batteries · after the polarity warning | — (macro, shallow depth of field, ports centred, charger LED visible; mask any serial sticker) |
| OPS-06 | `02-operation.md` | Pairing the Headset · after the LED table | — (three tightly framed photos of the same headset at the same angle in a dim room: 1 cycling colours, 2 solid team colour, 3 dark/off during play; combined as a strip in HTML) |
| OPS-07 | `02-operation.md` | The Grenade & Accessories · after the mode-colour table | — (grenade on a dark surface, same framing for all five; the LED colour is the only change; button clearly visible) |
| OPS-10 | `02-operation.md` | Care & Storage · after the wear table | — (bay open, pack lifted slightly so the connector and its two wires are visible; no polarity marking added in-camera — the overlay will annotate) |
| GAME-06 | `03-gameplay.md` | weapons / gun-menu table | REAL PHOTO — the tagger's rear display/LED area while cycling weapons in the on-gun menu |
| GAME-07 | `03-gameplay.md` | health / hero | REAL PHOTO — a tagger being hit: headset dome lit green, gun LED strip visible |
| GAME-11 | `03-gameplay.md` | how-a-kill-works / feedback table | REAL PHOTO — a headset lit green mid-hit next to a tagger sight showing the kill-confirm flash |
| GAME-12 | `03-gameplay.md` | grenade-modes / hero | REAL PHOTO — the Smart Grenade, top button and LED visible, lit in a mode colour |
| SND-04 | `04-sound.md` | Custom sounds · end of page | — (owner shoots it; frame the micro-USB cable in the Programming Port and the drive listing; blur any sticker labels) |
| SND-05 | `04-sound.md` | Firmware · end of page | — (owner shoots it; macro, dark background, blur any sticker labels) |
| FIX-02 | `05-fix-and-mod.md` | Pairing / LED table | Two headsets side by side on a neutral dark surface, shot from the front at eye level; left headset mid-rainbow (catch a colour), right headset solid red or blue; room dim so LEDs read clearly; no stickers/serials visible (mask or turn them away). |
| FIX-03 | `05-fix-and-mod.md` | Repairs / catalogue | Right side of the tagger, macro, 45° from above; handle off and placed in frame; battery unplugged and visibly disconnected; a pen pressing the switch. |
| FIX-04 | `05-fix-and-mod.md` | Hits, sound & battery / battery ladder | Macro of the open bay with the connector oriented so the two wires and their colours are legible; pack label in frame if it shows voltage/capacity; no serial stickers. |
| FIX-06 | `05-fix-and-mod.md` | Repairs / catalogue | Macro, flat lighting; the two buttons on a dark mat; crack clearly visible; optionally the D-pad recess on the tagger in the background. |
| FIX-07 | `05-fix-and-mod.md` | Pairing / re-pair steps | Three-quarter view showing both hands and both devices; power switch mid-slide; D-pad thumb on RIGHT; headset button pressed; no stickers. Consider a 3-frame strip: hold button → boot holding RIGHT → trigger pull. |
| FIX-08 | `05-fix-and-mod.md` | Mods / rider | Side profile of the tagger, bracket and rider in focus; show the clip/strap holding the bank; no brand logos prominent. |
| FIX-09 | `05-fix-and-mod.md` | Accessories / grenade | Hand-held at chest height, LED blue (Hill) or yellow (Respawn); second frame with the LED white (lock confirmation) if possible; dim room. |
| FIX-11 | `05-fix-and-mod.md` | Repairs / firmware steps | Macro, straight-on, with a micro-USB cable plugged into the programming port to disambiguate it from the charging port; power switch in frame. |
| PLAT-10 | `07-platform.md` | `/platform/pieces` Utility Box spec-sheet | — (shoot on a dark surface, side light; keep sticker labels out of frame) |
| PLAT-11 | `07-platform.md` | `/platform/pieces` Combat HUD spec-sheet; homepage | — (shoot at dusk or indoors dark; HUD in night mode; no gun stickers visible) |
| PLAT-12 | `07-platform.md` | `/platform` "The pieces" cards; `/platform/status` | — (overhead or 3/4 view; laptop showing Mission Control; sticker labels covered or out of frame) |

## C · Diagrams to build in the site (SVG/HTML)
| ID | Section | Where | What it shows | Source |
|---|---|---|---|---|
| HOME-02 | `00-home.md` | `/` "how it's wired" teaser | Topology: laptop at base ↔ (dashed Wi-Fi) ↔ phone nodes, each phone ↔ (solid BLE) ↔ one gun, gun → gun IR arrows. | docs/architecture-topology.md §2 |
| GAME-09 | `03-gameplay.md` | health / diagram | Three stacked pools (shield, armor, health) draining top-down, with one large hit overflowing from the armor bar into the health bar | protocol/session-findings-2026-08.md §7r addendum |
| GAME-10 | `03-gameplay.md` | how-a-kill-works / diagram | The kill pipeline: tagger emitting a coded burst of light → a headset with front and back domes plus a gun-body sensor → a pool bar dropping → a green sight flash on the shooter | protocol/brx-ir-protocol.md |
| GAME-14 | `03-gameplay.md` | open-brx-modes / tier ladder | Three ascending platforms: a laptop with taggers; plus a small station and a grenade; plus a radio mast — with abstract mode badges stacked on each | docs/game-modes.md |
| DEV-02 | `06-developer.md` | Transport — after the generation table | Link topology. Boxes: HOST (laptop/phone/ESP32) — TAGGER — HEADSET — OTHER TAGGER — USB CONSOLE. Arrows: host→tagger labelled "BLE NUS write 6E400002" and tagger→host "notify 6E400003"; a dashed bidirectional line tagger↔headset labelled "proprietary link (team colour, hit sensors)"; tagger→other tagger a dotted amber arrow labelled "IR 38 kHz, 25-bit word"; a side arrow USB CONSOLE→tagger labelled "QUERY / SETUP (CR-terminated, not $)". A small note on the Gen1 path: "Gen1: SPP 57600 via HC-05". | protocol/brx-protocol.md §1, protocol/session-findings-2026-08.md §7c, §7r |
| DEV-03 | `06-developer.md` | Transport — frame anatomy | Annotated frame `$PLAY,,4,6,V3A,,,,*` as monospace chips: `$` (start), `PLAY` (command), `,` separators, an **empty** token highlighted in amber with the note "empty = leave unchanged", `4`, `6`, `V3A` (announcer slot), trailing empties, `,*` (terminator). Callouts: "max ~20-byte BLE chunks", "no commas / * / newlines inside tokens". | protocol/brx-protocol.md §2, protocol/session-findings-2026-08.md §7o; mcp/brx_mcp/protocol.py |
| DEV-04 | `06-developer.md` | Arm sequence | Sequence diagram, two lifelines HOST and TAGGER. Downward arrows in order: `$CLEAR` `$START` (return `$LCD,0,0,0,0,0,0`) `$GSET` `$PSET` `$WEAP×3` `$SIR×10` `$BMAP×7` `$TID` `$PLAYX,0` `$PLAY,VA81,4,6` `$SPAWN,,` (return `$LCD,45,70,0,0,36,216`) `$AMMO,0,36,108,1` `$AMMO,1,6,12,1` `$BMAP,0,0`. Then a shaded "in play" band with `$BUT,0,1`/`$ALCD` returns. Then a death band: return `$HP,0,0,0` + `$LCD,0,0,0,1,1,1`; host `$HLOOP,0,0` (~1.7 s); host `$SPAWN,,` (~10 s) return `$LCD,45,70,0,0,36,216`. Then end: `$VOL,69,0` `$HLED,,6` `$STOP` `$CLEAR` `$PLAY,VSF,4,6,JAY`. Blue for host frames, amber for gun echoes. | protocol/session-findings-2026-08.md §7e, §7f, §7o |
| DEV-05 | `06-developer.md` | `$WEAP` page | A horizontal token ruler of 43 cells (t0–t42) colour-coded by block: identity (t0–t2), damage/IR (t3–t6), secondary-dormant (t7–t11, hatched grey), extra-headset (t12–t13, t42), cadence & ammo (t14–t19), fire mode/accuracy/burst/overheat (t20–t26), sounds (t27–t36), overheat gate (t37–t38), ammo tail (t39–t41). Each cell shows its index and a short label; t14 and t20 get a "bench-proven" badge; t15 gets a "constant 850 — don't write" badge. | protocol/callsign-extract/protocol-classes.md; protocol/brx-protocol.md §6.1 |
| DEV-06 | `06-developer.md` | IR page | 25-bit field ruler: B(4) P(6) T(2) D(8) C(1) U(2) Z(2) with bit offsets 0–24 below, plus a pulse-train strip above showing the 2 ms sync, then long (≈1000 µs) and short (≈500 µs) marks for the sample word `1101000111010101101000110`, and the trailing short end pulse. Under each field: "= $WEAP t3 / $HIR tok2", "= $PSET t1 / $HIR tok3", "= $TID & 3 / $HIR tok4", "= $WEAP t5 / $HIR tok5", "= $HIR tok6 (×1.5)", "= $SIR subtype / $HIR tok7", "parity: odd→01 even→10; gun checks only Z0≠Z1". | protocol/brx-ir-protocol.md |
| DEV-07 | `06-developer.md` | `$SIR` page | Damage pipeline flow: [IR word: B,U,D,C] → [victim looks up $SIR(B,U)] → branch "no row → dropped silently" / "row found" → [function class: damage ×1 / ×1.25 / ×2 / AP / heal / armor / shield / status] → [×1.5 if C=1] → [team gate: FF=0 blocks same-team damage and enemy heals] → [drain shields → armor → HP] → [emit $HIR + $HP]. Use amber for the drop/gate branches. | protocol/brx-protocol.md §5, protocol/session-findings-2026-08.md §7r addendum; docs/experiment-log.md |
| DEV-08 | `06-developer.md` | Events page | Kill attribution sequence with three lifelines: VICTIM GUN, HOST, SHOOTER GUN. Victim → host: `$HIR,4,0,19,2,9,0,3` (×N) then `$HIR` + `$HP,0,0,0` (same ms). Host box: "credit player 19 / team 2". Host → shooter: `$SFLASH,*` (+0.4 s), `$PLAY,,4,6,V3A,,,,*` (+0.2 s), `$PLAY,,4,6,VB17,,,,*` (lead change only). Host → victim after respawn delay: `$SPAWN,,*`. | protocol/session-findings-2026-08.md §7o, §7q |
| DEV-09 | `06-developer.md` | Headset/link page | Grid: rows = config, alive/dead+pools, ammo, `$TID`/LED colour, `$NAME`, player id, score/clock, fn-23 state; columns = BLE drop, headset off, power-cycle. Cells filled blue "survives", amber "wiped", grey "never on gun / untested", each with a two-word note. | protocol/session-findings-2026-08.md §7r, §7n; docs/experiment-log.md |
| PLAT-05 | `07-platform.md` | `/platform` overview + `/platform/architecture` "Match-time topology" | The match-time topology diagram | `docs/architecture-topology.md` §2 |
| PLAT-06 | `07-platform.md` | `/platform/architecture` "The squeeze" | The decision flow that forces a per-player node | `docs/architecture-topology.md` §1 |
| PLAT-07 | `07-platform.md` | `/platform/architecture` "Two deployment shapes" | Tier 0 vs Tier 1 side-by-side with the wall | `docs/architecture-topology.md` §3 |
| PLAT-08 | `07-platform.md` | `/platform/architecture` phase timeline | Which links are up, phase by phase | `docs/architecture-topology.md` §4 |
| PLAT-09 | `07-platform.md` | `/platform/architecture` "Coverage honesty" | The two-hop kill path | `docs/architecture-topology.md` §5 |

Box-by-box specs for each are in the section file's image table.
