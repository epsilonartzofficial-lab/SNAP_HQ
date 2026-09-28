// Loads the game's pure-logic scripts into a Node VM context (no DOM, no three.js).
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..');
export const PURE = ['core', 'blocks', 'blocks-world', 'blocks-stage2', 'blocks-biomes', 'items', 'items-stage2', 'inventory', 'crafting', 'recipes-stage2', 'survival', 'worldgen', 'worldgen2', 'lighting', 'save'];

export function loadBC(files = PURE) {
  const ctx = { console, Math, Date, JSON, BigInt, Uint8Array, Int16Array, Float32Array, Map, Set };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
  return ctx.BC;
}
