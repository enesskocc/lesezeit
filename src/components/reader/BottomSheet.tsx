import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet with a scrim (prototype "sheet"). Closes on scrim tap or Escape, keeps keyboard
 * focus inside while open and gives it back to the tapped word when it closes.
 */
export function BottomSheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  // Latest onClose without re-running the effect (which would steal focus on every re-render).
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-20 bg-black/35" onClick={() => close.current()} data-testid="scrim" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 z-30 mx-auto max-h-[78vh] max-w-[520px] overflow-auto rounded-t-[18px] border border-line bg-surface px-[max(18px,env(safe-area-inset-left))] pt-2.5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-[0_-10px_30px_rgb(0_0_0/0.18)] outline-none"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-sm bg-line" />
        {children}
      </div>
    </>
  );
}
