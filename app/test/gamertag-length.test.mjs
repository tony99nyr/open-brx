// F366: the phone cannot rename an over-limit gamertag — MC's ARMORY/KIT does that — so the HUD's job is only
// to notice one and nudge the player to ask the host. The length check has to agree with MC's own rule
// (`_check_tag` in mcp/brx_mcp/mc/state.py: trim, upper-case, then a plain character count against
// MAX_TAG_LEN) or the note would fire on a tag MC accepts, or stay silent on one it would refuse to rename.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TAG_LEN } from '../src/transport/contract.gen.js';
import { tagTooLong } from '../src/hud/hud.js';

test('MAX_TAG_LEN + 1 characters warns', () => {
  const over = 'A'.repeat(MAX_TAG_LEN + 1);
  assert.equal(over.length, 17, 'test fixture drifted from MAX_TAG_LEN');
  assert.equal(tagTooLong(over), true);
});
test('exactly MAX_TAG_LEN characters does not warn', () => {
  const atLimit = 'A'.repeat(MAX_TAG_LEN);
  assert.equal(atLimit.length, 16, 'test fixture drifted from MAX_TAG_LEN');
  assert.equal(tagTooLong(atLimit), false);
});
test('MC trims before counting: leading/trailing whitespace does not count toward the limit', () => {
  const padded = '  ' + 'A'.repeat(MAX_TAG_LEN) + '   ';   // 16 real characters, over 20 raw
  assert.equal(tagTooLong(padded), false);
  const paddedOver = '  ' + 'A'.repeat(MAX_TAG_LEN + 1) + '  ';   // 17 real characters
  assert.equal(tagTooLong(paddedOver), true);
});
test('MC upper-cases before counting: case does not change the verdict', () => {
  const lower = 'a'.repeat(MAX_TAG_LEN + 1);
  assert.equal(tagTooLong(lower), true);
  const mixed = 'aB'.repeat(MAX_TAG_LEN / 2);   // MAX_TAG_LEN characters, mixed case
  assert.equal(tagTooLong(mixed), false);
});
test('no tag (not yet known) never warns', () => {
  assert.equal(tagTooLong(''), false);
  assert.equal(tagTooLong(null), false);
  assert.equal(tagTooLong(undefined), false);
});
// H1 (review of d7a132f9): Python's `len()` counts code points, not UTF-16 code units. A surrogate-pair
// emoji is ONE character to MC's `_check_tag` but TWO to JS's `.length` — counting code units warns on a
// tag MC would happily store.
test('9 emoji is MAX_TAG_LEN/2 short of the limit by code points, even though JS .length reads 18', () => {
  const nineEmoji = '😀'.repeat(9);
  assert.equal(nineEmoji.length, 18, 'each emoji here is a surrogate pair — fixture check');
  assert.equal(tagTooLong(nineEmoji), false);
});
test('17 emoji is one code point over the limit', () => {
  const seventeenEmoji = '😀'.repeat(17);
  assert.equal(tagTooLong(seventeenEmoji), true);
});
