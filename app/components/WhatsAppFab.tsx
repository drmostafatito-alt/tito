import { useCallback, useEffect, useRef, useState } from "react";
import { cmsLabel } from "~/cms/registry";

/**
 * Floating WhatsApp button — PUBLIC HOMEPAGE ONLY.
 *
 * Why homepage-only: a fixed overlay is exactly the kind of thing that ends up
 * covering a video's controls, an exam question or a submit button. It is
 * therefore mounted by the homepage route alone, and additionally gets out of
 * the way of important content even there.
 *
 * Collision avoidance is IntersectionObserver-driven rather than timer-driven:
 * the observer keeps the set of "important" elements anywhere in the viewport
 * small, and only those are rect-tested against the corner the button reserves.
 * That stays correct across scroll, resize, RTL/LTR, lazy-loaded media and
 * dynamically added sections, with no arbitrary timeouts to go stale.
 *
 * Note on styling: everything visual lives in classes, never in a `style`
 * attribute — the app ships `style-src 'self'` (no 'unsafe-inline'), so inline
 * styles are dropped in production.
 */

/** Keep only digits — wa.me expects an international number with no punctuation. */
export function whatsAppDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Build the wa.me URL. The message is URL-encoded; an empty message adds no query. */
export function whatsAppHref(phone: string, message: string): string {
  const base = `https://wa.me/${whatsAppDigits(phone)}`;
  const text = message.trim();
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * Things the button must never sit on top of. `[data-avoid-fab]` lets a CMS
 * block or any future surface opt in without this component knowing about it.
 */
export const FAB_AVOID_SELECTOR = "video, iframe, form, table, [data-avoid-fab]";

/** Geometry of the button, mirrored by the `h-14 w-14 bottom-4 end-4` classes. */
export const FAB_SIZE = 56;
export const FAB_INSET = 16;
/** Slack around the button when testing for overlap. */
export const FAB_COLLISION_PADDING = 12;

/**
 * The corner the button occupies, as a viewport-relative rect.
 *
 * Derived from the known geometry rather than measured from the DOM: the dodge
 * decision must not depend on a stylesheet having loaded, and it keeps the
 * reserved area identical whether or not the button is currently faded out.
 */
export function fabZone(viewportWidth: number, viewportHeight: number, rtl: boolean) {
  const pad = FAB_COLLISION_PADDING;
  const start = FAB_INSET - pad; // 4
  const end = FAB_INSET + FAB_SIZE + pad; // 84
  const left = rtl ? start : viewportWidth - end;
  const right = rtl ? end : viewportWidth - start;
  return { left, right, top: viewportHeight - end, bottom: viewportHeight - start };
}

export function WhatsAppFab({
  phone,
  message,
  locale,
}: {
  phone: string;
  message: string;
  locale: "ar" | "en";
}) {
  const digits = whatsAppDigits(phone);
  const [dodging, setDodging] = useState(false);
  /** Elements the observer currently reports as intersecting the viewport. */
  const inView = useRef(new Set<Element>());

  const recompute = useCallback(() => {
    const rtl = document.documentElement.dir === "rtl" || getComputedStyle(document.body).direction === "rtl";
    const zone = fabZone(window.innerWidth, window.innerHeight, rtl);
    let hit = false;
    for (const candidate of inView.current) {
      const r = candidate.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.left < zone.right && r.right > zone.left && r.top < zone.bottom && r.bottom > zone.top) {
        hit = true;
        break;
      }
    }
    setDodging((prev) => (prev === hit ? prev : hit));
  }, []);

  useEffect(() => {
    if (!digits) return;
    if (typeof IntersectionObserver === "undefined") return;

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        recompute();
      });
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) inView.current.add(entry.target);
          else inView.current.delete(entry.target);
        }
        schedule();
      },
      // Full viewport on purpose. Shrinking the root to a band would exclude the
      // corner the button actually lives in, so collisions there would never be
      // reported. The viewport-wide set on a homepage is only a handful of
      // elements, and the per-element rect test above is cheap.
      { rootMargin: "0px", threshold: 0 }
    );

    const observe = () => {
      for (const t of document.querySelectorAll(FAB_AVOID_SELECTOR)) {
        observer.observe(t); // observing twice is a no-op
      }
    };
    observe();

    // Sections/blocks can be added after first paint (streaming, lazy media).
    const dom = new MutationObserver(() => {
      observe();
      schedule();
    });
    dom.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    schedule();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      dom.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [digits, recompute]);

  if (!digits) return null;

  return (
    <a
      href={whatsAppHref(digits, message)}
      target="_blank"
      rel="noopener noreferrer nofollow"
      aria-label={cmsLabel("cms.whatsappFab.label", locale)}
      aria-hidden={dodging ? "true" : undefined}
      tabIndex={dodging ? -1 : 0}
      data-testid="whatsapp-fab"
      data-dodging={dodging ? "true" : "false"}
      className={`fixed bottom-4 end-4 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition-opacity duration-200 hover:bg-[#1ebe5b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
        dodging ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" fill="currentColor">
        <path d="M12 3.5a8.5 8.5 0 0 0-7.3 12.8L3.5 20.5l4.4-1.2A8.5 8.5 0 1 0 12 3.5z" />
        <path d="M9 9.2c0 3 2.3 5.3 5.3 5.3.5 0 1-.4 1-.9v-.9l-1.7-.7-.8.9a4.4 4.4 0 0 1-2.2-2.2l.9-.8-.7-1.7h-.9c-.5 0-.9.5-.9 1z" />
      </svg>
    </a>
  );
}
