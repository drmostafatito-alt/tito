import { useEffect, useRef } from "react";

/**
 * Accessible modal: role=dialog + aria-modal, Escape closes, backdrop click closes,
 * first field focused, focus trapped inside the dialog (Tab/Shift+Tab cycle within),
 * focus restored to the opener on close, body scroll locked via position:fixed
 * pattern (iOS-safe).
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<{ top: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const prevFocused = document.activeElement as HTMLElement | null;
    scrollRef.current = { top: window.scrollY };
    const body = document.body;
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width };
    body.style.position = "fixed";
    body.style.top = `-${scrollRef.current.top}px`;
    body.style.width = "100%";

    const getFocusable = () =>
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
    getFocusable()?.[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // Trap focus: Tab/Shift+Tab cycle within the dialog instead of escaping.
      const focusable = getFocusable();
      if (!focusable || focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const inside = dialogRef.current?.contains(active) ?? false;
      if (e.shiftKey) {
        if (active === first || !inside) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !inside) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      Object.assign(body.style, prev);
      window.scrollTo({ top: scrollRef.current?.top ?? 0 });
      prevFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-brand-950/60 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-[var(--radius-card)] border border-line bg-parchment p-6 shadow-xl"
      >
        <h2 className="font-display mb-4 text-xl font-semibold text-ink">{title}</h2>
        {children}
      </div>
    </div>
  );
}
