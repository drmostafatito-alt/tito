import type { Route } from "./+types/profile";
import { Form, Link, data, useActionData, useRouteLoaderData } from "react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv, getWaitUntil } from "~server/cf.server";
import { users, roles } from "~server/db/schema";
import { logSecurityEvent } from "~server/security/events.server";
import { LOCALE_COOKIE } from "~server/settings/locale.server";
import { requestEmailChange } from "~server/users/emailchange.server";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { Alert } from "~/components/ui/Alert";
import { FIELD_CLASS, FIELD_LABEL } from "~/components/ui/Input";
import { ArrowGlyph } from "~/components/tito/ui";
import { WorkHead, WorkSection } from "~/components/tito/page";
import { t, formatDateShort, type Locale } from "~/lib/i18n";

function localizeRole(locale: Locale, label: string): string {
  const k = label.toLowerCase();
  if (k.includes("super")) return t(locale, "dashboard.roleSuperAdmin");
  if (k.includes("admin") || k.includes("مشرف")) return t(locale, "dashboard.roleAdmin");
  if (k.includes("teacher") || k.includes("مدر")) return t(locale, "dashboard.roleTeacher");
  if (k.includes("student") || k.includes("طالب")) return t(locale, "dashboard.roleStudent");
  return label;
}

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  phone: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v === "" || /^\+?[0-9\s-]{6,20}$/.test(v), "invalid phone"),
  localePref: z.enum(["ar", "en"]),
});

/** Student profile: account information + self-service edits (name/phone/language). */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const rows = await db
    .select({
      fullName: users.fullName,
      email: users.email,
      phone: users.phone,
      localePref: users.localePref,
      createdAt: users.createdAt,
      roleLabel: roles.label,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, auth.user.id))
    .limit(1);
  const user = rows[0];
  if (!user) throw new Response("Not Found", { status: 404 });
  return { user };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireUser(context, request);
  const env = getEnv(context);
  const db = getDb(env);
  const form = await request.formData();

  // Self-service email change: request an out-of-band verification.
  if (String(form.get("_action") ?? "") === "change-email") {
    const newEmail = String(form.get("newEmail") ?? "");
    const currentPassword = String(form.get("currentPassword") ?? "");
    const result = await requestEmailChange(
      env,
      db,
      { userId: auth.user.id },
      newEmail,
      currentPassword,
      request,
      getWaitUntil(context)
    );
    if (!result.ok) {
      if (result.code === "rate_limited") return { emailError: "rate_limited" as const };
      if (result.code === "invalid") return { emailError: "invalid" as const };
      if (result.code === "wrong_password") return { emailError: "wrong_password" as const };
      return { emailError: "same_email" as const };
    }
    // Enumeration- and delivery-safe confirmation: do not reveal ownership and
    // do not claim that an external provider accepted mail we cannot observe here.
    return { emailRequested: true as const };
  }

  const parsed = profileSchema.safeParse({
    fullName: String(form.get("fullName") ?? ""),
    phone: String(form.get("phone") ?? ""),
    localePref: String(form.get("localePref") ?? "ar"),
  });
  if (!parsed.success) return { error: "invalid" as const };

  const { fullName, phone, localePref } = parsed.data;
  await db
    .update(users)
    .set({ fullName, phone: phone === "" ? null : phone, localePref, updatedAt: Date.now() })
    .where(eq(users.id, auth.user.id));
  await logSecurityEvent(db, { userId: auth.user.id, type: "profile_updated" });

  const headers = new Headers();
  if (localePref !== auth.user.localePref) {
    // Keep the locale cookie in sync — the cookie wins over the stored preference.
    headers.append(
      "Set-Cookie",
      `${LOCALE_COOKIE}=${localePref}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly; Secure`
    );
  }
  return data({ ok: true as const }, { headers });
}

/**
 * The account, as a record sheet. Read-only facts sit in a ruled list; the two
 * things a student can actually change get their own ruled section and their
 * own submit. Email changes stay out-of-band — the server sends a confirmation
 * link and nothing here pretends otherwise.
 */
export default function ProfilePage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const { user } = loaderData;

  const facts = [
    { k: t(locale, "profile.email"), v: user.email, ltr: true },
    { k: t(locale, "dashboard.role"), v: localizeRole(locale, user.roleLabel) },
    { k: t(locale, "profile.memberSince"), v: formatDateShort(locale, user.createdAt) },
  ];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-10">
      <WorkHead eyebrow={t(locale, "profile.accountTitle")} title={t(locale, "profile.title")} />

      {actionData && "error" in actionData && <Alert kind="error">{t(locale, "auth.errors.generic")}</Alert>}
      {actionData && "ok" in actionData && actionData.ok && <Alert kind="success">{t(locale, "profile.saved")}</Alert>}

      <WorkSection title={t(locale, "profile.accountTitle")}>
        <dl>
          {facts.map((f) => (
            <div key={f.k} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-pub-line py-3">
              <dt className="tito-label">{f.k}</dt>
              <dd className="min-w-0 truncate font-bold text-pub-ink" dir={f.ltr ? "ltr" : undefined}>
                {f.v}
              </dd>
            </div>
          ))}
        </dl>
      </WorkSection>

      <WorkSection title={t(locale, "profile.title")}>
        <Form method="post" className="flex flex-col gap-5">
          <Input
            label={t(locale, "profile.fullName")}
            name="fullName"
            defaultValue={user.fullName}
            required
            minLength={2}
            maxLength={80}
            autoComplete="name"
          />
          <Input
            label={t(locale, "profile.phone")}
            name="phone"
            defaultValue={user.phone ?? ""}
            type="tel"
            maxLength={20}
            autoComplete="tel"
            dir="ltr"
          />
          <div>
            <label htmlFor="localePref" className={FIELD_LABEL}>
              {t(locale, "profile.localePref")}
            </label>
            <select id="localePref" name="localePref" defaultValue={user.localePref} className={`${FIELD_CLASS} mt-1.5`}>
              <option value="ar">{t(locale, "common.arabic")}</option>
              <option value="en">{t(locale, "common.english")}</option>
            </select>
          </div>
          <div className="flex justify-end">
            <SubmitButton>{t(locale, "common.save")}</SubmitButton>
          </div>
        </Form>
      </WorkSection>

      <WorkSection title={t(locale, "profile.emailChangeTitle")}>
        <p className="mb-5 max-w-[60ch] text-pub-sm leading-pub-normal text-pub-muted">{t(locale, "profile.emailChangeDesc")}</p>

        {actionData && "emailRequested" in actionData && actionData.emailRequested && (
          <div className="mb-5">
            <Alert kind="success">{t(locale, "profile.emailChangeSent")}</Alert>
          </div>
        )}
        {actionData && "emailError" in actionData && actionData.emailError && (
          <div className="mb-5">
            <Alert kind="error">
              {actionData.emailError === "invalid"
                ? t(locale, "profile.emailChangeInvalid")
                : actionData.emailError === "same_email"
                  ? t(locale, "profile.emailChangeSame")
                  : actionData.emailError === "wrong_password"
                    ? t(locale, "profile.emailChangeWrongPassword")
                    : t(locale, "profile.emailChangeRateLimited")}
            </Alert>
          </div>
        )}

        <Form method="post" className="flex flex-col gap-5">
          <input type="hidden" name="_action" value="change-email" />
          <Input
            label={t(locale, "profile.newEmail")}
            name="newEmail"
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            dir="ltr"
            defaultValue={actionData && "emailRequested" in actionData ? "" : undefined}
          />
          <Input
            label={t(locale, "profile.currentPassword")}
            name="currentPassword"
            type="password"
            required
            minLength={1}
            maxLength={128}
            autoComplete="current-password"
            dir="ltr"
            reveal
            revealShowLabel={t(locale, "common.showPassword")}
            revealHideLabel={t(locale, "common.hidePassword")}
          />
          <div className="flex justify-end">
            <SubmitButton className="w-full sm:w-auto">{t(locale, "profile.emailChangeSubmit")}</SubmitButton>
          </div>
        </Form>
      </WorkSection>

      <nav className="flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-pub-line pt-5">
        <Link to="/profile/security" className="inline-flex min-h-11 items-center gap-2 text-pub-sm font-bold text-pub-ink hover:underline">
          {t(locale, "dashboard.securityLink")}
          <ArrowGlyph />
        </Link>
        <Link to="/dashboard" className="inline-flex min-h-11 items-center gap-2 text-pub-sm font-bold text-pub-ink hover:underline">
          {t(locale, "common.dashboard")}
          <ArrowGlyph />
        </Link>
      </nav>
    </div>
  );
}
