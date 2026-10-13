import { describe, expect, it } from 'vitest';
import { AI_MOTION_MAX_KEYFRAMES, AI_MOTION_REQUEST_MAX_BYTES, AI_MOTION_RESULT_MAX_BYTES, aiMotionOutputSchema,
  parseAIMotionJson, validateAIMotionOutput, validateAIMotionRequest, validateAIMotionResult, type AIMotionRequest } from './aiMotion';
import { makeAIMotionFixture, makeAIMotionResultFixture } from './aiMotion.fixture';
import { JOINT_NAMES, type Pose } from './motion-types';

describe('direct structured motion contract (no inference)', () => {
  it('accepts direct sparse bone motion and preserves both input and independent result ownership', () => {
    const request = makeAIMotionFixture(), originalRequest = JSON.stringify(request);
    const response = makeAIMotionResultFixture(request), originalResponse = JSON.stringify(response);
    const parsed = parseAIMotionJson(JSON.stringify(response));
    const result = validateAIMotionResult(parsed, request);
    expect(result.keyframes[0].rotations.LeftUpperArm).toEqual([0, 0, 45]);
    expect(result.keyframes[1].rotations).toEqual({ LeftForeArm: [30, 0, 0] });
    expect(Object.keys(result.keyframes[0])).toEqual(['time', 'root', 'rotations']);
    result.keyframes[0].root[0] = 25;
    result.keyframes[0].rotations.LeftUpperArm![2] = -90;
    const copy = validateAIMotionRequest(request);
    copy.context.before.push({ time: 0, pose: copy.context.initialPose });
    copy.context.skeleton.joints[0].offset[0] = 1;
    expect(JSON.stringify(request)).toBe(originalRequest);
    expect(JSON.stringify(response)).toBe(originalResponse);
  });

  it('keeps interval endpoint ownership out of model output', () => {
    const request = makeAIMotionFixture('interval'), response = makeAIMotionResultFixture(request);
    expect(validateAIMotionResult(response, request).keyframes).toHaveLength(1);
    for (const time of [request.context.target.startSeconds, request.context.target.endSeconds, 0, 32]) {
      expect(() => validateAIMotionResult({ ...response, keyframes: [{ ...response.keyframes[0], time }] }, request)).toThrow();
    }
    expect(() => validateAIMotionResult({ ...response, target: { ...response.target, endSeconds: 9 } }, request)).toThrow(/原稿范围/);
  });

  it.each(['requestId', 'sourceHash', 'model', 'provider', 'protocol'] as const)('rejects changed response binding %s', field => {
    const request = makeAIMotionFixture('interval'), response = makeAIMotionResultFixture(request);
    expect(() => validateAIMotionResult({ ...response, [field]: field === 'sourceHash' ? 'c'.repeat(64) : 'other' }, request)).toThrow();
  });

  it('rejects reordered, duplicate, missing-ending or excessively dense model keys', () => {
    const request = makeAIMotionFixture(), response = makeAIMotionResultFixture(request);
    const invalid = [[], [response.keyframes[0]], response.keyframes.slice().reverse(),
      [response.keyframes[0], { ...response.keyframes[1], time: response.keyframes[0].time }],
      [response.keyframes[0], { ...response.keyframes[1], time: 31.999999 }],
      Array.from({ length: AI_MOTION_MAX_KEYFRAMES + 1 }, (_, index) => ({ ...response.keyframes[0], time: (index + 1) / 2 }))];
    for (const keyframes of invalid) expect(() => validateAIMotionResult({ ...response, keyframes }, request)).toThrow();
  });

  it('requires explicit finite Root and known finite bone rotations without physical projection', () => {
    const request = makeAIMotionFixture('interval'), response = makeAIMotionResultFixture(request);
    const key = response.keyframes[0];
    expect(validateAIMotionResult({ ...response, keyframes: [{ ...key, root: [0, -5, 0], rotations: { LeftLowerLeg: [-270, 360, 0] } }] }, request).keyframes[0]).toMatchObject({ root: [0, -5, 0], rotations: { LeftLowerLeg: [-270, 360, 0] } });
    for (const root of [[NaN, 0, 0], [0, Infinity, 0], [101, 0, 0], [0, 0], new Array(3)]) {
      expect(() => validateAIMotionResult({ ...response, keyframes: [{ ...key, root }] }, request)).toThrow();
    }
    for (const rotations of [{ AlienBone: [0, 0, 0] }, { Head: [0, 361, 0] }, { Head: [0, NaN, 0] }, { Head: [0, 0] }]) {
      expect(() => validateAIMotionResult({ ...response, keyframes: [{ ...key, rotations }] }, request)).toThrow();
    }
    expect(() => validateAIMotionResult({ ...response, keyframes: [{ time: key.time, rotations: {} }] }, request)).toThrow();
  });

  it('rejects a foreign skeleton, missing read-only context and inconsistent fixed boundary', () => {
    for (const mutate of [
      (request: AIMotionRequest) => { request.context.skeleton.joints[0].name = 'AlienBone' as never; },
      (request: AIMotionRequest) => { request.context.skeleton.joints[1].parent = null; },
      (request: AIMotionRequest) => { request.context.skeleton.joints[1].offset[1] += 0.01; },
      (request: AIMotionRequest) => { request.context.skeleton.joints[1].restRotation = [1, 0, 0, 0]; },
      (request: AIMotionRequest) => { request.context.before = []; },
      (request: AIMotionRequest) => { request.context.after[0].time = 7.99; },
      (request: AIMotionRequest) => { request.context.boundaries.start.time += 0.001; },
      (request: AIMotionRequest) => { request.context.initialPose.root[1] += 0.001; },
      (request: AIMotionRequest) => { request.context.boundaries.start.supportConfidence = 0.9; },
    ]) {
      const request = makeAIMotionFixture('interval'); mutate(request);
      expect(() => validateAIMotionRequest(request)).toThrow();
    }
  });

  it('preserves fractional CountMap samples and requires exact whole-selection mapping', () => {
    const request = makeAIMotionFixture();
    const map = request.context.timing, secondsPerCount = 60 / 137;
    map.bpm = 137; map.durationSeconds = map.octetCount * 8 * secondsPerCount;
    map.countTimesSeconds = Array.from({ length: 65 }, (_, index) => index * secondsPerCount);
    request.context.target.endSeconds = map.durationSeconds;
    request.context.boundaries.end.time = map.durationSeconds;
    request.context.audio[0].coverage!.endSeconds = map.durationSeconds;
    const samples = map.countTimesSeconds.slice();
    expect(validateAIMotionRequest(request).context.timing.countTimesSeconds).toEqual(samples);
    map.countTimesSeconds[5] += 0.001;
    expect(() => validateAIMotionRequest(request)).toThrow(/数拍/);
    expect(samples[5]).toBe(5 * secondsPerCount);
  });

  it('maps shifted audio coverage using scene offset and source offset without claiming audio understanding', () => {
    const request = makeAIMotionFixture();
    request.context.audio[0] = { ...request.context.audio[0], durationSeconds: 40, offsetSeconds: -2, sourceOffsetSeconds: 5,
      coverage: { startSeconds: 0, endSeconds: 32 } };
    expect(validateAIMotionRequest(request).context.audio[0].coverage).toEqual({ startSeconds: 0, endSeconds: 32 });
    request.context.audio[0].durationSeconds = 38.99;
    expect(() => validateAIMotionRequest(request)).toThrow(/音频覆盖/);
    request.context.audio[0].durationSeconds = 40;
    expect(() => validateAIMotionRequest({ ...request, context: { ...request.context, audioUnderstanding: true } })).toThrow();
    expect(() => validateAIMotionRequest({ ...request, context: { ...request.context, audioBytes: 'private' } })).toThrow();
  });

  it('keeps optional world-space foot observations read-only and rejects invented malformed data', () => {
    const request = makeAIMotionFixture('interval');
    request.context.boundaries.start.footKinematics = {
      left: { position: [0.1, -0.02, 0.3], velocity: [0, 0.1, 0] },
      right: { position: [-0.1, 0.03, 0.3], velocity: [0.5, 0, 0] },
    };
    const copy = validateAIMotionRequest(request);
    expect(copy.context.boundaries.start.support).toBe('unknown');
    expect(copy.context.boundaries.start.supportConfidence).toBe(0);
    expect(copy.context.boundaries.start.footKinematics).toEqual(request.context.boundaries.start.footKinematics);
    copy.context.boundaries.start.footKinematics!.left.position[1] = 10;
    expect(request.context.boundaries.start.footKinematics.left.position[1]).toBe(-0.02);
    for (const footKinematics of [
      { left: { position: [0, 0, 0], velocity: [0, 0, 0] } },
      { ...request.context.boundaries.start.footKinematics, left: { position: [0, NaN, 0], velocity: [0, 0, 0] } },
      { ...request.context.boundaries.start.footKinematics, collisionCorrection: true },
    ]) expect(() => validateAIMotionRequest({ ...request, context: { ...request.context,
      boundaries: { ...request.context.boundaries, start: { ...request.context.boundaries.start, footKinematics } } } })).toThrow();
  });

  it('rejects non-plain records and accessor properties without evaluating them', () => {
    const request = makeAIMotionFixture(), response = makeAIMotionResultFixture(request);
    expect(() => validateAIMotionRequest(Object.assign(Object.create({ inherited: true }), request))).toThrow();
    let invoked = false;
    const invalid = { ...response };
    Object.defineProperty(invalid, 'summary', { enumerable: true, get() { invoked = true; return 'malicious'; } });
    expect(() => validateAIMotionResult(invalid, request)).toThrow();
    expect(invoked).toBe(false);
    expect(() => validateAIMotionRequest({ ...request, [Symbol('extra')]: true })).toThrow();
    const root = [0, 1, 0];
    Object.defineProperty(root, '1', { get() { invoked = true; return 1; } });
    expect(() => validateAIMotionResult({ ...response, keyframes: [{ ...response.keyframes[0], root }, response.keyframes[1]] }, request)).toThrow();
    expect(invoked).toBe(false);
    const withCustomPrototype = [0, 1, 0];
    Object.setPrototypeOf(withCustomPrototype, Object.create(Array.prototype));
    expect(() => validateAIMotionResult({ ...response, keyframes: [{ ...response.keyframes[0], root: withCustomPrototype }, response.keyframes[1]] }, request)).toThrow();
  });

  it.each([
    '{"summary":"a","summary":"b","keyframes":[]}',
    '{"summary":"a","\\u0073ummary":"b","keyframes":[]}',
    '{"keyframes":[{"rotations":{"__proto__":[0,0,0]}}]}',
    '{"constructor":{}}', '{"prototype":[]}', '{"summary":"a"} trailing',
    '{"summary":}', '{"summary":"unterminated}', '[[[[[[[[[[0]]]]]]]]]]',
  ])('rejects ambiguous or dangerous raw model JSON: %s', source => {
    expect(() => parseAIMotionJson(source)).toThrow();
  });

  it('applies UTF-8 byte budgets to raw data and the complete context, not character counts', () => {
    expect(() => parseAIMotionJson('"' + '舞'.repeat(AI_MOTION_RESULT_MAX_BYTES / 2) + '"')).toThrow(/大小/);
    const request = makeAIMotionFixture('interval');
    const q = [1, 2, 3, 4].map(value => value / Math.sqrt(30));
    const largePose: Pose = { root: [0, 1.05, 0], joints: Object.fromEntries(JOINT_NAMES.map(name => [name, q.slice()])) as Pose['joints'] };
    request.context.before = Array.from({ length: 16 }, (_, index) => ({ time: index / 4, pose: structuredClone(largePose) }));
    request.context.after = Array.from({ length: 16 }, (_, index) => ({ time: 8.25 + index / 4, pose: structuredClone(largePose) }));
    expect(new TextEncoder().encode(JSON.stringify(request)).byteLength).toBeGreaterThan(AI_MOTION_REQUEST_MAX_BYTES);
    expect(() => validateAIMotionRequest(request)).toThrow(/大小/);
    expect(parseAIMotionJson(JSON.stringify(makeAIMotionFixture('interval')), AI_MOTION_REQUEST_MAX_BYTES)).toEqual(makeAIMotionFixture('interval'));
  });

  it('restricts schema to motion fields and known bones, with strict interval time bounds', () => {
    const request = makeAIMotionFixture('interval'), schema = aiMotionOutputSchema(request.context);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toEqual(['summary', 'keyframes']);
    expect(schema.properties.keyframes.items.properties.time).toEqual({ type: 'number', exclusiveMinimum: 4, exclusiveMaximum: 8 });
    expect(Object.keys(schema.properties.keyframes.items.properties.rotations.properties)).toEqual(JOINT_NAMES);
    expect(schema.properties.keyframes.items.properties.rotations.additionalProperties).toBe(false);
    expect(schema.properties.keyframes.maxItems).toBe(AI_MOTION_MAX_KEYFRAMES);
    const output = makeAIMotionResultFixture(request);
    expect(validateAIMotionOutput({ summary: output.summary, keyframes: output.keyframes }, request.context)).toMatchObject({ keyframes: output.keyframes });
    expect(() => validateAIMotionOutput(output, request.context)).toThrow();
  });
});
