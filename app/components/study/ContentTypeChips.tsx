import { Icon } from "~/cms/icons";
import { t, type Locale } from "~/lib/i18n";
import { contentKindIcon, contentKindLabelKey, type StudyContentKind } from "~/lib/study-view";

/**
 * Material chips for one lesson (PART 4/8/9): الفيديو · PDF · الملفات · التدريبات.
 *
 * Renders ONLY the kinds the lesson really owns — the list comes from real
 * `lesson_items` rows joined to the referenced file's recorded kind, so a lesson
 * with a PDF and nothing else shows exactly one chip and no video affordance.
 * Nothing is inferred from the lesson title or from other lessons.
 */
export function ContentTypeChips({
  kinds,
  locale,
  className = "",
}: {
  kinds: StudyContentKind[];
  locale: Locale;
  className?: string;
}) {
  if (kinds.length === 0) return null;
  return (
    <ul
      className={`flex flex-wrap items-center gap-1.5 ${className}`}
      aria-label={t(locale, "study.materialsAria")}
      data-testid="study-material-chips"
    >
      {kinds.map((kind) => (
        <li
          key={kind}
          data-material={kind}
          className="inline-flex items-center gap-1.5 rounded-lg bg-navy-50/80 px-2.5 py-1 text-xs font-medium text-navy-700 ring-1 ring-navy-100"
        >
          <Icon name={contentKindIcon(kind)} size="sm" colorRole="default" className="h-3.5 w-3.5 text-navy-500" />
          <span>{t(locale, contentKindLabelKey(kind))}</span>
        </li>
      ))}
    </ul>
  );
}

/** Explicit, honest state for a lesson that has no uploaded material yet. */
export function NoMaterialsNote({ locale, className = "" }: { locale: Locale; className?: string }) {
  return (
    <p className={`text-xs text-slate-500 ${className}`} data-testid="study-lesson-no-materials">
      {t(locale, "study.noMaterials")}
    </p>
  );
}
