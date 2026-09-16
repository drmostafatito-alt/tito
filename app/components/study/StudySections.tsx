/**
 * Study-surface sections under the subject cards (visual brief §16/§17).
 *
 * All three are DATA-DRIVEN — they render real published facts or disappear:
 *   MaterialKindsSection  which material kinds actually exist in the published
 *                         lessons right now, with the real number of lessons
 *                         that contain each one (no "we have thousands of
 *                         videos", no capability marketing);
 *   StartSteps            how the academic path works on this platform
 *                         (مادة → ترم → درس) — process, not a claim;
 *   KnowledgeBanner       a soft-blue band carrying the Marx slot, one honest
 *                         sentence about how the content is organised, and the
 *                         same real CTA as the hero.
 */
import { Icon } from "~/cms/icons";
import { PhilosopherSlot, PHILOSOPHER_BY_AREA } from "~/components/study/PhilosopherSlot";
import { t, type Locale } from "~/lib/i18n";
import { contentKindIcon, contentKindLabelKey, countLabel, type StudyContentKind } from "~/lib/study-view";

export interface MaterialKindFact {
  kind: StudyContentKind;
  /** published lessons that actually contain this kind of material */
  lessonCount: number;
}

export function MaterialKindsSection({ locale, facts }: { locale: Locale; facts: MaterialKindFact[] }) {
  if (facts.length === 0) return null;
  return (
    <section aria-labelledby="study-materials-title" data-testid="study-materials" className="mt-12">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 id="study-materials-title" className="text-xl font-bold text-navy-900">
            {t(locale, "study.materialsTitle")}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{t(locale, "study.materialsBody")}</p>
        </div>
      </header>

      <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {facts.map((fact) => (
          <li
            key={fact.kind}
            data-material={fact.kind}
            className="flex items-center gap-3 rounded-[1.25rem] border border-navy-100 bg-white p-4 shadow-sm"
          >
            <span aria-hidden="true" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-navy-50 text-navy-700 ring-1 ring-navy-100">
              <Icon name={contentKindIcon(fact.kind)} size="md" colorRole="default" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-navy-900">{t(locale, contentKindLabelKey(fact.kind))}</p>
              <p className="text-xs text-slate-500">{countLabel(locale, fact.lessonCount, "lessons")}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function StartSteps({ locale }: { locale: Locale }) {
  const steps = [
    { icon: "book-open", titleKey: "study.stepSubjectTitle", bodyKey: "study.stepSubjectBody" },
    { icon: "layers", titleKey: "study.stepTermTitle", bodyKey: "study.stepTermBody" },
    { icon: "play-circle", titleKey: "study.stepLessonTitle", bodyKey: "study.stepLessonBody" },
  ];
  return (
    <section aria-labelledby="study-start-title" data-testid="study-start" className="mt-12">
      <h2 id="study-start-title" className="text-xl font-bold text-navy-900">
        {t(locale, "study.startTitle")}
      </h2>
      <ol className="mt-5 grid gap-3 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.titleKey} className="relative rounded-[1.25rem] border border-navy-100 bg-white p-5 shadow-sm">
            <span aria-hidden="true" className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-navy-50 text-navy-700 ring-1 ring-navy-100">
              <Icon name={step.icon} size="sm" colorRole="default" className="h-5 w-5" />
            </span>
            <p className="mt-3 flex items-center gap-2 text-base font-bold text-navy-900">
              <span aria-hidden="true" className="text-xs font-bold tabular-nums text-gold-600">{`0${index + 1}`}</span>
              {t(locale, step.titleKey)}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{t(locale, step.bodyKey)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function KnowledgeBanner({ locale }: { locale: Locale }) {
  return (
    <section className="relative mt-12 overflow-hidden rounded-[1.5rem] border border-navy-100 bg-navy-50/60 p-5 sm:p-7" data-testid="study-knowledge-banner">
      <PhilosopherSlot id={PHILOSOPHER_BY_AREA.knowledgeBanner} size="banner" className="-bottom-8 -end-6 hidden opacity-[0.18] sm:block" />
      <div className="relative max-w-2xl">
        <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-navy-700 shadow-sm">
          <Icon name="lightbulb" size="sm" colorRole="default" className="h-3.5 w-3.5 text-gold-500" />
          {t(locale, "study.knowledgeEyebrow")}
        </p>
        <h2 className="mt-3 text-xl font-bold text-navy-900 sm:text-2xl">{t(locale, "study.knowledgeTitle")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-base">{t(locale, "study.knowledgeBody")}</p>
        <a
          href="#study-subjects"
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-semibold text-navy-800 shadow-sm ring-1 ring-navy-100 transition-colors hover:bg-navy-50"
        >
          {t(locale, "study.heroCta")}
          <span aria-hidden="true" className="inline-block rtl:rotate-180">→</span>
        </a>
      </div>
    </section>
  );
}
