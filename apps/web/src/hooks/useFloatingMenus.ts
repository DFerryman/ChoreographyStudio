import { useEffect } from 'react';

/** Floating disclosure menus that close on outside press or Escape. */
export const FLOATING_MENU_SELECTOR = [
  'details.studio-more[open]', 'details.scene-extras[open]', 'details.camera-options[open]',
  'details.kf-more-actions[open]', 'details.operation-history[open]',
].join(', ');

/** Modal dialogs own pointer and keyboard dismissal while they are open. */
export function useFloatingMenus(selector = FLOATING_MENU_SELECTOR): void {
  useEffect(() => {
    const modalOpen = () => !!document.querySelector('[aria-modal="true"]');
    const openMenus = () => document.querySelectorAll<HTMLDetailsElement>(selector);
    function dismiss(event: PointerEvent) {
      if (modalOpen()) return;
      openMenus().forEach(details => { if (event.target instanceof Node && !details.contains(event.target)) details.open = false; });
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || modalOpen()) return;
      openMenus().forEach(details => { details.open = false; });
    }
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', escape); };
  }, [selector]);
}
