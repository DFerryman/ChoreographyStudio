# AI choreography core

## 2026-10-15 (revision 2) · AI-authored keyposes (`ai-dance-plan-3`, `dance-synth-2`)

User feedback on the previous core: generation either timed out or kept producing the same set of movements, so it could not create new movements or poses. Both were structural:

- **Same movements.** The model could only choose from 19 fixed procedural moves (and the earlier pipeline only from two motion-capture sources). The local fallback was seeded by the description text, so the same description always produced the same dance.
- **Timeouts.** A failed gate attempt also ran the gate's three correction passes (each a full inspection), up to five attempts; the planner had a 30 s server timeout and no client deadline; the whole operation was capped at 120 s.

### What the model now does

The model composes the choreography itself. It returns up to four phrases of eight keyposes (one pose per count) plus the order in which phrases, or their mirror images, are danced. A pose is a handful of bounded integers with anatomical meaning, plus one footwork step:

| Field | Meaning |
| --- | --- |
| `arms` | left raise 0..10, left direction -2..10, left elbow 0..10, then the same for the right arm (0 = hanging, 5 = shoulder height, 10 = overhead; direction 0 = to the side, 10 = forward) |
| `torso` | lean -5..5, side tilt -5..5, twist -5..5 |
| `head` | nod -5..5, turn -5..5 |
| `hips` | sway -5..5, knee level 0..10 (0 standing tall, 10 deep bend) |
| `step` | `none`, `L-side`, `R-side`, `L-front`, `R-front`, `L-back`, `R-back`, `together`, `travel-L`, `travel-R`, `turn-L`, `turn-R` |

Every value on these scales maps inside the rig's joint envelope, so any pose the model invents is meaningful. Values outside a scale are clamped and malformed items dropped; a plan is never rejected as a whole. The request still contains only the description and coarse beat framing. The planner prompt, schema, summaries, keyword tables and all dance-pipeline messages are English only.

Model: Workers AI `@cf/openai/gpt-oss-120b` (since revision 2.1; native50 used `gpt-oss-20b`, see below), temperature 0.9, a random variation number per request, `max_tokens` 8192, non-strict JSON schema, compact single-line JSON requested, one call, no retries.

**Revision 2.1 (planner reply fix).** On native50 every real request fell back with "the AI plan was unusable". No production log was available in that session, so the exact reply is unknown. It differed from the call already verified on this account (gpt-oss-120b for motion) in three ways: an untested model (20b), a 3072-token budget that the model's reasoning also consumes (the verified call used 8192), and a strict schema. The fix has five parts:
- Return to the verified model and settings.
- Parse every reply shape: plain `response`; chat `choices`, including content-part lists; Responses `output`, including incomplete status. Reasoning text is used only when no message text exists.
- Salvage cut-off JSON by closing it after the last complete value, so every complete pose is kept.
- Log only the reply's shape (keys, status, finish reason, lengths, never the model text) to Workers observability.
- Show a fixed detail with the fallback reason (empty reply / no JSON in reply / no usable poses in reply).

### Local composer

When the planner is unavailable, slow or returns nothing usable, a seeded local composer invents phrases from the description (style and energy from English keywords; non-English descriptions default to a pop profile). Every generation uses a fresh random seed, so generating again gives a different dance. Phrases have motifs (a pose, its development, a mirrored answer, an accent) and the order repeats and mirrors them as a routine would.

### Synthesis

Keyposes land on the counts and are joined by C1 cubic curves. The change of each parameter between neighbouring counts is limited by its acceleration budget at the current tempo: arms 70 rad/s², trunk 9 rad/s² (trunk rotation moves most of the body mass, so its budget comes from the friction/centre-of-mass limit), linear pelvis terms 3.2 m/s². Steps are turned into planted footwork with leg IK, weight transfer and balance as before. Quarter turns are only taken when there is time left to turn back to a fixed end facing. Arm-body contacts are repaired everywhere by opening the arm and straightening the elbow a little. Inside boundary seams the legs are re-solved by IK to the seam-displaced foot targets, so planted feet do not dip or slide. Pelvis height uses a smooth reach-cap correction rather than a min-filter. The small floor-clearance lift (heel/toe/other lowest point) is smoothed over time instead of applied per sample, because its corners otherwise appear as fake ground-force spikes. The side-to-side weight shift is sized by the actual time between neighbouring steps, not by the beat. When a short range has little room after its start seam, the steps back to the fixed end stance start right after the start blend, and intermediate stances rotate about the stance centre so the feet keep their own sides while turning back.

### Time limits

- Planner: 55 s on the Worker, 60 s in the browser; past that the local composer takes over.
- Gate attempts run fail-fast without correction passes; intensity levels are 1, 0.65, 0.35, 0.15.
- If none passes, two last attempts (0.65, 0.25) keep the same keyposes but dance them in place: only the steps needed to reach the end stance remain. The candidate says so ("Footwork in place").
- The whole explicit generation may take up to 240 s (was 120 s).

### Verification (local, mocked AI)

See [VERIFICATION.md](VERIFICATION.md) for the exact counts of this revision. A real small model (Claude Haiku, run as a stand-in for the planner role with the exact system prompt, schema and user message) produced plans that all parsed and passed; this checks the prompt and protocol, not the Workers AI model itself.

### Limits

Standing choreography only: no floor work, inversions or flips. The check is the existing simplified kinematic and aggregate-force model, not full joint dynamics. No music understanding beyond BPM and counts. The new prompt and model id have not been called for real in this session (no Cloudflare credentials).

## 2026-10-15 (revision 1) · semantic planning + constraint-first synthesis

The first rebuild replaced the clip-timing planner (`ai-motion-plan-1`) with a model that picked moves from a fixed 19-move vocabulary (`ai-dance-plan-2`) and a constraint-first synthesizer (`dance-synth-1`). Root causes it addressed: the model had to produce exact float source/scene times; only two motion-capture sources; capture was generated then rejected with no fallback; fixed endpoints already outside the envelope made ranges ungeneratable. Seams use velocity-matched displacement mapping; the unchanged gate tolerates issues already present in fixed endpoint poses only inside the seam window. Revision 2 above supersedes its fixed vocabulary.
