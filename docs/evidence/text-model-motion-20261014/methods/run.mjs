import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const [operation, ...argumentsForOperation] = process.argv.slice(2);
if (!['prepare', 'audit'].includes(operation)) throw new Error('Use: node run.mjs prepare | audit <style-id> <api-response.json>');
const directory = fileURLToPath(new URL('.', import.meta.url));
const output = `${directory}/_${operation}.mjs`;
await build({ entryPoints: [`${directory}/${operation}.ts`], bundle: true, platform: 'node',
  format: 'esm', packages: 'external', target: 'node24', outfile: output, logLevel: 'error' });
process.argv = [process.argv[0], output, ...argumentsForOperation];
await import(new URL(`./_${operation}.mjs?run=${Date.now()}`, import.meta.url));
