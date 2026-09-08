import type { Route } from "./+types/admin.search";
import { Link, Form, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { canPlatform } from "~server/auth/permissions.server";
import { canAssessment } from "~server/assessment/service.server";
import { canAssignment } from "~server/assignments/service.server";
import {
  searchAssignments,
  searchCourses,
  searchExams,
  searchLessons,
  searchStudents,
} from "~server/search/service.server";
import { Badge } from "~/components/ui/Badge";
import { EmptyState } from "~/components/ui/EmptyState";
import { Card, CardBody } from "~/components/ui/Card";
import { t, type Locale } from "~/lib/i18n";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();

  const perms = {
    students: await canPlatform(db, auth, "users.read"),
    courses: true,
    lessons: true,
    exams: await canAssessment(db, auth, "assessment.read"),
    assignments: await canAssignment(db, auth, "assignment.read"),
  };

  if (!q) {
    return {
      q, perms,
      groups: {
        students: [], courses: [], lessons: [], exams: [], assignments: [],
      } as Record<string, unknown[]>,
    };
  }

  const [students, courses, lessons, exams, assignments] = await Promise.all([
    perms.students ? searchStudents(db, q) : Promise.resolve([]),
    perms.courses ? searchCourses(db, q) : Promise.resolve([]),
    perms.lessons ? searchLessons(db, q) : Promise.resolve([]),
    perms.exams ? searchExams(db, q) : Promise.resolve([]),
    perms.assignments ? searchAssignments(db, q) : Promise.resolve([]),
  ]);

  return {
    q,
    perms,
    groups: { students, courses, lessons, exams, assignments } as unknown as Record<string, unknown[]>,
  };
}

function useL() { return { locale: (useRouteLoaderData("root") as { locale: Locale })?.locale ?? "ar" as Locale }; }

export default function AdminSearchPage({ loaderData }: Route.ComponentProps) {
  const { locale } = useL();
  const L = (k: string, params?: Record<string, string | number>) => t(locale, k, params);
  const { q, perms, groups } = loaderData;
  const g = groups as unknown as Record<string, Array<Record<string, unknown>>>;
  const total = Object.values(g).reduce((n, arr) => n + arr.length, 0);

  const sections: Array<{ key: keyof typeof g; label: string; empty: boolean }> = [
    { key: "students", label: L("search.group_students"), empty: !perms.students },
    { key: "courses", label: L("search.group_courses"), empty: false },
    { key: "lessons", label: L("search.group_lessons"), empty: false },
    { key: "exams", label: L("search.group_exams"), empty: !perms.exams },
    { key: "assignments", label: L("search.group_assignments"), empty: !perms.assignments },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{L("search.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{L("search.subtitle")}</p>
      </div>

      <Form method="get" role="search" className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="admin-search-q">{L("search.placeholder")}</label>
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-slate-400" aria-hidden>🔍</span>
          <input
            id="admin-search-q"
            name="q"
            defaultValue={q}
            autoFocus
            data-testid="admin-search-input"
            className="h-12 w-full rounded-lg border border-slate-300 bg-white ps-10 pe-3 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder={L("search.placeholder")}
          />
        </div>
        <button type="submit" className="h-12 rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700">{L("search.button")}</button>
      </Form>

      {!q ? (
        <EmptyState title={L("search.prompt")} body={L("search.promptBody")} icon="🔍" />
      ) : (
        <>
          <p className="text-sm text-slate-500">{L("search.resultCount", { n: String(total), q })}</p>
          {total === 0 && <EmptyState title={L("search.noResults")} body={L("search.noResultsBody", { q })} icon="🕵️" />}

          {sections.map((s) => {
            const rows = g[s.key] ?? [];
            if (s.empty) return null;
            if (!rows.length) return null;
            return (
              <section key={s.key} aria-label={s.label}>
                <h2 className="mb-2 flex items-center gap-2 text-base font-bold text-slate-800">
                  {s.label} <Badge tone="neutral">{rows.length}</Badge>
                </h2>
                <Card><CardBody className="divide-y divide-slate-100 p-0">
                  {rows.map((r, idx) => (
                    <Row key={`${s.key}-${String(r.id)}-${idx}`} kind={s.key} row={r} locale={locale} />
                  ))}
                </CardBody></Card>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

function Row({ kind, row, locale }: { kind: string; row: Record<string, unknown>; locale: Locale }) {
  const L = (k: string) => t(locale, k);
  const to = (() => {
    const id = String(row.id ?? "");
    switch (kind) {
      case "students": return `/admin/students/${id}`;
      case "courses": return `/admin/content/course/${id}`;
      case "lessons": return `/admin/content/lesson/${id}`;
      case "exams": return `/admin/assessment/exams/${id}`;
      case "assignments": return `/admin/assignments/${id}`;
      default: return "#";
    }
  })();
  const title =
    kind === "students"
      ? String(row.fullName ?? "")
      : locale === "ar"
        ? (String(row.titleAr ?? "") || String(row.titleEn ?? ""))
        : (String(row.titleEn ?? "") || String(row.titleAr ?? ""));

  const meta = kind === "students"
    ? <span dir="ltr" className="text-slate-500">{String(row.email ?? "")}</span>
    : row.status
      ? <Badge tone="neutral">{L(`search.status.${String(row.status)}`)}</Badge>
      : null;

  return (
    <Link to={to} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-800">{title}</p>
        <p className="text-xs">{meta}</p>
      </div>
      <span className="shrink-0 text-slate-300" aria-hidden>←</span>
    </Link>
  );
}
