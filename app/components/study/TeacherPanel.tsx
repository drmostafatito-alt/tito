/**
 * Teacher identity panel (hero side of المحتوى التعليمي).
 *
 * THE PHOTO IS NOT OURS TO CHANGE (visual brief §1/§7): the panel reads the very
 * same binding the rest of the platform already uses —
 * `settings.identity.ownerPhotoFileId` resolved through
 * `resolvePublicImageUrls` — and renders it with the same crop behaviour the
 * existing `teacher_profile` block and /about use (`object-cover` in a rounded
 * frame, `alt` = the configured owner name). No placeholder photo, no stock
 * image, no AI portrait, no fallback asset: when the owner has not uploaded a
 * photo the panel shows a typographic monogram derived from the REAL configured
 * name, which cannot be mistaken for a photograph of him.
 *
 * Everything else on the panel (name, job title) also comes from identity
 * settings; the gold hairline is the platform's small accent, nothing more.
 */
import { Icon } from "~/cms/icons";
import { t, type Locale } from "~/lib/i18n";

export interface TeacherPanelProps {
  locale: Locale;
  name: string;
  title: string;
  /** resolved real photo URL — null until the owner uploads one */
  photoUrl: string | null;
}

export function TeacherPanel({ locale, name, title, photoUrl }: TeacherPanelProps) {
  if (!name && !title && !photoUrl) return null;
  const initial = (name || title).trim().charAt(0);

  return (
    <aside
      className="relative overflow-hidden rounded-[1.5rem] border border-navy-100 bg-white/80 p-4 shadow-sm backdrop-blur-sm sm:p-5"
      data-testid="study-teacher-panel"
    >
      <div className="flex items-center gap-3 sm:gap-4 lg:flex-col lg:gap-4 lg:text-center">
        {photoUrl ? (
          // Real photo, same source/binding/crop as every other surface.
          <img
            src={photoUrl}
            alt={name}
            loading="lazy"
            decoding="async"
            className="h-16 w-16 shrink-0 rounded-[1.25rem] object-cover ring-2 ring-white shadow-sm sm:h-20 sm:w-20 lg:h-28 lg:w-28"
            data-testid="study-teacher-photo"
          />
        ) : (
          <span
            aria-hidden="true"
            className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-[1.25rem] bg-navy-50 text-xl font-bold text-navy-800 ring-1 ring-navy-100 sm:h-20 sm:w-20 sm:text-2xl lg:h-28 lg:w-28 lg:text-3xl"
          >
            {initial}
          </span>
        )}

        <div className="min-w-0 lg:w-full">
          {name && <p className="truncate text-base font-bold text-navy-900 sm:text-lg">{name}</p>}
          {title && <p className="mt-0.5 line-clamp-2 text-sm font-medium text-navy-600">{title}</p>}
        </div>
      </div>

      {/* Badge sits on its own line so the label stays readable at 320px. */}
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-navy-50 px-3 py-1 text-xs font-medium text-navy-700 lg:mx-auto lg:flex lg:w-fit">
        <Icon name="graduation-cap" size="sm" colorRole="default" className="h-3.5 w-3.5 shrink-0 text-navy-500" />
        <span className="whitespace-nowrap">{t(locale, "study.teacherBadge")}</span>
      </p>

      <span aria-hidden="true" className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-gradient-to-r from-transparent via-gold-400 to-transparent opacity-60" />
    </aside>
  );
}
