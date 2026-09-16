import { Link } from "react-router";
import { Icon } from "~/cms/icons";
import { DecorRings } from "~/components/visuals/PhilosophyDecor";
import { t, type Locale } from "~/lib/i18n";
import { countLabel } from "~/lib/study-view";

/**
 * One subject in the المحتوى التعليمي hub (PART 32): المادة + الصف + المرحلة +
 * counts of REALLY published content + the academic year(s) it is offered in.
 *
 * The whole card is a single link (stretched title link) — one tab stop, a large
 * touch target, and the CTA is a visual affordance rather than a second link.
 * Counts come from the loader (published term containers / published lessons) and
 * a subject with no published term at all is never listed by the hub query, so
 * the card can never advertise content that does not exist.
 *
 * IDENTITY (Phase: visuals not generated yet): the ornament is the existing
 * SVG-only academic motif in Tito's gold. The reserved slot for a future
 * philosopher portrait is the bottom-left corner behind the meta row — see
 * docs/reports/student-content-experience-report.md §VISUAL PLAN. No image is
 * shipped in this phase and the layout is complete without one.
 */
export interface SubjectCardProps {
  locale: Locale;
  slug: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  gradeTitleAr: string;
  gradeTitleEn: string;
  programTitleAr: string;
  programTitleEn: string;
  termCount: number;
  lessonCount: number;
  freeLessonCount: number;
  years: Array<{ id: string; titleAr: string; titleEn: string }>;
}

export function SubjectCard(props: SubjectCardProps) {
  const { locale } = props;
  const ar = locale === "ar";
  const pick = (a: string | null, b: string | null) => (ar ? a || b || "" : b || a || "");
  const title = pick(props.titleAr, props.titleEn) || "—";
  const description = pick(props.descriptionAr, props.descriptionEn);
  const grade = pick(props.gradeTitleAr, props.gradeTitleEn);
  const program = pick(props.programTitleAr, props.programTitleEn);
  const years = props.years.map((y) => pick(y.titleAr, y.titleEn)).filter(Boolean);

  return (
    <li data-testid={`study-subject-${props.slug}`}>
      <article className="group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-navy-100 bg-white p-5 shadow-sm transition-all hover:border-gold-300 hover:shadow-md">
        {/* Decorative academic motif — the component is aria-hidden + pointer-safe
            by construction (see PhilosophyDecor), and sits behind the card copy. */}
        <DecorRings className="pointer-events-none absolute -bottom-20 -end-16 h-44 w-44 text-gold-500 opacity-[0.10]" />

        <div className="relative flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-navy-900 px-3 py-1 text-xs font-semibold text-white">{grade}</span>
          {program && (
            <span className="inline-flex items-center rounded-full border border-gold-200 bg-gold-50 px-3 py-1 text-xs font-medium text-gold-800">
              {program}
            </span>
          )}
        </div>

        <h3 className="relative mt-3 flex items-start gap-2 text-lg font-bold leading-snug text-navy-900">
          <Icon name="book-open" size="md" colorRole="default" className="mt-0.5 h-5 w-5 text-gold-600" />
          <Link
            to={`/study/${props.slug}`}
            className="break-words rounded-sm after:absolute after:inset-0 after:rounded-[var(--radius-card)]"
            aria-label={`${title} — ${t(locale, "study.exploreSubject")}`}
          >
            {title}
          </Link>
        </h3>

        {description && <p className="relative mt-2 line-clamp-3 text-sm text-slate-600">{description}</p>}

        <ul className="relative mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
          <li className="flex items-center gap-1.5">
            <Icon name="layers" size="sm" colorRole="default" className="h-3.5 w-3.5 text-navy-400" />
            <span>{countLabel(locale, props.termCount, "terms")}</span>
          </li>
          <li className="flex items-center gap-1.5">
            <Icon name="book-open" size="sm" colorRole="default" className="h-3.5 w-3.5 text-navy-400" />
            <span>{countLabel(locale, props.lessonCount, "lessons")}</span>
          </li>
          {props.freeLessonCount > 0 && (
            <li className="flex items-center gap-1.5 font-medium text-emerald-700" data-testid={`study-subject-free-${props.slug}`}>
              <Icon name="check-circle" size="sm" colorRole="default" className="h-3.5 w-3.5 text-emerald-600" />
              <span>{t(locale, "study.freeLessonsChip")}</span>
            </li>
          )}
        </ul>

        {years.length > 0 && (
          <ul className="relative mt-3 flex flex-wrap items-center gap-1.5" data-testid={`study-subject-years-${props.slug}`}>
            <li className="text-xs text-slate-500">{t(locale, "study.yearLabel")}:</li>
            {years.map((y) => (
              <li key={y} dir="ltr" className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700">
                {y}
              </li>
            ))}
          </ul>
        )}

        <div className="relative mt-5 flex-1" />

        <span className="relative inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-navy-800 px-5 py-2 text-sm font-semibold text-white transition-colors group-hover:bg-navy-900">
          {t(locale, "study.exploreSubject")}
          <span aria-hidden="true" className="inline-block rtl:rotate-180">→</span>
        </span>
      </article>
    </li>
  );
}
