#!/usr/bin/env node
// Regenerate the FOLLOWUPS summary from its open MVP rows.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const START = '<!-- index:start -->';
const END = '<!-- index:end -->';
const GROUPS = ['DESK', 'BENCH', 'DECISION'];
const MARKERS = ['🔴', '🟠', '🟡', '🟢'];
const LABELS = {
  DESK: n => `**MVP DESK (${n}),** a keyboard is enough:`,
  BENCH: n => `**MVP BENCH (${n}),** needs a gun, a Stick, phones or a field (the order is the bench plan):`,
  DECISION: n => `**MVP DECISION (${n}),** awaiting Tony:`,
};

const args = process.argv.slice(2);
const check = args.includes('--check');
const files = args.filter(arg => arg !== '--check');
if (files.length > 1 || files.some(arg => arg.startsWith('--'))) {
  console.error('Usage: node scripts/followups-index.mjs [--check] [FOLLOWUPS.md]');
  process.exit(2);
}
const file = files[0] || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/FOLLOWUPS.md');

function render(text, current) {
  const rows = Object.fromEntries(GROUPS.map(group => [group, []]));
  const ids = new Set();
  // Keep the bench plan's existing order. New ids follow the old ids in row order.
  const order = new Map();
  for (const line of current.split('\n')) {
    if (!/^- [🔴🟠🟡🟢] \*\*/u.test(line)) continue;
    for (const match of line.matchAll(/\*\*([A-Z]\d+)\*\*/g)) {
      if (!order.has(match[1])) order.set(match[1], order.size);
    }
  }
  let group = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      const match = /^## MVP (DESK|BENCH|DECISION)\b/.exec(line);
      group = match?.[1] || null;
      continue;
    }
    if (!group) continue;
    const row = /^- \*\*([A-Z]\d+) (🔴|🟠|🟡|🟢)(?= |\*\*)/u.exec(line);
    if (!row) {
      if (/^- \*\*[A-Z]\d+(?:\s|\*)/.test(line)) throw new Error(`row has no open marker: ${line.slice(0, 80)}`);
      continue;
    }
    const [, id, marker] = row;
    if (ids.has(id)) throw new Error(`duplicate open row: ${id}`);
    ids.add(id);
    rows[group].push({ id, marker });
  }
  const count = group => rows[group].length;
  const out = [
    `**MVP open: ${ids.size}.** Desk ${count('DESK')} · bench ${count('BENCH')} · decision ${count('DECISION')}.`,
  ];
  for (const group of GROUPS) {
    out.push('', LABELS[group](count(group)));
    for (const marker of MARKERS) {
      const listed = rows[group].filter(row => row.marker === marker)
        .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity))
        .map(row => `**${row.id}**`);
      if (listed.length) out.push(`- ${marker} ${listed.join(' · ')}`);
    }
  }
  return `${out.join('\n')}\n`;
}

function update(text) {
  const start = text.indexOf(`${START}\n`);
  const end = text.indexOf(END);
  if (start < 0 || end < start || text.indexOf(START, start + START.length) >= 0 || text.indexOf(END, end + END.length) >= 0) {
    throw new Error('FOLLOWUPS index needs one start marker and one end marker');
  }
  const from = start + START.length + 1;
  const current = text.slice(from, end);
  const wanted = render(text, current);
  return { current, wanted, updated: text.slice(0, from) + wanted + text.slice(end) };
}

try {
  const text = fs.readFileSync(file, 'utf8');
  const { current, wanted, updated } = update(text);
  if (current === wanted) process.exit(0);
  if (check) {
    const oldLines = current.split('\n');
    const newLines = wanted.split('\n');
    let first = 0;
    while (first < oldLines.length && first < newLines.length && oldLines[first] === newLines[first]) first++;
    let oldEnd = oldLines.length, newEnd = newLines.length;
    while (oldEnd > first && newEnd > first && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
      oldEnd--;
      newEnd--;
    }
    console.log(`--- ${file}\n+++ regenerated index\n@@ -${first + 1},${oldEnd - first} +${first + 1},${newEnd - first} @@`);
    for (const line of oldLines.slice(first, oldEnd)) console.log(`-${line}`);
    for (const line of newLines.slice(first, newEnd)) console.log(`+${line}`);
    process.exit(1);
  }
  fs.writeFileSync(file, updated);
} catch (error) {
  console.error(`followups-index: ${error.message}`);
  process.exit(2);
}
