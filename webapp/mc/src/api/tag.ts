// F366: the gamertag limits, as `state.py _check_tag` applies them. Both numbers come from the generated
// contract (`types.py` MAX_TAG_LEN / SOFT_TAG_LEN), so the console, the mock and the phone read one source.
import { MAX_TAG_LEN, SOFT_TAG_LEN } from './contract.gen';

/** the tag as MC stores it: trimmed, upper-cased ("ß" becomes "SS", so count after this) */
export const storedTag = (raw: string) => raw.trim().toUpperCase();

/** MC's refusal text for a tag over the hard limit, or null when MC accepts it */
export function tagError(raw: string): string | null {
  const n = storedTag(raw).length;
  return n > MAX_TAG_LEN ? `the gamertag is ${n} characters: ${MAX_TAG_LEN} is the most` : null;
}

/** true past the soft limit and within the hard one: MC accepts it, the phone HUD may shorten it */
export const tagMayShorten = (raw: string) => { const n = storedTag(raw).length; return n > SOFT_TAG_LEN && n <= MAX_TAG_LEN; };

/** how far past the hard limit an input may run, so a pasted long tag shows the refusal instead of a silent cut */
export const TAG_INPUT_MAX = MAX_TAG_LEN + 16;
