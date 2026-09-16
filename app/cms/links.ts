/**
 * Link safety — internal relative paths or https externals ONLY.
 * No javascript:, data:, vbscript:, no protocol-relative //, no bare domains.
 */

/**
 * Reserved CMS link value meaning "the admin-configured external Questions &
 * Exams Platform" (Appearance → System: `questionPlatformEnabled` +
 * `questionPlatformUrl`).
 *
 * It is a STORED PLACEHOLDER, never an emitted href: `resolveCmsHref` replaces
 * it with the resolved https URL, or with "" (render no link at all) while the
 * platform is disabled/unconfigured. That keeps exam destinations honest — the
 * URL lives in only one place (owner settings) and an unconfigured platform can
 * never produce a dead or misleading link.
 */
export const EXAM_PLATFORM_HREF = "exam:external";

/** In-page fragment targets ("#videos"). Same pattern as the section anchor id. */
const FRAGMENT_RE = /^#([A-Za-z0-9_-]{1,40})$/;

/** Section-anchor id pattern — mirrors the one SectionView uses to emit `id`. */
export const ANCHOR_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function safeHref(href: string): boolean {
  if (href === "") return true; // empty = no link
  if (href === EXAM_PLATFORM_HREF) return true; // resolved at render time (see above)
  // In-page fragment (e.g. "#videos"): same-document navigation only — cannot
  // execute script, cannot leave the origin. Pattern is deliberately tiny.
  if (FRAGMENT_RE.test(href)) return true;
  if (href.startsWith("/") && !href.startsWith("//")) {
    return /^\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/[\]?#]*$/.test(href) && !href.includes("\\");
  }
  if (/^https:\/\//i.test(href)) {
    try {
      const u = new URL(href);
      return u.protocol === "https:" && Boolean(u.hostname) && !u.hostname.includes("\\");
    } catch {
      return false;
    }
  }
  return false;
}

/** The anchor id a fragment points at ("#videos" → "videos"), else null. */
export function fragmentId(href: string): string | null {
  const m = FRAGMENT_RE.exec(href);
  return m ? m[1] : null;
}

/** True for absolute https URLs only (the only external scheme we ever emit). */
export function isExternalHref(href: string): boolean {
  return /^https:\/\//i.test(href);
}

/**
 * Everything the CMS renderers need to turn a STORED link value into the href
 * that must actually be rendered.
 */
export interface CmsHrefContext {
  /**
   * Anchor ids of the sections that will really render on this page. A section
   * collapses (no `id` emitted) when it is hidden or when every child is empty —
   * the external exams section is the common case, since it renders nothing
   * while the Questions Platform is disabled or unconfigured.
   * `undefined` = page context unknown (do not second-guess the stored value).
   */
  anchors?: ReadonlySet<string>;
  /**
   * Resolved external Questions Platform URL (https-only, enable-gated) or null.
   * Same value the signed-in entry uses — one gate, one source of truth.
   */
  questionPlatformUrl?: string | null;
}

/**
 * Resolve a stored CMS link to the href to render.
 *
 * Returns "" when the link must NOT be rendered as a link at all — that is the
 * single, explicit way a CMS destination degrades: the block still renders (so
 * nothing shifts or disappears), but there is no dead anchor and no link to a
 * feature the platform does not currently have.
 */
export function resolveCmsHref(href: string, ctx: CmsHrefContext = {}): string {
  if (!href) return "";

  if (href === EXAM_PLATFORM_HREF) {
    const url = ctx.questionPlatformUrl ?? null;
    // Only ever emit the resolved https URL; while it is missing, no link.
    return url && isExternalHref(url) ? url : "";
  }

  const id = fragmentId(href);
  if (id !== null) {
    // Unknown page context → leave the stored value untouched.
    if (!ctx.anchors) return href;
    // Target section will not render → the fragment would be a dead anchor.
    return ctx.anchors.has(id) ? href : "";
  }

  return href;
}
