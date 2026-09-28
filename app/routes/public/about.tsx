import type { Route } from "./+types/about";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { resolvePublicImageUrls } from "~server/cms/render.server";
import { resolveSocialLinks } from "~/cms/social";
import { subjects } from "~server/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { PageBody, PageHead } from "~/components/tito/page";
import { ArrowGlyph, Ordinal } from "~/components/tito/ui";
import { SubjectPlate, SubjectSignature, subjectKindOf } from "~/components/tito/subject";
import { rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { absUrl, breadcrumbJsonLd, personJsonLd, safeHttpsUrl, webPageJsonLd } from "~/cms/jsonld";
import { t, type Locale } from "~/lib/i18n";

/**
 * About / teacher entity page (SEO Master Phase, batch 4).
 *
 * The definitive public entity page for the owner (مصطفى تيتو / Dr Mostafa
 * Tito). EVERY fact on this page comes from the owner-configured identity
 * settings (Admin → Identity) or published content rows — the page 404s
 * outright when no owner name is configured, so it can never render an empty
 * shell or an invented person. Person + ProfilePage structured data use the
 * same source (jobTitle only when configured, sameAs only from the owner's
 * official social profiles).
 *
 * Brand searches (مصطفى تيتو / مستر مصطفى تيتو / دكتور مصطفى تيتو) have the
 * HOMEPAGE as their canonical destination; this page is the entity/E-E-A-T
 * surface that links back to it and to the real subjects.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
  const db = getDb(getEnv(context));
  const settings = await getSettings(db);
  const idn = settings.identity;

  const ownerName = (l: Locale) => (l === "ar" ? idn.ownerNameAr : idn.ownerNameEn) || (l === "ar" ? idn.ownerNameEn : idn.ownerNameAr);
  if (!ownerName("ar") && !ownerName("en")) {
    // No owner identity configured → no about page (keeps the sitemap and the
    // routes in lockstep; production starts content-empty).
    throw new Response("Not Found", { status: 404 });
  }

  const fileIds = [idn.ownerPhotoFileId, idn.aboutImageFileId].filter((x): x is string => Boolean(x));
  const images = fileIds.length ? await resolvePublicImageUrls(db, fileIds) : {};

  // Same resolution (incl. the WhatsApp number) the public layout uses, so
  // Person.sameAs and Organization.sameAs agree on every page.
  const waUrl = settings.platform.whatsapp ? `https://wa.me/${settings.platform.whatsapp.replace(/[^\d]/g, "")}` : "";

  const subjectRows = await db
    .select({ slug: subjects.slug, titleAr: subjects.titleAr, titleEn: subjects.titleEn })
    .from(subjects)
    .where(and(eq(subjects.status, "published"), isNull(subjects.deletedAt)))
    .orderBy(subjects.sortOrder);

  return {
    owner: {
      nameAr: idn.ownerNameAr,
      nameEn: idn.ownerNameEn,
      titleAr: idn.ownerTitleAr,
      titleEn: idn.ownerTitleEn,
      photoUrl: idn.ownerPhotoFileId ? (images[idn.ownerPhotoFileId] ?? null) : null,
      aboutImageUrl: idn.aboutImageFileId ? (images[idn.aboutImageFileId] ?? null) : null,
    },
    site: {
      nameAr: settings.platform.nameAr,
      nameEn: settings.platform.nameEn,
      taglineAr: settings.platform.taglineAr,
      taglineEn: settings.platform.taglineEn,
    },
    contact: {
      phone: idn.contactPhone,
      email: idn.contactEmail,
      addressAr: idn.contactAddressAr,
      addressEn: idn.contactAddressEn,
      // Same resolution the public layout uses: data-driven socialLinks,
      // falling back to the named identity fields (facebook/telegram/…).
      socials: resolveSocialLinks(idn, waUrl).map((s) => ({ url: s.url, labelAr: s.labelAr, labelEn: s.labelEn })),
    },
    subjects: subjectRows,
    url: request.url,
  };
}

/**
 * Meta: deterministic `About — brand` title (the brand cluster is the home
 * page's canonical; this page is the entity surface), description from the
 * owner-configured bio template + person name/title (nothing invented).
 */
export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  const locale = root.locale;
  const o = loaderData.owner as { nameAr: string; nameEn: string; titleAr: string; titleEn: string };
  const site = loaderData.site as { nameAr: string; nameEn: string; taglineAr: string; taglineEn: string };
  const name = locale === "ar" ? o.nameAr || o.nameEn : o.nameEn || o.nameAr;
  const title = locale === "ar" ? o.titleAr || o.titleEn : o.titleEn || o.titleAr;
  const siteName = locale === "ar" ? site.nameAr : site.nameEn;
  const tagline = locale === "ar" ? site.taglineAr : site.taglineEn;
  const bio = t(locale, "seo.aboutBio", { name: siteName, tagline });
  const description = title ? `${name} — ${title}. ${bio}` : bio;

  const label = { ar: t("ar", "seo.about"), en: t("en", "seo.about") };
  let origin = "";
  let pathname = "/about";
  try {
    const u = new URL(loaderData.url as string);
    origin = u.origin;
    pathname = u.pathname;
  } catch {
    /* keep relative */
  }
  const canonical = origin ? `${origin}${pathname}` : "";
  const base = [
    { title: `${label[locale]} — ${siteName}` },
    { name: "description", content: description.slice(0, 300) },
    ...(canonical ? [{ tagName: "link", rel: "canonical", href: canonical }] : []),
    { name: "robots", content: "index,follow" },
    { property: "og:title", content: `${label[locale]} — ${siteName}` },
    { property: "og:description", content: description.slice(0, 300) },
    { property: "og:type", content: "profile" },
    { name: "twitter:card", content: "summary" },
  ];

  const socials = (loaderData.contact as { socials: Array<{ url: string }> }).socials;
  const photoUrl = (loaderData.owner as { photoUrl: string | null }).photoUrl;
  const personLd = personJsonLd({
    name,
    url: absUrl(origin, "/about"),
    jobTitle: title || null,
    photo: photoUrl && origin ? absUrl(origin, photoUrl) : null,
    sameAs: socials.map((s) => s.url),
    worksFor: { name: siteName, url: absUrl(origin, "/") },
  });
  return [
    ...siteEntitiesMeta(matches),
    ...base,
    { "script:ld+json": personLd },
    {
      "script:ld+json": webPageJsonLd({
        name: `${label[locale]} — ${siteName}`,
        url: absUrl(origin, pathname),
        description: description.slice(0, 300),
        isPartOf: absUrl(origin, "/"),
        additionalType: "https://schema.org/ProfilePage",
      }),
    },
    {
      "script:ld+json": breadcrumbJsonLd({
        items: [{ name: locale === "ar" ? "الرئيسية" : "Home", url: "/" }, { name: label[locale] }],
        origin,
      }),
    },
  ];
}

export default function AboutPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const ar = locale === "ar";
  const { owner, site, contact, subjects } = loaderData;
  const name = ar ? owner.nameAr || owner.nameEn : owner.nameEn || owner.nameAr;
  const title = ar ? owner.titleAr || owner.titleEn : owner.titleEn || owner.titleAr;
  const siteName = ar ? site.nameAr : site.nameEn;
  const tagline = ar ? site.taglineAr : site.taglineEn;
  const c = (row: { titleAr: string; titleEn: string }) => (ar ? row.titleAr : row.titleEn);
  const address = ar ? contact.addressAr : contact.addressEn;

  /* The contact block is a ruled data list of REAL configured values only —
     a row exists exactly when the owner filled that field in. */
  const rows: Array<{ label: string; value: string; href?: string; ltr?: boolean }> = [];
  if (contact.phone) rows.push({ label: t(locale, "contact.phone"), value: contact.phone, href: `tel:${contact.phone}`, ltr: true });
  if (contact.email) rows.push({ label: t(locale, "contact.email"), value: contact.email, href: `mailto:${contact.email}`, ltr: true });
  if (address) rows.push({ label: t(locale, "contact.address"), value: address });

  return (
    <div className="flex flex-col">
      <PageHead
        locale={locale}
        crumbs={[{ label: t(locale, "study.breadcrumbHome"), to: "/" }, { label: t(locale, "seo.about") }]}
        eyebrow={title || t(locale, "seo.about")}
        title={name}
        lede={t(locale, "seo.aboutBio", { name: siteName, tagline })}
        aside={
          owner.photoUrl ? (
            /* THE photograph. Shown exactly as uploaded inside a hairline
               frame offset by one solid block of the mark — never re-cropped,
               never filtered, and never substituted when it is missing. */
            <figure className="relative shrink-0 self-center">
              <span aria-hidden="true" className="absolute inset-0 translate-x-3 translate-y-3 bg-pub-accent rtl:-translate-x-3" />
              <img
                src={owner.photoUrl}
                alt={name}
                loading="eager"
                decoding="async"
                width={288}
                height={352}
                className="relative block h-auto max-h-[22rem] w-[min(18rem,70vw)] border border-pub-ink bg-pub-sheet object-contain object-bottom"
              />
              {title && (
                <figcaption className="relative bg-pub-navy px-4 py-2.5 text-pub-xs font-bold text-pub-on-navy">{title}</figcaption>
              )}
            </figure>
          ) : undefined
        }
      />

      <PageBody className="grid items-start gap-x-[var(--pub-gap)] gap-y-12 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 flex flex-col gap-12">
          {subjects.length > 0 && (
            <section aria-labelledby="about-subjects">
              <div className="flex items-baseline gap-3 border-t-2 border-pub-ink pt-3.5">
                <h2 id="about-subjects" className="font-display text-[length:var(--text-pub-h3)] font-extrabold tracking-[-0.03em] text-pub-ink">
                  {t(locale, "seo.aboutSubjects")}
                </h2>
              </div>
              <ul className="tito-rows mt-2">
                {subjects.map((s, i) => {
                  const kind = subjectKindOf(s.slug, s.titleEn, s.titleAr);
                  return (
                    <li key={s.slug} data-subject={kind} className="tito-row grid-cols-[2.25rem_minmax(0,1fr)_auto] px-1">
                      <span className="pt-1 text-pub-sm font-bold text-ink-300" aria-hidden="true">
                        <Ordinal n={i + 1} />
                      </span>
                      <div className="min-w-0">
                        <Link
                          to={`/study/${s.slug}`}
                          data-testid={`about-subject-${s.slug}`}
                          className="font-display text-pub-md font-bold leading-pub-snug text-pub-ink after:absolute after:inset-0 focus-visible:outline-offset-4"
                        >
                          {c(s)}
                        </Link>
                      </div>
                      <span className="relative z-10 flex items-center gap-2 self-center text-[color:var(--subject-ink)]">
                        <SubjectSignature kind={kind} size={18} />
                        <ArrowGlyph className="text-pub-ink" />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {owner.aboutImageUrl && (
            <figure className="border border-pub-line bg-pub-sheet p-2">
              <img src={owner.aboutImageUrl} alt={name} loading="lazy" decoding="async" className="max-h-[26rem] w-full object-contain" />
            </figure>
          )}
        </div>

        <aside className="min-w-0">
          {(rows.length > 0 || contact.socials.length > 0) && (
            <section aria-labelledby="about-contact" className="relative isolate overflow-hidden border border-pub-line bg-pub-sheet p-5">
              <span aria-hidden="true" className="pointer-events-none absolute -bottom-8 -z-10 opacity-[0.12] ltr:-right-8 rtl:-left-8">
                <SubjectPlate kind="psych" className="h-40 w-64" />
              </span>
              <h2 id="about-contact" className="tito-label">
                {t(locale, "seo.aboutContact")}
              </h2>
              <dl className="mt-3">
                {rows.map((r) => (
                  <div key={r.label} className="flex items-baseline justify-between gap-4 border-t border-pub-line py-3">
                    <dt className="tito-label shrink-0">{r.label}</dt>
                    <dd className="min-w-0 text-end text-pub-sm font-bold text-pub-ink" dir={r.ltr ? "ltr" : undefined}>
                      {r.href ? (
                        <a href={r.href} className="inline-flex min-h-11 items-center hover:underline">
                          {r.value}
                        </a>
                      ) : (
                        r.value
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {contact.socials.length > 0 && (
                <ul className="mt-2 flex flex-col">
                  {contact.socials.map((soc, i) => (
                    <li key={i} className="border-t border-pub-line">
                      <a
                        href={safeHref(soc.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-11 items-center justify-between gap-3 py-2 text-pub-sm font-bold text-pub-ink hover:underline"
                      >
                        {ar ? soc.labelAr || soc.url : soc.labelEn || soc.url}
                        <ArrowGlyph />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </aside>
      </PageBody>
    </div>
  );
}

/** https-only guard for external social hrefs (schema + link safety). */
function safeHref(url: string): string {
  return safeHttpsUrl(url) ?? "#";
}
