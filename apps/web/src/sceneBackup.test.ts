import { describe, expect, it, vi } from 'vitest';
import { deepStrictEqual } from 'node:assert/strict';
import { analyzeStepAssistance, bakeKeyframeSequence, bakeLegacyKeyframeSequence, JOINT_NAMES, lastFrame, makeCountMap, makeKeyframeSequence, makePlan, rotationFromDegrees, sampleTake, setStepAssistance, upsertRootKeyframe, upsertRotationKeyframe, type BakedTake, type Pose } from '../../../packages/core/src';
import { createScene, type SceneDocument } from './scene';
import { decodeSceneBackup, encodeSceneBackup, encodeSceneJsonBackup, SCENE_BACKUP_LIMITS } from './sceneBackup';
import type { SceneProject } from './sceneProject';
import { addFootLock } from '../../../packages/core/src/keyframes';
import { captureFootLock } from '../../../packages/core/src/footLocks';
import { packScene, unpackScene } from './compactScene';

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
  const rawHeader = JSON.parse(new TextDecoder().decode(bytes.slice(prefixLength, prefixLength + headerLength)));
  const header = { ...rawHeader, scene: rawHeader.format === 'choreo-scene-bundle-2' ? unpackScene(rawHeader.scene) : rawHeader.scene };
  return { bytes, magicLength, prefixLength, header, rawHeader, audio: bytes.slice(prefixLength + headerLength) };
}
async function changeHeader(blob: Blob, mutate: (header: Record<string, any>) => void): Promise<Blob> {
  const parts = await bundleParts(blob); mutate(parts.header);
  const rawHeader = { ...parts.header, scene: parts.rawHeader.format === 'choreo-scene-bundle-2' ? packScene(parts.header.scene) : parts.header.scene };
  const header = new TextEncoder().encode(JSON.stringify(rawHeader));
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

function pointFixture(time = .7) {
  const scene = fixture(), original = scene.project.history[0];
  const times = [0, .7, 2.5, original.countMap.durationSeconds];
  const baseTake: BakedTake = {
    ...original.take!, times, poses: times.map((time, index): Pose => ({
      // Historical source coordinates must stay intact even outside today's edit bounds.
      root: index === 0 ? [8, -1, -9] : [time / 80, 1.05, -.1 * index],
      joints: Object.fromEntries(JOINT_NAMES.map((joint, jointIndex) => [joint, rotationFromDegrees([jointIndex + time, time / 2, -time])])) as Pose['joints'],
    })),
  };
  const manual = makeKeyframeSequence(baseTake);
  manual.pointEdits = [{ time, joints: { LeftHandTip: rotationFromDegrees([61, -7, 4]) } }];
  scene.project.history = [
    { ...original, take: baseTake },
    { ...original, title: '微调左手末端', take: bakeKeyframeSequence(manual), manual, operation: { label: '调整左手末端', time, tracks: ['LeftHandTip'] } },
  ];
  scene.project.historyIndex = 1;
  return scene;
}

function frozenPointFixture() {
  const scene = fixture(), previous = scene.project.history[1], frozen = previous.take!;
  // A saved authority can differ by a final floating point bit from this
  // engine's SLERP. Import validates its meaning and must preserve those bits.
  frozen.poses[1].root[0] += 1e-12;
  frozen.poses[1].joints.Head[0] += Number.EPSILON;
  const manual = { ...previous.manual!, pointBaseTake: frozen, pointEdits: [{ time: 1.01, joints: { LeftForeArm: rotationFromDegrees([35, 0, 0]) } }] };
  scene.project.history.push({ ...previous, title: '冻结原动作后微调', manual, take: bakeKeyframeSequence(manual), operation: { label: '调整左肘', time: 1.01, tracks: ['LeftForeArm'] } });
  scene.project.historyIndex = 2;
  scene.project.revision = 3;
  return scene;
}

describe('complete local scene backup', () => {
  it('preserves the frozen saved authority exactly while validating its sparse baseline and permitting only the overlay extra time', async () => {
    const source = frozenPointFixture(), before = structuredClone(source.project), frozen = source.project.history[1].take!;
    for (const file of [legacy(source), encodeSceneJsonBackup(source), await encodeSceneBackup(source)]) {
      const imported = await decodeSceneBackup(file), snapshot = imported.scene.project.history[2];
      expect(imported.scene.project).toEqual({ ...before, teacherCheckedRevision: null });
      expect(snapshot.manual!.pointBaseTake).toEqual(frozen);
      expect(snapshot.take!.times).toEqual([...frozen.times, 1.01].sort((a, b) => a - b));
      frozen.times.forEach((time, index) => expect(snapshot.take!.poses[snapshot.take!.times.indexOf(time)]).toEqual(frozen.poses[index]));
      const again = await decodeSceneBackup(await encodeSceneBackup(imported.scene.audio ? imported.scene : { ...imported.scene, audio: source.audio }));
      expect(again.scene.project.history).toEqual(before.history);
    }
    expect(source.project).toEqual(before);
  });

  it.each([
    ['Root authority', (take: any) => { take.poses[1].root[0] += .01; }],
    ['terminal authority', (take: any) => { take.poses[1].joints.LeftHandTip = rotationFromDegrees([40, 0, 0]); }],
    ['frozen sampling grid', (take: any) => { take.times[1] += .001; }],
  ])('rejects a self-consistent overlay with arbitrary hidden %s', async (_label, mutate) => {
    const source = frozenPointFixture();
    const file = legacy(source, data => {
      const snapshot = data.scene.project.history[2];
      mutate(snapshot.manual.pointBaseTake);
      // The saved output now agrees with the forged frozen take. A check of
      // only the final overlay would therefore miss the altered underlying data.
      snapshot.take = bakeKeyframeSequence(snapshot.manual);
    });
    await expect(decodeSceneBackup(file)).rejects.toThrow(/数据点原动作/);
  });

  it.each([
    ['foreign plan', (take: any) => { take.planId = 'foreign'; }],
    ['foreign count map', (take: any) => { take.countMapId = 'foreign'; }],
    ['changed duration', (take: any) => { take.durationSeconds += .1; }],
    ['unknown frozen field', (take: any) => { take.hidden = true; }],
  ])('rejects %s in a frozen point baseline', async (_label, mutate) => {
    await expect(decodeSceneBackup(legacy(frozenPointFixture(), data => mutate(data.scene.project.history[2].manual.pointBaseTake)))).rejects.toThrow('场景备份无效');
  });

  it('never reuses frozen equivalence merely because later snapshots retain the same IDs', async () => {
    for (const change of ['tracks', 'base'] as const) {
      const source = frozenPointFixture(), previous = source.project.history[2], manual = { ...previous.manual! };
      if (change === 'tracks') manual.rotations = { ...manual.rotations, Head: [{ frame: 90, rotation: rotationFromDegrees([70, -35, 8]) }] };
      else {
        manual.baseTake = structuredClone(manual.baseTake);
        manual.baseTake.poses[0].root[0] += .04;
      }
      source.project.history.push({ ...previous, manual, take: bakeKeyframeSequence(manual) });
      source.project.historyIndex = 3;
      // Frozen identity and manual IDs are shared with the accepted prior
      // snapshot; changed actual source/evaluation inputs still require a check.
      await expect(encodeSceneBackup(source)).rejects.toThrow(/数据点原动作/);
    }
  });

  it('charges one shared frozen authority once at the exact original sample budget and preserves that sharing after decode and re-export', async () => {
    const source = fixture(), previous = source.project.history[0], duration = previous.countMap.durationSeconds;
    const times = Array.from({ length: 6000 }, (_, index) => index === 5999 ? duration : duration * index / 5999);
    const base: BakedTake = { ...previous.take!, times, poses: times.map(() => previous.take!.poses[0]) };
    const manual = makeKeyframeSequence(base);
    manual.pointBaseTake = base;
    manual.pointEdits = [{ time: times[3000], joints: { Head: rotationFromDegrees([15, 0, 0]) } }];
    const take = bakeKeyframeSequence(manual);
    source.project.history = Array.from({ length: 12 }, (_, index) => ({ ...previous, title: `共享原动作 ${index}`, take, manual }));
    source.project.historyIndex = 11; source.project.revision = 12;
    // 12 × (6000 authority + 6000 base) + one 6000 frozen source = 150000.
    const imported = await decodeSceneBackup(await encodeSceneBackup(source));
    const frozen = imported.scene.project.history[0].manual!.pointBaseTake;
    expect(frozen).toBe(imported.scene.project.history[0].manual!.baseTake);
    imported.scene.project.history.forEach(snapshot => expect(snapshot.manual!.pointBaseTake).toBe(frozen));
    deepStrictEqual(imported.scene.project, { ...source.project, teacherCheckedRevision: null });
    // Full graph equality after re-export also guards against losing shared
    // frozen identity and charging twelve extra sources on the next save.
    deepStrictEqual((await decodeSceneBackup(await encodeSceneBackup(imported.scene))).scene.project, imported.scene.project);
    // Independent source objects (as legacy JSON would allocate) cannot reuse
    // the frozen-reference discount merely because their contents are equal.
    const unshared = { ...source, project: { ...source.project, history: source.project.history.map(snapshot => ({ ...snapshot, manual: { ...snapshot.manual!, pointBaseTake: { ...base } } })) } };
    await expect(encodeSceneBackup(unshared)).rejects.toThrow(/样本超出/);
  }, 45_000);

  it('exports twelve incremental snapshots compactly and restores all exact authority and history through both formats', async () => {
    const source = pointFixture(), original = source.project.history[0], current = source.project.history[1];
    source.project.history = [original, ...Array.from({ length: 11 }, (_, index) => {
      const manual = structuredClone(current.manual!);
      manual.pointEdits![0].joints!.LeftHandTip = rotationFromDegrees([40 + index, -7, 4]);
      return { ...current, title: `微调 ${index + 1}`, manual, take: bakeKeyframeSequence(manual) };
    })];
    source.project.historyIndex = 11;
    source.project.revision = 12;
    const before = structuredClone(source.project), compactJson = encodeSceneJsonBackup(source), bundle = await encodeSceneBackup(source);
    const json = JSON.parse(await compactJson.text()), parts = await bundleParts(bundle);
    expect(json.format).toBe('choreo-scene-backup-2');
    expect(parts.rawHeader.format).toBe('choreo-scene-bundle-2');
    expect(parts.rawHeader.scene.schema).toBe('compact-scene-1');
    expect(compactJson.size).toBeLessThan(legacy(source).size / 2);
    for (const file of [compactJson, bundle]) {
      const imported = await decodeSceneBackup(file);
      expect(imported.scene.project).toEqual({ ...before, teacherCheckedRevision: null });
      expect(imported.scene.project.history).toHaveLength(12);
      if (imported.scene.audio) expect(await imported.scene.audio.arrayBuffer()).toEqual(await source.audio!.arrayBuffer());
    }
    expect(source.project).toEqual(before);
  });

  it('continues reading full version-one bundles with ordinary scene payloads', async () => {
    const source = fixture(), parts = await bundleParts(await encodeSceneBackup(source));
    const header = new TextEncoder().encode(JSON.stringify({ ...parts.header, format: 'choreo-scene-bundle-1' }));
    const prefix = parts.bytes.slice(0, parts.prefixLength);
    new DataView(prefix.buffer).setUint32(parts.magicLength, header.byteLength, true);
    const imported = await decodeSceneBackup(new Blob([prefix, header, parts.audio]));
    expect(imported.scene.project.history).toEqual(source.project.history);
    expect(await imported.scene.audio!.arrayBuffer()).toEqual(await source.audio!.arrayBuffer());
  });

  it('roundtrips one selected source channel without losing Root, terminal joints, source times or earlier history', async () => {
    const source = pointFixture(), original = structuredClone(source.project), base = source.project.history[0].take!;
    for (const file of [legacy(source), await encodeSceneBackup(source)]) {
      const imported = await decodeSceneBackup(file);
      expect(imported.scene.project).toEqual({ ...original, teacherCheckedRevision: null });
      const edited = imported.scene.project.history[1];
      expect(edited.manual!.baseTake).toEqual(base);
      expect(edited.manual!.pointEdits).toEqual([{ time: .7, joints: { LeftHandTip: rotationFromDegrees([61, -7, 4]) } }]);
      expect(edited.manual!.root).toEqual([]);
      expect(edited.manual!.rotations).toEqual({});
      expect(edited.take!.times).toEqual(base.times);
      base.times.forEach((time, index) => {
        expect(edited.take!.poses[index].root).toEqual(base.poses[index].root);
        JOINT_NAMES.forEach(joint => {
          if (joint !== 'LeftHandTip' || time !== .7) expect(edited.take!.poses[index].joints[joint]).toEqual(base.poses[index].joints[joint]);
        });
      });
      expect(edited.take!.poses[1].joints.LeftHandTip).toEqual(edited.manual!.pointEdits![0].joints!.LeftHandTip);
      expect(imported.scene.project.history[0]).not.toHaveProperty('operation');
      expect(imported.scene.project.history[0]).not.toHaveProperty('manual');
    }
    expect(source.project).toEqual(original);
  });

  it('preserves an exact off-grid point and only inserts that time without snapping or hiding inherited channel data', async () => {
    const source = pointFixture(1.01), before = structuredClone(source.project), base = source.project.history[0].take!;
    const imported = await decodeSceneBackup(await encodeSceneBackup(source));
    const edited = imported.scene.project.history[1], take = edited.take!;
    expect(edited.manual!.pointEdits![0].time).toBe(1.01);
    expect(take.times).toEqual([0, .7, 1.01, 2.5, base.durationSeconds]);
    const inserted = take.poses[take.times.indexOf(1.01)], inherited = sampleTake(base, 1.01);
    expect(inserted.root).toEqual(inherited.root);
    JOINT_NAMES.forEach(joint => {
      if (joint !== 'LeftHandTip') expect(inserted.joints[joint]).toEqual(inherited.joints[joint]);
    });
    base.times.forEach((time, index) => expect(take.poses[take.times.indexOf(time)]).toEqual(base.poses[index]));
    expect(imported.scene.project).toEqual({ ...before, teacherCheckedRevision: null });
    expect(source.project).toEqual(before);
  });

  it('retains operation metadata per snapshot and keeps old snapshots and optional empty point collections unchanged', async () => {
    const source = fixture();
    source.project.history[1].manual!.pointEdits = [];
    source.project.history[1].operation = { label: '移动整体', time: 3, tracks: ['root', 'Head', 'LeftHandTip'] };
    for (const file of [legacy(source), await encodeSceneBackup(source)]) {
      const imported = await decodeSceneBackup(file);
      expect(imported.scene.project.history).toEqual(source.project.history);
      expect(imported.scene.project.history[0]).not.toHaveProperty('operation');
      expect(imported.scene.project.history[1].manual).toHaveProperty('pointEdits', []);
    }
    const older = fixture();
    const imported = await decodeSceneBackup(await encodeSceneBackup(older));
    expect(imported.scene.project.history[1].manual).not.toHaveProperty('pointEdits');
    expect(imported.scene.project.history[1]).not.toHaveProperty('operation');
  });

  it.each([
    ['unknown field', (point: any) => { point.hidden = true; }],
    ['frame instead of exact time', (point: any) => { delete point.time; point.frame = 21; }],
    ['out-of-scene time', (point: any) => { point.time = -1; }],
    ['empty point', (point: any) => { point.joints = {}; }],
    ['unknown joint', (point: any) => { point.joints.Invented = [0, 0, 0, 1]; }],
    ['nonunit rotation', (point: any) => { point.joints.LeftHandTip = [0, 0, 0, 2]; }],
    ['modified Root outside edit bounds', (point: any) => { point.root = [8, -1, -9]; }],
  ])('rejects point edit %s without silently dropping or repairing the modification', async (_label, mutate) => {
    const source = pointFixture();
    await expect(decodeSceneBackup(legacy(source, data => mutate(data.scene.project.history[1].manual.pointEdits[0])))).rejects.toThrow('场景备份无效');
  });

  it('rejects repeated or unsorted exact points, and counts every selected channel against the combined sparse resource cap', async () => {
    const source = pointFixture();
    for (const mutate of [
      (manual: any) => { manual.pointEdits.push({ ...manual.pointEdits[0] }); },
      (manual: any) => { manual.pointEdits.push({ ...manual.pointEdits[0], time: .5 }); },
      (manual: any) => { manual.pointEdits = Array.from({ length: 164 }, (_, index) => ({ time: index / 30, joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0, 1]])) })); },
    ]) await expect(decodeSceneBackup(legacy(source, data => mutate(data.scene.project.history[1].manual)))).rejects.toThrow('场景备份无效');
  });

  it.each([
    { label: '' }, { label: '错误', time: -1 }, { label: '错误', time: 999 },
    { label: '错误', time: null }, { label: '错误', tracks: ['Invented'] },
    { label: '错误', tracks: ['Head', 'Head'] }, { label: '错误', hidden: true },
  ])('rejects malformed persisted operation metadata %j', async operation => {
    await expect(decodeSceneBackup(legacy(fixture(), data => { data.scene.project.history[1].operation = operation; }))).rejects.toThrow('场景备份无效');
  });

  it('roundtrips independent audio placements in each history without moving CountMap, K or original music', async () => {
    const source = fixture();
    source.project.history[0].audioOffsetSeconds = -1;
    source.project.history[1].audioOffsetSeconds = 31 / 30;
    const original = structuredClone(source.project);
    for (const file of [legacy(source), await encodeSceneBackup(source)]) {
      const imported = await decodeSceneBackup(file);
      expect(imported.scene.project).toEqual({ ...original, teacherCheckedRevision: null });
      expect(imported.scene.project.history[0].audioOffsetSeconds).toBe(-1);
      expect(imported.scene.project.history[1].audioOffsetSeconds).toBe(31 / 30);
      if (imported.scene.audio) expect(await imported.scene.audio.arrayBuffer()).toEqual(await source.audio!.arrayBuffer());
    }
    expect(source.project).toEqual(original);
  });

  it('keeps the omitted offset on old snapshots instead of rewriting historical data', async () => {
    const source = fixture();
    for (const file of [legacy(source), await encodeSceneBackup(source)]) {
      const imported = await decodeSceneBackup(file);
      expect(imported.scene.project.history[0]).not.toHaveProperty('audioOffsetSeconds');
      expect(imported.scene.project.history[1]).not.toHaveProperty('audioOffsetSeconds');
    }
  });

  it.each([null, '1', .01, Infinity, 100, -100])('rejects invalid music placement %s instead of silently moving the clip', async value => {
    const source = fixture();
    const file = legacy(source, data => { data.scene.project.history[1].audioOffsetSeconds = value; });
    await expect(decodeSceneBackup(file)).rejects.toThrow(/音乐轨偏移/);
  });

  it('rejects a shift equal to scene duration and permits the final overlapping snapped frame', async () => {
    const source = fixture(), snapshot = source.project.history[1];
    await expect(decodeSceneBackup(legacy(source, data => { data.scene.project.history[1].audioOffsetSeconds = snapshot.countMap.durationSeconds; }))).rejects.toThrow(/音乐轨偏移/);
    snapshot.audioOffsetSeconds = (Math.ceil(snapshot.countMap.durationSeconds * 30) - 1) / 30;
    const imported = await decodeSceneBackup(await encodeSceneBackup(source));
    expect(imported.scene.project.history[1].audioOffsetSeconds).toBe(snapshot.audioOffsetSeconds);
  });

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
      (data: any) => { data.format = 'choreo-scene-bundle-3'; },
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
