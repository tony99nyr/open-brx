import fs from 'node:fs';
import path from 'node:path';

const BUNDLES = {
  mc: {
    output: 'webapp/mc/dist/index.html',
    inputs: ['webapp/mc/src', 'webapp/mc/public', 'webapp/mc/index.html', 'webapp/mc/vite.config.ts',
      'webapp/mc/package.json', 'webapp/mc/package-lock.json', 'webapp/mc/tsconfig.json',
      'webapp/mc/tsconfig.app.json', 'webapp/mc/tsconfig.node.json'],
    hint: 'cd webapp/mc && npm run build',
  },
  app: {
    output: 'app/www/app.js',
    required: ['app/www/index.html'],
    inputs: ['app/src', 'app/plugins', 'app/scripts/build.mjs', 'mcp/brx_mcp/mc/golden_bundle.json',
      'app/package.json', 'app/package-lock.json'],
    hint: 'cd app && npm run build',
  },
};

function newestMtime(file) {
  const stat = fs.statSync(file);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return fs.readdirSync(file).reduce((newest, name) => Math.max(newest, newestMtime(path.join(file, name))), stat.mtimeMs);
}

export function bundleStale(root, name) {
  const bundle = BUNDLES[name];
  if (!bundle) throw new Error(`unknown bundle: ${name}`);
  const output = path.join(root, bundle.output);
  if (!fs.existsSync(output)) return `${bundle.output} is missing; ${bundle.hint}`;
  for (const required of bundle.required || []) {
    if (!fs.existsSync(path.join(root, required))) return `${required} is missing; ${bundle.hint}`;
  }
  const outputTime = fs.statSync(output).mtimeMs;
  for (const input of bundle.inputs) {
    const file = path.join(root, input);
    if (fs.existsSync(file) && newestMtime(file) > outputTime) return `${input} is newer than ${bundle.output}; ${bundle.hint}`;
  }
  return null;
}
