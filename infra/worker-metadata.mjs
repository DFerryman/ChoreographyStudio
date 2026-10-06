import { readFile } from 'node:fs/promises';

export async function readWorkerConfig() {
  const source = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const noComments = source.replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, token => token.startsWith('"') ? token : '');
  return JSON.parse(noComments.replace(/"(?:\\.|[^"\\])*"|,\s*(?=[}\]])/g, token => token.startsWith('"') ? token : ''));
}

// Both upload paths must preserve the API guard declared by Wrangler. Rate
// limiting uses Cloudflare's binding; it needs no D1, KV or Durable Object.
export function workerMetadata(config, mainModule = 'index.js') {
  return {
    main_module: mainModule,
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags || [],
    bindings: [
      ...Object.entries(config.vars || {}).map(([name, value]) => ({ type: 'plain_text', name, text: typeof value === 'string' ? value : JSON.stringify(value) })),
      ...(config.ratelimits || []).map(({ name, namespace_id, simple }) => ({ type: 'ratelimit', name, namespace_id, simple })),
    ],
    ...(config.observability ? { observability: config.observability } : {}),
  };
}
