/** Offline replay of frozen owned text outputs; never calls a model or writes this archive. */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const options = process.argv.slice(2);
if (options.some(option => option !== '--render') || new Set(options).size !== options.length) {
  throw new Error('Use: node replay-analysis.mjs [--render]');
}
const archive = dirname(fileURLToPath(import.meta.url));
const repository = resolve(archive, '../../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(resolve(archive, 'manifest.json'), 'utf8'));
for (const file of manifest.files) {
  const path = resolve(archive, file.path);
  if (!path.startsWith(archive + sep) || sha(await readFile(path)) !== file.sha256) {
    throw new Error(`Archive byte identity changed: ${file.path}`);
  }
}
for (const file of manifest.replaySourceFiles) {
  const path = resolve(repository, file.path);
  if (!path.startsWith(repository + sep) || sha(await readFile(path)) !== file.sha256) {
    throw new Error(`Recorded repository source changed; use the recorded version: ${file.path}`);
  }
}
// Exactly three directories below the repository, matching the preserved TS import depth.
const scratch = resolve(repository, 'work/evidence-replay', `text-motion-${Date.now()}`);
await mkdir(scratch, { recursive: true });
for (const name of ['common.ts', 'audit.ts', 'run.mjs']) {
  await copyFile(resolve(archive, 'methods', name), resolve(scratch, name));
}
for (const name of ['owned-source-snapshot.json', 'preparation-receipt.json',
  'chinese-classical.request.json', 'hip-hop.request.json', 'ballet.request.json']) {
  await copyFile(resolve(archive, 'fixture', name), resolve(scratch, name));
}
function run(command, argumentsForCommand) {
  const result = spawnSync(command, argumentsForCommand, { cwd: repository, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}; actual replay artifacts remain in ${scratch}`);
}
for (const style of ['chinese-classical', 'hip-hop', 'ballet']) {
  const raw = resolve(scratch, `${style}.raw.json`);
  await copyFile(resolve(archive, 'author', `${style}.raw.json`), raw);
  run(process.execPath, [resolve(scratch, 'run.mjs'), 'audit', style, raw,
    '--format=output', '--expected-provider=codex-session', '--expected-model=gpt-6.1-sol']);
  if (options.includes('--render')) {
    const audits = (await readdir(scratch)).filter(name => name.startsWith(`audit-${style}-`));
    if (audits.length !== 1) throw new Error(`Unexpected replay audit count for ${style}`);
    run('python', [resolve(archive, 'methods/render_text_motion.py'), '--style', style,
      '--audit-dir', resolve(scratch, audits[0]), '--request', resolve(scratch, `${style}.request.json`),
      '--output-dir', resolve(scratch, 'visuals', style)]);
  }
}
console.log(JSON.stringify({ scope: 'offline local replay, not model generation or browser replay', scratch,
  providerCalls: 0, archiveUnmodified: true, originalRawOutputsUnmodified: true }));
