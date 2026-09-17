import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DB } from "../db/client.server";
import {
  courses,
  files,
  formFields,
  forms,
  grades,
  lessonItems,
  lessons,
  pricePlans,
  productItems,
  products,
  programs,
  subjects,
  units,
  users,
  videos,
} from "../db/schema";
import { studyHub, type StudySubjectCard } from "../content/service.server";
import { effectivePriceMinor } from "../commerce/service.server";
import { formatMoney } from "../commerce/money";
import { resolveQuestionPlatformUrl } from "../../app/lib/question-platform";
import { t } from "../../app/lib/i18n";
import { BLOCKS, type LStr, type PageSnapshot, zodForBlock } from "../../app/cms/registry";
import type {
  CardView,
  CmsRenderCtx,
  FormResultView,
  FormView,
  IdentityView,
} from "../../app/cms/render-types";
import type { Settings } from "../settings/schema";
import { collectFileRefs } from "./service.server";
import { resolveSocialLinks } from "../../app/cms/social";

/**
 * CMS render resolvers (Phase 3). The CONTENT ↔ PRESENTATION boundary lives
 * here: resolvers merge content rows (courses/subjects/lessons/forms) with the
 * admin presentation settings into neutral view-models (CardView/FormView/
 * IdentityView). Renderer components contain structure only — they never query
 * data and never make access decisions (authorization stays in target routes).
 *
 * Empty-first: any resolver with no rows returns [] and the block collapses —
 * there are NO placeholder/demo substitutions anywhere in this file.
 */

type SnapshotSection = PageSnapshot["sections"][number];
type SnapshotComponent = SnapshotSection["children"][number];

const L = (ar: string | null | undefined, en: string | null | undefined): LStr => ({ ar: ar ?? "", en: en ?? "" });
const badgeL = (key: string): LStr => ({ ar: t("ar", key), en: t("en", key) });
const clampLimit = (props: Record<string, unknown>): number => {
  const n = typeof props.limit === "number" ? props.limit : 3;
  return Math.min(12, Math.max(1, Math.floor(n)));
};
const uuidList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)) : [];

// ---------------------------------------------------------------------------
// Image resolution — PUBLIC files only (picker enforces; defense in depth here)
// ---------------------------------------------------------------------------

export async function resolvePublicImageUrls(db: DB, fileIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(fileIds.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  const out: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const rows = await db
      .select({ id: files.id })
      .from(files)
      .where(and(inArray(files.id, chunk), eq(files.visibility, "public")));
    for (const r of rows) out[r.id] = `/files/${r.id}`; // streamed by files.$id route (cacheable)
  }
  return out;
}

export function snapshotFileRefs(sections: SnapshotSection[]): string[] {
  const ids: string[] = [];
  for (const s of sections) {
    ids.push(...collectFileRefs(s.type, s.props));
    for (const c of s.children) ids.push(...collectFileRefs(c.type, c.props));
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Identity (branding) view — platform + identity settings, images pre-resolved
// ---------------------------------------------------------------------------

export function buildIdentityView(settings: Settings, images: Record<string, string>): IdentityView {
  const p = settings.platform;
  const idn = settings.identity;
  const img = (fileId: string): string | null => (fileId && images[fileId] ? images[fileId] : null);
  const wa = (p.whatsapp ?? "").replace(/[^\d]/g, "");
  const waUrl = wa ? `https://wa.me/${wa}` : "";
  const socials = resolveSocialLinks(idn, waUrl).map((s) => ({
    network: s.network, url: s.url, labelAr: s.labelAr, labelEn: s.labelEn,
    showHeader: s.showHeader, showFooter: s.showFooter, showHome: s.showHome, showContact: s.showContact,
  }));
  return {
    platformName: L(p.nameAr, p.nameEn),
    shortName: L(idn.shortNameAr || p.nameAr, idn.shortNameEn || p.nameEn),
    tagline: L(p.taglineAr, p.taglineEn),
    ownerName: L(idn.ownerNameAr, idn.ownerNameEn),
    ownerTitle: L(idn.ownerTitleAr, idn.ownerTitleEn),
    ownerPhoto: img(idn.ownerPhotoFileId),
    logo: img(idn.logoFileId),
    contactPhone: idn.contactPhone,
    contactEmail: idn.contactEmail,
    contactAddress: L(idn.contactAddressAr, idn.contactAddressEn),
    whatsapp: (p.whatsapp ?? "").replace(/[^\d]/g, ""),
    telegram: idn.telegram,
    socials,
    copyright: L(idn.copyrightAr, idn.copyrightEn),
  };
}

export function identityFileRefs(settings: Settings): string[] {
  const idn = settings.identity;
  return [idn.logoFileId, idn.ownerPhotoFileId, idn.heroImageFileId, idn.aboutImageFileId, idn.faviconFileId].filter(Boolean);
}

// ---------------------------------------------------------------------------
// Dynamic card resolvers — content rows × presentation settings → CardView
// ---------------------------------------------------------------------------

interface DynRequest { blockId: string; kind: string; props: Record<string, unknown> }

export function collectDynamicRequests(sections: SnapshotSection[]): DynRequest[] {
  const reqs: DynRequest[] = [];
  for (const s of sections) {
    for (const c of s.children) {
      const kind = BLOCKS[c.type]?.dynamic;
      if (kind) reqs.push({ blockId: c.id, kind, props: c.props });
    }
  }
  return reqs;
}

const publishedWindow = (nowMs: number) => sql`(${courses.publishAt} IS NULL OR ${courses.publishAt} <= ${nowMs}) AND (${courses.expiresAt} IS NULL OR ${courses.expiresAt} > ${nowMs})`;

export async function lessonCounts(db: DB, courseIds: string[]): Promise<Record<string, number>> {
  if (!courseIds.length) return {};
  const rows = await db
    .select({ courseId: units.courseId, n: sql<number>`count(*)` })
    .from(lessons)
    .innerJoin(units, eq(lessons.unitId, units.id))
    .where(and(inArray(units.courseId, courseIds), eq(lessons.status, "published"), isNull(lessons.deletedAt), isNull(units.deletedAt)))
    .groupBy(units.courseId);
  return Object.fromEntries(rows.map((r) => [r.courseId, Number(r.n)]));
}

export async function teacherNames(db: DB, teacherIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(teacherIds.filter(Boolean))];
  if (!ids.length) return {};
  const rows = await db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, ids));
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

export async function resolveDynamicBlocks(
  db: DB,
  reqs: DynRequest[],
  settings: Settings
): Promise<{ rows: Record<string, CardView[]>; imageIds: string[]; questionPlatformUrl: string | null }> {
  const pres = settings.presentation;
  const nowMs = Date.now();
  // The EXTERNAL questions/exams platform gate (enable + https-only) — resolved
  // once here so blocks, chips and resolvers all share the same answer.
  const questionPlatformUrl = resolveQuestionPlatformUrl(settings.platform);
  const out: Record<string, CardView[]> = {};
  const imageIds: string[] = [];
  if (!reqs.length) return { rows: out, imageIds, questionPlatformUrl };

  const needsCourses = reqs.some((r) => r.kind === "courses" || r.kind === "featured" || r.kind === "free_content" || r.kind === "latest_lessons");
  const needsSubjects = reqs.some((r) => r.kind === "subjects" || r.kind === "featured");
  const needsPrograms = reqs.some((r) => r.kind === "programs" || r.kind === "featured");

  interface CourseLite {
    id: string; slug: string; titleAr: string; titleEn: string;
    descriptionAr: string | null; descriptionEn: string | null;
    thumbnailFileId: string | null; accessLevel: "public" | "authenticated" | "entitled";
    visibility: "hidden" | "catalog" | "featured"; teacherId: string | null;
    subjectId: string; createdAt: number;
  }

  const needsSubjectCounts = reqs.some((r) => r.kind === "subjects" || (r.kind === "featured" && r.props.kind === "subjects"));

  // W9: the four queries below are mutually independent (course/subject/program
  // rows + per-subject course counts) — run them in a single round trip instead
  // of four sequential awaits. Each branch is a Drizzle thenable (PromiseLike),
  // which Promise.all accepts.
  const [courseRows, subjectRows, programRows, subjectCourseCountRows] = (await Promise.all([
    needsCourses
      ? db
          .select({
            id: courses.id, slug: courses.slug, titleAr: courses.titleAr, titleEn: courses.titleEn,
            descriptionAr: courses.descriptionAr, descriptionEn: courses.descriptionEn,
            thumbnailFileId: courses.thumbnailFileId, accessLevel: courses.accessLevel,
            visibility: courses.visibility, teacherId: courses.teacherId, subjectId: courses.subjectId,
            createdAt: courses.createdAt,
          })
          .from(courses)
          .where(and(eq(courses.status, "published"), isNull(courses.deletedAt), inArray(courses.visibility, ["catalog", "featured"]), publishedWindow(Date.now())))
          .orderBy(asc(courses.sortOrder))
      : Promise.resolve([]),
    needsSubjects
      ? db
          .select({
            id: subjects.id, slug: subjects.slug, titleAr: subjects.titleAr, titleEn: subjects.titleEn,
            descriptionAr: subjects.descriptionAr, descriptionEn: subjects.descriptionEn,
            thumbnailFileId: subjects.thumbnailFileId, sortOrder: subjects.sortOrder,
          })
          .from(subjects)
          .innerJoin(grades, eq(subjects.gradeId, grades.id))
          .innerJoin(programs, eq(grades.programId, programs.id))
          .where(and(eq(subjects.status, "published"), isNull(subjects.deletedAt), eq(grades.status, "published"), eq(programs.status, "published")))
          .orderBy(asc(subjects.sortOrder))
      : Promise.resolve([]),
    needsPrograms
      ? db
          .select({ id: programs.id, slug: programs.slug, titleAr: programs.titleAr, titleEn: programs.titleEn, descriptionAr: programs.descriptionAr, descriptionEn: programs.descriptionEn, sortOrder: programs.sortOrder })
          .from(programs)
          .where(and(eq(programs.status, "published"), isNull(programs.deletedAt)))
          .orderBy(asc(programs.sortOrder))
      : Promise.resolve([]),
    needsSubjectCounts
      ? db
          .select({ subjectId: courses.subjectId, n: sql<number>`count(*)` })
          .from(courses)
          .where(and(eq(courses.status, "published"), isNull(courses.deletedAt), inArray(courses.visibility, ["catalog", "featured"])))
          .groupBy(courses.subjectId)
      : Promise.resolve([]),
  ])) as [
    CourseLite[],
    Array<{ id: string; slug: string; titleAr: string; titleEn: string; descriptionAr: string | null; descriptionEn: string | null; thumbnailFileId: string | null; sortOrder: number }>,
    Array<{ id: string; slug: string; titleAr: string; titleEn: string; descriptionAr: string | null; descriptionEn: string | null; sortOrder: number }>,
    Array<{ subjectId: string; n: number }>,
  ];

  // course-count per subject (only when subject cards requested)
  const subjectCourseCounts: Record<string, number> = {};
  for (const r of subjectCourseCountRows) subjectCourseCounts[r.subjectId] = Number(r.n);

  // W9: these three depend only on courseRows (not on each other) — one round
  // trip instead of three sequential awaits.
  const [counts, names, subjectTitleById] = needsCourses
    ? await Promise.all([
        lessonCounts(db, courseRows.map((r) => r.id)),
        teacherNames(db, courseRows.map((r) => r.teacherId ?? "")),
        (async () => {
          const byId: Record<string, LStr> = {};
          if (courseRows.length) {
            const ids = [...new Set(courseRows.map((r) => r.subjectId))];
            const rows = await db.select({ id: subjects.id, titleAr: subjects.titleAr, titleEn: subjects.titleEn }).from(subjects).where(inArray(subjects.id, ids));
            for (const r of rows) byId[r.id] = L(r.titleAr, r.titleEn);
          }
          return byId;
        })(),
      ])
    : [{}, {}, {} as Record<string, LStr>];

  const courseCard = (r: (typeof courseRows)[number], ctaOverride?: LStr | null): CardView => {
    const cc = pres.courseCard;
    const meta: string[] = [];
    const metaEn: string[] = [];
    if (cc.showTeacher && r.teacherId && names[r.teacherId]) { meta.push(names[r.teacherId]); metaEn.push(names[r.teacherId]); }
    if (cc.showLessonCount) {
      const n = counts[r.id] ?? 0;
      meta.push(t("ar", "content.lessonsCount", { n }));
      metaEn.push(t("en", "content.lessonsCount", { n }));
    }
    const subj = subjectTitleById[r.subjectId];
    if (cc.showSubject && subj) { meta.push(subj.ar); metaEn.push(subj.en); }
    if (r.thumbnailFileId) imageIds.push(r.thumbnailFileId);
    return {
      id: r.id,
      href: `/courses/${r.slug}`,
      title: L(r.titleAr, r.titleEn),
      desc: L(r.descriptionAr, r.descriptionEn),
      image: cc.showImage ? r.thumbnailFileId : null,
      badge: cc.showBadge && r.accessLevel === "public" ? badgeL("content.accessPublic") : null,
      meta: meta.length ? { ar: meta.join(" · "), en: metaEn.join(" · ") } : null,
      cta: ctaOverride && (ctaOverride.ar || ctaOverride.en) ? ctaOverride : L(cc.ctaLabelAr, cc.ctaLabelEn),
    };
  };

  const subjectCard = (r: (typeof subjectRows)[number]): CardView => {
    const sc = pres.subjectCard;
    if (r.thumbnailFileId) imageIds.push(r.thumbnailFileId);
    return {
      id: r.id,
      // `/study/:subjectSlug` is the single public learning front door; the
      // legacy `/courses?subject=` catalog filter remains reachable for old
      // links/SEO but no longer receives the platform's own CTAs.
      href: `/study/${r.slug}`,
      title: L(r.titleAr, r.titleEn),
      desc: L(r.descriptionAr, r.descriptionEn),
      image: sc.showImage ? r.thumbnailFileId : null,
      badge: null,
      meta: sc.showCourseCount ? { ar: t("ar", "content.coursesCount", { n: subjectCourseCounts[r.id] ?? 0 }), en: t("en", "content.coursesCount", { n: subjectCourseCounts[r.id] ?? 0 }) } : null,
      cta: L(sc.ctaLabelAr, sc.ctaLabelEn),
    };
  };

  const programCard = (r: (typeof programRows)[number]): CardView => ({
    id: r.id,
    href: `/study`, // program cards explain the journey; /study starts it
    title: L(r.titleAr, r.titleEn),
    desc: L(r.descriptionAr, r.descriptionEn),
    image: null,
    badge: null,
    meta: null,
    cta: null,
  });

  for (const req of reqs) {
    const limit = clampLimit(req.props);
    switch (req.kind) {
      case "courses": {
        const source = typeof req.props.source === "string" ? req.props.source : "latest";
        const override = req.props.ctaLabelOverride as LStr | undefined;
        let rows = courseRows;
        if (source === "featured") rows = rows.filter((r) => r.visibility === "featured");
        else if (source === "manual") {
          const ids = uuidList(req.props.manualIds);
          rows = ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is (typeof courseRows)[number] => Boolean(r));
        } else rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
        out[req.blockId] = rows.slice(0, limit).map((r) => courseCard(r, override ?? null));
        break;
      }
      case "featured": {
        const kind = typeof req.props.kind === "string" ? req.props.kind : "courses";
        if (kind === "subjects") out[req.blockId] = subjectRows.slice(0, limit).map(subjectCard);
        else if (kind === "programs") out[req.blockId] = programRows.slice(0, limit).map(programCard);
        else out[req.blockId] = courseRows.filter((r) => r.visibility === "featured").slice(0, limit).map((r) => courseCard(r));
        break;
      }
      case "subjects": {
        const source = typeof req.props.source === "string" ? req.props.source : "all";
        let rows = subjectRows;
        if (source === "manual") {
          const ids = uuidList(req.props.manualIds);
          rows = ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is (typeof subjectRows)[number] => Boolean(r));
        }
        out[req.blockId] = rows.slice(0, limit).map(subjectCard);
        break;
      }
      case "programs": {
        const source = typeof req.props.source === "string" ? req.props.source : "all";
        let rows = programRows;
        if (source === "manual") {
          const ids = uuidList(req.props.manualIds);
          rows = ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is (typeof programRows)[number] => Boolean(r));
        }
        out[req.blockId] = rows.slice(0, limit).map(programCard);
        break;
      }
      case "study_subjects": {
        out[req.blockId] = await resolveStudySubjectCards(db, limit);
        break;
      }
      case "free_content":
      case "latest_lessons": {
        out[req.blockId] = await resolveLessonCards(db, req, limit, needsFreeOnly(req.kind), pres);
        break;
      }
      case "videos": {
        out[req.blockId] = await resolveVideoCards(db, limit, uuidList(req.props.courseIds), imageIds);
        break;
      }
      case "products": {
        out[req.blockId] = await resolveProductCards(db, limit, nowMs);
        break;
      }
      case "grades": {
        out[req.blockId] = await resolveGradeCards(db, limit, Boolean(questionPlatformUrl));
        break;
      }
      default:
        out[req.blockId] = [];
    }
  }
  return { rows: out, imageIds, questionPlatformUrl };
}

const needsFreeOnly = (kind: string) => kind === "free_content";

// ---------------------------------------------------------------------------
// Identity-surface resolvers (owner brief: شرح · فيديوهات · كتب ومذكرات ·
// امتحانات · اختيار الصف). Each one resolves REAL published rows only and
// returns [] when there is nothing to show, so the block collapses instead of
// rendering an empty shell or — worse — an invented placeholder.
// ---------------------------------------------------------------------------

/** Kind labels for product cards (the product's own kind, never a marketing claim). */
const PRODUCT_KIND_KEY: Record<string, string> = {
  course: "content.course",
  subject: "content.subject",
  bundle: "home.productKindBundle",
  subscription_plan: "home.productKindSubscription",
};

/**
 * Grades → picker cards. Chips are derived from rows that exist for THAT grade:
 * published subjects, catalog courses, lessons with a ready video, products
 * covering one of its subjects, and the (globally configured) external exams
 * platform. No chip is ever emitted without its backing data.
 */
async function resolveGradeCards(db: DB, limit: number, examsConfigured: boolean): Promise<CardView[]> {
  const gradeRows = await db
    .select({
      id: grades.id, slug: grades.slug, titleAr: grades.titleAr, titleEn: grades.titleEn,
      programTitleAr: programs.titleAr, programTitleEn: programs.titleEn,
    })
    .from(grades)
    .innerJoin(programs, eq(grades.programId, programs.id))
    .where(and(eq(grades.status, "published"), isNull(grades.deletedAt), eq(programs.status, "published"), isNull(programs.deletedAt)))
    .orderBy(asc(grades.sortOrder))
    .limit(limit);
  if (!gradeRows.length) return [];
  const gradeIds = gradeRows.map((g) => g.id);

  const subjectRows = await db
    .select({ id: subjects.id, gradeId: subjects.gradeId })
    .from(subjects)
    .where(and(inArray(subjects.gradeId, gradeIds), eq(subjects.status, "published"), isNull(subjects.deletedAt)));
  const subjectIds = subjectRows.map((s) => s.id);
  const gradeBySubject = new Map(subjectRows.map((s) => [s.id, s.gradeId] as const));
  const subjectCount = new Map<string, number>();
  for (const s of subjectRows) subjectCount.set(s.gradeId, (subjectCount.get(s.gradeId) ?? 0) + 1);

  const courseRows = subjectIds.length
    ? await db
        .select({ id: courses.id, subjectId: courses.subjectId })
        .from(courses)
        .where(and(inArray(courses.subjectId, subjectIds), eq(courses.status, "published"), isNull(courses.deletedAt), inArray(courses.visibility, ["catalog", "featured"])))
    : [];
  const courseCount = new Map<string, number>();
  for (const c of courseRows) {
    const g = gradeBySubject.get(c.subjectId);
    if (g) courseCount.set(g, (courseCount.get(g) ?? 0) + 1);
  }

  const videoRows = subjectIds.length
    ? await db
        .select({ subjectId: courses.subjectId, n: sql<number>`count(distinct ${lessons.id})` })
        .from(lessons)
        .innerJoin(units, eq(lessons.unitId, units.id))
        .innerJoin(courses, eq(units.courseId, courses.id))
        .innerJoin(lessonItems, and(eq(lessonItems.lessonId, lessons.id), eq(lessonItems.itemType, "video")))
        .innerJoin(videos, and(eq(videos.id, lessonItems.videoId), eq(videos.status, "ready")))
        .where(and(
          inArray(courses.subjectId, subjectIds),
          eq(lessons.status, "published"), isNull(lessons.deletedAt),
          isNull(units.deletedAt),
          eq(courses.status, "published"), isNull(courses.deletedAt),
          inArray(courses.visibility, ["catalog", "featured"]),
        ))
        .groupBy(courses.subjectId)
    : [];
  const videoCount = new Map<string, number>();
  for (const r of videoRows) {
    const g = gradeBySubject.get(r.subjectId);
    if (g) videoCount.set(g, (videoCount.get(g) ?? 0) + Number(r.n));
  }

  // products (books/notes/…) that cover a subject of this grade AND are buyable
  // (active product with at least one active price plan)
  const activeProductRows = await db
    .select({ id: products.id })
    .from(products)
    .innerJoin(pricePlans, and(eq(pricePlans.productId, products.id), eq(pricePlans.active, true)))
    .where(and(eq(products.active, true), isNull(products.archivedAt)))
    .groupBy(products.id);
  const gradeWithProduct = new Set<string>();
  if (activeProductRows.length) {
    const itemRows = await db
      .select({ resourceId: productItems.resourceId })
      .from(productItems)
      .where(and(
        inArray(productItems.productId, activeProductRows.map((p) => p.id)),
        eq(productItems.resourceType, "subject"),
      ));
    for (const it of itemRows) {
      const g = gradeBySubject.get(it.resourceId);
      if (g) gradeWithProduct.add(g);
    }
  }

  return gradeRows.map((g) => {
    const chips: LStr[] = [];
    const chip = (key: string, n?: number) => chips.push({ ar: t("ar", key, n === undefined ? undefined : { n }), en: t("en", key, n === undefined ? undefined : { n }) });
    const subs = subjectCount.get(g.id) ?? 0;
    const crs = courseCount.get(g.id) ?? 0;
    const vids = videoCount.get(g.id) ?? 0;
    if (subs > 0) chip("home.chipSubjects", subs);
    if (crs > 0) chip("home.chipCourses", crs);
    if (vids > 0) chip("home.chipVideos", vids);
    if (gradeWithProduct.has(g.id)) chip("home.chipBooks");
    if (examsConfigured) chip("home.chipExams");
    return {
      id: g.id,
      href: `/grades/${g.slug}`,
      title: L(g.titleAr, g.titleEn),
      desc: L("", ""),
      image: null,
      badge: g.programTitleAr || g.programTitleEn ? L(g.programTitleAr, g.programTitleEn) : null,
      meta: null,
      cta: L(t("ar", "home.gradeCta"), t("en", "home.gradeCta")),
      chips,
    } satisfies CardView;
  });
}

/**
 * The ONE public subject-discovery surface (owner brief §12/§13): the exact
 * same data as /study (`studyHub`), delivered to a CMS block so the homepage
 * shows one discovery experience instead of a second hand-built band.
 *
 * Empty-first is structural: a subject appears only when it has a published
 * term container, so a fresh install renders nothing and the section collapses.
 * Chips are real counts (terms / lessons) — never a marketing claim.
 */
async function resolveStudySubjectCards(db: DB, limit: number): Promise<CardView[]> {
  const rows = await studyHub(db);
  return rows.slice(0, limit).map((r) => studySubjectCard(r));
}

function studySubjectCard(r: StudySubjectCard): CardView {
  const chips: LStr[] = [];
  if (r.termCount > 0) chips.push({ ar: t("ar", "study.termsCount", { n: r.termCount }), en: t("en", "study.termsCount", { n: r.termCount }) });
  if (r.lessonCount > 0) chips.push({ ar: t("ar", "study.lessonsCount", { n: r.lessonCount }), en: t("en", "study.lessonsCount", { n: r.lessonCount }) });
  // Journey line (owner brief §10): السنة الدراسية → الصف → المادة.
  const journey = (ar: boolean) =>
    [
      (ar ? r.yearTitleAr : r.yearTitleEn) ? `${t(ar ? "ar" : "en", "study.yearLabel")}: ${ar ? r.yearTitleAr : r.yearTitleEn}` : "",
      `${t(ar ? "ar" : "en", "study.gradeLabel")}: ${ar ? r.gradeTitleAr : r.gradeTitleEn}`,
      (ar ? r.programTitleAr : r.programTitleEn) ? `${t(ar ? "ar" : "en", "study.programLabel")}: ${ar ? r.programTitleAr : r.programTitleEn}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  return {
    id: r.slug,
    href: `/study/${r.slug}`,
    title: L(r.titleAr, r.titleEn),
    desc: L(r.descriptionAr, r.descriptionEn),
    image: null,
    badge: null,
    meta: { ar: journey(true), en: journey(false) },
    cta: L(t("ar", "study.openSubject"), t("en", "study.openSubject")),
    chips,
  } satisfies CardView;
}

/**
 * Products (books / notes / bundles / subscriptions) → storefront cards.
 * Only products that are ACTIVE and have at least one ACTIVE price plan appear
 * (otherwise checkout is impossible and the card would be a dead end). The card
 * shows the cheapest effective price of those plans — the same server-side price
 * truth the public product page renders. `limit` caps the row count.
 */
async function resolveProductCards(db: DB, limit: number, nowMs: number): Promise<CardView[]> {
  const productRows = await db
    .select({
      id: products.id, kind: products.kind, slug: products.slug,
      nameAr: products.nameAr, nameEn: products.nameEn,
      descriptionAr: products.descriptionAr, descriptionEn: products.descriptionEn,
      thumbnailFileId: products.thumbnailFileId,
    })
    .from(products)
    .where(and(eq(products.active, true), isNull(products.archivedAt)))
    .orderBy(asc(products.sortOrder))
    .limit(limit);
  if (!productRows.length) return [];

  const planRows = await db
    .select()
    .from(pricePlans)
    .where(and(inArray(pricePlans.productId, productRows.map((p) => p.id)), eq(pricePlans.active, true)));

  const cheapest = new Map<string, { minor: number; currency: string; labelAr: string | null; labelEn: string | null }>();
  for (const p of planRows) {
    const minor = effectivePriceMinor(p, nowMs);
    const current = cheapest.get(p.productId);
    if (!current || minor < current.minor) {
      cheapest.set(p.productId, { minor, currency: p.currency, labelAr: p.labelAr, labelEn: p.labelEn });
    }
  }

  const cards: CardView[] = [];
  for (const p of productRows) {
    const price = cheapest.get(p.id);
    if (!price) continue; // no active plan → not purchasable → never shown
    const label = price.labelAr || price.labelEn ? ` · ${price.labelAr || price.labelEn}` : "";
    cards.push({
      id: p.id,
      href: `/products/${p.slug}`,
      title: L(p.nameAr, p.nameEn),
      desc: L(p.descriptionAr, p.descriptionEn),
      image: p.thumbnailFileId ?? null,
      badge: { ar: t("ar", PRODUCT_KIND_KEY[p.kind] ?? "content.course"), en: t("en", PRODUCT_KIND_KEY[p.kind] ?? "content.course") },
      meta: { ar: `${formatMoney(price.minor, price.currency)}${label}`, en: `${formatMoney(price.minor, price.currency)}${label}` },
      cta: L(t("ar", "home.productCta"), t("en", "home.productCta")),
    });
  }
  return cards;
}

/**
 * Lesson videos → cards. A row appears only when the lesson is PUBLISHED inside
 * a published unit of a catalog course AND has a `video` lesson-item whose video
 * row is `ready` — i.e. there is something real to watch. Playback itself stays
 * entitlement-checked on /learn (this block only advertises the lesson), exactly
 * like the existing latest_lessons/free_content blocks.
 */
async function resolveVideoCards(db: DB, limit: number, courseFilter: string[], imageIds: string[]): Promise<CardView[]> {
  const rows = await db
    .select({
      lessonId: lessons.id, lessonSlug: lessons.slug, titleAr: lessons.titleAr, titleEn: lessons.titleEn,
      descriptionAr: lessons.descriptionAr, descriptionEn: lessons.descriptionEn,
      accessLevel: lessons.accessLevel, freePreview: lessons.freePreview,
      courseSlug: courses.slug, courseTitleAr: courses.titleAr, courseTitleEn: courses.titleEn,
      courseThumb: courses.thumbnailFileId,
      durationSeconds: videos.durationSeconds, videoThumbFileId: videos.thumbnailFileId, videoThumbUrl: videos.thumbnailUrl,
    })
    .from(lessons)
    .innerJoin(units, eq(lessons.unitId, units.id))
    .innerJoin(courses, eq(units.courseId, courses.id))
    .innerJoin(lessonItems, and(eq(lessonItems.lessonId, lessons.id), eq(lessonItems.itemType, "video")))
    .innerJoin(videos, and(eq(videos.id, lessonItems.videoId), eq(videos.status, "ready")))
    .where(and(
      eq(lessons.status, "published"), isNull(lessons.deletedAt),
      isNull(units.deletedAt),
      eq(courses.status, "published"), isNull(courses.deletedAt),
      inArray(courses.visibility, ["catalog", "featured"]),
      courseFilter.length ? inArray(courses.id, courseFilter) : sql`1=1`,
    ))
    .orderBy(desc(lessons.createdAt))
    .limit(limit);

  const seen = new Set<string>();
  const cards: CardView[] = [];
  for (const r of rows) {
    if (seen.has(r.lessonId)) continue; // a lesson with several video items → one card
    seen.add(r.lessonId);
    const thumbFile = r.videoThumbFileId ?? r.courseThumb ?? null;
    if (thumbFile) imageIds.push(thumbFile);
    const externalThumb = !r.videoThumbFileId && r.videoThumbUrl && /^https:\/\//i.test(r.videoThumbUrl) ? r.videoThumbUrl : null;
    const courseTitle = L(r.courseTitleAr, r.courseTitleEn);
    const duration = typeof r.durationSeconds === "number" && r.durationSeconds > 0
      ? `${t("ar", "content.durationMinutes", { n: Math.max(1, Math.round(r.durationSeconds / 60)) })}`
      : "";
    cards.push({
      id: r.lessonId,
      href: `/learn/${r.courseSlug}/${r.lessonSlug}`,
      title: L(r.titleAr, r.titleEn),
      desc: L(r.descriptionAr, r.descriptionEn),
      image: thumbFile,
      imageUrl: externalThumb,
      badge: r.accessLevel === "public" || r.freePreview
        ? { ar: t("ar", "content.freePreview"), en: t("en", "content.freePreview") }
        : { ar: t("ar", "home.videoBadge"), en: t("en", "home.videoBadge") },
      meta: { ar: [courseTitle.ar, duration].filter(Boolean).join(" · "), en: [courseTitle.en, duration].filter(Boolean).join(" · ") },
      cta: L(t("ar", "home.videoCta"), t("en", "home.videoCta")),
    });
  }
  return cards;
}


async function resolveLessonCards(
  db: DB,
  req: DynRequest,
  limit: number,
  freeOnly: boolean,
  pres: Settings["presentation"]
): Promise<CardView[]> {
  const courseFilter = uuidList(req.props.courseIds);
  const rows = await db
    .select({
      id: lessons.id, slug: lessons.slug, titleAr: lessons.titleAr, titleEn: lessons.titleEn,
      descriptionAr: lessons.descriptionAr, descriptionEn: lessons.descriptionEn,
      accessLevel: lessons.accessLevel, freePreview: lessons.freePreview, createdAt: lessons.createdAt,
      courseSlug: courses.slug, courseId: courses.id, courseThumb: courses.thumbnailFileId,
    })
    .from(lessons)
    .innerJoin(units, eq(lessons.unitId, units.id))
    .innerJoin(courses, eq(units.courseId, courses.id))
    .where(
      and(
        eq(lessons.status, "published"),
        isNull(lessons.deletedAt),
        isNull(units.deletedAt),
        eq(courses.status, "published"),
        isNull(courses.deletedAt),
        inArray(courses.visibility, ["catalog", "featured"]),
        courseFilter.length ? inArray(courses.id, courseFilter) : sql`1=1`,
        freeOnly ? or(eq(lessons.accessLevel, "public"), eq(lessons.freePreview, true)) : sql`1=1`
      )
    )
    .orderBy(desc(lessons.createdAt))
    .limit(limit);
  return rows.map((r) => {
    return {
      id: r.id,
      href: `/learn/${r.courseSlug}/${r.slug}`,
      title: L(r.titleAr, r.titleEn),
      desc: L(r.descriptionAr, r.descriptionEn),
      image: pres.courseCard.showImage ? r.courseThumb : null,
      badge: r.accessLevel === "public" || r.freePreview ? badgeL("content.freePreview") : null,
      meta: null,
      cta: null,
    } satisfies CardView;
  });
}

// ---------------------------------------------------------------------------
// Forms — active forms referenced by blocks on the page → FormView
// ---------------------------------------------------------------------------

export async function resolveForms(db: DB, sections: SnapshotSection[]): Promise<Record<string, FormView>> {
  const ids = new Set<string>();
  for (const s of sections) {
    for (const c of s.children) {
      if (c.type === "form_block" || c.type === "newsletter_form") {
        for (const id of uuidList([c.props.formId])) ids.add(id);
      }
    }
  }
  if (ids.size === 0) return {};

  const idList = [...ids];
  // W9: was 2 sequential queries PER form (N+1); now 2 batched queries total.
  // form_fields is indexed on (form_id, sort_order) so the combined field query
  // is covered, and grouping by formId preserves each form's original ordering.
  const [formRows, fieldRows] = await Promise.all([
    db.select().from(forms).where(and(inArray(forms.id, idList), eq(forms.status, "active"))),
    (db
      .select()
      .from(formFields)
      .where(and(inArray(formFields.formId, idList), eq(formFields.enabled, true)))
      .orderBy(asc(formFields.formId), asc(formFields.sortOrder), asc(formFields.createdAt))) as unknown as Array<Record<string, unknown>>,
  ]);

  const fieldsByForm = new Map<string, Array<Record<string, unknown>>>();
  for (const f of fieldRows) {
    const formId = String(f.formId);
    const list = fieldsByForm.get(formId);
    if (list) list.push(f);
    else fieldsByForm.set(formId, [f]);
  }

  const out: Record<string, FormView> = {};
  for (const form of formRows) {
    const view: FormView = {
      slug: form.slug,
      title: L(form.titleAr, form.titleEn),
      fields: (fieldsByForm.get(form.id) ?? []).map((f) => ({
        name: String(f.name),
        type: String(f.type),
        label: L(f.labelAr as string, f.labelEn as string),
        placeholder: L(f.placeholderAr as string | null, f.placeholderEn as string | null),
        help: L(f.helpAr as string | null, f.helpEn as string | null),
        required: Boolean(f.required),
        options: ((f.options ?? []) as Array<Record<string, unknown>>).map((o) => ({
          value: String(o.value ?? ""),
          label: L(o.labelAr as string | null, o.labelEn as string | null),
        })),
      })),
      consentRequired: Boolean(form.consentRequired),
      consent: L(form.consentAr, form.consentEn),
      success: L(form.successAr, form.successEn),
      failure: L(form.failureAr, form.failureEn),
    };
    out[form.id] = view;   // blocks reference forms by id (formRef uuid)
    out[form.slug] = view; // slug alias (renderer fallback)
  }
  return out;
}

// ---------------------------------------------------------------------------
// Full page assembly — snapshot → renderable sections + CmsRenderCtx
// ---------------------------------------------------------------------------

export interface RenderedPage {
  sections: SnapshotSection[];
  ctx: CmsRenderCtx;
}

/**
 * Re-validates snapshot blocks against the CURRENT registry (a block type or
 * schema may have changed after publishing) and skips anything broken — the
 * public page degrades gracefully instead of crashing. Only published
 * snapshots go through here for public traffic; preview passes the draft tree.
 */
export async function renderSnapshot(
  db: DB,
  snapshot: PageSnapshot,
  opts: { settings: Settings; locale: "ar" | "en"; formResults?: Record<string, FormResultView> }
): Promise<RenderedPage> {
  const sectionSchema = zodForBlock("section");
  const sections: SnapshotSection[] = [];
  for (const s of snapshot.sections) {
    if (sectionSchema && !sectionSchema.safeParse(s.props).success) continue;
    const children: SnapshotComponent[] = [];
    for (const c of s.children) {
      const schema = zodForBlock(c.type);
      if (!schema) continue; // unknown type → skipped (legacy/removed block)
      if (!schema.safeParse(c.props).success) continue;
      children.push(c);
    }
    sections.push({ ...s, children });
  }

  const dynamicReqs = collectDynamicRequests(sections);
  const [dyn, formsView] = await Promise.all([
    resolveDynamicBlocks(db, dynamicReqs, opts.settings),
    resolveForms(db, sections),
  ]);

  const imageIds = [
    ...snapshotFileRefs(sections),
    ...identityFileRefs(opts.settings),
    ...dyn.imageIds,
  ];
  const images = await resolvePublicImageUrls(db, imageIds);

  return {
    sections,
    ctx: {
      locale: opts.locale,
      images,
      dynamic: dyn.rows,
      forms: formsView,
      formResults: opts.formResults ?? {},
      identity: buildIdentityView(opts.settings, images),
      questionPlatformUrl: dyn.questionPlatformUrl,
      now: Date.now(),
    },
  };
}
