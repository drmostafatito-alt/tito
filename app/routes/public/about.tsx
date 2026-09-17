import type { Route } from "./+types/about";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { resolvePublicImageUrls } from "~server/cms/render.server";
import { resolveSocialLinks } from "~/cms/social";
import { subjects } from "~server/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { CARD_BODY, CARD_LINK, CARD_META, CARD_TITLE, PUB_CARD } from "~/lib/publicStyles";
import { Icon } from "~/cms/icons";
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
  const { owner, site, contact, subjects } = loaderData;
  const name = locale === "ar" ? owner.nameAr || owner.nameEn : owner.nameEn || owner.nameAr;
  const title = locale === "ar" ? owner.titleAr || owner.titleEn : owner.titleEn || owner.titleAr;
  const siteName = locale === "ar" ? site.nameAr : site.nameEn;
  const tagline = locale === "ar" ? site.taglineAr : site.taglineEn;
  const c = (row: { titleAr: string; titleEn: string }) => (locale === "ar" ? row.titleAr : row.titleEn);

  return (
    <div className="pub-section pub-container flex flex-col gap-[calc(var(--pub-gap)*2)]">
      <nav aria-label="breadcrumb" data-allow-small className={`${CARD_META} flex items-center gap-1.5`}>
        <Link to="/" className="hover:text-pub-navy">{locale === "ar" ? "الرئيسية" : "Home"}</Link>
        <span aria-hidden>›</span>
        <span className="font-medium text-pub-ink-soft">{t(locale, "seo.about")}</span>
      </nav>

      {/*
        The teacher's own picture, framed the same way as on the homepage hero:
        light surface, one gold hairline, one soft shadow. The image is shown as
        uploaded (object-contain inside a crop container) — never re-cropped into a
        square, never filtered, never replaced.
      */}
      <div className="grid items-start gap-[calc(var(--pub-gap)*1.5)] lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {owner.photoUrl && (
            <div className="relative isolate overflow-hidden rounded-pub-2xl border border-pub-line bg-pub-surface shadow-pub-md">
              <span aria-hidden="true" className="pointer-events-none absolute -end-10 -top-12 h-32 w-32 rounded-full bg-pub-tint" />
              <img
                src={owner.photoUrl}
                alt={name}
                loading="eager"
                decoding="async"
                className="relative z-[1] mx-auto block max-h-[22rem] w-full px-4 py-4 object-contain object-bottom"
              />
            </div>
          )}
          {(contact.phone || contact.email || contact.socials.length > 0 || contact.addressAr || contact.addressEn) && (
            <div className="flex flex-col gap-2">
              <h2 className={`${CARD_META} uppercase`}>{t(locale, "seo.aboutContact")}</h2>
              <ul className="flex flex-col gap-1.5 text-pub-sm text-pub-muted">
                {contact.phone && (
                  <li>
                    <a
                      dir="ltr"
                      href={`tel:${contact.phone}`}
                      className="inline-flex min-h-11 items-center hover:text-pub-navy"
                    >
                      {contact.phone}
                    </a>
                  </li>
                )}
                {contact.email && (
                  <li>
                    <a href={`mailto:${contact.email}`} className="inline-flex min-h-11 items-center hover:text-pub-navy">
                      {contact.email}
                    </a>
                  </li>
                )}
                {(locale === "ar" ? contact.addressAr : contact.addressEn) && <li>{locale === "ar" ? contact.addressAr : contact.addressEn}</li>}
                {contact.socials.length > 0 && (
                  <li className="flex flex-wrap gap-3 pt-1">
                    {contact.socials.map((soc, i) => (
                      <a
                        key={i}
                        href={safeHref(soc.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${CARD_LINK} inline-flex min-h-11 items-center`}
                      >
                        {locale === "ar" ? soc.labelAr || soc.url : soc.labelEn || soc.url}
                      </a>
                    ))}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="text-pub-h1 font-extrabold text-pub-navy [overflow-wrap:anywhere]">{name}</h1>
          {title && <p className="text-pub-md font-medium text-pub-ink-soft">{title}</p>}
          <p className={`${CARD_BODY} pub-measure`}>{t(locale, "seo.aboutBio", { name: siteName, tagline })}</p>
          {owner.aboutImageUrl && (
            <div className="mt-2 overflow-hidden rounded-pub-2xl border border-pub-line bg-pub-surface shadow-pub-card">
              <img src={owner.aboutImageUrl} alt={name} loading="lazy" decoding="async" className="max-h-[26rem] w-full object-contain" />
            </div>
          )}
          {subjects.length > 0 && (
            <section className="mt-2 flex flex-col gap-3">
              <h2 className={`${CARD_META} uppercase`}>{t(locale, "seo.aboutSubjects")}</h2>
              <ul className="pub-grid grid-cols-1 sm:grid-cols-2">
                {subjects.map((s) => (
                  <li key={s.slug} className="h-full min-w-0">
                    <Link to={`/study/${s.slug}`} className={`${PUB_CARD} min-h-[5rem] gap-1.5 p-4 sm:p-5`} data-testid={`about-subject-${s.slug}`}>
                      <h3 className={`${CARD_TITLE} min-w-0`}>
                        <Icon name="book-open" size="sm" colorRole="brand" className="shrink-0" />
                        {c(s)}
                      </h3>
                      <span className={`${CARD_LINK} mt-auto inline-flex items-center`}>
                        {locale === "ar" ? "افتح المحتوى" : "Open content"}
                        <span aria-hidden className="ms-1">→</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** https-only guard for external social hrefs (schema + link safety). */
function safeHref(url: string): string {
  return safeHttpsUrl(url) ?? "#";
}
