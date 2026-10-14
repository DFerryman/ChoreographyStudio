import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { AI_MOTION_MODEL, AI_MOTION_PROTOCOL, parseAIMotionJson, validateAIMotionOutput, validateAIMotionRequest, validateAIMotionResult,
  type AIMotionRequest, type AIMotionTrustedIdentityOptions } from '../../../packages/core/src/aiMotion';
import { analyzeAIMotionPatch, compileAIMotionPatch, createAIMotionSampler, type AIMotionPatch } from '../../../packages/core/src/aiMotionTrack';
import { CANONICAL_MOTION_FEASIBILITY_PROFILE, getMotionFeasibilitySampleTimes, solveAIMotionFeasibility } from '../../../packages/core/src/motionFeasibility';
import { conditionMotionGroundingCurve } from '../../../packages/core/src/motionGrounding';
import { clonePose, evaluatePose } from '../../../packages/core/src/humanoid';
import { checkAIMotionSourceBoundaries } from '../../../apps/web/src/motionSourcePreflight';
import type { SceneSnapshot } from '../../../apps/web/src/sceneProject';
import { JOINT_NAMES, type Pose } from '../../../packages/core/src/motion-types';
import { DIRECTORY, json, prohibitNetwork, sha, sourceSampler } from './common';

const [style, responseArgument, ...argumentsAfterResponse] = process.argv.slice(2);
if (!['chinese-classical', 'hip-hop', 'ballet'].includes(style ?? '') || !responseArgument) {
  throw new Error('Use: node run.mjs audit <chinese-classical|hip-hop|ballet> <response.json> [httpStatus] [--format=result|output] [--expected-provider=...] [--expected-model=...]');
}
let httpStatusArgument: string | undefined;
const flags = new Map<string, string>();
for (const argument of argumentsAfterResponse) {
  if (!argument.startsWith('--')) {
    if (httpStatusArgument !== undefined) throw new Error('Only one HTTP status is allowed.');
    httpStatusArgument = argument; continue;
  }
  const match = /^--(format|expected-provider|expected-model)=(.+)$/.exec(argument);
  if (!match || flags.has(match[1])) throw new Error('Unknown or repeated audit option.');
  flags.set(match[1], match[2]);
}
const inputFormat = flags.get('format') ?? 'result';
if (inputFormat !== 'result' && inputFormat !== 'output') throw new Error('Unsupported response format.');
const expectedProvider = flags.get('expected-provider'), expectedModel = flags.get('expected-model');
let trustedOptions: AIMotionTrustedIdentityOptions | undefined;
if (expectedProvider !== undefined || expectedModel !== undefined) {
  if (expectedProvider === 'cloudflare-workers-ai' && expectedModel === AI_MOTION_MODEL) {
    trustedOptions = { expectedProvider, expectedModel };
  } else if (expectedProvider === 'codex-session' && expectedModel === 'gpt-6.1-sol') {
    trustedOptions = { expectedProvider, expectedModel };
  } else throw new Error('Explicit expected identity must be a supported provider/model pair; never derive it from the response.');
}
if (inputFormat === 'output' && !trustedOptions) throw new Error('Standalone model output requires explicit trusted provider AND model.');
const network = prohibitNetwork();
const responsePath = await realpath(resolve(responseArgument));
if (!responsePath.startsWith(resolve(DIRECTORY) + sep) || extname(responsePath) !== '.json') {
  throw new Error('Only an API response JSON inside this owned experiment directory may be read.');
}
if ((await stat(responsePath)).size > 1024 * 1024) throw new Error('Response is over the local 1MiB audit file bound; keep the original file.');
const httpStatus = httpStatusArgument === undefined ? null : Number(httpStatusArgument);
if (httpStatus !== null && (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) throw new Error('Invalid HTTP status metadata.');
const out = `${DIRECTORY}/audit-${style}-${Date.now()}`;
await mkdir(out);
const save = (name: string, value: unknown) => writeFile(`${out}/${name}`, json(value), { flag: 'wx' });
const responseBytes = await readFile(responsePath);
await writeFile(`${out}/raw-response.json`, responseBytes, { flag: 'wx' });
const requestBytes = await readFile(`${DIRECTORY}/${style}.request.json`);
const sourceBytes = await readFile(`${DIRECTORY}/owned-source-snapshot.json`);
const source = JSON.parse(sourceBytes.toString('utf8')) as SceneSnapshot;
const beforeSourceHash = sha(sourceBytes);
const receipt: Record<string, unknown> = {
  scope: 'Sparse text-generated motion independently checked by current unchanged production detectors/solver',
  styleRequested: style, httpStatus, responsePath, responseSHA256: sha(responseBytes),
  inputFormat, trustedExpectedIdentity: trustedOptions ?? { expectedProvider: 'cloudflare-workers-ai', expectedModel: AI_MOTION_MODEL },
  identityEvidence: 'Expected identity is supplied by the trusted operator; schema validation itself does not attest model execution. Preserve the actual generation receipt separately.',
  requestSHA256: sha(requestBytes), sourceFileSHA256: beforeSourceHash,
  actualProviderCalls: 0, networkRequests: 0, usesCatalog: false, usesHumanPrior: false,
  styleEvaluation: { status: 'not-assessed', summaryIsStyleEvidence: false, jointJSONIsStyleEvidence: false,
    note: 'Naturalness, style fidelity and semantic intent require separate review of actual motion; this script reports engineering detection only.' },
  sparseCompatibility: null, acceptedByEngineeringGate: false,
};
let stage = 'verify-frozen-inputs';
let raw: AIMotionPatch | undefined;
let lastActualPatch: AIMotionPatch | undefined;
const sampler = sourceSampler(source);

function exactPose(a: Pose, b: Pose): boolean {
  return a.root.every((value, axis) => Object.is(value, b.root[axis])) &&
    JOINT_NAMES.every(joint => a.joints[joint].every((value, axis) => Object.is(value, b.joints[joint][axis])));
}
function patchSampler(patch: AIMotionPatch) {
  return createAIMotionSampler(sampler, { schema: 'ai-motion-track-1', countMapId: source.countMap.id,
    durationSeconds: source.countMap.durationSeconds, patches: [patch] });
}
async function savePoses(name: string, patch: AIMotionPatch): Promise<void> {
  const takeAt = patchSampler(patch), { startSeconds: start, endSeconds: end } = patch.target;
  const times = new Set([start, end, ...patch.knots.map(knot => knot.time)]);
  for (let frame = 0; start + frame / 30 < end; frame++) times.add(start + frame / 30);
  const frames = [...times].sort((a, b) => a - b).map(time => {
    const pose = clonePose(takeAt(time)), fk = evaluatePose(pose);
    return { time, pose, fk,
      frontXY: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [fk[joint].position[0], fk[joint].position[1]]])),
      sideZY: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [fk[joint].position[2], fk[joint].position[1]]])) };
  });
  await save(name, { coordinateSystem: 'right-handed-y-up-z-forward', units: 'meters',
    rotations: 'parent-local-XYZW-quaternions', display: 'canonical25 FK projections, not SOMA77 or skin rendering', frames });
}
async function saveDeviation(name: string, candidate: AIMotionPatch): Promise<void> {
  if (!raw) return;
  const first = patchSampler(raw), second = patchSampler(candidate);
  const times = [...new Set([...getMotionFeasibilitySampleTimes(raw), ...getMotionFeasibilitySampleTimes(candidate)])].sort((a, b) => a - b);
  let maxRootDisplacementMeters = 0, maxJointRotationRadians = 0;
  const differences = times.map(time => {
    const a = first(time), b = second(time);
    const rootDelta = b.root.map((value, axis) => value - a.root[axis]);
    maxRootDisplacementMeters = Math.max(maxRootDisplacementMeters, Math.hypot(...rootDelta));
    const angles = Object.fromEntries(JOINT_NAMES.map(joint => {
      const qa = a.joints[joint], qb = b.joints[joint];
      // Absolute quaternion dot measures an orientation difference, not Euler error.
      const dot = Math.abs(qa.reduce((sum, value, axis) => sum + value * qb[axis], 0) / (Math.hypot(...qa) * Math.hypot(...qb)));
      const angle = 2 * Math.acos(Math.min(1, dot)); maxJointRotationRadians = Math.max(maxJointRotationRadians, angle);
      return [joint, angle];
    }));
    return { time, rootDeltaMeters: rootDelta, jointAngleDifferenceRadians: angles };
  });
  await save(name, { scope: 'actual sampled candidate differences from unmodified compiled model result; no new acceptance threshold',
    maxRootDisplacementMeters, maxJointRotationRadians, differences });
}

try {
  const preparation = JSON.parse(await readFile(`${DIRECTORY}/preparation-receipt.json`, 'utf8')) as {
    sourceFileSHA256: string; requests: { id: string; requestSHA256: string; sourceHash: string }[] };
  const frozen = preparation.requests.find(item => item.id === style);
  if (!frozen || frozen.requestSHA256 !== sha(requestBytes) || preparation.sourceFileSHA256 !== beforeSourceHash) {
    throw new Error('Prepared request/source files changed; stop rather than rebuilding their identity.');
  }
  const request: AIMotionRequest = validateAIMotionRequest(parseAIMotionJson(requestBytes.toString('utf8'), 64 * 1024));
  if (request.context.sourceHash !== frozen.sourceHash) throw new Error('Request source binding changed.');
  receipt.requestId = request.context.requestId; receipt.sourceHash = request.context.sourceHash;
  receipt.target = request.context.target;
  await checkAIMotionSourceBoundaries(request); receipt.sourcePreflight = 'passed';
  stage = 'parse-and-validate-model-result';
  const parsed = parseAIMotionJson(new TextDecoder('utf-8', { fatal: true }).decode(responseBytes));
  const boundInput = inputFormat === 'output'
    ? { ...validateAIMotionOutput(parsed, request.context), protocol: AI_MOTION_PROTOCOL,
      provider: trustedOptions!.expectedProvider, model: trustedOptions!.expectedModel,
      requestId: request.context.requestId, sourceHash: request.context.sourceHash, target: { ...request.context.target } }
    : parsed;
  receipt.resultBindingOrigin = inputFormat === 'output'
    ? 'Local trusted adapter bound standalone model output to the frozen request; this is not a provider-authenticated API envelope.'
    : 'Complete result envelope as received; no model/provider/identity replacement.';
  const result = validateAIMotionResult(boundInput, request, trustedOptions);
  await save('validated-result.json', result);
  stage = 'compile-raw-sparse-curve';
  raw = compileAIMotionPatch(request, result, sampler, trustedOptions);
  if (raw.motionOrigin !== undefined) throw new Error('Sparse model output must not be labelled as a human-motion prior.');
  lastActualPatch = raw;
  const count = raw.knots.length;
  receipt.sparseCompatibility = { internalModelKeyframes: result.keyframes.length, compiledKnots: count,
    requestedInternalKeyframes: [12, 24], minimumGroundingKnots: 3,
    rootLockedNeighbourKnotsEachSide: 3, adjustableRootKnots: Math.max(0, count - 6),
    note: count <= 6 ? 'Unchanged interval grounding locks first/last three knots: no adjustable Root knot. No densification or relaxed gate is applied.'
      : 'Some Root knots are adjustable; this is not evidence of motion feasibility or style quality.' };
  await save('raw-compiled-patch.json', raw);
  await save('raw-quality.json', analyzeAIMotionPatch(raw));
  await savePoses('raw-pose-views.json', raw);
  const options = { sourceSampler: sampler, durationSeconds: source.countMap.durationSeconds,
    profile: CANONICAL_MOTION_FEASIBILITY_PROFILE, diagnostics: true };
  stage = 'raw-independent-detector';
  const rawAudit = await solveAIMotionFeasibility(raw, { ...options, correct: false });
  await save('raw-independent-gate.json', rawAudit);
  receipt.rawEngineeringStatus = rawAudit.report.status;
  stage = 'unchanged-root-conditioning';
  // No fabricated supported/planted contact hints: the sparse protocol supplies none.
  const groundingOptions = { sourceSampler: sampler, durationSeconds: source.countMap.durationSeconds };
  const grounded = await conditionMotionGroundingCurve(raw, groundingOptions);
  lastActualPatch = grounded.patch;
  await save('root-conditioned-patch.json', grounded.patch);
  await save('root-conditioning-report.json', grounded.report);
  await saveDeviation('root-conditioning-differences.json', grounded.patch);
  stage = 'unchanged-feasibility-solver';
  let attempt = 0;
  const solved = await solveAIMotionFeasibility(grounded.patch, { ...options,
    conditionCandidate: async patch => {
      const label = `solver-attempt-${++attempt}`;
      lastActualPatch = patch; await save(`${label}-regularized-patch.json`, patch);
      const conditioned = await conditionMotionGroundingCurve(patch, groundingOptions);
      lastActualPatch = conditioned.patch;
      await save(`${label}-root-conditioned-patch.json`, conditioned.patch);
      await save(`${label}-root-conditioning-report.json`, conditioned.report);
      return conditioned.patch;
    } });
  await save('solver-result.json', solved);
  await save('solver-corrections.json', solved.report.corrections);
  receipt.solverEngineeringStatus = solved.report.status;
  if (solved.patch) {
    lastActualPatch = solved.patch;
    await save('solver-returned-patch.json', solved.patch);
    stage = 'independent-final-detector';
    const final = await solveAIMotionFeasibility(solved.patch, { ...options, correct: false });
    await save('final-independent-gate.json', final);
    receipt.acceptedByEngineeringGate = final.report.status === 'accepted' && final.report.coverage.complete &&
      final.report.derivativeCoverage.complete && final.report.totalViolations === 0;
    receipt.finalCoverage = final.report.coverage; receipt.finalDerivativeCoverage = final.report.derivativeCoverage;
    receipt.finalTotalViolations = final.report.totalViolations;
  } else {
    receipt.rejectedCorrectedPatchAvailable = false;
    receipt.rejectionNote = 'The unchanged solver does not return its final failed patch; only actual captured intermediate attempts are retained, never labelled accepted.';
  }
  stage = 'save-actual-final-or-intermediate-views';
  if (lastActualPatch) {
    await savePoses('last-actual-pose-views.json', lastActualPatch);
    await saveDeviation('last-actual-correction-differences.json', lastActualPatch);
    const effective = patchSampler(lastActualPatch);
    const { startSeconds: start, endSeconds: end } = lastActualPatch.target;
    const outsideTimes = [0, Math.max(0, start - 1e-6), start, end, Math.min(32, end + 1e-6), 32];
    receipt.frozenSourceSamplesExact = outsideTimes.every(time => exactPose(effective(time), sampler(time)));
    if (!receipt.frozenSourceSamplesExact) throw new Error('Actual candidate changed a fixed source endpoint or outside sample.');
  }
  receipt.status = receipt.acceptedByEngineeringGate ? 'engineering-accepted-style-unassessed' : 'engineering-rejected';
} catch (error) {
  receipt.status = 'audit-failed'; receipt.failedStage = stage;
  receipt.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  receipt.networkRequests = network.attempts;
  receipt.sourceFileUnchanged = sha(await readFile(`${DIRECTORY}/owned-source-snapshot.json`)) === beforeSourceHash;
  receipt.sourceObjectUnchanged = sha(json(source)) === beforeSourceHash;
  receipt.rawResponseUnchanged = sha(await readFile(responsePath)) === receipt.responseSHA256;
  if (!receipt.sourceFileUnchanged || !receipt.sourceObjectUnchanged || !receipt.rawResponseUnchanged || network.attempts !== 0) {
    receipt.status = 'audit-failed'; receipt.acceptedByEngineeringGate = false;
    receipt.preservationFailure = 'Frozen input/output preservation or zero-network guard failed.';
    process.exitCode = 1;
  }
  receipt.physicalScope = 'Finite Quaternius proxy/functional geometry, adaptive interpolation and one-sided SO(3) curvature, aggregate forces; no articulated dynamics, continuous skin proof or automatic style acceptance.';
  await save('audit-receipt.json', receipt);
  console.log(JSON.stringify({ output: out, status: receipt.status, acceptedByEngineeringGate: receipt.acceptedByEngineeringGate,
    sourceHash: receipt.sourceHash, responseSHA256: receipt.responseSHA256, networkRequests: receipt.networkRequests,
    sparseCompatibility: receipt.sparseCompatibility, failedStage: receipt.failedStage, error: receipt.error }));
}
