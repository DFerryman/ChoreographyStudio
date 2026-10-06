#!/usr/bin/env node
/**
 * Prepare a Cloudflare Workers Static Assets upload from a verified build.
 * This performs no network requests, stores no credentials, and does not deploy.
 * The normal deployment path remains `npm run deploy` with Wrangler credentials.
 *
 * Usage:
 *   node infra/prepare-preview.mjs dist /tmp/choreo-worker/index.js /tmp/choreo-preview.json
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

const [assetsArgument, workerArgument, outputArgument] = process.argv.slice(2);
if (!assetsArgument || !workerArgument || !outputArgument) {
  throw new Error('Usage: node infra/prepare-preview.mjs <assets-dir> <worker-js> <output-json>');
}
const assetRoot = resolve(assetsArgument);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};
const manifest = {};
const assets = {};

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(fullPath);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Unsupported build entry: ${fullPath}`);
    const route = '/' + relative(assetRoot, fullPath).split(sep).join('/');
    const content = await readFile(fullPath);
    // Follow the direct-upload example: include extension so equal bytes with
    // different MIME types are registered as distinct assets.
    const hash = createHash('sha256')
      .update(content.toString('base64') + extname(fullPath).slice(1))
      .digest('hex')
      .slice(0, 32);
    manifest[route] = { hash, size: content.byteLength };
    assets[hash] = {
      contentType: mimeTypes[extname(fullPath)] || 'application/octet-stream',
      contentBase64: content.toString('base64'),
    };
  }
}

await collect(assetRoot);
if (!manifest['/index.html']) throw new Error('Build must contain index.html');
const worker = await readFile(resolve(workerArgument), 'utf8');
if (!worker.includes('fetch')) throw new Error('Expected a bundled Worker fetch handler');
const prepared = {
  workerName: 'choreo-studio-preview',
  compatibilityDate: '2026-10-06',
  manifest,
  assets,
  worker,
};
await writeFile(resolve(outputArgument), JSON.stringify(prepared));
console.log(JSON.stringify({
  output: resolve(outputArgument),
  files: Object.keys(manifest).length,
  assetBytes: Object.values(manifest).reduce((sum, entry) => sum + entry.size, 0),
  workerBytes: Buffer.byteLength(worker),
}));
