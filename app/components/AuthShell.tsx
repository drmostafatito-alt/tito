import { useRouteLoaderData } from "react-router";
import { BrandMark } from "~/components/BrandMark";
import { Card } from "~/components/ui/Card";
import type { Locale } from "~/lib/i18n";

/**
 * Auth pages share one brand moment: the seal, a display title, and a calm
 * card. Behavior (forms, actions, validation) lives in the routes.
 */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const root = useRouteLoaderData("root") as
    | { locale: Locale; platform: { nameAr: string; nameEn: string } }
    | undefined;
  const locale = root?.locale ?? "ar";
  const appName =
    locale === "ar" ? (root?.platform.nameAr ?? "") : (root?.platform.nameEn ?? "");

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-12 sm:py-16">
      <div className="mb-7 flex flex-col items-center gap-3 text-center">
        <BrandMark name={appName} locale={locale} compact />
        <span aria-hidden="true" className="h-1 w-10 rounded-full bg-accent-500" />
        <h1 className="font-display text-3xl font-semibold leading-snug text-ink">{title}</h1>
        {subtitle && (
          <p className="max-w-sm text-[15px] leading-relaxed text-ink-muted">{subtitle}</p>
        )}
      </div>
      <Card className="p-6 sm:p-8">{children}</Card>
    </div>
  );
}
