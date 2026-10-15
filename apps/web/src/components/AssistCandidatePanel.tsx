import type { AIMotionTarget } from '../../../../packages/core/src/aiMotion';
import { AI_MOTION_STATIC_WARNING, type AIMotionQuality } from '../../../../packages/core/src/aiMotionTrack';
import type { MotionFeasibilityReport } from '../../../../packages/core/src/motionFeasibility';

/** An AI candidate is previewed and adopted explicitly; the original stays authoritative until then. */
export function AssistCandidatePanel({ summary, target, quality, feasibility, planSource, fallbackReason, intensity, inPlace, moves, previewing, valid, onTogglePreview, onAdopt, onClose }: {
  summary: string; target: AIMotionTarget; quality?: AIMotionQuality; feasibility?: MotionFeasibilityReport;
  planSource: 'ai' | 'local'; fallbackReason?: string; intensity: number; inPlace?: boolean; moves: readonly string[]; previewing: boolean; valid: boolean;
  onTogglePreview: () => void; onAdopt: () => void; onClose: () => void;
}) {
  return <section className="assist-candidate" aria-label="AI candidate">
    <div className="assist-candidate-copy">
      <div className="assist-candidate-heading">
        <strong>AI dance candidate</strong>
        <small aria-label="Candidate target range">{target.mode === 'interval'
          ? `Replaces only ${Number(target.startSeconds.toFixed(2))}–${Number(target.endSeconds.toFixed(2))} s; both ends and everything outside stay.`
          : `Replaces the whole 0–${Number(target.endSeconds.toFixed(2))} s of character motion.`} Undo restores the original.</small>
      </div>
      <p className="assist-candidate-summary" title={summary}>{summary}</p>
      {planSource === 'local' && <p className="assist-candidate-warning" role="status" aria-label="Plan source">
        {fallbackReason ? `${fallbackReason}; ` : ''}this dance was composed locally from your description.
      </p>}
      {feasibility && <small aria-label="Motion constraint check" data-feasibility-status={feasibility.status} data-feasibility-profile={feasibility.profileId}>
        Footwork and foot contact, joint ranges, body collisions and support forces passed the simplified model check. Please preview it.
      </small>}
      <details className="assist-candidate-details">
        <summary>Structure and check scope{intensity < 1 && ` · amplitude ${Math.round(intensity * 100)}%`}</summary>
        {!!moves.length && <small aria-label="Dance structure">Phrases: {moves.join(', ')}.</small>}
        {inPlace && <small aria-label="Footwork in place">The planned steps and turns could not be fitted between the fixed ends, so the poses are danced in place.</small>}
        {intensity < 1 && <small aria-label="Amplitude reduction">To satisfy the joint and force limits, amplitude was reduced to about {Math.round(intensity * 100)}%.</small>}
        {!!feasibility?.inheritedBoundaryIssues && <small aria-label="Inherited endpoint issues">The original motion at the range ends is itself outside the body envelope or intersecting; only near those ends are such existing issues tolerated, never beyond their original amount.</small>}
        {feasibility && <small aria-label="Check scope">The check uses a simplified body model of the default character; it is not a full strength or joint-dynamics validation.</small>}
      </details>
      {quality?.warnings.includes(AI_MOTION_STATIC_WARNING) && <p className="assist-candidate-warning" role="status">{AI_MOTION_STATIC_WARNING}</p>}
      {quality?.warnings.some(warning => warning !== AI_MOTION_STATIC_WARNING) && <p className="assist-candidate-warning" role="status">The candidate contains sharp movement or turns; preview it before adopting.</p>}
      {!valid && <small role="status">The work has changed; generate a new candidate.</small>}
    </div>
    <div className="assist-actions">
      <button className="button secondary compact" onClick={onTogglePreview}>{previewing ? 'Back to original' : 'Preview candidate'}</button>
      <button className="button primary compact" disabled={!valid} onClick={onAdopt}>Adopt candidate</button>
      <button className="text-button" onClick={onClose}>Close candidate</button>
    </div>
  </section>;
}
