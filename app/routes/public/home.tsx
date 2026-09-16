import type { Route } from "./+types/home";
import type { MetaDescriptor } from "react-router";
import { Link, useActionData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { getPageBySlug } from "~server/cms/service.server";
import { renderSnapshot, resolvePublicImageUrls } from "~server/cms/render.server";
import { handleCmsFormAction, requestLocale } from "~server/cms/page-render.server";
import { resolveAuth } from "~server/auth/session.server";
import { asSnapshot, parseSeo, rootMetaFrom, seoMeta, siteEntitiesMeta } from "~/cms/seo";
import { PageView } from "~/components/cms/blocks";
import { WhatsAppFab } from "~/components/WhatsAppFab";
import { EmptyState } from "~/components/ui/EmptyState";
import { ThinkerPortrait } from "~/components/visuals/ThinkerPortrait";
import { DecorHairline } from "~/components/visuals/PhilosophyDecor";
import { thinkerAlternate, thinkerFor } from "~/lib/thinkers";
import { studyHub } from "~server/content/service.server";
import { t, type Locale } from "~/lib/i18n";

/** The floating WhatsApp button is a homepage-only affordance (see WhatsAppFab). */
function fabFrom(platform: {
  whatsapp?: string | null;
  whatsappFloating?: boolean;
  whatsappMessage?: string;
}) {
  return {
    enabled: platform.whatsappFloating === true,
    phone: platform.whatsapp ?? "",
    message: platform.whatsappMessage ?? "",
  };
}

/**
 * Homepage = CMS page with slug `home` (Phase 3: the owner composes it in the
 * admin builder; NO hardcoded marketing content lives in code anymore).
 * Empty-first: until a published `home` page exists, visitors see a clean
 * empty state — never demo/placeholder content.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const settings = await getSettings(db);
  const { auth } = await resolveAuth(db, env, request);
  const locale = requestLocale(request, settings, auth?.user.localePref ?? null);

  const page = await getPageBySlug(db, "home");
  const snapshot = page && page.status === "published" ? asSnapshot(page.publishedSnapshot) : null;
  const platformTitle = { ar: settings.platform.nameAr, en: settings.platform.nameEn };
  if (!snapshot) {
    return { sections: [], ctx: null, seo: null, ogImage: null, title: platformTitle, locale, empty: true as const, url: request.url, whatsappFab: fabFrom(settings.platform), discover: [] };
  }

  const rendered = await renderSnapshot(db, snapshot, { settings, locale });
  const seo = parseSeo(snapshot.page.seo ?? page?.seo);
  const ogImage = seo.ogImage
    ? ((await resolvePublicImageUrls(db, [seo.ogImage]))[seo.ogImage] ?? null)
    : null;

  // Student content discovery: REAL published subjects that actually have
  // term containers (studyHub). Empty-first — never lists a subject the
  // admin has not published as learning content.
  const hub = await studyHub(db);

  return {
    sections: rendered.sections,
    ctx: rendered.ctx,
    seo,
    ogImage,
    title: { ar: snapshot.page.titleAr || platformTitle.ar, en: snapshot.page.titleEn || platformTitle.en },
    locale,
    empty: false as const,
    url: request.url,
    whatsappFab: fabFrom(settings.platform),
    discover: hub,
  };
}

/**
 * Brand-first document title for the homepage. Used ONLY when the owner has not
 * set an SEO title in the CMS SEO tab: `الاسم | الشعار` (name | tagline) —
 * both owner-editable in Appearance → System, nothing hardcoded beyond the
 * empty-first platform-name fallback.
 */
function brandHomeTitle(locale: Locale, name?: { ar: string; en: string } | null, tagline?: { ar: string; en: string } | null) {
  const pick = (v?: { ar: string; en: string } | null) => (v ? (locale === "ar" ? v.ar || v.en : v.en || v.ar) : "");
  const n = pick(name);
  const tl = pick(tagline);
  return n && tl ? `${n} | ${tl}` : n || (locale === "ar" ? "د/ مصطفى تيتو" : "Dr mostafa tito");
}

/**
 * Description for the homepage when the owner has not set one in the CMS SEO
 * tab: a deterministic one-liner about what the platform IS, built only from
 * owner-configured identity (no invented claims, no statistics).
 */
function brandHomeDescription(locale: Locale, name?: { ar: string; en: string } | null, tagline?: { ar: string; en: string } | null) {
  const pick = (v?: { ar: string; en: string } | null) => (v ? (locale === "ar" ? v.ar || v.en : v.en || v.ar) : "");
  const n = pick(name);
  const tl = pick(tagline);
  if (!n) return "";
  if (locale === "ar") return tl ? `منصة ${n} الرسمية — ${tl}: كورسات ودروس ومراجعات ومصادر تعليمية.` : `منصة ${n} الرسمية: كورسات ودروس ومراجعات.`;
  return tl ? `The official ${n} platform — ${tl}: courses, lessons, revision and study resources.` : `The official ${n} platform: courses, lessons and revision.`;
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const root = rootMetaFrom(matches);
  const locale = (loaderData?.locale ?? root.locale) as Locale;
  // Owner-set CMS SEO wins; the brand fallback only fills what is missing.
  const seo = loaderData?.seo ? loaderData.seo : parseSeo({});
  const fallbackTitle = {
    ar: brandHomeTitle("ar", root.siteName, root.tagline),
    en: brandHomeTitle("en", root.siteName, root.tagline),
  };
  const finalSeo = { ...seo };
  if (!finalSeo.description.ar && !finalSeo.description.en) {
    finalSeo.description = {
      ar: brandHomeDescription("ar", root.siteName, root.tagline),
      en: brandHomeDescription("en", root.siteName, root.tagline),
    };
  }
  if (loaderData && !loaderData.empty && loaderData.ctx) {
    const ogAbsolute = loaderData.ogImage ? new URL(loaderData.ogImage, loaderData.url).href : null;
    return [...siteEntitiesMeta(matches), ...seoMeta(finalSeo, fallbackTitle, locale, loaderData.url, ogAbsolute)];
  }
  // empty-first (no published home page yet): brand title + description only
  const meta: MetaDescriptor[] = [{ title: locale === "ar" ? fallbackTitle.ar : fallbackTitle.en }];
  const d = locale === "ar" ? finalSeo.description.ar : finalSeo.description.en;
  if (d) meta.push({ name: "description", content: d });
  meta.push({ name: "robots", content: "index,follow" });
  return [...siteEntitiesMeta(matches), ...meta];
}

export async function action({ context, request }: Route.ActionArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const result = await handleCmsFormAction(db, env, request);
  if (!result) throw new Response("Not Found", { status: 404 });
  if ("status" in result) throw new Response("Bad Request", { status: result.status });
  return result;
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const pageTitle = loaderData.locale === "ar" ? loaderData.title.ar : loaderData.title.en;
  const fab = loaderData.whatsappFab.enabled ? (
    <WhatsAppFab
      phone={loaderData.whatsappFab.phone}
      message={loaderData.whatsappFab.message}
      locale={loaderData.locale}
    />
  ) : null;

  if (loaderData.empty || !loaderData.ctx) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <h1 className="sr-only">{pageTitle || (loaderData.locale === "en" ? "Dr mostafa tito" : "د/ مصطفى تيتو")}</h1>
        <EmptyState
          title={t(loaderData.locale, "content.pageEmptyTitle")}
          body={t(loaderData.locale, "content.pageEmptyBody")}
        />
        {fab}
      </div>
    );
  }

  const ctx = actionData?.formResults
    ? { ...loaderData.ctx, formResults: actionData.formResults }
    : loaderData.ctx;

  if (loaderData.sections.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <h1 className="sr-only">{pageTitle || (loaderData.locale === "en" ? "Dr mostafa tito" : "د/ مصطفى تيتو")}</h1>
        <EmptyState
          title={t(ctx.locale, "content.pageEmptyTitle")}
          body={t(ctx.locale, "content.pageEmptyBody")}
        />
        {fab}
      </div>
    );
  }
  return (
    <>
      {/* CMS hero supplies the visible h1; public layout already provides <main> */}
      <PageView sections={loaderData.sections} ctx={ctx} main={false} />
      <HomeDiscover subjects={loaderData.discover} locale={loaderData.locale} />
      {fab}
    </>
  );
}

/**
 * Student content discovery — additive, below the owner's CMS. Lists REAL
 * published subjects that have live term containers. Renders nothing when
 * empty. Never uses "courses" vocabulary.
 */
function HomeDiscover({
  subjects,
  locale,
}: {
  subjects: Array<{
    slug: string;
    titleAr: string;
    titleEn: string;
    gradeTitleAr: string;
    gradeTitleEn: string;
    programTitleAr: string;
    programTitleEn: string;
    yearTitleAr: string | null;
    yearTitleEn: string | null;
  }>;
  locale: Locale;
}) {
  if (!subjects.length) return null;
  const ar = locale === "ar";
  return (
    <section className="relative isolate mx-auto w-full max-w-5xl overflow-x-hidden px-4 pb-12" aria-labelledby="home-discover-title">
      <p className="text-sm font-semibold text-gold-700">{t(locale, "study.discoverEyebrow")}</p>
      <h2 id="home-discover-title" className="mt-1 text-2xl font-extrabold text-navy-900">
        {t(locale, "study.discoverTitle")}
      </h2>
      <DecorHairline className="mt-3 mb-6 max-w-[8rem] text-gold-500" />
      <div className="grid gap-5 sm:grid-cols-2">
        {subjects.map((s, i) => {
          const primary = thinkerFor({
            slot: "home-discover",
            slug: s.slug,
            titleAr: s.titleAr,
            titleEn: s.titleEn,
            skip: i > 1,
          });
          const thinker = i === 1 ? thinkerAlternate(primary ?? thinkerFor({ slot: "home-discover", slug: s.slug }), s.slug) : primary;
          return (
            <article
              key={s.slug}
              className="group relative isolate overflow-hidden rounded-[1.5rem] border border-navy-100 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-gold-300 hover:shadow-lg"
            >
              <ThinkerPortrait thinker={thinker} intensity="subtle" />
              <Link to={`/study/${s.slug}`} className="relative z-10 flex min-h-[9.5rem] flex-col gap-1.5 p-5 pe-16 sm:p-6 sm:pe-24">
                <h3 className="text-lg font-extrabold text-navy-900">{ar ? s.titleAr : s.titleEn}</h3>
                <p className="text-sm text-slate-600">
                  {t(locale, "study.gradeLabel")}: {ar ? s.gradeTitleAr : s.gradeTitleEn}
                  {s.programTitleAr || s.programTitleEn
                    ? ` · ${t(locale, "study.programLabel")}: ${ar ? s.programTitleAr : s.programTitleEn}`
                    : ""}
                </p>
                {(ar ? s.yearTitleAr : s.yearTitleEn) && (
                  <p className="text-xs font-medium text-navy-500" dir="ltr">
                    {t(locale, "study.yearLabel")}: {ar ? s.yearTitleAr : s.yearTitleEn}
                  </p>
                )}
                <span className="mt-auto inline-flex min-h-11 w-fit items-center pt-3 text-sm font-semibold text-navy-800 group-hover:text-gold-700">
                  {t(locale, "study.openSubject")}
                  <span aria-hidden="true" className="ms-1 rtl:rotate-180">→</span>
                </span>
              </Link>
            </article>
          );
        })}
      </div>
      <p className="mt-5">
        <Link to="/study" className="inline-flex min-h-11 items-center text-sm font-semibold text-navy-800 hover:text-gold-700">
          {t(locale, "study.discoverCta")}
          <span aria-hidden="true" className="ms-1 rtl:rotate-180">→</span>
        </Link>
      </p>
    </section>
  );
}
