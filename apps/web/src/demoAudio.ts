/** Original 120 BPM pulse track. Synthesized locally; no third-party music. */
export function demoAudio(): Blob {
  const rate = 16000, duration = 40, samples = rate * duration;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const str = (offset: number, text: string) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const t = i / rate, beat = Math.floor(t * 2), phase = t - beat * 0.5;
    const tone = phase < 0.12 ? Math.sin(phase * Math.PI * 2 * (beat % 8 === 0 ? 660 : 440)) * Math.exp(-phase * 42) * 0.22 : 0;
    const bass = Math.sin(t * Math.PI * 2 * 110) * Math.exp(-phase * 12) * 0.06;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, tone + bass)) * 32767, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
