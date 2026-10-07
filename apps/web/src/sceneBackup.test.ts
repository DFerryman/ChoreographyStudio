import { describe, expect, it, vi } from 'vitest';
import { bakeKeyframeSequence, JOINT_NAMES, makeCountMap, makeKeyframeSequence, makePlan, rotationFromDegrees, upsertRootKeyframe, upsertRotationKeyframe, type BakedTake, type Pose } from '../../../packages/core/src';
import { createScene, type SceneDocument } from './scene';
import { decodeSceneBackup, encodeSceneBackup, SCENE_BACKUP_LIMITS } from './sceneBackup';
import type { SceneProject } from './sceneProject';

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

describe('complete local scene backup', () => {
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
