/**
 * المحتوى التعليمي hero — white-first, soft blue, one small gold accent.
 *
 * Composition (visual brief §6/§7/§30):
 *   · white card, generous padding, soft blue glow + a faint dotted lattice;
 *   · start side: eyebrow (the owner's real tagline), the page heading, one
 *     factual subtitle, the REAL counts that exist on the page today
 *     (subjects / current academic year / free lessons) and two CTAs — browse
 *     the subjects, or open the activation flow;
 *   · end side: the teacher identity panel (real photo binding, untouched);
 *   · a reserved philosopher slot, cropped by the card edge, behind everything.
 *
 * Nothing here is invented: counts come from published rows, the year comes from
 * the owner's academic-year rows, and the identity comes from identity settings.
 */
import { Link, useRouteLoaderData } from "react-router";
import { Icon } from "~/cms/icons";
import { PhilosopherSlot, PHILOSOPHER_BY_AREA } from "~/components/study/PhilosopherSlot";
import { TeacherPanel } from "~/components/study/TeacherPanel";
import { t, type Locale } from "~/lib/i18n";
import { countLabel } from "~/lib/study-view";

export interface StudyHeroProps {
  subjectCount: number;
  lessonCount: number;
  freeLessonCount: number;
  /** real current academic year label (owner row) — null when none is published */
  currentYear: string | null;
  teacher: { name: string; title: string; photoUrl: string | null } | null;
  /** platform tagline from identity settings (real owner copy) */
  tagline: string;
}

export function StudyHero(props: StudyHeroProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";

  return (
    <section
      className="fade-up glow-soft relative overflow-hidden rounded-[1.5rem] border border-navy-100 bg-white p-5 shadow-sm sm:rounded-[1.75rem] sm:p-8"
      data-testid="study-hero"
    >
      {/* Decoration layer — all aria-hidden, all behind the content. */}
      <span aria-hidden="true" className="dotted-grid pointer-events-none absolute inset-y-0 end-0 hidden w-1/3 opacity-[0.18] sm:block" />
      <PhilosopherSlot
        id={PHILOSOPHER_BY_AREA.hubHero}
        size="card"
        opacity={0.12}
        className="-bottom-14 -end-12 hidden h-52 w-52 sm:block sm:h-60 sm:w-60"
      />

      {/* Mobile order: copy → teacher → CTAs (thumb-friendly). On lg the copy and
          the CTAs share the start column and the teacher identity takes the end
          column, vertically centred. */}
      <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem] lg:grid-rows-[auto_auto] lg:items-start lg:gap-x-10 lg:gap-y-6">
        <div className="order-1 min-w-0 lg:col-start-1 lg:row-start-1">
          {props.tagline && (
            <p className="inline-flex items-center gap-2 rounded-full bg-navy-50 px-3 py-1 text-xs font-semibold text-navy-700">
              <Icon name="sparkles" size="sm" colorRole="default" className="h-3.5 w-3.5 text-gold-500" />
              {props.tagline}
            </p>
          )}

          <h1 className="mt-3 text-3xl font-extrabold leading-tight text-navy-900 sm:text-4xl">
            {t(locale, "study.title")}
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-600 sm:text-base">
            {t(locale, "study.heroLead")}
          </p>

          <ul className="mt-5 flex flex-wrap items-center gap-2 text-sm">
            {props.subjectCount > 0 && (
              <li
                className="inline-flex items-center gap-2 rounded-xl border border-navy-100 bg-navy-50/70 px-3 py-2 font-medium text-navy-800"
                data-testid="study-hero-subjects"
              >
                <Icon name="book-open" size="sm" colorRole="default" className="h-4 w-4 text-navy-500" />
                {countLabel(locale, props.subjectCount, "subjects")}
              </li>
            )}
            {props.lessonCount > 0 && (
              <li
                className="inline-flex items-center gap-2 rounded-xl border border-navy-100 bg-navy-50/70 px-3 py-2 font-medium text-navy-800"
                data-testid="study-hero-lessons"
              >
                <Icon name="layers" size="sm" colorRole="default" className="h-4 w-4 text-navy-500" />
                {countLabel(locale, props.lessonCount, "lessons")}
              </li>
            )}
            {props.freeLessonCount > 0 && (
              <li
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 font-medium text-emerald-800"
                data-testid="study-hero-free"
              >
                <Icon name="check-circle" size="sm" colorRole="default" className="h-4 w-4 text-emerald-600" />
                {t(locale, "study.freeLessonsChip")}
              </li>
            )}
            {/* The academic year is the owner's own row — rendered only when one
                really exists, never hardcoded. */}
            {props.currentYear && (
              <li
                className="inline-flex items-center gap-2 rounded-xl border border-navy-100 bg-white px-3 py-2 font-medium text-navy-800 shadow-sm"
                data-testid="study-current-year"
              >
                <Icon name="calendar" size="sm" colorRole="default" className="h-4 w-4 text-navy-500" />
                <span className="text-xs text-slate-500">{t(locale, "study.currentYearLabel")}</span>
                <span dir="ltr" className="font-bold tabular-nums text-navy-900">{props.currentYear}</span>
              </li>
            )}
          </ul>

        </div>

        {props.teacher && (
          <div className="order-2 min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:w-full lg:self-center">
            <TeacherPanel
              locale={locale}
              name={props.teacher.name}
              title={props.teacher.title}
              photoUrl={props.teacher.photoUrl}
            />
          </div>
        )}

        <div className="order-3 flex flex-wrap items-center gap-3 lg:col-start-1 lg:row-start-2">
          <a
            href="#study-subjects"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-navy-800 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-900"
            data-testid="study-hero-cta"
          >
            {t(locale, "study.heroCta")}
            <span aria-hidden="true" className="inline-block rtl:rotate-180">→</span>
          </a>
          <Link
            to="/activate"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-navy-200 bg-white px-5 py-2.5 text-sm font-semibold text-navy-800 transition-colors hover:border-navy-300 hover:bg-navy-50"
            data-testid="study-hero-activate"
          >
            <Icon name="tag" size="sm" colorRole="default" className="h-4 w-4 text-navy-500" />
            {t(locale, "content.lockedActivate")}
          </Link>
        </div>
      </div>
    </section>
  );
}
