/**
 * <PageHeader> — the shared template header for the public catalogue pages.
 *
 * It keeps the many-thinker identity running through the whole site: each page
 * passes the one engraving that fits its subject (a philosopher, an emblem or
 * the colonnade frieze), and the header renders it cropped into the card corner,
 * behind the copy, `aria-hidden`, faint, and hidden on phones where the page
 * needs every pixel for content.
 *
 * It is deliberately a thin wrapper around the existing markup: the same `h1`
 * (SEO tests and screen-reader landmarks depend on it), the same optional
 * subtitle, plus whatever badges/links the page already had as `children`.
 */
import { Art } from "~/components/visuals/Art";
import type { ArtName } from "~/lib/art";

export interface PageHeaderProps {
  /** engraved line-art that identifies this page (decorative only) */
  art: ArtName;
  title: string;
  subtitle?: string | null | undefined;
  /** existing badges, breadcrumb links or meta rows — rendered below the title */
  children?: React.ReactNode;
}

export function PageHeader({ art, title, subtitle, children }: PageHeaderProps) {
  return (
    <header className="glow-soft relative isolate mb-6 overflow-hidden rounded-[1.5rem] border border-navy-100 bg-white p-5 shadow-sm sm:p-6" data-page-header>
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-10 -end-10 hidden h-48 w-48 select-none opacity-[0.09] sm:block">
        <Art name={art} />
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-6 bottom-0 hidden select-none opacity-[0.05] md:block">
        <Art name="columns" className="h-14 w-full" />
      </div>
      <div className="relative min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight text-navy-900 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">{subtitle}</p>}
        {children}
      </div>
    </header>
  );
}
