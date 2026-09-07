import { and, desc, eq, isNull, or, like } from "drizzle-orm";
import type { DB } from "~server/db/client.server";
import { assignments, courses, exams, lessons, users } from "~server/db/schema";

/**
 * Global admin search — bounded, server-side, D1-only (no external engine).
 * Every category is a direct parameterized query with a small LIMIT so a whole
 * table is never pulled into Worker memory. Access is decided by the caller
 * (each category gated by its own permission) — this module never returns rows
 * for a category that should be hidden. LIKE wildcards in the term are clamped
 * and length-limited; there is no SQL-injection surface (parameterized).
 */

export const SEARCH_CATEGORY_LIMIT = 8;
export const SEARCH_MAX_TERM = 40;

function safeTerm(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, SEARCH_MAX_TERM);
}

export interface StudentHit {
  id: string;
  fullName: string;
  email: string;
  status: string;
  createdAt: number;
}

export async function searchStudents(db: DB, raw: string, limit = SEARCH_CATEGORY_LIMIT): Promise<StudentHit[]> {
  const q = safeTerm(raw);
  if (!q) return [];
  const pattern = `%${q}%`;
  return db
    .select({ id: users.id, fullName: users.fullName, email: users.email, status: users.status, createdAt: users.createdAt })
    .from(users)
    .where(and(eq(users.roleId, "student"), isNull(users.deletedAt), or(like(users.fullName, pattern), like(users.email, pattern))!))
    .orderBy(desc(users.createdAt))
    .limit(limit);
}

export interface CourseHit {
  id: string;
  titleAr: string;
  titleEn: string;
  status: string;
}

export async function searchCourses(db: DB, raw: string, limit = SEARCH_CATEGORY_LIMIT): Promise<CourseHit[]> {
  const q = safeTerm(raw);
  if (!q) return [];
  const pattern = `%${q}%`;
  return db
    .select({ id: courses.id, titleAr: courses.titleAr, titleEn: courses.titleEn, status: courses.status })
    .from(courses)
    .where(and(isNull(courses.deletedAt), eq(courses.status, "published") as never, or(like(courses.titleAr, pattern), like(courses.titleEn, pattern))!))
    .orderBy(desc(courses.updatedAt))
    .limit(limit);
}

export interface LessonHit {
  id: string;
  titleAr: string;
  titleEn: string;
}

export async function searchLessons(db: DB, raw: string, limit = SEARCH_CATEGORY_LIMIT): Promise<LessonHit[]> {
  const q = safeTerm(raw);
  if (!q) return [];
  const pattern = `%${q}%`;
  return db
    .select({ id: lessons.id, titleAr: lessons.titleAr, titleEn: lessons.titleEn })
    .from(lessons)
    .where(and(eq(lessons.status, "published") as never, isNull(lessons.deletedAt) as never, or(like(lessons.titleAr, pattern), like(lessons.titleEn, pattern))!))
    .limit(limit);
}

export interface AssignmentHit {
  id: string;
  titleAr: string;
  titleEn: string;
  status: string;
}

export async function searchAssignments(db: DB, raw: string, limit = SEARCH_CATEGORY_LIMIT): Promise<AssignmentHit[]> {
  const q = safeTerm(raw);
  if (!q) return [];
  const pattern = `%${q}%`;
  return db
    .select({ id: assignments.id, titleAr: assignments.titleAr, titleEn: assignments.titleEn, status: assignments.status })
    .from(assignments)
    .where(or(like(assignments.titleAr, pattern), like(assignments.titleEn, pattern))!)
    .orderBy(desc(assignments.updatedAt))
    .limit(limit);
}

export interface ExamHit {
  id: string;
  titleAr: string;
  titleEn: string;
  status: string;
}

export async function searchExams(db: DB, raw: string, limit = SEARCH_CATEGORY_LIMIT): Promise<ExamHit[]> {
  const q = safeTerm(raw);
  if (!q) return [];
  const pattern = `%${q}%`;
  return db
    .select({ id: exams.id, titleAr: exams.titleAr, titleEn: exams.titleEn, status: exams.status })
    .from(exams)
    .where(or(like(exams.titleAr, pattern), like(exams.titleEn, pattern))!)
    .orderBy(desc(exams.updatedAt))
    .limit(limit);
}
