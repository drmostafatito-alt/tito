import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DB } from "../db/client.server";
import {
  courses,
  files,
  formFields,
  forms,
  grades,
  lessons,
  programs,
  subjects,
  units,
  users,
} from "../db/schema";
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
  const socials: Array<{ network: string; url: string }> = [];
  for (const network of ["facebook", "youtube", "instagram", "tiktok", "twitter", "linkedin", "telegram"] as const) {
    if (idn[network]) socials.push({ network, url: idn[network] });
  }
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

async function lessonCounts(db: DB, courseIds: string[]): Promise<Record<string, number>> {
  if (!courseIds.length) return {};
  const rows = await db
    .select({ courseId: units.courseId, n: sql<number>`count(*)` })
    .from(lessons)
    .innerJoin(units, eq(lessons.unitId, units.id))
    .where(and(inArray(units.courseId, courseIds), eq(lessons.status, "published"), isNull(lessons.deletedAt), isNull(units.deletedAt)))
    .groupBy(units.courseId);
  return Object.fromEntries(rows.map((r) => [r.courseId, Number(r.n)]));
}

async function teacherNames(db: DB, teacherIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(teacherIds.filter(Boolean))];
  if (!ids.length) return {};
  const rows = await db.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, ids));
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

export async function resolveDynamicBlocks(
  db: DB,
  reqs: DynRequest[],
  settings: Settings
): Promise<{ rows: Record<string, CardView[]>; imageIds: string[] }> {
  const pres = settings.presentation;
  const out: Record<string, CardView[]> = {};
  const imageIds: string[] = [];
  if (!reqs.length) return { rows: out, imageIds };

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
  let courseRows: CourseLite[] = [];
  let counts: Record<string, number> = {};
  let names: Record<string, string> = {};
  if (needsCourses) {
    courseRows = (await db
      .select({
        id: courses.id, slug: courses.slug, titleAr: courses.titleAr, titleEn: courses.titleEn,
        descriptionAr: courses.descriptionAr, descriptionEn: courses.descriptionEn,
        thumbnailFileId: courses.thumbnailFileId, accessLevel: courses.accessLevel,
        visibility: courses.visibility, teacherId: courses.teacherId, subjectId: courses.subjectId,
        createdAt: courses.createdAt,
      })
      .from(courses)
      .where(and(eq(courses.status, "published"), isNull(courses.deletedAt), inArray(courses.visibility, ["catalog", "featured"]), publishedWindow(Date.now())))
      .orderBy(asc(courses.sortOrder))) as CourseLite[];
    counts = await lessonCounts(db, courseRows.map((r) => r.id));
    names = await teacherNames(db, courseRows.map((r) => r.teacherId ?? ""));
  }

  const subjectRows = needsSubjects
    ? await db
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
    : [];

  const programRows = needsPrograms
    ? await db
        .select({ id: programs.id, slug: programs.slug, titleAr: programs.titleAr, titleEn: programs.titleEn, descriptionAr: programs.descriptionAr, descriptionEn: programs.descriptionEn, sortOrder: programs.sortOrder })
        .from(programs)
        .where(and(eq(programs.status, "published"), isNull(programs.deletedAt)))
        .orderBy(asc(programs.sortOrder))
    : [];

  // course-count per subject (only when subject cards requested)
  const subjectCourseCounts: Record<string, number> = {};
  if (reqs.some((r) => r.kind === "subjects" || (r.kind === "featured" && r.props.kind === "subjects"))) {
    const rows = await db
      .select({ subjectId: courses.subjectId, n: sql<number>`count(*)` })
      .from(courses)
      .where(and(eq(courses.status, "published"), isNull(courses.deletedAt), inArray(courses.visibility, ["catalog", "featured"])))
      .groupBy(courses.subjectId);
    for (const r of rows) subjectCourseCounts[r.subjectId] = Number(r.n);
  }

  // subject titles for course meta
  const subjectTitleById: Record<string, LStr> = {};
  if (needsCourses && courseRows.length) {
    const ids = [...new Set(courseRows.map((r) => r.subjectId))];
    const rows = await db.select({ id: subjects.id, titleAr: subjects.titleAr, titleEn: subjects.titleEn }).from(subjects).where(inArray(subjects.id, ids));
    for (const r of rows) subjectTitleById[r.id] = L(r.titleAr, r.titleEn);
  }

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
      href: `/courses?subject=${encodeURIComponent(r.slug)}`,
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
    href: `/courses?program=${encodeURIComponent(r.slug)}`,
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
      case "free_content":
      case "latest_lessons": {
        out[req.blockId] = await resolveLessonCards(db, req, limit, needsFreeOnly(req.kind), pres);
        break;
      }
      default:
        out[req.blockId] = [];
    }
  }
  return { rows: out, imageIds };
}

const needsFreeOnly = (kind: string) => kind === "free_content";

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
  const out: Record<string, FormView> = {};
  for (const id of ids) {
    const rows = await db.select().from(forms).where(and(eq(forms.id, id), eq(forms.status, "active"))).limit(1);
    const form = rows[0];
    if (!form) continue; // deleted/disabled → block collapses at render
    const fieldRows = (await db
      .select()
      .from(formFields)
      .where(and(eq(formFields.formId, form.id), eq(formFields.enabled, true)))
      .orderBy(asc(formFields.sortOrder), asc(formFields.createdAt))) as Array<Record<string, unknown>>;
    const view: FormView = {
      slug: form.slug,
      title: L(form.titleAr, form.titleEn),
      fields: fieldRows.map((f) => ({
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
      now: Date.now(),
    },
  };
}
