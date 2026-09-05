import { useEffect, useRef } from "react";

/**
 * Accessible modal: role=dialog + aria-modal, Escape closes, backdrop click closes,
 * first field focused, body scroll locked via position:fixed pattern (iOS-safe).
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
    scrollRef.current = { top: window.scrollY };
    const body = document.body;
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width };
    body.style.position = "fixed";
    body.style.top = `-${scrollRef.current.top}px`;
    body.style.width = "100%";

    const focusable = dialogRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button, [href]"
    );
    focusable?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      Object.assign(body.style, prev);
      window.scrollTo({ top: scrollRef.current?.top ?? 0 });
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
      >
        <h2 className="mb-3 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
