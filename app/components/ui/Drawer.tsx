import { useEffect } from "react";

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
      <div className="fixed inset-0 z-50 bg-pub-navy/50" aria-hidden="true" onClick={onClose} />
      <nav
        id={id}
        aria-label={label}
        className="fixed inset-y-0 start-0 z-50 flex w-80 max-w-[88vw] flex-col overflow-y-auto border-e border-pub-line bg-pub-bg p-4 pt-safe shadow-pub-lg"
      >
        {children}
      </nav>
    </div>
  );
}
