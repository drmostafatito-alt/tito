import { Link } from "react-router";
import { Icon } from "~/cms/icons";
import { PhilosopherSlot } from "~/components/study/PhilosopherSlot";
import { t, type Locale } from "~/lib/i18n";
import { countLabel, subjectIcon } from "~/lib/study-view";

/**
 * One subject card in المحتوى التعليمي — modern white card, soft blue support
 * colour, gold only as a hairline accent.
 *
 * Layout (visual brief §9/§30): icon tile + title + grade at the top, the
 * owner's description, a row of COMPACT INFO BLOCKS carrying the real numbers
 * (terms · lessons · free lessons), then the academic year and the CTA
 * «استعرض المحتوى». Counts are published rows only; a subject with nothing
 * published is never returned by the hub query, so no block can ever advertise
 * content that does not exist.
 *
 * The whole card is one link (stretched title link): one tab stop, a large touch
 * target, and the CTA is a visual affordance rather than a second link — the
 * mobile behaviour stays a stacked, thumb-friendly card.
 *
 * The philosopher illustration sits in a RESERVED, EMPTY slot (see
 * PhilosopherSlot): cropped by the card's end corner, behind the copy, aria-hidden
 * — Aristotle for فلسفة ومنطق, Freud for علم النفس, supplied by the caller. No
 * imagery ships in this phase; the geometry is already final.
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
  /** reserved illustration slot for this subject (e.g. aristotle / freud) */
  slotId: "aristotle" | "freud" | "marx" | "socrates" | "plato" | "descartes" | "kant" | "nietzsche" | "ibn-rushd" | "ibn-sina";
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
    <li data-testid={`study-subject-${props.slug}`} className="h-full">
      <article className="group relative flex h-full flex-col overflow-hidden rounded-[1.5rem] border border-navy-100 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-navy-200 hover:shadow-md sm:p-6">
        <PhilosopherSlot
          id={props.slotId}
          opacity={0.12}
          boostOnHover
          className="-bottom-16 -end-12 h-48 w-48 sm:h-56 sm:w-56"
        />

        {/* md+: copy at the start, the real numbers + CTA in a narrow end column,
            so a single-subject grade does not leave a wide empty card. */}
        <div className="relative flex min-w-0 flex-1 flex-col gap-5 md:flex-row md:items-end md:justify-between md:gap-8">
          <div className="min-w-0 md:flex-1">
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-navy-50 text-navy-800 ring-1 ring-navy-100"
              >
                <Icon name={subjectIcon(title, props.slug)} size="md" colorRole="default" className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold leading-snug text-navy-900">
                  <Link
                    to={`/study/${props.slug}`}
                    className="break-words rounded-sm after:absolute after:inset-0 after:rounded-[1.5rem] group-hover:text-navy-700"
                    aria-label={`${title} — ${t(locale, "study.exploreSubject")}`}
                  >
                    {title}
                  </Link>
                </h3>
                <p className="mt-1 text-xs font-medium text-slate-500">{grade}</p>
              </div>
            </div>

            {description && (
              <p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-relaxed text-slate-600">{description}</p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {program && (
                <span className="rounded-full bg-navy-50 px-3 py-1 text-[11px] font-medium text-navy-600">{program}</span>
              )}
              {years.length > 0 && (
                <ul className="flex flex-wrap items-center gap-1.5" data-testid={`study-subject-years-${props.slug}`}>
                  <li className="text-[11px] text-slate-500">{t(locale, "study.yearLabel")}:</li>
                  {years.map((y) => (
                    <li key={y} dir="ltr" className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700">
                      {y}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Compact information blocks — real published counts only. */}
          <div className="flex shrink-0 flex-col gap-3 md:w-[15rem]">
            <ul className="grid grid-cols-3 gap-2">
              <li className="rounded-xl bg-navy-50/70 px-3 py-2">
                <span className="block text-sm font-bold tabular-nums text-navy-900">{props.termCount}</span>
                <span className="text-[11px] text-slate-500">{t(locale, "study.termUnit")}</span>
              </li>
              <li className="rounded-xl bg-navy-50/70 px-3 py-2">
                <span className="block text-sm font-bold tabular-nums text-navy-900">{props.lessonCount}</span>
                <span className="text-[11px] text-slate-500">{t(locale, "study.lessonUnit")}</span>
              </li>
              <li
                className={`rounded-xl px-3 py-2 ${props.freeLessonCount > 0 ? "bg-emerald-50" : "bg-navy-50/70"}`}
                data-testid={`study-subject-free-${props.slug}`}
              >
                <span className={`block text-sm font-bold tabular-nums ${props.freeLessonCount > 0 ? "text-emerald-700" : "text-navy-900"}`}>
                  {props.freeLessonCount}
                </span>
                <span className="text-[11px] text-slate-500">{t(locale, "study.freeUnit")}</span>
              </li>
            </ul>

            {/* One link only: the title link stretches over the whole card, so the
                CTA is an affordance, never a second tab stop or a dead button. */}
            <span className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-navy-800 px-5 py-2.5 text-sm font-semibold text-white transition-colors group-hover:bg-navy-900">
              {t(locale, "study.exploreSubject")}
              <span aria-hidden="true" className="inline-block rtl:rotate-180">→</span>
            </span>
          </div>
        </div>
      </article>
    </li>
  );
}
