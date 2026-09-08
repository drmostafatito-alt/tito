import type { Route } from "./+types/public.products.$slug";
import { Link, useRouteLoaderData } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { publicProductBySlug } from "~server/commerce/service.server";
import { resolvePublicImageUrls } from "~server/cms/render.server";
import { formatMoney } from "~server/commerce/money";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody } from "~/components/ui/Card";
import { contentSeoMeta, rootMetaFrom } from "~/cms/seo";
import { t, type Locale } from "~/lib/i18n";

/**
 * Public product page (Phase 6): what's on offer, at which prices — server-read
 * only (effectivePriceMinor evaluates promo windows on the server clock). The
 * buy CTA leads to /checkout/:slug inside the authenticated student area;
 * anonymous visitors are sent to login with a return path.
 */
export async function loader({ context, params, request }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const view = await publicProductBySlug(db, String(params.slug ?? ""));
  if (!view) throw new Response("Not found", { status: 404 });
  const images = view.product.thumbnailFileId
    ? await resolvePublicImageUrls(db, [view.product.thumbnailFileId])
    : {};
  let viewer: { userId: string | null; rank: number } = { userId: null, rank: 0 };
  try {
    const { auth } = await requireUser(context, request);
    viewer = { userId: auth.user.id, rank: auth.user.rank };
  } catch {
    viewer = { userId: null, rank: 0 };
  }
  return {
    product: {
      slug: view.product.slug,
      kind: view.product.kind,
      nameAr: view.product.nameAr,
      nameEn: view.product.nameEn,
      descriptionAr: view.product.descriptionAr,
      descriptionEn: view.product.descriptionEn,
    },
    plans: view.plans.map((p) => ({
      id: p.id,
      kind: p.kind,
      period: p.period,
      periodDays: p.periodDays,
      labelAr: p.labelAr,
      labelEn: p.labelEn,
      currency: p.currency,
      effectiveMinor: p.effectiveMinor,
      compareAtMinor: p.compareAtMinor,
      promoActive: p.promoPriceMinor !== null && p.effectiveMinor === p.promoPriceMinor,
    })),
    itemsCount: view.items.length,
    imageUrl: (view.product.thumbnailFileId && images[view.product.thumbnailFileId]) || null,
    loggedIn: viewer.userId !== null,
    url: request.url,
  };
}

const PERIOD_KEY: Record<string, string> = {
  monthly: "commerce.periodMonthly",
  term: "commerce.periodTerm",
  annual: "commerce.periodAnnual",
  custom: "commerce.periodCustom",
  fixed_date: "commerce.periodFixed",
};

/** SEO/social preview from the admin-edited product row (Admin → Commerce). */
export function meta({ loaderData, matches }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Not Found" }];
  const root = rootMetaFrom(matches);
  return contentSeoMeta(
    {
      title: { ar: loaderData.product.nameAr, en: loaderData.product.nameEn },
      description: { ar: loaderData.product.descriptionAr, en: loaderData.product.descriptionEn },
    },
    root.locale,
    loaderData.url,
    { ogImageUrl: loaderData.imageUrl, siteName: root.siteName }
  );
}

export default function ProductPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { product, plans, imageUrl, loggedIn } = loaderData;
  const name = locale === "ar" ? product.nameAr : product.nameEn;
  const description = locale === "ar" ? product.descriptionAr : product.descriptionEn;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <nav className="text-xs text-ink-muted" aria-label={t(locale, "common.breadcrumb")}>
        <Link to="/courses" className="hover:text-brand-700">{t(locale, "content.catalogTitle")}</Link>
        <span aria-hidden="true"> › </span>
        <span className="text-ink-soft">{name}</span>
      </nav>

      <Card>
        <CardBody className="space-y-4">
          {imageUrl && (
            <img src={imageUrl} alt="" className="h-44 w-full rounded-xl object-cover" />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold">{name}</h1>
            <Badge tone="brand">{t(locale, `commerce.kind_${product.kind}` as never)}</Badge>
          </div>
          {description && <p className="text-sm leading-6 text-ink-muted whitespace-pre-line">{description}</p>}

          <div className="space-y-3 pt-2" data-testid="product-plans">
            {plans.length === 0 && (
              <p className="text-sm text-ink-muted">{t(locale, "commerce.noPlans")}</p>
            )}
            {plans.map((plan) => {
              const label = (locale === "ar" ? plan.labelAr : plan.labelEn) ||
                (plan.period ? t(locale, PERIOD_KEY[plan.period] as never) : t(locale, "commerce.oneTime"));
              return (
                <div
                  key={plan.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4"
                >
                  <div>
                    <p className="font-semibold">{label}</p>
                    <p className="text-xs text-ink-muted">
                      {plan.kind === "recurring" ? t(locale, "commerce.recurring") : t(locale, "commerce.oneTime")}
                      {plan.period === "custom" && plan.periodDays
                        ? ` · ${t(locale, "commerce.daysCount").replace("{n}", String(plan.periodDays))}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-end">
                      {plan.compareAtMinor !== null && plan.compareAtMinor > plan.effectiveMinor && (
                        <p className="text-xs text-ink-muted line-through" dir="ltr">
                          {formatMoney(plan.compareAtMinor, plan.currency)}
                        </p>
                      )}
                      <p className="text-lg font-bold text-brand-700" dir="ltr" data-testid="plan-price">
                        {formatMoney(plan.effectiveMinor, plan.currency)}
                      </p>
                      {plan.promoActive && <p className="text-xs font-semibold text-warning">{t(locale, "commerce.promo")}</p>}
                    </div>
                    {loggedIn ? (
                      <Link
                        to={`/checkout/${product.slug}?plan=${plan.id}`}
                        className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800"
                        data-testid="buy-cta"
                      >
                        {t(locale, "commerce.buyNow")}
                      </Link>
                    ) : (
                      <Link
                        to={`/login?next=/products/${product.slug}`}
                        className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800"
                      >
                        {t(locale, "commerce.loginToBuy")}
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-ink-muted">
            <Link to="/activate" className="underline hover:text-brand-700">{t(locale, "commerce.haveCode")}</Link>
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
