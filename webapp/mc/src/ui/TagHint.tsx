// F366: the line under a gamertag input. Nothing up to the soft limit; a warning from 13 to 16; the refusal past 16.
import { MAX_TAG_LEN } from '../api/contract.gen';
import { storedTag, tagError, tagMayShorten } from '../api/tag';
import { F } from '../tokens';
import { colourOf, glyphed, sevOf } from '../alerts';

export function TagHint({ value, testId }: { value: string; testId?: string }) {
  const err = tagError(value);
  if (err) {
    return <div aria-live="polite" data-tag-hint="too-long" data-testid={testId} data-alert="kit-tag-too-long"
      style={{ font: F.chk(700, 11), letterSpacing: '.08em', color: colourOf('kit-tag-too-long') }}>{glyphed(sevOf('kit-tag-too-long'), `${storedTag(value).length} OF ${MAX_TAG_LEN} CHARACTERS: SHORTEN IT`)}</div>;
  }
  if (tagMayShorten(value)) {
    return <div data-tag-hint="may-shorten" data-testid={testId} data-alert="kit-tag-may-shorten"
      style={{ font: F.chk(700, 11), letterSpacing: '.08em', color: colourOf('kit-tag-may-shorten') }}>{storedTag(value).length} OF {MAX_TAG_LEN} CHARACTERS: MAY BE SHORTENED ON THE PHONE HUD</div>;
  }
  return null;
}
