// Which modes have card/preview art in public/assets/modes/*.jpg. Derived from the directory itself
// (not hand-typed) so a dropped-in image is picked up without a code change and a missing one is
// never silently assumed present. state.py's MODES currently lists six modes; koth has no art yet
// (FOLLOWUPS: "mode art for koth (MC + phone), melee weapon art") — Games.tsx/Designer.tsx fall back
// to a plain caption for any mode not in this set.
export const MODE_ART: ReadonlySet<string> = new Set(
  Object.keys(import.meta.glob('../public/assets/modes/*.jpg', { eager: true }))
    .map((path) => path.match(/([^/]+)\.jpg$/)![1]),
);
