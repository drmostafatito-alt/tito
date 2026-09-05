import type { Route } from "./+types/home";
import { Link, useRouteLoaderData } from "react-router";
import { Card } from "~/components/ui/Card";
import { t, type Locale } from "~/lib/i18n";

export default function Home() {
  const root = useRouteLoaderData("root") as { locale: Locale; platform: { nameAr: string; nameEn: string; taglineAr: string; taglineEn: string } };
  const locale = root?.locale ?? "ar";
  const tagline = locale === "ar" ? root.platform.taglineAr : root.platform.taglineEn;
  const appName = locale === "ar" ? root.platform.nameAr : root.platform.nameEn;

  const features = [
    { icon: "📚", title: t(locale, "home.f1t"), body: t(locale, "home.f1d") },
    { icon: "📈", title: t(locale, "home.f2t"), body: t(locale, "home.f2d") },
    { icon: "📝", title: t(locale, "home.f3t"), body: t(locale, "home.f3d") },
  ];

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 py-16 text-center sm:py-24">
          <h1 className="max-w-2xl text-3xl font-bold leading-tight text-slate-900 sm:text-5xl">
            {appName}
          </h1>
          <p className="max-w-xl text-lg text-slate-600">{tagline}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              to="/register"
              className="rounded-lg bg-accent-500 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-accent-600"
            >
              {t(locale, "home.heroCtaPrimary")}
            </Link>
            <Link
              to="/login"
              className="rounded-lg border border-brand-200 bg-white px-6 py-3 text-base font-semibold text-brand-700 hover:bg-brand-50"
            >
              {t(locale, "home.heroCtaSecondary")}
            </Link>
          </div>
          <p className="text-xs text-slate-400">{t(locale, "home.phase2Note")}</p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-6xl px-4 py-14">
        <h2 className="mb-8 text-center text-2xl font-bold text-slate-900">
          {t(locale, "home.featuresTitle")}
        </h2>
        <div className="grid gap-5 sm:grid-cols-3">
          {features.map((f) => (
            <Card key={f.title} className="p-6 text-center">
              <div className="mb-3 text-3xl" aria-hidden="true">
                {f.icon}
              </div>
              <h3 className="mb-1.5 font-semibold text-slate-900">{f.title}</h3>
              <p className="text-sm leading-relaxed text-slate-600">{f.body}</p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
