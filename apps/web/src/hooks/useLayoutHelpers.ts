import { useEffect, useState, type RefObject } from 'react';

/** Rendered height of an overlay plus a gap; 0 while it is absent. */
export function useOverlayInset(ref: RefObject<HTMLElement | null>, present: boolean, gap = 16, initial = 240): number {
  const [inset, setInset] = useState(initial);
  useEffect(() => {
    const element = ref.current;
    if (!element) { setInset(0); return; }
    const measure = () => setInset(Math.ceil(element.getBoundingClientRect().height) + gap);
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure();
    return () => observer.disconnect();
  }, [present, gap, ref]);
  return inset;
}

/** Transient feedback that clears itself after a few seconds. */
export function useNotice(timeoutMs = 7000) {
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(''), timeoutMs);
    return () => window.clearTimeout(id);
  }, [notice, timeoutMs]);
  return [notice, setNotice] as const;
}

/** Ask before leaving while local work is unsaved. */
export function useUnsavedGuard(unsaved: () => boolean, active: boolean): void {
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (active && unsaved()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved, active]);
}
