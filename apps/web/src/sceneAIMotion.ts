import { validateAIMotionTrack } from '../../../packages/core/src/aiMotionTrack';
import { sampleTake } from '../../../packages/core/src';

/** Validate new layers without touching any legacy scene or take data. */
export function validateProjectAIMotionTracks(value: unknown, validateSource = true): void {
  // Storage also supports generic historical payloads without editor history.
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('history' in value) || !Array.isArray(value.history)) return;
  for (const snapshot of value.history) {
    if (!snapshot || typeof snapshot !== 'object' || !Object.hasOwn(snapshot, 'aiMotion')) continue;
    if (value.history.length > 12) throw new Error('AI 动作的历史数量超出范围。');
    const map = snapshot.countMap;
    if (!map || typeof map.id !== 'string' || typeof map.durationSeconds !== 'number' || !snapshot.take) throw new Error('AI 动作缺少原始动作或数拍。');
    // Compact preflight sees bounded $take references. Verify their seams only
    // after the ordinary take table has been fully and safely expanded.
    validateAIMotionTrack(snapshot.aiMotion, map, validateSource ? time => sampleTake(snapshot.take, time) : undefined);
  }
}
