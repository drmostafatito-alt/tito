import { Icon } from "~/cms/icons";
import { t, type Locale } from "~/lib/i18n";
import type { StudyItemKind } from "~/lib/thinkers";

const META: Record<StudyItemKind, { icon: string; key: "study.typeVideo" | "study.typePdf" | "study.typeFile" | "study.typeQuiz" }> = {
  video: { icon: "play-circle", key: "study.typeVideo" },
  pdf: { icon: "file-text", key: "study.typePdf" },
  file: { icon: "download", key: "study.typeFile" },
  quiz: { icon: "pencil", key: "study.typeQuiz" },
};

/**
 * What a lesson actually contains, as glyphs.
 *
 * In the index grammar these are not chips in boxes: they are small marks in
 * the meta line, with the label kept for screen readers and shown from `sm` up
 * where the row has room. A student scanning a term reads the shape of a lesson
 * (video? notes? exercise?) before they read its title.
 */
export function ContentTypeChips({ kinds, locale }: { kinds: StudyItemKind[]; locale: Locale }) {
  if (!kinds.length) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {kinds.map((k) => (
        <li key={k} className="inline-flex items-center gap-1.5 text-pub-xs font-semibold text-pub-muted">
          <Icon name={META[k].icon} size="sm" className="h-4 w-4 text-pub-ink-soft" />
          <span>{t(locale, META[k].key)}</span>
        </li>
      ))}
    </ul>
  );
}
