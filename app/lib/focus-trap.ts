import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Keeps keyboard focus inside an open overlay panel.
 *
 * The mobile navigation drawers render a full-screen scrim, so everything
 * behind them is unreachable by pointer. Without this, Tab still walked
 * straight through the scrim into the page underneath — focus landed on
 * controls the user could neither see nor click.
 *
 * On open, focus moves to the first focusable control in the panel; Tab and
 * Shift+Tab wrap at the ends; on close, focus returns to whatever was focused
 * before (the toggle button), so the keyboard user never loses their place.
 *
 * Visibility is re-evaluated on every keypress rather than cached, because the
 * drawers contain collapsible sections whose contents come and go.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (!node) return;

    const restoreTo = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) =>
        typeof el.checkVisibility === "function"
          ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
          : true
      );

    const first = focusable()[0];
    if (first) {
      first.focus();
    } else {
      node.tabIndex = -1;
      node.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      const active = document.activeElement;

      if (!active || !node.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? tail : head).focus();
        return;
      }
      if (event.shiftKey && active === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && active === tail) {
        event.preventDefault();
        head.focus();
      }
    };

    // Capture phase so the wrap happens before anything else reacts to Tab.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (restoreTo && document.contains(restoreTo)) restoreTo.focus();
    };
  }, [ref, open]);
}
