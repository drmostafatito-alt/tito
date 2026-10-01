import { useEffect, useRef } from "react";
import { useFocusTrap } from "~/lib/focus-trap";

/**
 * Overlay drawer used by public + student mobile navigation.
 * Admin keeps its own dark-rail drawer (different surface). The breakpoint
 * class is passed in so public/student (`xl`) and any future caller can share
 * the overlay / scroll-lock / Escape behaviour without forking markup.
 */
export function Drawer({
  open,
  onClose,
  id,
  label,
  children,
  hiddenClass = "xl:hidden",
}: {
  open: boolean;
  onClose: () => void;
  id: string;
  label: string;
  children: React.ReactNode;
  hiddenClass?: string;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  // Focus stays inside the panel while the scrim is up, and returns to the
  // toggle when it closes.
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={hiddenClass}>
      <div
        className="animate-scrim-in fixed inset-0 z-50 bg-pub-navy/50"
        aria-hidden="true"
        onClick={onClose}
      />
      <nav
        ref={panelRef}
        id={id}
        aria-label={label}
        // `left-0` / `border-r` are PHYSICAL on purpose: the drawer opens from
        // the left edge in Arabic and in English alike. Using the logical
        // `start-0` / `border-e` made it follow `dir` and slide in from the
        // right on the RTL site. The panel's own content is untouched and
        // still inherits RTL from the document.
        className="animate-drawer-in-left fixed inset-y-0 left-0 z-50 flex w-80 max-w-[88vw] flex-col overflow-y-auto border-r border-pub-line bg-pub-bg p-4 pt-safe shadow-pub-lg"
      >
        {children}
      </nav>
    </div>
  );
}
