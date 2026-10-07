import { useEffect, useRef } from 'react';

export type ModalFocusOptions = {
  /** Cancel only the supplied topmost dialog; callers retain their busy guards. */
  onEscape: (dialog: HTMLElement) => void;
};

const dialogSelector = '[role="dialog"][aria-modal="true"]';
const focusableSelector = 'a[href],button,input,select,textarea,[tabindex],[contenteditable="true"]';
type ModalRecord = { trigger: HTMLElement | null; lastFocused: HTMLElement | null; addedTabIndex: boolean };

function visible(element: HTMLElement): boolean {
  return !element.closest('[hidden],[inert],[aria-hidden="true"]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
}

function available(element: HTMLElement): boolean {
  return visible(element) && !element.matches(':disabled') && element.getAttribute('type') !== 'hidden';
}

function tabStops(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
    .filter(element => element.tabIndex >= 0 && available(element))
    // Positive tabindex values precede ordinary controls in native tab order.
    .sort((a, b) => (a.tabIndex || Number.MAX_SAFE_INTEGER) - (b.tabIndex || Number.MAX_SAFE_INTEGER));
}

/** Stacking contexts inherit their enclosing modal backdrop's z-index. */
function stackingPath(element: HTMLElement): number[] {
  const path: number[] = [];
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current), layer = Number(style.zIndex);
    if (style.zIndex !== 'auto' && Number.isFinite(layer) && style.position !== 'static') path.unshift(layer);
  }
  return path;
}

function compareLayers(a: HTMLElement, b: HTMLElement): number {
  const aPath = stackingPath(a), bPath = stackingPath(b);
  for (let index = 0; index < Math.max(aPath.length, bPath.length); index++) {
    const difference = (aPath[index] ?? 0) - (bPath[index] ?? 0);
    if (difference) return difference;
  }
  // The later DOM dialog wins equal layers, as in the app's nested confirmations.
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

/**
 * Manage existing aria-modal dialogs without coupling focus to their business actions.
 * Mount once in the application; give any preferred initial control
 * data-modal-initial-focus. React autoFocus is also retained when already inside.
 */
export function useModalFocus(options: ModalFocusOptions): void {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    const records = new Map<HTMLElement, ModalRecord>();
    let top: HTMLElement | null = null;
    let rememberedFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let reconciling = false;

    function focus(element: HTMLElement | null | undefined): boolean {
      if (!element?.isConnected || !available(element)) return false;
      element.focus({ preventScroll: true });
      return document.activeElement === element;
    }

    function restoreFocus(trigger: HTMLElement | null) {
      if (focus(trigger) || !trigger?.isConnected) return;
      // A successful action can disable its own trigger (for example, moving its
      // last K away). Stay in that feature's semantic region instead of the body.
      const regions = 'section,header,nav,footer,main,[role="region"]';
      let region = trigger.closest<HTMLElement>(regions);
      while (region) {
        const preferred = Array.from(region.querySelectorAll<HTMLElement>('[data-modal-focus-fallback]')).find(available);
        if (focus(preferred) || tabStops(region).some(focus)) return;
        region = region.parentElement?.closest<HTMLElement>(regions) ?? null;
      }
    }

    function focusInside(dialog: HTMLElement, preferred?: HTMLElement | null) {
      const record = records.get(dialog)!;
      const marked = dialog.querySelector<HTMLElement>('[data-modal-initial-focus]');
      const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const candidates = [preferred, record.lastFocused, marked, current && dialog.contains(current) ? current : null, ...tabStops(dialog)];
      const target = candidates.find(candidate => candidate && dialog.contains(candidate) && available(candidate));
      if (target) focus(target);
      else {
        if (!dialog.hasAttribute('tabindex')) { dialog.tabIndex = -1; record.addedTabIndex = true; }
        focus(dialog);
      }
    }

    function synchronize(trigger = rememberedFocus) {
      if (reconciling) return;
      reconciling = true;
      try {
        const dialogs = Array.from(document.querySelectorAll<HTMLElement>(dialogSelector)).filter(visible);
        const former = top, formerRecord = former ? records.get(former) : undefined;
        const removed = new Map(Array.from(records).filter(([dialog]) => !dialogs.includes(dialog)));
        for (const dialog of dialogs) {
          if (!records.has(dialog)) records.set(dialog, { trigger: trigger && !dialog.contains(trigger) ? trigger : null, lastFocused: null, addedTabIndex: false });
        }
        top = dialogs.sort(compareLayers).at(-1) ?? null;
        if (top !== former) {
          let restore = formerRecord?.trigger ?? null;
          // When nested and parent dialogs close together, walk out to the live trigger.
          const visited = new Set<HTMLElement>();
          while (restore && !restore.isConnected && !visited.has(restore)) {
            visited.add(restore);
            const owner = Array.from(removed).find(([dialog]) => dialog.contains(restore));
            restore = owner?.[1].trigger ?? null;
          }
          if (top) focusInside(top, restore && top.contains(restore) ? restore : undefined);
          else restoreFocus(restore);
        }
        for (const [dialog, record] of removed) {
          if (record.addedTabIndex && dialog.getAttribute('tabindex') === '-1') dialog.removeAttribute('tabindex');
          records.delete(dialog);
        }
        if (document.activeElement instanceof HTMLElement) {
          rememberedFocus = document.activeElement;
          if (top?.contains(rememberedFocus)) records.get(top)!.lastFocused = rememberedFocus;
        }
      } finally { reconciling = false; }
    }

    function onFocusIn() {
      const previous = rememberedFocus;
      // React autoFocus can fire before the MutationObserver sees a new dialog.
      synchronize(previous);
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (top && (!active || !top.contains(active))) focusInside(top);
      if (document.activeElement instanceof HTMLElement) {
        rememberedFocus = document.activeElement;
        if (top?.contains(rememberedFocus)) records.get(top)!.lastFocused = rememberedFocus;
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' && event.key !== 'Escape') return;
      synchronize();
      if (!top) return;
      if (event.key === 'Escape') {
        if (event.isComposing || event.repeat) return;
        event.preventDefault(); event.stopPropagation();
        latest.current.onEscape(top);
        return;
      }
      const stops = tabStops(top), active = document.activeElement;
      const first = stops[0], last = stops.at(-1);
      if (!stops.length) { event.preventDefault(); focusInside(top); }
      else if (!top.contains(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault(); focus(event.shiftKey ? last : first);
      }
    }

    const observer = new MutationObserver(mutations => {
      if (top || mutations.some(mutation => [mutation.target, ...mutation.addedNodes].some(node => node instanceof HTMLElement && (node.matches(dialogSelector) || node.querySelector(dialogSelector))))) synchronize();
    });
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('keydown', onKeyDown, true);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'aria-hidden', 'hidden', 'inert'] });
    synchronize();
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('keydown', onKeyDown, true);
      for (const [dialog, record] of records) if (record.addedTabIndex && dialog.getAttribute('tabindex') === '-1') dialog.removeAttribute('tabindex');
    };
  }, []);
}
