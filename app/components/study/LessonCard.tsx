import { Link } from "react-router";
import { Badge } from "~/components/ui/Badge";
import { Icon } from "~/cms/icons";
import { t, type Locale } from "~/lib/i18n";
import { ContentTypeChips, NoMaterialsNote } from "~/components/study/ContentTypeChips";
import {
  lessonNumber,
  studyLessonBadgeKey,
  studyLessonBadgeTone,
  studyLessonCtaKey,
  studyLockedSecondaryCtaKey,
  toStudyContentKinds,
  type LessonViewProgress,
  type StudyLessonState,
} from "~/lib/study-view";

/**
 * One lesson, as a student element (PART 4). Every fact on the card is real:
 *
 *   number    — the lesson's position inside its term (owner ordering)
 *   title     — the owner's title (never generated)
 *   materials — material kinds that exist on the lesson (video / pdf / …)
 *   access    — the SERVER verdict (free · subscribers · coming soon · unavailable)
 *   state     — the student's own progress, when signed in
 *   CTA       — derived from that verdict: start / continue / review / sign in /
 *               subscribe / activation code. Never a purchase CTA on a lesson
 *               that is not actually for sale (scheduled/expired content).
 *
 * Two interaction patterns are used on purpose:
 *   - an OPEN lesson: ONE tab stop — the title link is stretched over the whole
 *     card (a CSS `after:absolute` overlay), so tapping anywhere opens it;
 *   - a LOCKED lesson: the title still opens the lesson (where the full locked
 *     state + scope lives) AND the subscribe/activate CTA is a real, separate
 *     link raised above the overlay, never a dead end.
 */
export interface LessonCardProps {
  locale: Locale;
  position: number;
  slug: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  /** material kinds as they arrive from the server payload (narrowed here) */
  contentKinds: readonly string[];
  state: StudyLessonState;
  progress: LessonViewProgress | null;
  accessLevel: "public" | "authenticated" | "entitled";
  lessonHref: string;
  /** real subscription offer for this lesson's term (null when the owner published none) */
  offer: { href: string; priceLabel: string } | null;
  /** where "إدخال كود التفعيل" goes (the existing activation flow) */
  activateHref: string;
  /** where "سجّل الدخول" goes (the existing login flow, preserving the destination) */
  signInHref: string;
  /** h3 when the term renders flat, h4 when real unit headings precede the card */
  headingLevel?: "h3" | "h4";
}

export function LessonCard(props: LessonCardProps) {
  const { locale, state, progress, offer } = props;
  const ar = locale === "ar";
  const title = (ar ? props.titleAr || props.titleEn : props.titleEn || props.titleAr) || "—";
  const description = ar ? props.descriptionAr || props.descriptionEn : props.descriptionEn || props.descriptionAr;
  const number = lessonNumber(props.position);
  const contentKinds = toStudyContentKinds(props.contentKinds);
  const Heading = props.headingLevel ?? "h3";
  const badgeKey = studyLessonBadgeKey(state, props.accessLevel, progress);
  const badgeTone = studyLessonBadgeTone(state, progress);
  const ctaKey = studyLessonCtaKey(state, { hasOffer: Boolean(offer), progress });
  const secondaryKey = studyLockedSecondaryCtaKey(state);
  const isLocked = state === "locked";

  // Number spine: soft blue for an open lesson, a quiet gold tint once it is
  // completed, muted for anything the student cannot open yet. Colour is never
  // the only signal — the state chip and CTA always carry the meaning in words.
  const numberTone =
    progress?.status === "completed"
      ? "bg-gold-50 text-gold-700 ring-1 ring-gold-200"
      : state === "open"
        ? "bg-navy-50 text-navy-800 ring-1 ring-navy-100"
        : "bg-slate-50 text-slate-400 ring-1 ring-slate-200";

  return (
    <li data-testid={`study-lesson-${props.slug}`} data-lesson-state={state}>
      <article
        className={`group relative flex flex-col gap-3 rounded-[1.25rem] border border-navy-100 bg-white p-4 shadow-sm transition-all sm:flex-row sm:items-start sm:gap-4 sm:p-5 ${
          isLocked ? "hover:border-navy-200" : "hover:-translate-y-0.5 hover:border-navy-200 hover:shadow-md"
        }`}
      >
        {/* Position badge — the "01 / 02" spine of the lesson list */}
        <div className="flex items-center gap-3 sm:block">
          <span
            aria-hidden="true"
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-base font-bold tabular-nums ${numberTone}`}
            data-testid={`study-lesson-number-${props.slug}`}
          >
            {number}
          </span>
          <span className="sr-only">{t(locale, "study.lessonNumberAria", { n: props.position })}</span>
          {/* Mobile: state chip travels with the number so the row reads at a glance */}
          {badgeKey && (
            <span className="ms-auto sm:hidden">
              <Badge tone={badgeTone}>{t(locale, badgeKey)}</Badge>
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <Heading className="text-base font-semibold leading-snug text-navy-900 sm:text-[1.0625rem]">
            <Link
              to={props.lessonHref}
              className="break-words rounded-sm after:absolute after:inset-0 after:rounded-[1.25rem] group-hover:text-navy-700"
              aria-label={`${title} — ${ctaKey ? t(locale, ctaKey) : t(locale, "study.openLesson")}`}
            >
              {title}
            </Link>
          </Heading>

          {description && <p className="mt-1 line-clamp-2 text-sm text-slate-500">{description}</p>}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {badgeKey && (
              <span className="hidden sm:inline-flex">
                <Badge tone={badgeTone}>{t(locale, badgeKey)}</Badge>
              </span>
            )}
            <ContentTypeChips kinds={contentKinds} locale={locale} />
            {contentKinds.length === 0 && state === "open" && <NoMaterialsNote locale={locale} />}
          </div>
        </div>

        {/* Actions — raised above the stretched title link */}
        <div className="relative z-10 flex flex-col gap-2 sm:min-w-[9.5rem] sm:items-end">
          {ctaKey &&
            (state === "locked" ? (
              <Link
                to={offer ? offer.href : props.activateHref}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-navy-800 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-navy-900 sm:w-auto"
                data-testid={`study-lesson-cta-${props.slug}`}
              >
                <Icon name={offer ? "lock" : "tag"} size="sm" colorRole="invert" className="h-4 w-4" />
                {t(locale, ctaKey)}
                {offer && (
                  <span dir="ltr" className="text-xs font-medium text-navy-100">
                    {offer.priceLabel}
                  </span>
                )}
              </Link>
            ) : (
              <Link
                to={state === "sign_in_required" ? props.signInHref : props.lessonHref}
                className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold shadow-sm transition-colors sm:w-auto ${
                  state === "open" && progress?.status === "completed"
                    ? "bg-white text-navy-800 ring-1 ring-navy-200 hover:bg-navy-50"
                    : "bg-navy-800 text-white hover:bg-navy-900"
                }`}
                data-testid={`study-lesson-cta-${props.slug}`}
              >
                <Icon name={state === "sign_in_required" ? "user" : "play-circle"} size="sm" colorRole="invert" className="h-4 w-4" />
                {t(locale, ctaKey)}
              </Link>
            ))}

          {isLocked && secondaryKey && offer && (
            <Link
              to={props.activateHref}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-navy-200 bg-white px-4 py-2 text-sm font-semibold text-navy-800 transition-colors hover:border-navy-300 hover:bg-navy-50 sm:w-auto"
              data-testid={`study-lesson-activate-${props.slug}`}
            >
              {t(locale, secondaryKey)}
            </Link>
          )}

          {state === "sign_in_required" && (
            <Link
              to={props.signInHref}
              className="text-center text-xs font-medium text-navy-600 underline decoration-navy-300 underline-offset-4 hover:text-navy-800 sm:text-end"
            >
              {t(locale, "study.registerHint")}
            </Link>
          )}
        </div>
      </article>
    </li>
  );
}
