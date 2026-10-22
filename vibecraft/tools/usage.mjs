// Sum API usage in this session's transcript between two ISO times (default: all). Dedupes by message id.
import fs from 'node:fs';
// Usage: node tools/usage.mjs <transcript.jsonl> [fromISO] [toISO]
const [F, from = '0000', to = '9999'] = process.argv.slice(2);
const seen = new Map();
for (const line of fs.readFileSync(F, 'utf8').split('\n')) {
  if (!line.includes('"usage"')) continue;
  let r; try { r = JSON.parse(line); } catch { continue; }
  const m = r.message; if (!m || !m.usage || !r.timestamp) continue;
  if (r.timestamp < from || r.timestamp > to) continue;
  seen.set(m.id || r.uuid, { u: m.usage, model: m.model, t: r.timestamp });
}
const tot = { requests: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 }, models = {};
for (const { u, model } of seen.values()) {
  tot.requests++; tot.input += u.input_tokens || 0; tot.cacheWrite += u.cache_creation_input_tokens || 0;
  tot.cacheRead += u.cache_read_input_tokens || 0; tot.output += u.output_tokens || 0;
  tot.thinking += (u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0;
  models[model] = (models[model] || 0) + 1;
}
console.log(JSON.stringify({ from, to, ...tot, models }));
