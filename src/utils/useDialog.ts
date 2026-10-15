/**
 * Keyboard behaviour for modal dialogs:
 * - Escape calls onClose
 * - focus moves into the dialog when it opens and back to the previously
 *   focused element when it closes
 * - Tab / Shift+Tab stay inside the dialog
 *
 * Attach the returned ref to the dialog panel, and give the panel
 * role="dialog" and aria-modal="true".
 */
import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Open dialogs, innermost last; only the top one reacts to keys */
const openDialogs: symbol[] = [];

export function useDialog<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const id = Symbol('dialog');
    openDialogs.push(id);
    const previous = document.activeElement as HTMLElement | null;

    const focusables = () =>
      ref.current
        ? Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null)
        : [];

    // Wait a tick so the dialog (and any enter animation) is in the DOM
    const timer = setTimeout(() => {
      const first = focusables()[0];
      if (first) first.focus();
      else ref.current?.focus();
    }, 0);

    const onKeyDown = (e: KeyboardEvent) => {
      // A dialog opened on top of this one (e.g. a confirm) handles the keys
      if (openDialogs[openDialogs.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !ref.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !ref.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      const i = openDialogs.indexOf(id);
      if (i >= 0) openDialogs.splice(i, 1);
      previous?.focus?.();
    };
  }, [open]);

  return ref;
}
