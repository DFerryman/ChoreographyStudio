import { useEffect, useRef } from 'react';

export type EditorShortcutOptions = {
  enabled: boolean;
  readOnly?: boolean;
  onStep: (direction: -1 | 1) => void;
  onPlay: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
};

const interactiveSelector = [
  'input', 'textarea', 'select', 'button', 'a', 'summary',
  '[role="button"]', '[role="link"]', '[role="textbox"]',
  '[role="combobox"]', '[role="listbox"]', '[role="slider"]',
  '[role="spinbutton"]', '[role="menuitem"]', '[role="checkbox"]',
  '[role="radio"]', '[role="switch"]', '[role="tab"]',
].join(',');

function interactive(target: EventTarget | null): boolean {
  return target instanceof Element && (
    !!target.closest(interactiveSelector)
    || (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Stage shortcuts leave focused controls and the caller's editing guards in charge. */
export function useEditorShortcuts(options: EditorShortcutOptions): void {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const callbacks = latest.current;
      if (!callbacks.enabled || event.defaultPrevented || event.isComposing || event.altKey
        || interactive(document.activeElement) || event.composedPath().some(interactive)) return;

      const key = event.key.toLowerCase();
      let action: (() => void) | undefined;
      let allowRepeat = false;
      if (event.ctrlKey || event.metaKey) {
        if (key === 'z') action = event.shiftKey ? callbacks.onRedo : callbacks.onUndo;
        else if (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey) action = callbacks.onRedo;
      } else if (key === 'arrowleft' || key === 'arrowright') {
        action = () => callbacks.onStep(key === 'arrowleft' ? -1 : 1);
        allowRepeat = true;
      } else if (key === ' ' || key === 'spacebar' || event.code === 'Space') action = callbacks.onPlay;
      else if (key === 'delete') action = callbacks.onDelete;

      if (!action) return;
      event.preventDefault();
      // A disabled stage action must not fall through to the browser's undo
      // stack and restore a previously edited time field while viewing.
      if (callbacks.readOnly) return;
      if (!event.repeat || allowRepeat) action();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
