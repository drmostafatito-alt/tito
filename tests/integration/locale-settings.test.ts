/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { getDb } from "~server/db/client.server";
import { login, registerUser } from "~server/auth/service.server";
import { getSettings } from "~server/settings/service.server";
import { action as appearanceAction } from "~/routes/admin.appearance";
import { loader as rootLoader } from "~/root";
import { action as setLocaleAction } from "~/routes/public/set-locale";

/**
 * Owner-controllability regression: the site's DEFAULT LANGUAGE and the set of
 * languages offered are stored in the `locale` settings group and are consumed
 * by resolveLocale() on every request — but before this change there was no
 * Admin UI for them, so the owner could not change the site's language without
 * a code deployment. These tests drive the real Appearance action and then
 * assert the effect through the real root loader and the real /set-locale guard.
 */

const db = getDb(env);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const routeCtx = { cloudflare: { env, ctx: { waitUntil() {}, passThroughOnException() {} } } };

const call = (fn: unknown, req: Request) =>
  (fn as (a: unknown) => unknown)({ context: routeCtx, request: req, params: {} });

let admin: { id: string; cookie: string };

async function wipe() {
  for (const table of ["settings", "audit_logs", "security_events", "rate_limit_counters", "sessions", "devices", "users"]) {
    await db.run(`DELETE FROM ${table}`);
  }
}

async function makeAdmin() {
  const email = `owner-${crypto.randomUUID().slice(0, 8)}@test.local`;
  const req = () => new Request("https://app.test/login", { method: "POST", headers: { "user-agent": UA, "cf-connecting-ip": "10.1.2.3" } });
  const reg = await registerUser(env, { email, password: "Str0ngPass!x", fullName: "Owner" }, req());
  if (!("userId" in reg) || !reg.userId) throw new Error("register failed");
  await db.run(sql`UPDATE users SET role_id = ${"super_admin"} WHERE id = ${reg.userId}`);
  const loggedIn = await login(env, { email, password: "Str0ngPass!x" }, req());
  if (!("ok" in loggedIn) || !loggedIn.ok) throw new Error("login failed");
  return { id: reg.userId, cookie: loggedIn.cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
}

/** The real Appearance → System form (platform identity fields are required by the schema). */
function systemForm(extra: Record<string, string>) {
  return new Request("https://app.test/admin/appearance?tab=system", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: admin.cookie, "user-agent": UA, "cf-connecting-ip": "10.1.2.3" },
    body: new URLSearchParams({
      _action: "save-system",
      nameAr: "د/ مصطفى تيتو", nameEn: "Dr mostafa tito",
      taglineAr: "الفلسفة وعلم النفس", taglineEn: "Philosophy & Psychology",
      // The System tab also writes the video + payment groups for a super_admin,
      // so the real form's values for those are included verbatim.
      provider: "mock", playbackTokenTtl: "45", fileTtl: "120",
      manualEnabled: "on", manualInstructionsAr: "", manualInstructionsEn: "",
      orderTtlMinutes: "4320", refundWindowDays: "0",
      ...extra,
    }).toString(),
  });
}

/** A brand-new visitor: no locale cookie, English browser. */
const freshVisitor = (acceptLanguage = "en-US,en;q=0.9") =>
  new Request("https://app.test/", { headers: { "user-agent": UA, "accept-language": acceptLanguage } });

beforeEach(async () => {
  await wipe();
  admin = await makeAdmin();
});

describe("Appearance → System controls the platform language", () => {
  it("changing the default language changes what a fresh visitor is served", async () => {
    // Baseline: Arabic by default, even for an English browser (documented behaviour).
    const before = (await call(rootLoader, freshVisitor())) as { locale: string; localeOptions: string[] };
    expect(before.locale).toBe("ar");
    expect(before.localeOptions).toEqual(["ar", "en"]);

    const res = (await call(appearanceAction, systemForm({
      defaultLocale: "en", "localeEnabled.ar": "on", "localeEnabled.en": "on",
    }))) as { ok?: boolean; issues?: string[] };
    expect(res.issues).toBeUndefined();
    expect(res.ok).toBe(true);

    expect((await getSettings(db)).locale).toEqual({ default: "en", enabled: ["ar", "en"] });
    const after = (await call(rootLoader, freshVisitor())) as { locale: string };
    expect(after.locale).toBe("en");
  });

  it("an Arabic-only platform stops offering English (and the cookie can no longer force it)", async () => {
    const res = (await call(appearanceAction, systemForm({
      defaultLocale: "ar", "localeEnabled.ar": "on",
    }))) as { ok?: boolean; issues?: string[] };
    expect(res.ok).toBe(true);
    expect((await getSettings(db)).locale).toEqual({ default: "ar", enabled: ["ar"] });

    // /set-locale must refuse the disabled language server-side, not just hide the button
    const post = new Request("https://app.test/set-locale", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA, origin: "https://app.test" },
      body: new URLSearchParams({ lang: "en", next: "/" }).toString(),
    });
    const response = (await call(setLocaleAction, post)) as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie") ?? "").not.toContain("edu_locale=en");
  });

  it("rejects an inconsistent combination instead of saving an unusable site", async () => {
    const res = (await call(appearanceAction, systemForm({
      defaultLocale: "en", "localeEnabled.ar": "on", // default EN but only AR offered
    }))) as { error?: string; issues?: string[] };
    expect(res.error).toBe("validation");
    // the owner sees the actual reason, not a raw Zod JSON dump
    expect(res.issues?.join(" ") ?? "").toMatch(/default language must also be offered/i);
    // nothing was persisted
    expect((await getSettings(db)).locale).toEqual({ default: "ar", enabled: ["ar", "en"] });
  });

  it("a disabled language no longer resolves even when the cookie asks for it", async () => {
    await call(appearanceAction, systemForm({ defaultLocale: "ar", "localeEnabled.ar": "on" }));
    const withCookie = new Request("https://app.test/", {
      headers: { "user-agent": UA, cookie: "edu_locale=en" },
    });
    const data = (await call(rootLoader, withCookie)) as { locale: string; localeOptions: string[] };
    expect(data.localeOptions).toEqual(["ar"]);
    expect(data.locale).toBe("ar");
  });
});
