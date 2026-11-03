// diag branch only: npm has no patchedDependencies, so apply the repo's rolldown WASM memory patch
// (patches/@rolldown__binding-wasm32-wasi@1.2.15.patch) by hand: 1 GiB / 4 GiB is more than iPad Safari can reserve
import { readFileSync, writeFileSync } from 'node:fs';

const dir = 'node_modules/@rolldown/binding-wasm32-wasi/';
for (const file of ['rolldown-binding.wasi.cjs', 'rolldown-binding.wasi-browser.js']) {
  const code = readFileSync(dir + file, 'utf8');
  const patched = code.replace('initial: 16384,', 'initial: 1024,').replace('maximum: 65536,', 'maximum: 16384,');
  if (patched === code) throw new Error(`no memory settings to patch in ${file}`);
  writeFileSync(dir + file, patched);
  console.log(`[diag] patched ${file}`);
}
