"""Build docs/site/images.md from the per-section content files' image tables."""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent  # docs/site
CONTENT = ROOT.parent / "manual"
files = sorted(CONTENT.glob("0*.md"))

rows = []  # (section_file, id, where, what, kind, source, prompt)
for f in files:
    text = f.read_text()
    m = re.search(r"^## Images for this section\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    if not m:
        print("no image table:", f.name, file=sys.stderr); continue
    for line in m.group(1).splitlines():
        if not line.startswith("|"): continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 6 or not re.match(r"[A-Z]+-\d+", cells[0]): continue
        rows.append((f.name, *cells[:6]))

def kind_of(k):
    k = k.upper()
    if "REAL PHOTO" in k: return "photo"
    if "SVG" in k: return "svg"
    return "generate"

def aspect_of(prompt, what):
    m = re.search(r"(\d+:\d+)", prompt) or re.search(r"(\d+:\d+)", what)
    return m.group(1) if m else "16:9"

photos = [r for r in rows if kind_of(r[4]) == "photo"]
svgs = [r for r in rows if kind_of(r[4]) == "svg"]
gens = [r for r in rows if kind_of(r[4]) == "generate"]

out = []
out.append("# Open BRX site — image manifest + Gemini prompts\n")
out.append(f"Generated from `docs/manual/*.md` image tables. **{len(rows)} slots**: "
           f"**{len(gens)} to generate (Gemini)** · **{len(photos)} real photos (shoot list)** · "
           f"**{len(svgs)} diagrams to build as SVG/HTML in the site**.\n")
out.append("""
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
""")
for f in files:
    fr = [r for r in rows if r[0] == f.name]
    if not fr: continue
    g = sum(kind_of(r[4]) == "generate" for r in fr)
    p = sum(kind_of(r[4]) == "photo" for r in fr)
    s = sum(kind_of(r[4]) == "svg" for r in fr)
    out.append(f"| `{f.name}` | {g} | {p} | {s} | {len(fr)} |\n")
out.append(f"| **Total** | **{len(gens)}** | **{len(photos)}** | **{len(svgs)}** | **{len(rows)}** |\n")

out.append("\n## A · Gemini generation batch (copy prompts as-is)\n")
out.append("Priority order: hero/atmosphere first (HOME-01, HOME-04, PLAT-*, section heroes), then the icon sets, then per-page diagrams.\n")
cur = None
for r in gens:
    if r[0] != cur:
        cur = r[0]; out.append(f"\n### {cur}\n")
    out.append(f"\n#### {r[1]} · {aspect_of(r[6], r[5]) if False else aspect_of(r[6], r[3])}\n")
    out.append(f"- **Where:** {r[2]}\n- **Shows:** {r[3]}\n- **Kind:** {r[4]}\n")
    if r[5] and r[5] != "—": out.append(f"- **Source:** {r[5]}\n")
    out.append(f"\n> {r[6]}\n")

out.append("\n## B · Real-photo shoot list (owner shoots; Gemini must not fake these)\n")
out.append("Shoot on a matte black surface, soft diffused key light, 4:3 unless noted; also capture a 16:9 crop-safe version of every hero. Keep sticker labels out of frame or tape over them.\n\n")
out.append("| ID | Section | Where | Shot brief |\n|---|---|---|---|\n")
for r in photos:
    brief = r[6] if r[6] and r[6] != "—" else r[3]
    out.append(f"| {r[1]} | `{r[0]}` | {r[2]} | {brief} |\n")

out.append("\n## C · Diagrams to build in the site (SVG/HTML)\n")
out.append("| ID | Section | Where | What it shows | Source |\n|---|---|---|---|---|\n")
for r in svgs:
    out.append(f"| {r[1]} | `{r[0]}` | {r[2]} | {r[3]} | {r[5]} |\n")
out.append("\nBox-by-box specs for each are in the section file's image table.\n")

(ROOT / "images.md").write_text("".join(out))
print(f"wrote images.md: {len(rows)} rows ({len(gens)} gen / {len(photos)} photo / {len(svgs)} svg)")
