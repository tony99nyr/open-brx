// The old block DSL's names, in ONE place: build.mjs validates the source against this and the
// Playwright gate asserts every rendered page against the same regex, so they cannot drift.
// A DSL marker anywhere on a line, but NOT an ordinary markdown link: `[download](url)` and
// `[table][ref]` are legitimate prose, and 21 block names are common enough words to appear as link
// text. The negative lookahead is what keeps the mid-line catch from failing honest markdown.
export const BLOCK_MARKER = /\[(hero|callout|steps|cards|table|data-table|spec-sheet|accordion|faq|image|diagram|code|bit-field|symptom-ladder|compare|stat-row|quote|timeline|pricing-tiers|download|under-construction|audio-player)(?::[a-z|]+)?(?:\s+[A-Z0-9-]+)?\](?![(\[])/;
