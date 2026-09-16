import type { DB } from "../db/client.server";
import { academicYearById, gradeById, getNode, subjectById, termById } from "../content/service.server";
import { entitlementSpecSchema } from "./service.server";

/**
 * Turns a subscription request's frozen entitlement spec into the human scope the
 * student and the admin both need to read: السنة الدراسية · الصف · المادة · الترم.
 *
 * Everything is resolved from REAL rows by id. When a title cannot be resolved
 * (e.g. the container was archived) the entry is simply omitted — scope text is
 * never guessed or placeholdered.
 */

export interface BilingualTitle {
  ar: string;
  en: string;
}

export interface OrderScopeView {
  years: BilingualTitle[];
  grades: BilingualTitle[];
  subjects: BilingualTitle[];
  terms: BilingualTitle[];
  /** "term" | "full_year" | null — the admin-chosen subscription scope */
  scopeKind: "term" | "full_year" | null;
  /** what is being bought (product/plan snapshot title) */
  planLabel: BilingualTitle | null;
}

function unique(list: BilingualTitle[], next: BilingualTitle | null): BilingualTitle[] {
  if (!next || !next.ar || !next.en) return list;
  if (list.some((x) => x.ar === next.ar && x.en === next.en)) return list;
  return [...list, next];
}

/** Course/lesson/subject grants → the containers they belong to. */
async function containerIdsForGrants(
  db: DB,
  grants: { resourceType: string; resourceId: string }[]
): Promise<{ courses: string[]; subjects: string[] }> {
  const courses: string[] = [];
  const subjects: string[] = [];
  for (const g of grants) {
    if (g.resourceType === "course") courses.push(g.resourceId);
    else if (g.resourceType === "subject") subjects.push(g.resourceId);
    else if (g.resourceType === "lesson") {
      const lesson = (await getNode(db, "lesson", g.resourceId)) as { unitId?: string } | null;
      if (!lesson?.unitId) continue;
      const unit = (await getNode(db, "unit", lesson.unitId)) as { courseId?: string } | null;
      if (unit?.courseId) courses.push(unit.courseId);
    }
  }
  return { courses: [...new Set(courses)], subjects: [...new Set(subjects)] };
}

export async function orderScopeView(
  db: DB,
  opts: { entitlementSpec: unknown; titleSnapshotAr: string; titleSnapshotEn: string }
): Promise<OrderScopeView> {
  const view: OrderScopeView = {
    years: [],
    grades: [],
    subjects: [],
    terms: [],
    scopeKind: null,
    planLabel: { ar: opts.titleSnapshotAr, en: opts.titleSnapshotEn },
  };

  const parsed = entitlementSpecSchema.safeParse(opts.entitlementSpec);
  if (!parsed.success) return view;
  const spec = parsed.data;
  view.scopeKind = spec.scope?.kind ?? null;

  const { courses, subjects } = await containerIdsForGrants(db, spec.grants);
  const subjectIds = new Set<string>(subjects);

  for (const courseId of courses) {
    const course = (await getNode(db, "course", courseId)) as {
      subjectId?: string;
      academicYearId?: string | null;
      termId?: string | null;
      titleAr?: string;
      titleEn?: string;
    } | null;
    if (!course) continue;
    if (course.subjectId) subjectIds.add(course.subjectId);
    if (course.academicYearId) {
      const year = await academicYearById(db, course.academicYearId);
      view.years = unique(view.years, year ? { ar: year.titleAr, en: year.titleEn } : null);
    }
    if (course.termId) {
      const term = await termById(db, course.termId);
      // A container with no resolvable term row still describes itself.
      view.terms = unique(
        view.terms,
        term ? { ar: term.titleAr, en: term.titleEn } : { ar: course.titleAr ?? "", en: course.titleEn ?? "" }
      );
    } else {
      view.terms = unique(view.terms, { ar: course.titleAr ?? "", en: course.titleEn ?? "" });
    }
  }

  for (const subjectId of subjectIds) {
    const subject = await subjectById(db, subjectId);
    if (!subject) continue;
    view.subjects = unique(view.subjects, { ar: subject.titleAr, en: subject.titleEn });
    const subjectRow = (await getNode(db, "subject", subjectId)) as { gradeId?: string } | null;
    if (subjectRow?.gradeId) {
      const grade = await gradeById(db, subjectRow.gradeId);
      view.grades = unique(view.grades, grade ? { ar: grade.titleAr, en: grade.titleEn } : null);
    }
  }

  return view;
}

/** Flattens a scope view into ordered bilingual lines (label keys are added by the caller). */
export function scopeLinePairs(view: OrderScopeView): Array<{ key: "year" | "grade" | "subject" | "term"; title: BilingualTitle }> {
  const out: Array<{ key: "year" | "grade" | "subject" | "term"; title: BilingualTitle }> = [];
  for (const t of view.years) out.push({ key: "year", title: t });
  for (const t of view.grades) out.push({ key: "grade", title: t });
  for (const t of view.subjects) out.push({ key: "subject", title: t });
  for (const t of view.terms) out.push({ key: "term", title: t });
  return out;
}
