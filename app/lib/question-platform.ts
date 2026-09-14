/**
 * External Questions & Exams Platform entry.
 *
 * The native question bank / exams engine was retired in favour of a standalone
 * platform. Tito only keeps a clearly-labelled EXTERNAL entry point whose URL is
 * admin-controlled (Appearance → System → platform settings).
 *
 * The settings schema already validates the stored value (https-or-empty) on
 * write; this helper is the render-side defence in depth: the entry is shown
 * ONLY when enabled AND the value parses as a well-formed absolute https URL.
 * `javascript:`, `data:`, `vbscript:`, protocol-relative (`//host`), bare
 * domains and malformed values all resolve to `null` (entry hidden), so no
 * unsafe string can ever reach an `<a href>`.
 */
export interface QuestionPlatformConfig {
  questionPlatformEnabled?: boolean | null;
  questionPlatformUrl?: string | null;
}

/**
 * Return the safe, normalized https URL to show, or null when the entry must be
 * hidden (disabled, unconfigured, or unsafe).
 */
export function resolveQuestionPlatformUrl(cfg: QuestionPlatformConfig | null | undefined): string | null {
  if (!cfg || cfg.questionPlatformEnabled !== true) return null;
  const raw = typeof cfg.questionPlatformUrl === "string" ? cfg.questionPlatformUrl.trim() : "";
  if (!raw || raw.length > 500) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // Hard allowlist of the clickable scheme. Explicitly rejects javascript:,
  // data:, vbscript:, file: and anything else a browser might navigate to.
  if (url.protocol !== "https:") return null;
  if (!url.hostname || url.hostname.includes("\\") || url.hostname.includes("/")) return null;
  return url.toString();
}
