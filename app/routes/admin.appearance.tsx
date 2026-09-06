import type { Route } from "./+types/admin.appearance";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { and, desc, eq } from "drizzle-orm";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings, updateSettingsGroup } from "~server/settings/service.server";
import { canCms } from "~server/cms/service.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { files } from "~server/db/schema";
import { cmsLabel, ICON_IDS } from "~/cms/registry";
import { namedSocialsFromLinks, socialLinksForEditor, type SocialLink } from "~/cms/social";
import { useState } from "react";
import { DASHBOARD_MODULE_IDS } from "~server/settings/schema";
import { Alert } from "~/components/ui/Alert";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { ImagePicker } from "~/components/ui/ImagePicker";
import { t } from "~/lib/i18n";
import type { Locale } from "~/lib/i18n";

/**
 * Appearance & identity admin (Phase 3 stage 3). Branding, theme tokens,
 * presentation toggles and dashboard modules — all validated design tokens /
 * whitelisted options, persisted as settings (zero code deployment for routine
 * visual changes). Theme tokens render through /theme.css; arbitrary CSS is
 * never accepted.
 */

const TABS = ["identity", "theme", "presentation", "dashboard", "system"] as const;
type Tab = (typeof TABS)[number];

export async function loader({ context, request }: Route.LoaderArgs) {
  const guarded = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  const url = new URL(request.url);
  const tabParam = url.searchParams.get("tab");
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "identity";
  const [canTheme, canEdit] = await Promise.all([
    canCms(db, guarded.auth, "cms.manage_theme"),
    canCms(db, guarded.auth, "cms.edit"),
  ]);
  const allowed = tab === "identity" || tab === "theme" || tab === "system" ? canTheme : canEdit;
  const isSuper = guarded.auth.user.rank >= 4;
  const settings = await getSettings(db);
  const imageRows = await db
    .select({ id: files.id, name: files.originalFilename })
    .from(files)
    .where(and(eq(files.visibility, "public"), eq(files.kind, "image")))
    .orderBy(desc(files.createdAt))
    .limit(200);
  return { tab, allowed, canTheme, canEdit, isSuper, settings, images: imageRows.map((r) => ({ id: r.id, label: r.name })) };
}

export async function action({ context, request }: Route.ActionArgs) {
  const guarded = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const group = intent.replace("save-", "");
  if (!TABS.includes(group as Tab)) return { error: "generic" as const };
  const needed = group === "identity" || group === "theme" || group === "system" ? "cms.manage_theme" : "cms.edit";
  if (!(await canCms(db, guarded.auth, needed as "cms.manage_theme"))) return { error: "denied" as const };
  const actor = { userId: guarded.auth.user.id, role: guarded.auth.user.roleId, ipHash: await sha256Hex(clientIpOf(request) ?? "unknown") };
  const str = (k: string) => String(form.get(k) ?? "");
  const on = (k: string) => form.get(k) === "on";

  try {
    if (group === "system") {
      // platform identity (name/tagline/support/maintenance) + — super_admin only — video provider policy.
      const nullable = (k: string) => { const v = str(k); return v === "" ? null : v; };
      await updateSettingsGroup(db, "platform", {
        nameAr: str("nameAr"), nameEn: str("nameEn"),
        taglineAr: str("taglineAr"), taglineEn: str("taglineEn"),
        supportEmail: nullable("supportEmail"), supportPhone: nullable("supportPhone"),
        whatsapp: nullable("whatsapp"), maintenance: on("maintenance"),
      }, actor);
      if (guarded.auth.user.rank >= 4) {
        const num = (k: string) => Number(str(k) || 0);
        await updateSettingsGroup(db, "video", {
          provider: str("provider"),
          playbackTokenTtlSeconds: num("playbackTokenTtl"),
          fileUrlTtlSeconds: num("fileTtl"),
        }, actor);
        // Phase 6: manual payment-rail configuration (PAYMENTS.md §3 — admin-configured instructions)
        await updateSettingsGroup(db, "payments", {
          manualEnabled: on("manualEnabled"),
          manualInstructionsAr: str("manualInstructionsAr").slice(0, 2000),
          manualInstructionsEn: str("manualInstructionsEn").slice(0, 2000),
          orderTtlMinutes: num("orderTtlMinutes"),
          refundWindowDays: num("refundWindowDays"),
        }, actor);
      }
      return { ok: true as const };
    }
    let patch: Record<string, unknown>;
    if (group === "identity") {
      const socialLinks: SocialLink[] = [];
      for (let i = 0; i < 20; i++) {
        const url = str(`sl.${i}.url`);
        const network = str(`sl.${i}.network`);
        if (!url && !network) continue;
        socialLinks.push({
          id: str(`sl.${i}.id`) || crypto.randomUUID(),
          network: network || "globe",
          url,
          labelAr: str(`sl.${i}.labelAr`),
          labelEn: str(`sl.${i}.labelEn`),
          enabled: on(`sl.${i}.enabled`),
          sortOrder: i,
          showHeader: on(`sl.${i}.showHeader`),
          showFooter: on(`sl.${i}.showFooter`),
          showHome: on(`sl.${i}.showHome`),
          showContact: on(`sl.${i}.showContact`),
        });
      }
      const named = namedSocialsFromLinks(socialLinks);
      patch = {
        shortNameAr: str("shortNameAr"), shortNameEn: str("shortNameEn"),
        ownerNameAr: str("ownerNameAr"), ownerNameEn: str("ownerNameEn"),
        ownerTitleAr: str("ownerTitleAr"), ownerTitleEn: str("ownerTitleEn"),
        ownerPhotoFileId: str("ownerPhotoFileId"), logoFileId: str("logoFileId"),
        faviconFileId: str("faviconFileId"), heroImageFileId: str("heroImageFileId"),
        aboutImageFileId: str("aboutImageFileId"),
        contactPhone: str("contactPhone"), contactEmail: str("contactEmail"),
        contactAddressAr: str("contactAddressAr"), contactAddressEn: str("contactAddressEn"),
        ...named,
        copyrightAr: str("copyrightAr"), copyrightEn: str("copyrightEn"),
        socialLinks,
      };
    } else if (group === "theme") {
      const num = (k: string) => Number(str(k) || 0);
      patch = {
        primary: str("primary"), secondary: str("secondary"), accent: str("accent"),
        background: str("background"), surface: str("surface"), text: str("text"),
        mutedText: str("mutedText"), border: str("border"),
        success: str("success"), warning: str("warning"), error: str("error"),
        radiusBase: num("radiusBase"), radiusButton: num("radiusButton"), radiusCard: num("radiusCard"),
        shadow: str("shadow"), density: str("density"), fontScale: str("fontScale"),
        headingFont: str("headingFont") || "cairo", bodyFont: str("bodyFont") || "cairo",
      };
    } else if (group === "presentation") {
      patch = {
        courseCard: {
          showImage: on("cc.showImage"), showTeacher: on("cc.showTeacher"),
          showLessonCount: on("cc.showLessonCount"), showSubject: on("cc.showSubject"),
          showBadge: on("cc.showBadge"),
          ctaLabelAr: str("cc.ctaLabelAr"), ctaLabelEn: str("cc.ctaLabelEn"),
          layout: str("cc.layout"),
        },
        subjectCard: {
          showImage: on("sc.showImage"), showCourseCount: on("sc.showCourseCount"),
          ctaLabelAr: str("sc.ctaLabelAr"), ctaLabelEn: str("sc.ctaLabelEn"),
        },
        lesson: {
          showDescription: on("ls.showDescription"), showAttachments: on("ls.showAttachments"),
          showPrevNext: on("ls.showPrevNext"), showRelated: on("ls.showRelated"),
          video: {
            showPoster: on("ls.video.showPoster"), showTitle: on("ls.video.showTitle"),
            showDescription: on("ls.video.showDescription"),
            allowSpeed: on("ls.video.allowSpeed"), allowFullscreen: on("ls.video.allowFullscreen"),
          },
        },
      };
    } else {
      patch = {
        welcomeAr: str("welcomeAr"), welcomeEn: str("welcomeEn"),
        modules: DASHBOARD_MODULE_IDS.map((id) => ({ id, enabled: on(`mod.${id}`) })),
      };
    }
    await updateSettingsGroup(db, group as "identity", patch, actor);
    return { ok: true as const };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: "validation" as const, issues: [message.slice(0, 300)] };
  }
}

type Loc = "ar" | "en";

/**
 * Reusable image field with a real media-picker experience (Phase 1). Replaces
 * the previous bare `<select>`. Offers: a live preview (or an explanatory empty
 * state when no image is set), "choose from the media library", "remove", and a
 * link to open the Media Library to upload. The chosen file id is carried on a
 * hidden input with the same `name`, so the parent Form/action is unchanged.
 */
function BrandImageField({ name, value, images, label, locale }: { name: string; value: string; images: Array<{ id: string; label: string }>; label: string; locale: Loc }) {
  // Shared bilingual image picker (see components/ui/ImagePicker.tsx).
  return (
    <div className="sm:col-span-2">
      <ImagePicker name={name} value={value} images={images} locale={locale} label={label} />
    </div>
  );
}

function Check({ name, checked, label }: { name: string; checked: boolean; label: string }) {
  return (
    <label className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
      <input type="checkbox" name={name} defaultChecked={checked} className="h-4 w-4" />
      {label}
    </label>
  );
}

const selectCls = "h-[42px] rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none";

function SocialHub({ identity, locale, L }: { identity: { socialLinks?: SocialLink[]; facebook: string; youtube: string; instagram: string; tiktok: string; twitter: string; linkedin: string; telegram: string }; locale: Loc; L: (k: string) => string }) {
  void locale;
  const initial = socialLinksForEditor(identity);
  const [rows, setRows] = useState(initial.length ? initial : [{
    id: "new", network: "globe", url: "", labelAr: "", labelEn: "", enabled: true, sortOrder: 0,
    showHeader: false, showFooter: true, showHome: true, showContact: true,
  }]);
  const move = (from: number, dir: -1 | 1) => {
    setRows((rs) => {
      const to = from + dir;
      if (to < 0 || to >= rs.length) return rs;
      const next = rs.slice();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next.map((r, i) => ({ ...r, sortOrder: i }));
    });
  };
  return (
    <fieldset className="sm:col-span-2 flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-slate-700">{L("cms.ui.socialHub")}</legend>
      {rows.map((row, i) => (
        <div key={row.id} className="grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-3 sm:grid-cols-2">
          <input type="hidden" name={`sl.${i}.id`} value={row.id} />
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium">{L("cms.f.network")}</span>
            <select name={`sl.${i}.network`} defaultValue={row.network} className={selectCls}>
              {ICON_IDS.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </label>
          <Input label={L("cms.f.url")} name={`sl.${i}.url`} defaultValue={row.url} dir="ltr" placeholder="https://…" />
          <Input label={`${L("cms.f.label")} (عربي)`} name={`sl.${i}.labelAr`} defaultValue={row.labelAr} dir="rtl" />
          <Input label={`${L("cms.f.label")} (English)`} name={`sl.${i}.labelEn`} defaultValue={row.labelEn} dir="ltr" />
          <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name={`sl.${i}.enabled`} defaultChecked={row.enabled} className="h-4 w-4" /> {L("cms.ui.enabled")}</label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name={`sl.${i}.showHeader`} defaultChecked={row.showHeader} className="h-4 w-4" /> {L("cms.ui.showHeader")}</label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name={`sl.${i}.showFooter`} defaultChecked={row.showFooter} className="h-4 w-4" /> {L("cms.ui.showFooter")}</label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name={`sl.${i}.showHome`} defaultChecked={row.showHome} className="h-4 w-4" /> {L("cms.ui.showHome")}</label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name={`sl.${i}.showContact`} defaultChecked={row.showContact} className="h-4 w-4" /> {L("cms.ui.showContact")}</label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button type="button" className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs" onClick={() => move(i, -1)} disabled={i === 0} aria-label="↑">↑</button>
            <button type="button" className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="↓">↓</button>
            <button type="button" className="w-fit text-xs text-red-600" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>{L("cms.ui.removeRow")}</button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="inline-flex min-h-11 w-fit items-center rounded-lg border border-dashed border-slate-300 px-4 text-sm"
        onClick={() => setRows((rs) => [...rs, { id: crypto.randomUUID(), network: "globe", url: "", labelAr: "", labelEn: "", enabled: true, sortOrder: rs.length, showHeader: false, showFooter: true, showHome: true, showContact: true }])}
      >
        + {L("cms.ui.addRow")}
      </button>
    </fieldset>
  );
}

function ColorInput({ name, value, label }: { name: string; value: string; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="mb-1 text-sm font-medium text-slate-700">{label}</span>
      <div className="flex items-center gap-2">
        <input type="color" name={name} defaultValue={value} className="h-10 w-14 cursor-pointer rounded border border-slate-300 bg-white p-1" />
        <span className="text-xs text-slate-400" dir="ltr">{value}</span>
      </div>
    </div>
  );
}

/** Reorganized identity editor — one page but visually grouped into clear
 *  sections (name/identity, owner profile, branding, contact, social, legal)
 *  instead of a flat wall of fields. Writes the exact same settings group. */
function IdentityEditor({
  idn,
  images,
  locale,
  L,
}: {
  idn: {
    shortNameAr: string; shortNameEn: string; ownerNameAr: string; ownerNameEn: string;
    ownerTitleAr: string; ownerTitleEn: string; ownerPhotoFileId: string; logoFileId: string;
    faviconFileId: string; heroImageFileId: string; aboutImageFileId: string; contactPhone: string;
    contactEmail: string; contactAddressAr: string; contactAddressEn: string; copyrightAr: string; copyrightEn: string;
    socialLinks?: SocialLink[];
    facebook: string; youtube: string; instagram: string; tiktok: string; twitter: string; linkedin: string; telegram: string;
  };
  images: Array<{ id: string; label: string }>;
  locale: Loc;
  L: (k: string) => string;
}) {
  const Sec = ({ k }: { k: string }) => (
    <h3 className="col-span-full mt-4 border-b border-slate-100 pb-1.5 text-sm font-semibold text-slate-700 first:mt-0">
      {t(locale, `appearanceSec.${k}`)}
    </h3>
  );
  const AR = " (عربي)";
  const EN = " (English)";
  return (
    <Card>
      <CardHeader title={L("cms.ui.identity")} />
      <CardBody>
        <Form method="post" className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="_action" value="save-identity" />
          <Sec k="names" />
          <Input label={`${L("cms.set.shortName")}${AR}`} name="shortNameAr" defaultValue={idn.shortNameAr} dir="rtl" />
          <Input label={`${L("cms.set.shortName")}${EN}`} name="shortNameEn" defaultValue={idn.shortNameEn} dir="ltr" />
          <Input label={`${L("cms.set.ownerName")}${AR}`} name="ownerNameAr" defaultValue={idn.ownerNameAr} dir="rtl" />
          <Input label={`${L("cms.set.ownerName")}${EN}`} name="ownerNameEn" defaultValue={idn.ownerNameEn} dir="ltr" />
          <Input label={`${L("cms.set.ownerTitle")}${AR}`} name="ownerTitleAr" defaultValue={idn.ownerTitleAr} dir="rtl" />
          <Input label={`${L("cms.set.ownerTitle")}${EN}`} name="ownerTitleEn" defaultValue={idn.ownerTitleEn} dir="ltr" />

          <Sec k="profile" />
          <BrandImageField name="ownerPhotoFileId" value={idn.ownerPhotoFileId} images={images} label={L("cms.set.ownerPhoto")} locale={locale} />

          <Sec k="branding" />
          <BrandImageField name="logoFileId" value={idn.logoFileId} images={images} label={L("cms.set.logo")} locale={locale} />
          <BrandImageField name="faviconFileId" value={idn.faviconFileId} images={images} label={L("cms.set.favicon")} locale={locale} />
          <BrandImageField name="heroImageFileId" value={idn.heroImageFileId} images={images} label={L("cms.set.heroImage")} locale={locale} />
          <BrandImageField name="aboutImageFileId" value={idn.aboutImageFileId} images={images} label={L("cms.set.aboutImage")} locale={locale} />

          <Sec k="contact" />
          <Input label={L("cms.set.contactPhone")} name="contactPhone" defaultValue={idn.contactPhone} dir="ltr" />
          <Input label={L("cms.set.contactEmail")} name="contactEmail" defaultValue={idn.contactEmail} dir="ltr" type="email" />
          <Input label={`${L("cms.set.contactAddress")}${AR}`} name="contactAddressAr" defaultValue={idn.contactAddressAr} dir="rtl" />
          <Input label={`${L("cms.set.contactAddress")}${EN}`} name="contactAddressEn" defaultValue={idn.contactAddressEn} dir="ltr" />

          <Sec k="social" />
          <SocialHub identity={idn} locale={locale} L={L} />

          <Sec k="legal" />
          <Input label={`${L("cms.set.copyright")}${AR}`} name="copyrightAr" defaultValue={idn.copyrightAr} dir="rtl" />
          <Input label={`${L("cms.set.copyright")}${EN}`} name="copyrightEn" defaultValue={idn.copyrightEn} dir="ltr" />
          <SubmitButton className="w-fit sm:col-span-2">{L("cms.ui.saveGroup")}</SubmitButton>
        </Form>
      </CardBody>
    </Card>
  );
}

export default function AdminAppearance({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = (root?.locale ?? "ar") as Loc;
  const L = (k: string) => cmsLabel(k, locale);
  const actionData = useActionData<typeof action>();
  const { tab, settings, images } = loaderData;
  const idn = settings.identity;
  const theme = settings.theme;
  const pres = settings.presentation;
  const dash = settings.dashboard;
  const plat = settings.platform;
  const vid = settings.video;
  const pay = settings.payments;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin/cms" className="inline-flex min-h-11 items-center text-sm text-slate-500 hover:text-slate-800"><span aria-hidden="true" className="inline-block rtl:rotate-180">←</span> {L("cms.ui.backToPages")}</Link>
        <h1 className="text-2xl font-bold text-slate-900">{L("cms.ui.appearance")}</h1>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label={L("cms.ui.appearance")}>
        {TABS.map((tb) => {
          const key = tb === "identity" ? "cms.ui.identity" : tb === "theme" ? "cms.ui.theme" : tb === "presentation" ? "cms.ui.presentation" : tb === "system" ? "cms.ui.system" : "cms.ui.dashboardCfg";
          const allowed = tb === "identity" || tb === "theme" || tb === "system" ? loaderData.canTheme : loaderData.canEdit;
          return (
            <Link
              key={tb}
              to={`/admin/appearance?tab=${tb}`}
              className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium ${tab === tb ? "bg-brand-600 text-white" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"} ${allowed ? "" : "opacity-50"}`}
            >
              {L(key)}
            </Link>
          );
        })}
      </nav>

      {actionData && "error" in actionData && actionData.error === "denied" && <Alert kind="error">{L("cms.ui.permissionDenied")}</Alert>}
      {actionData && "issues" in actionData && actionData.issues && <Alert kind="error">{actionData.issues.join(" — ")}</Alert>}
      {actionData && "ok" in actionData && actionData.ok && <Alert kind="success">{L("cms.ui.saved")}</Alert>}

      {!loaderData.allowed ? (
        <Alert kind="error">{L("cms.ui.permissionDenied")}</Alert>
      ) : tab === "identity" ? (
        <IdentityEditor idn={idn} images={images} locale={locale} L={L} />
      ) : tab === "theme" ? (
        <Card>
          <CardHeader title={L("cms.ui.theme")} description={L("cms.set.colorHint")} />
          <CardBody>
            <Form method="post" className="grid gap-4 sm:grid-cols-3">
              <input type="hidden" name="_action" value="save-theme" />
              {(["primary", "secondary", "accent", "background", "surface", "text", "mutedText", "border", "success", "warning", "error"] as const).map((c) => (
                <ColorInput key={c} name={c} value={theme[c]} label={L(`cms.set.${c}`)} />
              ))}
              <div className="flex flex-col">
                <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.set.radiusBase")}</span>
                <input type="number" name="radiusBase" min={0} max={32} defaultValue={theme.radiusBase} className={selectCls} />
              </div>
              <div className="flex flex-col">
                <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.set.radiusButton")}</span>
                <input type="number" name="radiusButton" min={0} max={32} defaultValue={theme.radiusButton} className={selectCls} />
              </div>
              <div className="flex flex-col">
                <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.set.radiusCard")}</span>
                <input type="number" name="radiusCard" min={0} max={32} defaultValue={theme.radiusCard} className={selectCls} />
              </div>
              <div className="flex flex-col">
                <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.set.shadow")}</span>
                <select name="shadow" defaultValue={theme.shadow} className={selectCls}>
                  {["none", "sm", "md", "lg"].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="flex flex-col">
                <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.set.density")}</span>
                <select name="density" defaultValue={theme.density} className={selectCls}>
                  {["compact", "normal", "relaxed"].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="flex flex-col">
                <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.set.fontScale")}</span>
                <select name="fontScale" defaultValue={theme.fontScale} className={selectCls}>
                  {["compact", "normal", "large"].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div className="flex flex-col">
                <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.set.headingFont")}</span>
                <select name="headingFont" defaultValue={theme.headingFont} className={selectCls}>
                  <option value="cairo">{L("cms.font.cairo")}</option>
                  <option value="ibm">{L("cms.font.ibm")}</option>
                </select>
              </div>
              <div className="flex flex-col">
                <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.set.bodyFont")}</span>
                <select name="bodyFont" defaultValue={theme.bodyFont} className={selectCls}>
                  <option value="cairo">{L("cms.font.cairo")}</option>
                  <option value="ibm">{L("cms.font.ibm")}</option>
                </select>
              </div>
              <SubmitButton className="w-fit sm:col-span-3">{L("cms.ui.saveGroup")}</SubmitButton>
            </Form>
          </CardBody>
        </Card>
      ) : tab === "presentation" ? (
        <Card>
          <CardHeader title={L("cms.ui.presentation")} />
          <CardBody>
            <Form method="post" className="flex flex-col gap-6">
              <input type="hidden" name="_action" value="save-presentation" />
              <fieldset className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-700">{L("cms.set.courseCard")}</legend>
                <Check name="cc.showImage" checked={pres.courseCard.showImage} label={L("cms.set.showImage")} />
                <Check name="cc.showTeacher" checked={pres.courseCard.showTeacher} label={L("cms.set.showTeacher")} />
                <Check name="cc.showLessonCount" checked={pres.courseCard.showLessonCount} label={L("cms.set.showLessonCount")} />
                <Check name="cc.showSubject" checked={pres.courseCard.showSubject} label={L("cms.set.showSubject")} />
                <Check name="cc.showBadge" checked={pres.courseCard.showBadge} label={L("cms.set.showBadge")} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input label={`${L("cms.set.ctaLabel")} (عربي)`} name="cc.ctaLabelAr" defaultValue={pres.courseCard.ctaLabelAr} dir="rtl" />
                  <Input label={`${L("cms.set.ctaLabel")} (English)`} name="cc.ctaLabelEn" defaultValue={pres.courseCard.ctaLabelEn} dir="ltr" />
                  <div className="flex flex-col">
                    <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.set.layout")}</span>
                    <select name="cc.layout" defaultValue={pres.courseCard.layout} className={selectCls}>
                      {["standard", "compact", "wide"].map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                </div>
              </fieldset>
              <fieldset className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-700">{L("cms.set.subjectCard")}</legend>
                <Check name="sc.showImage" checked={pres.subjectCard.showImage} label={L("cms.set.showImage")} />
                <Check name="sc.showCourseCount" checked={pres.subjectCard.showCourseCount} label={L("cms.set.showCourseCount")} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label={`${L("cms.set.ctaLabel")} (عربي)`} name="sc.ctaLabelAr" defaultValue={pres.subjectCard.ctaLabelAr} dir="rtl" />
                  <Input label={`${L("cms.set.ctaLabel")} (English)`} name="sc.ctaLabelEn" defaultValue={pres.subjectCard.ctaLabelEn} dir="ltr" />
                </div>
              </fieldset>
              <fieldset className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-700">{L("cms.set.lessonPage")}</legend>
                <Check name="ls.showDescription" checked={pres.lesson.showDescription} label={L("cms.set.showDescription")} />
                <Check name="ls.showAttachments" checked={pres.lesson.showAttachments} label={L("cms.set.showAttachments")} />
                <Check name="ls.showPrevNext" checked={pres.lesson.showPrevNext} label={L("cms.set.showPrevNext")} />
                <Check name="ls.showRelated" checked={pres.lesson.showRelated} label={L("cms.set.showRelated")} />
                <fieldset className="mt-2 flex flex-col gap-2 rounded-lg border border-slate-100 p-3">
                  <legend className="px-1 text-xs font-semibold text-slate-500">{L("cms.set.videoBlock")}</legend>
                  <Check name="ls.video.showPoster" checked={pres.lesson.video.showPoster} label={L("cms.set.showPoster")} />
                  <Check name="ls.video.showTitle" checked={pres.lesson.video.showTitle} label={L("cms.set.showTitle")} />
                  <Check name="ls.video.showDescription" checked={pres.lesson.video.showDescription} label={L("cms.set.showDescription")} />
                  <Check name="ls.video.allowSpeed" checked={pres.lesson.video.allowSpeed} label={L("cms.set.allowSpeed")} />
                  <Check name="ls.video.allowFullscreen" checked={pres.lesson.video.allowFullscreen} label={L("cms.set.allowFullscreen")} />
                </fieldset>
              </fieldset>
              <SubmitButton className="w-fit">{L("cms.ui.saveGroup")}</SubmitButton>
            </Form>
          </CardBody>
        </Card>
      ) : tab === "dashboard" ? (
        <Card>
          <CardHeader title={L("cms.ui.dashboardCfg")} />
          <CardBody>
            <Form method="post" className="flex flex-col gap-3">
              <input type="hidden" name="_action" value="save-dashboard" />
              <Input label={`${L("cms.set.welcome")} (عربي)`} name="welcomeAr" defaultValue={dash.welcomeAr} dir="rtl" />
              <Input label={`${L("cms.set.welcome")} (English)`} name="welcomeEn" defaultValue={dash.welcomeEn} dir="ltr" />
              <fieldset className="flex flex-col gap-1 rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-700">{L("cms.set.modules")}</legend>
                {dash.modules.map((m) => (
                  <Check key={m.id} name={`mod.${m.id}`} checked={m.enabled} label={L(`cms.set.mod.${m.id}`)} />
                ))}
              </fieldset>
              <SubmitButton className="w-fit">{L("cms.ui.saveGroup")}</SubmitButton>
            </Form>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader title={L("cms.ui.system")} />
          <CardBody>
            <Form method="post" className="flex flex-col gap-4">
              <input type="hidden" name="_action" value="save-system" />
              <fieldset className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
                <legend className="px-1 text-sm font-semibold text-slate-700">{L("cms.ui.systemPlatform")}</legend>
                <Input label={L("cms.f.platformNameAr")} name="nameAr" defaultValue={plat.nameAr} dir="rtl" />
                <Input label={L("cms.f.platformNameEn")} name="nameEn" defaultValue={plat.nameEn} dir="ltr" />
                <Input label={L("cms.f.taglineAr")} name="taglineAr" defaultValue={plat.taglineAr} dir="rtl" />
                <Input label={L("cms.f.taglineEn")} name="taglineEn" defaultValue={plat.taglineEn} dir="ltr" />
                <Input label={L("cms.f.supportEmail")} name="supportEmail" defaultValue={plat.supportEmail ?? ""} dir="ltr" />
                <Input label={L("cms.f.supportPhone")} name="supportPhone" defaultValue={plat.supportPhone ?? ""} dir="ltr" />
                <Input label={L("cms.f.whatsapp")} name="whatsapp" defaultValue={plat.whatsapp ?? ""} dir="ltr" />
                <Check name="maintenance" checked={plat.maintenance} label={L("cms.f.maintenance")} />
              </fieldset>
              {loaderData.isSuper && (
                <fieldset className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
                  <legend className="px-1 text-sm font-semibold text-slate-700">{L("cms.ui.systemVideo")}</legend>
                  <div className="flex flex-col">
                    <span className="mb-1 text-sm font-medium text-slate-700">{L("cms.f.videoProvider")}</span>
                    <select name="provider" defaultValue={vid.provider} className={selectCls}>
                      <option value="mock">mock (development only)</option>
                      <option value="mux">mux</option>
                    </select>
                  </div>
                  <Input label={L("cms.f.playbackTtl")} name="playbackTokenTtl" defaultValue={String(vid.playbackTokenTtlSeconds)} dir="ltr" />
                  <Input label={L("cms.f.fileTtl")} name="fileTtl" defaultValue={String(vid.fileUrlTtlSeconds)} dir="ltr" />
                </fieldset>
              )}
              {loaderData.isSuper && (
                <fieldset className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4" data-testid="payments-settings">
                  <legend className="px-1 text-sm font-semibold text-slate-700">{t(locale, "commerceAdmin.settingsTitle")}</legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="manualEnabled" defaultChecked={pay.manualEnabled} />
                    {t(locale, "commerceAdmin.manualEnabled")}
                  </label>
                  <div className="flex flex-col">
                    <span className="mb-1 text-sm font-medium text-slate-700">{t(locale, "commerceAdmin.manualInstructionsAr")}</span>
                    <textarea name="manualInstructionsAr" rows={3} defaultValue={pay.manualInstructionsAr} dir="rtl" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                  <div className="flex flex-col">
                    <span className="mb-1 text-sm font-medium text-slate-700">{t(locale, "commerceAdmin.manualInstructionsEn")}</span>
                    <textarea name="manualInstructionsEn" rows={3} defaultValue={pay.manualInstructionsEn} dir="ltr" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                  </div>
                  <Input label={t(locale, "commerceAdmin.orderTtlMinutes")} name="orderTtlMinutes" defaultValue={String(pay.orderTtlMinutes)} dir="ltr" />
                  <Input label={t(locale, "commerceAdmin.refundWindowDays")} name="refundWindowDays" defaultValue={String(pay.refundWindowDays)} dir="ltr" />
                </fieldset>
              )}
              <SubmitButton className="w-fit">{L("cms.ui.saveGroup")}</SubmitButton>
            </Form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
