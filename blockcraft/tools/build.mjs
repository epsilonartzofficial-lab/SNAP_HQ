#!/usr/bin/env node
// Blockcraft build. Reads index.html and writes two single-file versions of the game:
//
//   dist/blockcraft.html  Self-contained page: every local stylesheet and <script src> (three.js
//                         included) is inlined in document order, so the file works offline from file://.
//   dist/artifact.html    Page body for a host that supplies its own <!doctype>/<html>/<head>/<body>:
//                         no wrapper tags and no charset/viewport meta, <title>/font links/<style> on top,
//                         and three.js loaded from cdnjs instead of being inlined.
//
// Zero dependencies (Node 22). Usage: node tools/build.mjs   (or: npm run build)
// Exits non-zero with a clear message if index.html references a local file that does not exist.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const THREE_LOCAL = 'vendor/three.min.js';   // vendor copy is three.js r128, same as the CDN build below
const THREE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

class BuildError extends Error {}
const fail = (msg) => { throw new BuildError(msg); };

// Comments are matched first so tags inside them are left alone; <script>...</script> is matched whole
// so an inline script's body is never scanned for tags.
const TOKEN = /<!--[\s\S]*?-->|<!doctype\b[^>]*>|<\/?(?:html|head|body)\b[^>]*>|<script\b([^>]*)>([\s\S]*?)<\/script\s*>|<link\b([^>]*)>|<meta\b([^>]*)>/gi;
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const REMOVED = '\u0001';

function parseAttrs(src) {
  const out = new Map();
  for (const m of src.matchAll(ATTR)) out.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

const isRemote = (url) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url);   // https:, data:, //host ...
const isStylesheet = (attrs) => (attrs.get('rel') || '').toLowerCase().split(/\s+/).includes('stylesheet');

// Walks index.html and lets `handle` decide what each tag becomes. Replacements are never rescanned.
function rewrite(html, handle) {
  return html.replace(TOKEN, (raw, sAttrs, sBody, lAttrs, mAttrs) => {
    if (raw.startsWith('<!--')) return raw;
    if (sAttrs !== undefined) return handle({ kind: 'script', raw, attrs: parseAttrs(sAttrs), body: sBody });
    if (lAttrs !== undefined) return handle({ kind: 'link', raw, attrs: parseAttrs(lAttrs) });
    if (mAttrs !== undefined) return handle({ kind: 'meta', raw, attrs: parseAttrs(mAttrs) });
    return handle({ kind: 'wrapper', raw });
  });
}

const localPath = (ref) => decodeURI(ref.split(/[?#]/)[0]).replace(/^\.\//, '');

// Local files index.html pulls in, in document order.
function collectRefs(html) {
  const scripts = [], styles = [];
  rewrite(html, (t) => {
    if (t.kind === 'script' && t.attrs.has('src') && !isRemote(t.attrs.get('src'))) {
      const type = (t.attrs.get('type') || '').toLowerCase();
      if (type === 'module' || t.attrs.has('defer') || t.attrs.has('async')) {
        fail(`<script src="${t.attrs.get('src')}"> uses type=module/defer/async, which would behave differently once inlined`);
      }
      scripts.push(localPath(t.attrs.get('src')));
    }
    if (t.kind === 'link' && isStylesheet(t.attrs) && t.attrs.has('href') && !isRemote(t.attrs.get('href'))) {
      styles.push(localPath(t.attrs.get('href')));
    }
    return t.raw;
  });
  return { scripts, styles };
}

function readSources(rels) {
  const missing = [], sources = new Map();
  for (const rel of rels) {
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep)) fail(`index.html references a file outside the project: ${rel}`);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { missing.push(rel); continue; }
    sources.set(rel, fs.readFileSync(file, 'utf8'));
  }
  if (missing.length) {
    fail(`index.html references ${missing.length} missing file${missing.length > 1 ? 's' : ''}:\n`
      + missing.map((m) => `  - ${m}`).join('\n'));
  }
  return sources;
}

// "</script" would end the inline element early, and "<!--" can put the HTML parser into its
// script-escaped states; both are rewritten to forms that mean the same thing in strings, comments
// and (non-/u) regex literals.
function inlineScript(rel, code) {
  const safe = code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  return `<script data-src="${rel}">\n${safe}${safe.endsWith('\n') ? '' : '\n'}//# sourceURL=${rel}\n</script>`;
}

function inlineStyle(rel, css) {
  if (/url\(\s*['"]?(?!data:|https?:|#)/i.test(css)) {
    console.warn(`warning: ${rel} has a relative url(...); it will not resolve from dist/`);
  }
  const safe = css.replace(/<\/(style)/gi, '<\\/$1');
  return `<style data-src="${rel}">\n${safe}${safe.endsWith('\n') ? '' : '\n'}</style>`;
}

// Renders a page. Inlined files go in as placeholders so the whitespace tidy-up only ever touches
// index.html's own markup, never the inlined code.
function render(html, sources, { artifact }) {
  const chunks = [];
  const hold = (s) => `\u0000${chunks.push(s) - 1}\u0000`;
  let page = rewrite(html, (t) => {
    const src = t.attrs?.get('src'), href = t.attrs?.get('href');
    if (t.kind === 'script' && src && !isRemote(src)) {
      const rel = localPath(src);
      if (artifact && rel === THREE_LOCAL) return `<script src="${THREE_CDN}"></script>`;
      return hold(inlineScript(rel, sources.get(rel)));
    }
    if (t.kind === 'link' && isStylesheet(t.attrs) && href && !isRemote(href)) {
      const rel = localPath(href);
      return hold(inlineStyle(rel, sources.get(rel)));
    }
    if (artifact && t.kind === 'wrapper') return REMOVED;
    if (artifact && t.kind === 'meta' && (t.attrs.has('charset') || (t.attrs.get('name') || '').toLowerCase() === 'viewport')) return REMOVED;
    return t.raw;
  });
  if (artifact) {
    page = page.replace(/^[ \t]*(?:\u0001[ \t]*)+\r?\n/gm, '').replaceAll(REMOVED, '').trim() + '\n';
  }
  return page.replace(/\u0000(\d+)\u0000/g, (_, i) => chunks[Number(i)]);
}

const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;

function main() {
  const indexFile = path.join(ROOT, 'index.html');
  if (!fs.existsSync(indexFile)) fail(`index.html not found in ${ROOT}`);
  const html = fs.readFileSync(indexFile, 'utf8');

  const { scripts, styles } = collectRefs(html);
  if (!scripts.includes(THREE_LOCAL)) {
    fail(`index.html no longer loads ${THREE_LOCAL}; update THREE_LOCAL/THREE_CDN in tools/build.mjs`);
  }
  const sources = readSources([...styles, ...scripts]);

  const outputs = [
    ['blockcraft.html', render(html, sources, { artifact: false }), `${scripts.length} scripts + ${styles.length} stylesheet(s) inlined`],
    ['artifact.html', render(html, sources, { artifact: true }), `${scripts.length - 1} scripts inlined, three.js r128 from cdnjs`],
  ];

  fs.mkdirSync(DIST, { recursive: true });
  console.log(`Blockcraft build (${scripts.length} scripts: ${scripts.join(', ')})`);
  for (const [name, text, note] of outputs) {
    fs.writeFileSync(path.join(DIST, name), text);
    const bytes = Buffer.byteLength(text), gz = zlib.gzipSync(text, { level: 9 }).length;
    console.log(`  dist/${name.padEnd(16)} ${kib(bytes).padStart(10)}  (${bytes} bytes, gzip ${kib(gz)})  ${note}`);
  }
}

try {
  main();
} catch (err) {
  if (!(err instanceof BuildError)) throw err;
  console.error(`\nBuild failed: ${err.message}\n`);
  process.exit(1);
}
