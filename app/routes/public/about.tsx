import type { Route } from "./+types/about";
import { Link, useRouteLoaderData } from "react-router";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getSettings } from "~server/settings/service.server";
import { resolvePublicImageUrls } from "~server/cms/render.server";
import { resolveSocialLinks } from "~/cms/social";
import { subjects } from "~server/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { Card, CardBody } from "~/components/ui/Card";
import { Icon } from "~/cms/icons";
import { rootMetaFrom, siteEntitiesMeta } from "~/cms/seo";
import { absUrl, breadcrumbJsonLd, personJsonLd, safeHttpsUrl, webPageJsonLd } from "~/cms/jsonld";
import { t, type Locale } from "~/lib/i18n";
import { Art } from "~/components/visuals/Art";

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
    <div className="mx-auto max-w-4xl px-4 py-8">
      <nav aria-label="breadcrumb" className="mb-3 text-sm text-slate-500">
        <Link to="/" className="hover:text-brand-600">{locale === "ar" ? "الرئيسية" : "Home"}</Link>
        <span className="mx-1.5" aria-hidden>›</span>
        <span className="font-medium text-slate-700">{t(locale, "seo.about")}</span>
      </nav>

      {/* Identity header — the owner's real photo keeps its own slot and is never
          replaced; the engraved line-art only sits BESIDE it, as page identity. */}
      <div className="glow-soft relative isolate overflow-hidden rounded-[1.5rem] border border-navy-100 bg-white p-5 shadow-sm sm:p-6">
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-10 -end-8 hidden h-48 w-48 select-none opacity-[0.09] sm:block">
          <Art name="plato" />
        </div>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-6 bottom-0 hidden select-none opacity-[0.05] md:block">
          <Art name="columns" className="h-14 w-full" />
        </div>
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start">
          {owner.photoUrl && (
            <img src={owner.photoUrl} alt={name} className="h-40 w-40 shrink-0 rounded-2xl object-cover ring-2 ring-white shadow-sm" />
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{name}</h1>
            {title && <p className="mt-1 font-medium text-brand-700">{title}</p>}
            <p className="mt-3 leading-relaxed text-slate-600">
              {t(locale, "seo.aboutBio", { name: siteName, tagline })}
            </p>
          </div>
        </div>
      </div>

      {owner.aboutImageUrl && (
        <img src={owner.aboutImageUrl} alt={name} className="mt-6 max-h-96 w-full rounded-2xl object-cover" />
      )}

      {subjects.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold text-slate-700">{t(locale, "seo.aboutSubjects")}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((s) => (
              <Card key={s.slug}>
                <CardBody>
                  <Link to={`/subjects/${s.slug}`} className="group block">
                    <h3 className="flex items-center gap-2 font-medium text-slate-800 group-hover:text-brand-600">
                      <Icon name="book-open" className="h-4.5 w-4.5 shrink-0 text-brand-500" aria-hidden />
                      {c(s)}
                    </h3>
                  </Link>
                </CardBody>
              </Card>
            ))}
          </div>
        </section>
      )}

      {(contact.phone || contact.email || contact.socials.length > 0 || contact.addressAr || contact.addressEn) && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold text-slate-700">{t(locale, "seo.aboutContact")}</h2>
          <div className="space-y-1.5 text-slate-600">
            {contact.phone && (
              <p dir="ltr" className="text-right">
                <a href={`tel:${contact.phone}`} className="hover:text-brand-600">{contact.phone}</a>
              </p>
            )}
            {contact.email && (
              <p>
                <a href={`mailto:${contact.email}`} className="hover:text-brand-600">{contact.email}</a>
              </p>
            )}
            {(locale === "ar" ? contact.addressAr : contact.addressEn) && (
              <p>{locale === "ar" ? contact.addressAr : contact.addressEn}</p>
            )}
            {contact.socials.length > 0 && (
              <div className="flex flex-wrap gap-3 pt-1">
                {contact.socials.map((s, i) => (
                  <a key={i} href={safeHref(s.url)} target="_blank" rel="noopener noreferrer" className="hover:text-brand-600">
                    {locale === "ar" ? s.labelAr || s.url : s.labelEn || s.url}
                  </a>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** https-only guard for external social hrefs (schema + link safety). */
function safeHref(url: string): string {
  return safeHttpsUrl(url) ?? "#";
}
