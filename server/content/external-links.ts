/**
 * External quiz / Google Form link handling.
 *
 * The owner pastes a Google Forms (or Google Forms *quiz*) URL. We accept only
 * that host and shape, keep only the form id, and rebuild a canonical embed URL
 * ourselves. As with YouTube, the pasted string is never rendered as markup and
 * never used verbatim as an href, so a crafted URL cannot inject HTML/JS.
 *
 * NOTE ON QUESTION IMPORT: importing the actual questions into the native
 * question bank would require Google OAuth + the Forms/Drive API with
 * owner-supplied credentials, which this platform does not have. That is NOT
 * faked here — see docs/OWNER-CONTENT-GUIDE.md ("Owner-only limitations"). What
 * IS supported is the safe, credential-free workflow: embed the live form, or
 * open it externally.
 */

/** Google Forms ids are long opaque tokens; be permissive on length, strict on charset. */
const FORM_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

const ALLOWED_HOST = "docs.google.com";

export interface ExternalQuizLink {
  kind: "google_form";
  /** The opaque form id. */
  id: string;
  /** "e" = published /viewform link, "d" = the form's own id. */
  segment: "e" | "d";
  /** Canonical embeddable URL (?embedded=true is Google's own embed switch). */
  embedUrl: string;
  /** Canonical full-page URL, for the "open in a new tab" affordance. */
  openUrl: string;
}

/**
 * Validate a pasted Google Forms URL, or return null.
 *
 * Accepts: docs.google.com/forms/d/e/<id>/viewform and
 *          docs.google.com/forms/d/<id>/viewform (with or without a trailing
 *          slash and with arbitrary query params, which are dropped).
 * Rejects: any other host or scheme, /edit links, spreadsheets/docs, ids of the
 * wrong shape, and non-strings.
 */
export function parseGoogleFormUrl(input: unknown): ExternalQuizLink | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null; // Google Forms is https-only
  if (url.hostname.toLowerCase() !== ALLOWED_HOST) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  // forms / d / [e /] <id> / viewform
  if (parts.length < 4 || parts[0] !== "forms" || parts[1] !== "d") return null;

  let segment: "e" | "d";
  let id: string;
  if (parts[2] === "e") {
    if (parts.length < 5) return null;
    segment = "e";
    id = parts[3];
    if (parts[4] !== "viewform") return null;
  } else {
    segment = "d";
    id = parts[2];
    if (parts[3] !== "viewform") return null;
  }
  if (!FORM_ID_RE.test(id)) return null;

  const base = `https://${ALLOWED_HOST}/forms/d/${segment === "e" ? `e/${id}` : id}/viewform`;
  return {
    kind: "google_form",
    id,
    segment,
    embedUrl: `${base}?embedded=true`,
    openUrl: base,
  };
}
