import type { DB } from "../db/client.server";
import { LOCALE_COOKIE, resolveLocale } from "../settings/locale.server";
import { parseCookieHeader } from "../auth/cookies.server";
import { isLocale, type Locale } from "../../app/lib/i18n";
import type { Settings } from "../settings/schema";
import { clientIpOf, checkRateLimit, sha256Hex } from "../http/rate-limit.server";
import { submitForm } from "./service.server";
import type { FormResultView } from "../../app/cms/render-types";

/**
 * Shared loader/action helpers for CMS-backed public routes (`/` and `/p/:slug`).
 * Publishing is the only path that produces public content; these helpers only
 * READ frozen snapshots and resolve view data (no drafts ever leak here).
 */

/** Locale for a public request (cookie → accept-language → default). */
export function requestLocale(request: Request, settings: Settings): Locale {
  const cookieLocale = parseCookieHeader(request.headers.get("cookie")).get(LOCALE_COOKIE);
  return resolveLocale({
    cookieValue: isLocale(cookieLocale) ? cookieLocale : null,
    userPref: null,
    acceptLanguage: request.headers.get("accept-language"),
    defaultLocale: settings.locale.default,
    enabled: settings.locale.enabled,
  });
}

/**
 * Form submissions from CMS form blocks. Rate-limited per IP, validated
 * declaratively (buildFormValidator — never executes admin-provided code),
 * stored via submitForm. Returns null when the POST is not a form submission.
 */
export async function handleCmsFormAction(
  db: DB,
  _env: Env,
  request: Request
): Promise<{ formResults: Record<string, FormResultView> } | { status: number } | null> {
  let formData: FormData;
  try { formData = await request.formData(); } catch { return { status: 400 }; }
  const slug = formData.get("_cmsForm");
  if (typeof slug !== "string" || !slug) return null;

  const ip = clientIpOf(request);
  const ipHash = ip ? await sha256Hex(`form:${ip}`) : "form:unknown";
  const rl = await checkRateLimit(db, "form-submit", ipHash, 10, 3_600_000);
  if (!rl.ok) {
    return { formResults: { [slug]: { ok: false, errors: { __form: "rate_limited" } } } };
  }

  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key === "_cmsForm") continue;
    if (key.endsWith("[]")) {
      const name = key.slice(0, -2);
      const list = Array.isArray(raw[name]) ? (raw[name] as string[]) : [];
      list.push(String(value));
      raw[name] = list;
      continue;
    }
    raw[key] = typeof value === "string" ? value : value.name;
  }
  const result = await submitForm(db, slug, raw, { ipHash });
  const view: FormResultView = result.ok ? { ok: true, errors: {} } : { ok: false, errors: result.errors };
  return { formResults: { [slug]: view } };
}
