#!/usr/bin/env node
/**
 * Prepare an embedded-assets fallback when the connected API cannot send an
 * asset-upload JWT. Normal authenticated deployments still use Wrangler and
 * Workers Static Assets. This command makes no network requests or deployment.
 * Generated modules and multipart payloads must remain outside the repository.
 *
 * Usage:
 *   node infra/prepare-inline-preview.mjs dist /tmp/choreo-worker/index.js /tmp/choreo-inline
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { readWorkerConfig, workerMetadata } from './worker-metadata.mjs';

const [assetsArgument, workerArgument, outputArgument, ...extra] = process.argv.slice(2);
if (!assetsArgument || !workerArgument || !outputArgument || extra.length) {
  throw new Error('Usage: node infra/prepare-inline-preview.mjs <assets-dir> <worker-js> <output-prefix>');
}
const assetRoot = resolve(assetsArgument);
const outputPrefix = resolve(outputArgument);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};
const assets = {};
const assetSummary = [];
let headerSource = '';

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) { await collect(path); continue; }
    if (!entry.isFile()) throw new Error(`Unsupported build entry: ${path}`);
    const route = '/' + relative(assetRoot, path).split(sep).join('/');
    const content = await readFile(path);
    if (route === '/_headers') { headerSource = content.toString('utf8'); continue; }
    if (route === '/_redirects') {
      if (content.toString('utf8').split(/\r?\n/).some(line => line.trim() && !line.trim().startsWith('#'))) {
        throw new Error('The inline fallback does not implement _redirects; use Workers Static Assets.');
      }
      continue;
    }
    const gzip = gzipSync(content, { level: 9 });
    const sha256 = createHash('sha256').update(content).digest('hex');
    assets[route] = {
      type: mimeTypes[extname(path).toLowerCase()] || 'application/octet-stream',
      gzip: gzip.toString('base64'), sha256,
    };
    assetSummary.push({ file: route.slice(1), bytes: content.byteLength, gzipBytes: gzip.byteLength, sha256 });
  }
}

// _headers currently uses path rules. Reject unsupported syntax explicitly so
// future configuration cannot silently lose headers in this fallback.
function parseHeaders(source) {
  const rules = [];
  let current;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      if (!line.startsWith('/') || line.includes(':')) {
        throw new Error(`Unsupported _headers pattern in inline fallback: ${line}`);
      }
      const pattern = '^' + line.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$';
      current = { pattern, headers: {}, remove: [] };
      rules.push(current);
      continue;
    }
    if (!current) throw new Error('_headers entry requires a path rule');
    const removal = /^!\s*([!#$%&'*+.^_`|~0-9a-z-]+)$/i.exec(line);
    if (removal) { current.remove.push(removal[1].toLowerCase()); continue; }
    const entry = /^([!#$%&'*+.^_`|~0-9a-z-]+):\s*(.*)$/i.exec(line);
    if (!entry) throw new Error(`Invalid _headers entry: ${line}`);
    current.headers[entry[1].toLowerCase()] = entry[2];
  }
  return rules;
}

const config = await readWorkerConfig();
const binding = config.assets?.binding;
if (!/^[A-Za-z_$][\w$]*$/.test(binding || '')) throw new Error('Wrangler assets.binding is required');
if (config.assets.not_found_handling !== 'single-page-application') throw new Error('Inline preview expects SPA asset routing');
await collect(assetRoot);
if (!assets['/index.html']) throw new Error('Build must contain index.html');
const headerRules = parseHeaders(headerSource);
const worker = await readFile(resolve(workerArgument), 'utf8');
// Preserve the bundled handler's function body and exports; supply only a local
// fetch-compatible assets binding. A changed bundle shape fails for review.
const exportPattern = /export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+default\s*\}\s*;?/g;
const exports = [...worker.matchAll(exportPattern)];
if (exports.length !== 1) throw new Error('Expected one bundled ES-module default export');
const handler = exports[0][1];
const original = worker.replace(exportPattern, '').replace(/^\/\/# sourceMappingURL=.*$/gm, '');
const staticModule = `
const INLINE_PREVIEW_ASSETS = ${JSON.stringify(assets)};
const INLINE_PREVIEW_HEADER_RULES = ${JSON.stringify(headerRules)}.map(rule => ({ ...rule, pattern: new RegExp(rule.pattern) }));
const inlinePreviewCompressedBytes = new Map();
function inlinePreviewGzipBytes(path) {
  if (!inlinePreviewCompressedBytes.has(path)) {
    const binary = atob(INLINE_PREVIEW_ASSETS[path].gzip);
    inlinePreviewCompressedBytes.set(path, Uint8Array.from(binary, char => char.charCodeAt(0)));
  }
  return inlinePreviewCompressedBytes.get(path);
}
function inlinePreviewHeaders(path, values) {
  const headers = new Headers(values);
  for (const rule of INLINE_PREVIEW_HEADER_RULES) {
    if (!rule.pattern.test(path)) continue;
    for (const name of rule.remove) headers.delete(name);
    for (const [name, value] of Object.entries(rule.headers)) headers.set(name, value);
  }
  return headers;
}
function inlinePreviewEncoding(value) {
  const encodings = value.split(',').map(part => {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    const quality = params.find(param => param.trim().startsWith('q='));
    return [name, quality === undefined ? 1 : Number(quality.trim().slice(2))];
  });
  const explicit = encodings.find(([name]) => name === 'gzip');
  if (explicit ? explicit[1] > 0 : encodings.some(([name, q]) => name === '*' && q > 0)) return 'gzip';
  const identity = encodings.find(([name]) => name === 'identity');
  if (identity ? identity[1] <= 0 : encodings.some(([name, q]) => name === '*' && q === 0)) return null;
  return 'identity';
}
async function serveInlinePreviewStatic(request) {
  const method = request.method;
  const requestPath = new URL(request.url).pathname;
  if (method !== 'GET' && method !== 'HEAD') return new Response('Method Not Allowed', {
    status: 405, headers: inlinePreviewHeaders(requestPath, { 'content-type': 'text/plain; charset=utf-8', 'allow': 'GET, HEAD', 'cache-control': 'no-store' })
  });
  let path = requestPath === '/' ? '/index.html' : requestPath;
  if (!Object.hasOwn(INLINE_PREVIEW_ASSETS, path)) {
    if (path.startsWith('/assets/') || /\\.[^/]+$/.test(path)) return new Response(method === 'HEAD' ? null : 'Not Found', {
      status: 404, headers: inlinePreviewHeaders(requestPath, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    });
    path = '/index.html';
  }
  const asset = INLINE_PREVIEW_ASSETS[path];
  const headers = inlinePreviewHeaders(requestPath, {
    'content-type': asset.type,
    'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : path === '/index.html' ? 'no-cache' : 'public, max-age=3600',
    'vary': 'Accept-Encoding',
    'etag': 'W/"' + asset.sha256 + '"'
  });
  const vary = headers.get('vary');
  if (vary !== '*' && !vary?.split(',').some(value => value.trim().toLowerCase() === 'accept-encoding')) {
    headers.set('vary', vary ? vary + ', Accept-Encoding' : 'Accept-Encoding');
  }
  const encoding = inlinePreviewEncoding(request.headers.get('accept-encoding') || '');
  if (!encoding) {
    headers.set('content-type', 'text/plain; charset=utf-8');
    headers.set('cache-control', 'no-store');
    headers.delete('etag');
    headers.delete('content-encoding');
    return new Response(method === 'HEAD' ? null : 'Not Acceptable', { status: 406, headers });
  }
  if (encoding === 'gzip') headers.set('content-encoding', 'gzip');
  const noneMatch = request.headers.get('if-none-match');
  const etag = headers.get('etag');
  if (noneMatch && etag && noneMatch.split(',').some(tag => tag.trim() === '*' || tag.trim().replace(/^W\\//, '') === etag.replace(/^W\\//, ''))) {
    return new Response(null, { status: 304, headers });
  }
  if (method === 'HEAD') return new Response(null, { headers });
  const bytes = inlinePreviewGzipBytes(path);
  if (encoding === 'gzip') return new Response(bytes, { headers, encodeBody: 'manual' });
  return new Response(new Response(bytes).body.pipeThrough(new DecompressionStream('gzip')), { headers });
}
`;
const wrapper = `
export default {
  ...${handler},
  fetch(request, env, ctx) {
    return ${handler}.fetch(request, { ...env, ${JSON.stringify(binding)}: { fetch: serveInlinePreviewStatic } }, ctx);
  }
};
`;
const module = staticModule + '\n' + original + '\n' + wrapper;
const metadata = workerMetadata(config);
const moduleSha256 = createHash('sha256').update(module).digest('hex');
const boundary = 'choreo-inline-' + moduleSha256.slice(0, 24);
const multipart = [
  '--' + boundary, 'Content-Disposition: form-data; name="metadata"',
  'Content-Type: application/json', '', JSON.stringify(metadata),
  '--' + boundary, 'Content-Disposition: form-data; name="index.js"; filename="index.js"',
  'Content-Type: application/javascript+module', '', module, '--' + boundary + '--', '',
].join('\r\n');
const summary = {
  workerName: config.name, moduleBytes: Buffer.byteLength(module), moduleSha256,
  multipartBytes: Buffer.byteLength(multipart), boundary,
  headerRules: headerRules.length, assets: assetSummary,
};
await writeFile(outputPrefix + '.mjs', module);
await writeFile(outputPrefix + '-metadata.json', JSON.stringify(metadata, null, 2));
await writeFile(outputPrefix + '-multipart.txt', multipart);
await writeFile(outputPrefix + '-summary.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ outputPrefix, ...summary }));
