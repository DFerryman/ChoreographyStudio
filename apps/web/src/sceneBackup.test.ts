import { describe, expect, it, vi } from 'vitest';
import { analyzeStepAssistance, bakeKeyframeSequence, bakeLegacyKeyframeSequence, JOINT_NAMES, lastFrame, makeCountMap, makeKeyframeSequence, makePlan, rotationFromDegrees, setStepAssistance, upsertRootKeyframe, upsertRotationKeyframe, type BakedTake, type Pose } from '../../../packages/core/src';
import { createScene, type SceneDocument } from './scene';
import { decodeSceneBackup, encodeSceneBackup, SCENE_BACKUP_LIMITS } from './sceneBackup';
import type { SceneProject } from './sceneProject';
import { addFootLock } from '../../../packages/core/src/keyframes';
import { captureFootLock } from '../../../packages/core/src/footLocks';

// Original nonuniform fixture: a short final 30 Hz interval and animated
// readonly terminals make accidental rebaking, normalization and aliasing visible.
function fixture(): SceneDocument<SceneProject> {
  const countMap = makeCountMap({ bpm: 123, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0.25, startOctet: 1, octetCount: 5, audioDurationSeconds: 40 });
  const plan = makePlan(countMap);
  const times = [...new Set([0, 0.7, 2.5, ...countMap.countTimesSeconds.filter((_, index) => index % 8 === 0)])].sort((a, b) => a - b);
  const poses = times.map((time): Pose => ({
    root: [time / 80, 1.05, 0],
    joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, joint === 'LeftHandTip' ? rotationFromDegrees([time, 0, 0]) : [0, 0, 0, 1]])) as Pose['joints'],
  }));
  const take: BakedTake = { id: 'original-nonuniform', schemaVersion: 'preview-1', planId: plan.id, countMapId: countMap.id, durationSeconds: countMap.durationSeconds, times, poses, provenance: 'synthetic-demo' };
  let manual = makeKeyframeSequence(take);
  manual = upsertRotationKeyframe(manual, 'Head', 90, rotationFromDegrees([15, -35, 8]));
  manual = upsertRootKeyframe(manual, 90, [1.1, 1.05, -0.3]);
  const project: SceneProject = { history: [{ title: '原稿', countMap, plan, take }, { title: '手 K', countMap, plan, take: bakeKeyframeSequence(manual), manual }], historyIndex: 1, revision: 2, audioDuration: 40, teacherCheckedRevision: 2 };
  const scene = createScene({ name: '完整场景', project, audio: new Blob([new Uint8Array([0, 255, 19, 10, 23, 41, 0, 212])], { type: 'audio/wav' }), audioName: 'original.wav' });
  scene.viewer = { ...scene.viewer, view: 'free', camera: { position: [4, 3, -5], target: [1.1, 1.4, -0.3], zoom: 1.2 }, editorMode: 'keyframes', transformTool: 'translate', selectedJoint: 'LeftHandTip', selectedSlot: 1, time: 3, mirror: true, rate: 0.75 };
  return scene;
}
function legacy(scene: SceneDocument<SceneProject>, change?: (data: Record<string, any>) => void): Blob {
  const { audio: _audio, ...document } = scene;
  const data = JSON.parse(JSON.stringify({ format: 'choreo-scene-backup-1', scene: document, audioIncluded: false }));
  change?.(data);
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}
async function bundleParts(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const magicLength = new TextEncoder().encode('CHOREO-BUNDLE-1\n').length;
  const prefixLength = magicLength + 4;
  const headerLength = new DataView(bytes.buffer).getUint32(magicLength, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.slice(prefixLength, prefixLength + headerLength)));
  return { bytes, magicLength, prefixLength, header, audio: bytes.slice(prefixLength + headerLength) };
}
async function changeHeader(blob: Blob, mutate: (header: Record<string, any>) => void): Promise<Blob> {
  const parts = await bundleParts(blob); mutate(parts.header);
  const header = new TextEncoder().encode(JSON.stringify(parts.header));
  const prefix = parts.bytes.slice(0, parts.prefixLength);
  new DataView(prefix.buffer).setUint32(parts.magicLength, header.byteLength, true);
  return new Blob([prefix, header, parts.audio]);
}

function lockedFixture() {
  const scene = fixture();
  const previous = scene.project.history[1];
  const beforeLock = upsertRootKeyframe(previous.manual!, 90, [0.2, 1.05, 0]);
  const lock = captureFootLock(beforeLock.baseTake.poses[0], 'LeftFoot', 0, 150, 3);
  const manual = addFootLock(beforeLock, lock);
  scene.project.history.push({ ...previous, title: '左脚接触', manual, take: bakeKeyframeSequence(manual) });
  scene.project.historyIndex = 2;
  scene.project.revision = 3;
  scene.viewer.transformTool = 'ik';
  scene.viewer.selectedJoint = 'LeftFoot';
  return scene;
}

function stepsFixture() {
  const scene = fixture(), previous = scene.project.history[1];
  const baseTake = { ...previous.manual!.baseTake, poses: previous.manual!.baseTake.poses.map(pose => ({ ...structuredClone(pose), root: [0, 1.05, 0] as Pose['root'] })) };
  let manual = makeKeyframeSequence(baseTake);
  manual = upsertRootKeyframe(manual, 0, [0, 1.05, 0]);
  manual = upsertRootKeyframe(manual, 180, [.2, 1.05, 0]);
  manual = upsertRootKeyframe(manual, 300, [.8, 1.05, 0]);
  // An unusual author's arm pose is independent of the derived leg motion.
  manual = upsertRotationKeyframe(manual, 'LeftUpperArm', 240, rotationFromDegrees([0, 0, 170]));
  manual = addFootLock(manual, captureFootLock(baseTake.poses[0], 'LeftFoot', 0, 90, 3));
  manual = setStepAssistance(manual, 180, lastFrame(baseTake.durationSeconds));
  scene.project.history.push({ ...previous, manual, take: bakeKeyframeSequence(manual), title: '自动步伐' });
  scene.project.historyIndex = 2;
  scene.project.revision = 3;
  return scene;
}

describe('complete local scene backup', () => {
  // Full-history encode/import rechecks derived IK several times. Allow slower
  // CI CPUs to finish all authority comparisons without relaxing assertions.
  it('roundtrips derived stepping, exact authored sparse K, original base, foot locks and earlier history in JSON and full bundles', async () => {
    const source = stepsFixture(), project = structuredClone(source.project);
    const manual = source.project.history[2].manual!;
    expect(analyzeStepAssistance(manual).stepCount).toBeGreaterThan(0);
    for (const file of [legacy(source), await encodeSceneBackup(source)]) {
      const imported = await decodeSceneBackup(file);
      expect(imported.scene.project).toEqual({ ...project, teacherCheckedRevision: null });
      expect(imported.scene.project.history[1].manual).not.toHaveProperty('steps');
      const restored = imported.scene.project.history[2].manual!;
      expect(restored.steps).toEqual({ schema: 'ground-steps-1', startFrame: 180, endFrame: lastFrame(manual.baseTake.durationSeconds) });
      restored.steps!.startFrame = 0;
      restored.root[1].position[0] = 4;
      restored.baseTake.poses[0].root[0] = 4;
      expect(source.project).toEqual(project);
    }
  }, 15_000);

  it.each([
    ['unknown version', (manual: any) => { manual.steps.schema = 'ground-steps-2'; }],
    ['missing end', (manual: any) => { delete manual.steps.endFrame; }],
    ['fractional frame', (manual: any) => { manual.steps.startFrame = .5; }],
    ['negative frame', (manual: any) => { manual.steps.startFrame = -1; }],
    ['reversed interval', (manual: any) => { manual.steps.endFrame = manual.steps.startFrame - 1; }],
    ['empty interval', (manual: any) => { manual.steps.endFrame = manual.steps.startFrame; }],
    ['out of duration', (manual: any) => { manual.steps.endFrame = 10_000; }],
    ['generated poses in configuration', (manual: any) => { manual.steps.poses = []; }],
    ['unversioned author precedence', (manual: any) => { delete manual.authorKeyPriority; }],
  ])('rejects stepping %s rather than silently repairing configuration', async (_label, mutate) => {
    const source = stepsFixture();
    await expect(decodeSceneBackup(legacy(source, data => mutate(data.scene.project.history[2].manual)))).rejects.toThrow('场景备份无效');
  });

  it('rejects a saved animation that ignores active stepping rather than rebaking the imported authority', async () => {
    const source = stepsFixture(), snapshot = source.project.history[2];
    const unassisted = { ...snapshot.manual! };
    delete unassisted.steps;
    const original = structuredClone(source.project);
    const withoutSteps = bakeKeyframeSequence(unassisted);
    expect(withoutSteps.poses).not.toEqual(snapshot.take!.poses);
    await expect(decodeSceneBackup(legacy(source, data => { data.scene.project.history[2].take = withoutSteps; }))).rejects.toThrow('手 K');
    expect(source.project).toEqual(original);
  });

  it('preserves old contact authority and earlier histories through strict full-bundle and JSON validation', async () => {
    const source = lockedFixture(), active = source.project.history[2];
    delete active.manual!.authorKeyPriority;
    active.take = bakeLegacyKeyframeSequence(active.manual!);
    const original = structuredClone(source.project);
    expect(active.take.poses).not.toEqual(bakeKeyframeSequence(active.manual!).poses);
    for (const file of [legacy(source), await encodeSceneBackup(source)]) {
      const imported = await decodeSceneBackup(file);
      expect(imported.scene.project).toEqual({ ...original, teacherCheckedRevision: null });
      expect(imported.scene.project.history[2].manual).not.toHaveProperty('authorKeyPriority');
    }
  });

  it('rejects an old contact output claimed as author-priority and rejects unknown evaluation versions', async () => {
    const source = lockedFixture(), active = source.project.history[2];
    delete active.manual!.authorKeyPriority;
    active.take = bakeLegacyKeyframeSequence(active.manual!);
    active.manual!.authorKeyPriority = 'author-key-priority-1';
    await expect(decodeSceneBackup(legacy(source))).rejects.toThrow(/手 K/);
    const valid = lockedFixture();
    await expect(decodeSceneBackup(legacy(valid, data => { data.scene.project.history[2].manual.authorKeyPriority = 'unknown-version'; }))).rejects.toThrow(/作者关键帧/);
  });

  it('rejects a hybrid take rather than matching new and legacy evaluators pose by pose', async () => {
    const source = lockedFixture(), active = source.project.history[2];
    delete active.manual!.authorKeyPriority;
    const authored = bakeKeyframeSequence(active.manual!), old = bakeLegacyKeyframeSequence(active.manual!);
    const conflicts = old.poses.map((pose, index) => JSON.stringify(pose) !== JSON.stringify(authored.poses[index]) ? index : -1).filter(index => index >= 0);
    expect(conflicts.length).toBeGreaterThan(1);
    active.take = old;
    active.take.poses[conflicts[0]] = structuredClone(authored.poses[conflicts[0]]);
    await expect(decodeSceneBackup(legacy(source))).rejects.toThrow(/手 K/);
  });

  it('roundtrips versioned foot contacts and their exact authority in full bundles and JSON without rewriting earlier history', async () => {
    const source = lockedFixture(), project = structuredClone(source.project);
    for (const file of [legacy(source), await encodeSceneBackup(source)]) {
      const imported = await decodeSceneBackup(file);
      expect(imported.scene.project).toEqual({ ...project, teacherCheckedRevision: null });
      expect(imported.scene.viewer).toEqual(source.viewer);
      expect(imported.scene.project.history[0].take).toEqual(project.history[0].take);
      expect(imported.scene.project.history[1].manual).not.toHaveProperty('footLocks');
      const restoredLock = imported.scene.project.history[2].manual!.footLocks![0];
      restoredLock.target[0] = 7;
      restoredLock.rotation[0] = 0.5;
      expect(source.project).toEqual(project);
    }
  });

  it('preserves an explicit empty contact collection and leaves old sequences without the optional field', async () => {
    const source = fixture();
    source.project.history[1].manual!.footLocks = [];
    const imported = await decodeSceneBackup(await encodeSceneBackup(source));
    expect(imported.scene.project.history[1].manual).toHaveProperty('footLocks', []);
    expect(imported.scene.project.history[0]).not.toHaveProperty('manual');
    const old = fixture();
    const legacyImport = await decodeSceneBackup(await encodeSceneBackup(old));
    expect(legacyImport.scene.project.history[1].manual).not.toHaveProperty('footLocks');
    expect(legacyImport.scene.project.history).toEqual(old.project.history);
  });

  it.each([
    ['unknown contact version', (lock: any) => { lock.schema = 'foot-lock-2'; }],
    ['non-foot endpoint', (lock: any) => { lock.foot = 'LeftHand'; }],
    ['missing anchor', (lock: any) => { delete lock.target; }],
    ['out-of-bounds anchor', (lock: any) => { lock.target[0] = 10.01; }],
    ['nonunit anchor orientation', (lock: any) => { lock.rotation = [0, 0, 0, 2]; }],
    ['fractional start', (lock: any) => { lock.startFrame = 0.5; }],
    ['reversed interval', (lock: any) => { lock.startFrame = lock.endFrame + 1; }],
    ['end outside confirmed duration', (lock: any) => { lock.endFrame = 10_000; }],
    ['excessive blend', (lock: any) => { lock.blendFrames = 16; }],
    ['unknown nested field', (lock: any) => { lock.generatedTarget = [1, 2, 3]; }],
  ])('rejects %s rather than repairing a foot contact during import', async (_label, mutate) => {
    const source = lockedFixture();
    await expect(decodeSceneBackup(legacy(source, data => mutate(data.scene.project.history[2].manual.footLocks[0])))).rejects.toThrow('场景备份无效');
  });

  it('rejects duplicate anchors, overlapping intervals, excessive contacts and an authority that ignores the contact', async () => {
    const source = lockedFixture();
    for (const mutate of [
      (data: any) => { const manual = data.scene.project.history[2].manual; manual.footLocks.push({ ...manual.footLocks[0] }); },
      (data: any) => { const manual = data.scene.project.history[2].manual; manual.footLocks.push({ ...manual.footLocks[0], id: 'overlap', startFrame: 150, endFrame: 180 }); },
      (data: any) => { const manual = data.scene.project.history[2].manual; manual.footLocks = Array.from({ length: 33 }, (_, index) => ({ ...manual.footLocks[0], id: `contact-${index}` })); },
      (data: any) => { data.scene.project.history[2].take.poses[1].root[1] += 0.02; },
      (data: any) => { data.scene.project.history[2].manual.footLocks[0].target[0] += 0.12; },
    ]) await expect(decodeSceneBackup(legacy(source, mutate))).rejects.toThrow('场景备份无效');
  });

  it('roundtrips original audio, exact nonuniform authority, immutable bases, history and saved camera without asserting external review', async () => {
    const original = fixture();
    const copied = structuredClone(original.project);
    const file = await encodeSceneBackup(original);
    const restored = await decodeSceneBackup(file);
    expect(restored.needsAudio).toBe(false);
    expect(restored.scene.id).toBe(original.id); // The import UI assigns the fresh identity.
    expect(restored.scene.project).toEqual({ ...original.project, teacherCheckedRevision: null });
    expect(restored.scene.viewer).toEqual(original.viewer);
    expect(restored.scene.audio?.type).toBe('audio/wav');
    expect(new Uint8Array(await restored.scene.audio!.arrayBuffer())).toEqual(new Uint8Array(await original.audio!.arrayBuffer()));
    expect(restored.scene.project.history[1].take?.times.at(-1)).toBe(original.project.history[1].countMap.durationSeconds);
    restored.scene.project.history[1].manual!.baseTake.poses[0].root[0] = 99;
    restored.scene.viewer.camera!.position[0] = 99;
    expect(original.project).toEqual(copied);
    expect(original.viewer.camera!.position[0]).toBe(4);
  });

  it('writes only persisted fields and omits editor drafts, clipboards and candidates at every supported level', async () => {
    const scene = fixture() as SceneDocument<SceneProject> & Record<string, unknown>;
    scene.poseDraft = { secret: 'draft-only' }; scene.poseClipboard = { secret: 'clipboard-only' };
    Object.assign(scene.project, { candidate: { secret: 'candidate-only' } });
    Object.assign(scene.viewer, { pendingPoseAction: { secret: 'pending-only' } });
    Object.assign(scene.project.history[1].take!, { draftOnly: 'nested-only' });
    const parts = await bundleParts(await encodeSceneBackup(scene));
    expect(JSON.stringify(parts.header)).not.toMatch(/draft-only|clipboard-only|candidate-only|pending-only|nested-only/);
    expect(parts.header.scene).not.toHaveProperty('audio');
    expect(parts.header.audio).toMatchObject({ byteLength: 8, mimeType: 'audio/wav' });
    expect(parts.header.audio.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await decodeSceneBackup(new Blob([parts.bytes]))).scene.project.history).toEqual(parts.header.scene.project.history);
  });

  it('accepts old audio-less JSON, explicitly asks for original music and retains optional old viewer defaults', async () => {
    const original = fixture();
    const file = legacy(original, data => { delete data.scene.viewer.editorMode; delete data.scene.viewer.transformTool; });
    const imported = await decodeSceneBackup(file);
    expect(imported.needsAudio).toBe(true);
    expect(imported.scene.audio).toBeNull();
    expect(imported.scene.audioName).toBe('original.wav');
    expect(imported.scene.viewer).not.toHaveProperty('editorMode');
    expect(imported.scene.project.history).toEqual(original.project.history);
    expect(imported.scene.project.teacherCheckedRevision).toBeNull();
  });

  it('retains finite legacy Root coordinates outside current editing bounds without clamping authority', async () => {
    const scene = fixture(); scene.project.history = [scene.project.history[0]]; scene.project.historyIndex = 0;
    scene.project.history[0].take!.poses[0].root = [8, -1, -9];
    const imported = await decodeSceneBackup(await encodeSceneBackup(scene));
    expect(imported.scene.project.history[0].take!.poses[0].root).toEqual([8, -1, -9]);
  });

  it('restores valid sparse legacy takes exactly without inserting missing octet boundaries or rebaking their plan', async () => {
    const scene = fixture();
    const countMap = makeCountMap({ bpm: 120, musicBeatsPerDanceCount: 1, firstCountSourceSeconds: 0.25, startOctet: 1, octetCount: 4, audioDurationSeconds: 40 });
    const plan = makePlan(countMap), source = scene.project.history[0].take!;
    const take: BakedTake = { ...source, countMapId: countMap.id, planId: plan.id, durationSeconds: 16, times: [0, 0.7, 2.5, 16], poses: [source.poses[0], source.poses[1], source.poses[2], source.poses.at(-1)!] };
    scene.project.history = [{ title: '稀疏旧原稿', countMap, plan, take }]; scene.project.historyIndex = 0;
    const original = structuredClone(take);
    for (const file of [legacy(scene), await encodeSceneBackup(scene)]) {
      const imported = await decodeSceneBackup(file);
      expect(imported.scene.project.history[0].take).toEqual(original);
      expect(imported.scene.project.history[0].take!.times).toEqual([0, 0.7, 2.5, 16]);
      expect(imported.scene.project.history[0].plan).toEqual(plan);
    }
    expect(take).toEqual(original);
  });

  it('accepts safe vendor audio MIME metadata and empty upload types without asserting decodability', async () => {
    for (const mimeType of ['audio/x-m4a', 'audio/mp4a-latm', '']) {
      const scene = fixture(); scene.audio = new Blob([await scene.audio!.arrayBuffer()], { type: mimeType });
      const imported = await decodeSceneBackup(await encodeSceneBackup(scene));
      expect(imported.scene.audio?.type).toBe(mimeType || 'application/octet-stream');
    }
  });

  it('rejects damaged original audio and extra or missing bytes before importing anything', async () => {
    const file = await encodeSceneBackup(fixture());
    const { bytes } = await bundleParts(file); bytes[bytes.length - 1] ^= 1;
    await expect(decodeSceneBackup(new Blob([bytes]))).rejects.toThrow('校验失败');
    await expect(decodeSceneBackup(file.slice(0, file.size - 1))).rejects.toThrow('截断');
    await expect(decodeSceneBackup(new Blob([file, new Uint8Array([1])]))).rejects.toThrow('多余数据');
  });

  it('rejects unsupported bundle versions, unsafe MIME types and forged audio metadata', async () => {
    const file = await encodeSceneBackup(fixture());
    for (const mutate of [
      (data: any) => { data.format = 'choreo-scene-bundle-2'; },
      (data: any) => { data.audio.mimeType = 'text/html'; },
      (data: any) => { data.audio.sha256 = 'g'.repeat(64); },
      (data: any) => { data.audio.byteLength = 0.5; },
      (data: any) => { data.scene.audio = { fabricated: true }; },
    ]) await expect(decodeSceneBackup(await changeHeader(file, mutate))).rejects.toThrow('场景备份无效');
  });

  it('bounds total file and audio sizes before allocating their contents, and bounds header reads by the prefix', async () => {
    class OversizedFile extends Blob { get size() { return 133 * 1024 * 1024; } }
    const huge = new OversizedFile(['unused']); const slice = vi.spyOn(huge, 'slice'); const read = vi.spyOn(huge, 'arrayBuffer');
    await expect(decodeSceneBackup(huge)).rejects.toThrow('大小上限'); expect(slice).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    const file = await encodeSceneBackup(fixture()); const { bytes, magicLength, prefixLength } = await bundleParts(file);
    const prefix = bytes.slice(0, prefixLength); new DataView(prefix.buffer).setUint32(magicLength, SCENE_BACKUP_LIMITS.headerBytes + 1, true);
    const declared = new Blob([prefix, new Uint8Array([0])]); const boundedSlice = vi.spyOn(declared, 'slice');
    await expect(decodeSceneBackup(declared)).rejects.toThrow('文件头长度'); expect(boundedSlice).toHaveBeenCalledTimes(1); expect(boundedSlice).toHaveBeenCalledWith(0, prefixLength);
    const scene = fixture(); scene.audio = huge; await expect(encodeSceneBackup(scene)).rejects.toThrow('100 MiB'); expect(read).not.toHaveBeenCalled();
  });

  it('rejects truncated headers, empty inputs, invalid UTF8 and duplicate or dangerous JSON fields', async () => {
    const file = await encodeSceneBackup(fixture());
    await expect(decodeSceneBackup(file.slice(0, 16))).rejects.toThrow('文件头不完整');
    await expect(decodeSceneBackup(new Blob())).rejects.toThrow('文件为空');
    await expect(decodeSceneBackup(new Blob([new Uint8Array([0xff, 0xfe])]))).rejects.toThrow('UTF-8');
    const json = await legacy(fixture()).text();
    await expect(decodeSceneBackup(new Blob([json.replace('"format":', '"format":"choreo-scene-backup-1","\\u0066ormat":')]))).rejects.toThrow('重复字段');
    await expect(decodeSceneBackup(new Blob([json.replace('"audioIncluded":false', '"audioIncluded":false,"__proto__":{"polluted":true}')]))).rejects.toThrow('危险');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([
    ['source offset outside an eight-count boundary', (data: any) => { data.scene.project.history[0].countMap.sourceOffsetSeconds += 0.2; }],
    ['forged count grid', (data: any) => { data.scene.project.history[0].countMap.countTimesSeconds[2] += 0.1; }],
    ['selection beyond original audio', (data: any) => { data.scene.project.audioDuration = 16; }],
    ['unconfirmed map', (data: any) => { data.scene.project.history[0].countMap.confirmed = false; }],
    ['plan coverage', (data: any) => { data.scene.project.history[0].plan.slots[1].countStart = 8; }],
    ['wrong coordinate system', (data: any) => { data.scene.coordinateSystem.upAxis = '+Z'; }],
    ['untrusted rig', (data: any) => { data.scene.actor.provenance = 'licensed'; }],
    ['unknown persisted state', (data: any) => { data.scene.project.poseDraft = {}; }],
    ['empty camera direction', (data: any) => { data.scene.viewer.camera.position = data.scene.viewer.camera.target; }],
    ['out-of-range viewer', (data: any) => { data.scene.viewer.time = 999; }],
    ['invalid history index', (data: any) => { data.scene.project.historyIndex = 0.5; }],
    ['excessive history', (data: any) => { data.scene.project.history = Array.from({ length: 13 }, () => data.scene.project.history[0]); }],
  ])('rejects %s', async (_label, mutate) => {
    await expect(decodeSceneBackup(legacy(fixture(), mutate))).rejects.toThrow('场景备份无效');
  });

  it.each([
    ['wrong preview protocol', (data: any) => { data.scene.project.history[0].take.schemaVersion = '2.1.0'; }],
    ['duplicate sample times', (data: any) => { data.scene.project.history[0].take.times[1] = 0; }],
    ['missing exact final sample', (data: any) => { data.scene.project.history[0].take.times[data.scene.project.history[0].take.times.length - 1] -= 0.01; }],
    ['missing joint', (data: any) => { delete data.scene.project.history[0].take.poses[0].joints.Head; }],
    ['zero quaternion', (data: any) => { data.scene.project.history[0].take.poses[0].joints.Head = [0, 0, 0, 0]; }],
    ['extra joint', (data: any) => { data.scene.project.history[0].take.poses[0].joints.Invented = [0, 0, 0, 1]; }],
    ['take binding mismatch', (data: any) => { data.scene.project.history[0].take.countMapId = 'foreign'; }],
    ['sample resource excess', (data: any) => { data.scene.project.history[0].take.times = Array.from({ length: 6002 }, (_, i) => i); }],
    ['terminal key', (data: any) => { data.scene.project.history[1].manual.rotations.LeftHandTip = [{ frame: 1, rotation: [0, 0, 0, 1] }]; }],
    ['fractional key', (data: any) => { data.scene.project.history[1].manual.root[0].frame = 90.5; }],
    ['duplicate key', (data: any) => { data.scene.project.history[1].manual.root.push(data.scene.project.history[1].manual.root[0]); }],
    ['key resources', (data: any) => { data.scene.project.history[1].manual.root = Array.from({ length: 4097 }, () => data.scene.project.history[1].manual.root[0]); }],
    ['Root key outside envelope', (data: any) => { data.scene.project.history[1].manual.root[0].position[0] = 6; }],
    ['authority disagrees between keys', (data: any) => { data.scene.project.history[1].take.poses[1].joints.Head = rotationFromDegrees([70, 0, 0]); }],
    ['untouched authority disagrees with base', (data: any) => { data.scene.project.history[1].take.poses[1].joints.LeftHandTip = rotationFromDegrees([70, 0, 0]); }],
  ])('rejects %s rather than repairing or rebaking imported authority', async (_label, mutate) => {
    await expect(decodeSceneBackup(legacy(fixture(), mutate))).rejects.toThrow('场景备份无效');
  });

  it('rejects nonfinite numbers even though native JSON permits exponent overflow', async () => {
    const json = await legacy(fixture()).text();
    await expect(decodeSceneBackup(new Blob([json.replace('"audioDuration":40', '"audioDuration":1e999')]))).rejects.toThrow('有限数字');
  });
});
