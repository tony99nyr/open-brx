// Which modes have card/preview art in `public/assets/modes/<mode>.jpg`. Games.tsx and Designer.tsx
// fall back to a plain striped caption for any mode not listed here.
//
// Hand-kept, and `test/modeArt.test.ts` is what keeps it honest: it reads the directory and fails if
// this set and the basenames on disk disagree in either direction, so dropping an image in without
// adding it here is a red test, not a silently ignored file.
//
// It used to be derived at build time with `import.meta.glob('../public/assets/modes/*.jpg')`. That
// worked, but on unspecified behaviour: Vite documents `publicDir` as the tree served and copied
// VERBATIM, not as importable source, so globbing into it is outside the contract — and the
// documented consequence of importing a public asset is that it gets bundled a second time, on top of
// the copy already being served. The images are referenced by URL (`url(assets/modes/...)`), never
// imported, so nothing needs them in the graph. A five-entry list plus a test that reads the folder
// costs less than depending on a behaviour that is not promised.
//
// `state.py`'s MODES lists six modes; koth has no art yet (FOLLOWUPS: "mode art for koth (MC + phone),
// melee weapon art"). Add the file AND the id here together.
export const MODE_ART: ReadonlySet<string> = new Set(['tdm', 'ffa', 'infection', 'lms', 'extraction']);
