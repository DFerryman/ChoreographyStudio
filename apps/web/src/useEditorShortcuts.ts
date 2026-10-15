import { useEffect, useRef } from 'react';

export type EditorShortcutOptions = {
  enabled: boolean;
  readOnly?: boolean;
  onStep: (direction: -1 | 1) => void;
  /** Shift+Arrow: previous/next dance count. */
  onStepCount?: (direction: -1 | 1) => void;
  /** Home/End: start/end of the selected range or the scene. */
  onJump?: (edge: 'start' | 'end') => void;
  /** I/O: set the range start/end at the current frame. */
  onMark?: (edge: 'in' | 'out') => void;
  /** Escape: clear the Timeline range. */
  onClearRange?: () => void;
  onPlay: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Ctrl/Cmd+S; also available while viewing mirrored, since saving changes no motion. */
  onSave?: () => void;
};

const interactiveSelector = [
  'input', 'textarea', 'select', 'button', 'a', 'summary',
  '[role="button"]', '[role="link"]', '[role="textbox"]',
  '[role="combobox"]', '[role="listbox"]', '[role="slider"]',
  '[role="spinbutton"]', '[role="menuitem"]', '[role="checkbox"]',
  '[role="radio"]', '[role="switch"]', '[role="tab"]',
].join(',');

/** Focused controls keep their own keys; shared with Timeline zoom shortcuts. */
export function isInteractiveTarget(target: EventTarget | null): boolean {
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
        || isInteractiveTarget(document.activeElement) || event.composedPath().some(isInteractiveTarget)) return;

      const key = event.key.toLowerCase();
      let action: (() => void) | undefined;
      let allowRepeat = false;
      if ((event.ctrlKey || event.metaKey) && key === 's' && !event.shiftKey && callbacks.onSave) {
        event.preventDefault();
        if (!event.repeat) callbacks.onSave();
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (key === 'z') action = event.shiftKey ? callbacks.onRedo : callbacks.onUndo;
        else if (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey) action = callbacks.onRedo;
      } else if (key === 'arrowleft' || key === 'arrowright') {
        const direction = key === 'arrowleft' ? -1 : 1;
        action = event.shiftKey && callbacks.onStepCount ? () => callbacks.onStepCount!(direction) : () => callbacks.onStep(direction);
        allowRepeat = true;
      } else if ((key === 'home' || key === 'end') && callbacks.onJump) action = () => callbacks.onJump!(key === 'home' ? 'start' : 'end');
      else if ((key === 'i' || key === 'o') && !event.shiftKey && callbacks.onMark) action = () => callbacks.onMark!(key === 'i' ? 'in' : 'out');
      else if (key === 'escape' && callbacks.onClearRange && !document.querySelector('details[open]')) action = callbacks.onClearRange;
      else if (key === ' ' || key === 'spacebar' || event.code === 'Space') action = callbacks.onPlay;
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
