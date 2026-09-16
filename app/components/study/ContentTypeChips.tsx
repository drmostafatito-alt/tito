import { Icon } from "~/cms/icons";
import { t, type Locale } from "~/lib/i18n";
import type { StudyItemKind } from "~/lib/thinkers";

const META: Record<StudyItemKind, { icon: string; key: "study.typeVideo" | "study.typePdf" | "study.typeFile" | "study.typeQuiz" }> = {
  video: { icon: "play-circle", key: "study.typeVideo" },
  pdf: { icon: "file-text", key: "study.typePdf" },
  file: { icon: "download", key: "study.typeFile" },
  quiz: { icon: "pencil", key: "study.typeQuiz" },
};

export function ContentTypeChips({
  kinds,
  locale,
}: {
  kinds: StudyItemKind[];
  locale: Locale;
}) {
  if (!kinds.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {kinds.map((k) => (
        <li
          key={k}
          className="inline-flex items-center gap-1 rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-medium text-navy-700 ring-1 ring-navy-100"
        >
          <Icon name={META[k].icon} size="sm" colorRole="brand" className="h-3.5 w-3.5 text-navy-600" />
          {t(locale, META[k].key)}
        </li>
      ))}
    </ul>
  );
}
