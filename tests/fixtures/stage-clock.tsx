import { createRoot } from 'react-dom/client';
import { JOINT_NAMES, type BakedTake, type Pose } from '../../packages/core/src';
import { Stage } from '../../apps/web/src/Stage';

// Fixed React inputs expose the regression even when the browser only draws
// at 30 Hz: later frames must read the clock rather than wait for a prop update.
const pose = (x: number): Pose => ({
  root: [x, 1.05, 0],
  joints: Object.fromEntries(JOINT_NAMES.map(joint => [joint, [0, 0, 0, 1]])) as Pose['joints'],
});
const take: BakedTake = {
  id: 'stage-clock-fixture', schemaVersion: 'preview-1',
  planId: 'stage-clock-fixture-plan', countMapId: 'stage-clock-fixture-count-map',
  durationSeconds: 60, times: [0, 60], poses: [pose(0), pose(12)], provenance: 'synthetic-demo',
};
const container = document.getElementById('stage-clock-fixture')!;
const original = JSON.stringify(take);
container.dataset.inputTake = original;
const anchor = performance.now();
const getPlaybackTime = () => Math.min(take.durationSeconds, (performance.now() - anchor) / 1000);

// No state setters, audio, scene storage or external APIs are involved.
createRoot(container).render(
  <Stage take={take} time={0} getPlaybackTime={getPlaybackTime} playing
    view="front" mirror={false} selectedJoint={null} jointPicking={false} editMode={false} />,
);

// The browser test can compare the source after several real draw frames.
Object.defineProperty(window, 'stageClockFixture', { value: { take, inputTime: 0 }, writable: false });
