import type { Route } from "./+types/admin.assignments";
import { Link, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { adminTree } from "~server/content/service.server";
import {
  canAssignment,
  gradingQueue,
  listAssignmentsAdmin,
} from "~server/assignments/service.server";
import { Badge } from "~/components/ui/Badge";
import { Alert } from "~/components/ui/Alert";
import { Card, CardBody } from "~/components/ui/Card";
import { EmptyState } from "~/components/ui/EmptyState";
import { t, formatDate, type Locale } from "~/lib/i18n";

const selectCls = "h-[42px] rounded-lg border border-line bg-white px-3 text-sm";
const inputCls = "h-[42px] rounded-lg border border-line bg-white px-3 text-sm";

export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") === "grading" ? "grading" : "assignments";
  const perms = {
    read: await canAssignment(db, auth, "assignment.read"),
    create: await canAssignment(db, auth, "assignment.create"),
    edit: await canAssignment(db, auth, "assignment.edit"),
    publish: await canAssignment(db, auth, "assignment.publish"),
    grade: await canAssignment(db, auth, "assignment.grade"),
  };

  const tree = await adminTree(db);
  const courses: Array<{ id: string; labelAr: string; labelEn: string }> = [];
  for (const p of tree)
    for (const g of p.children)
      for (const s of g.children)
        for (const c of s.children) {
          if (c.type === "course") {
            courses.push({ id: c.id, labelAr: `${s.titleAr} › ${c.titleAr}`, labelEn: `${s.titleEn} › ${c.titleEn}` });
          }
        }

  if (!perms.read) {
    return {
      tab, perms, list: { items: [], total: 0, offset: 0, limit: 0 },
      grading: [] as Awaited<ReturnType<typeof gradingQueue>>,
      courses, status: "", q: "", courseId: "",
    };
  }

  if (tab === "grading") {
    const grading = await gradingQueue(db, { status: "submitted", limit: 100 });
    return { tab, perms, list: { items: [], total: 0, offset: 0, limit: 0 }, grading, courses, status: "", q: "", courseId: "" };
  }

  const status = url.searchParams.get("status") ?? "";
  const courseId = url.searchParams.get("courseId") ?? "";
  const q = url.searchParams.get("q") ?? "";
  const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
  const list = await listAssignmentsAdmin(db, {
    status: ["draft", "published", "archived"].includes(status) ? status as "draft" : undefined,
    courseId: courseId || undefined,
    q: q || undefined,
    limit: 50,
    offset,
  });
  return { tab, perms, list, grading: [] as Awaited<ReturnType<typeof gradingQueue>>, courses, status, q, courseId };
}

const aStatusTone: Record<string, "neutral" | "warning" | "success" | "brand"> = {
  draft: "neutral",
  published: "success",
  archived: "brand",
};

export default function AdminAssignmentsPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { tab, perms, list, grading, courses, status, q, courseId } = loaderData;
  const buildQuery = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    if (tab === "grading") p.set("tab", "grading");
    if (over.status) p.set("status", over.status);
    if (over.q) p.set("q", over.q);
    if (over.courseId) p.set("courseId", over.courseId);
    if (over.offset) p.set("offset", over.offset);
    return `?${p.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t(locale, "assignment.title")}</h1>
        {perms.create && (
          <Link to="/admin/assignments/new" className="min-h-11 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-800">
            + {t(locale, "assignment.newAssignment")}
          </Link>
        )}
      </div>

      {!perms.read && <Alert kind="error">{t(locale, "assignment.denied")}</Alert>}

      <div className="flex gap-2 border-b">
        {(["assignments", "grading"] as const).map((tb) => (
          <Link
            key={tb}
            to={buildQuery({}) === "?tab=grading" && tb === "grading" ? `?tab=grading` : tb === "assignments" ? "/admin/assignments" : "?tab=grading"}
            className={`border-b-2 px-4 py-2 text-sm font-medium ${tab === tb ? "border-brand-600 text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
          >
            {tb === "assignments" ? t(locale, "assignment.listTitle") : t(locale, "assignment.gradingTitle")}
          </Link>
        ))}
      </div>

      {tab === "grading" ? (
        <Card>
          <CardBody>
            {grading.length === 0 ? (
              <EmptyState title={t(locale, "assignment.noPendingGrading")} body={t(locale, "assignment.noPendingGradingBody")} icon="○" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink-muted">
                      <th className="px-3 py-2 font-medium">{t(locale, "assignment.colAssignment")}</th>
                      <th className="px-3 py-2 font-medium">{t(locale, "assignment.colStudent")}</th>
                      <th className="px-3 py-2 font-medium">{t(locale, "assignment.colSubmitted")}</th>
                      <th className="px-3 py-2 font-medium">{t(locale, "assignment.colFile")}</th>
                      <th className="px-3 py-2" scope="col"><span className="sr-only">{t(locale, "assignment.colReview")}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {grading.map((s) => (
                      <tr key={s.submissionId} className="border-b border-line last:border-0 hover:bg-slate-50/60">
                        <td className="px-3 py-2.5 font-medium">{locale === "ar" ? s.assignmentTitleAr : s.assignmentTitleEn}</td>
                        <td className="px-3 py-2.5 text-ink-muted">{s.studentName}</td>
                        <td className="px-3 py-2.5 text-ink-muted">{formatDate(locale, s.submittedAt)}</td>
                        <td className="px-3 py-2.5 text-ink-muted">{s.file ? t(locale, "assignment.yesFile") : "—"}</td>
                        <td className="px-3 py-2.5 text-end">
                          <Link to={`/admin/assignments/${s.assignmentId}`} className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-xs font-medium text-ink hover:border-ink">
                            {t(locale, "assignment.colReview")}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      ) : (
        <>
          <Card>
            <CardBody className="space-y-3">
              <form method="get" className="grid gap-3 lg:grid-cols-12" role="search">
                <div className="lg:col-span-4">
                  <input name="q" defaultValue={q} placeholder={t(locale, "assignment.searchPlaceholder")} className={inputCls} />
                </div>
                <div className="lg:col-span-3">
                  <select name="status" defaultValue={status} className={selectCls}>
                    <option value="">{t(locale, "assignment.allStatuses")}</option>
                    <option value="draft">{t(locale, "assignment.status_draft")}</option>
                    <option value="published">{t(locale, "assignment.status_published")}</option>
                    <option value="archived">{t(locale, "assignment.status_archived")}</option>
                  </select>
                </div>
                <div className="lg:col-span-3">
                  <select name="courseId" defaultValue={courseId} className={selectCls}>
                    <option value="">{t(locale, "assignment.allCourses")}</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>{locale === "ar" ? c.labelAr : c.labelEn}</option>
                    ))}
                  </select>
                </div>
                <div className="lg:col-span-2 flex gap-2">
                  <button type="submit" className="h-[42px] flex-1 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">
                    {t(locale, "assignment.filter")}
                  </button>
                </div>
              </form>
            </CardBody>
          </Card>

          {list.items.length === 0 ? (
            <EmptyState
              title={t(locale, "assignment.emptyList")}
              body={t(locale, "assignment.emptyListBody")}
              icon="○"
              action={perms.create ? (
                <Link to="/admin/assignments/new" className="inline-flex min-h-10 items-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800">
                  {t(locale, "assignment.emptyListCta")}
                </Link>
              ) : undefined}
            />
          ) : (
            <Card>
              <CardBody className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-ink-muted">
                        <th className="px-4 py-3 font-medium">{t(locale, "assignment.colAssignment")}</th>
                        <th className="px-4 py-3 font-medium">{t(locale, "assignment.colStatus")}</th>
                        <th className="px-4 py-3 font-medium">{t(locale, "assignment.colDue")}</th>
                        <th className="px-4 py-3 font-medium">{t(locale, "assignment.colMax")}</th>
                        <th className="px-4 py-3 font-medium">{t(locale, "assignment.colSubmissions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.items.map((a) => (
                        <tr key={a.id} className="border-b border-line last:border-0 hover:bg-slate-50/60">
                          <td className="px-4 py-3">
                            <Link to={`/admin/assignments/${a.id}`} className="font-medium text-ink hover:underline">
                              {locale === "ar" ? a.titleAr : a.titleEn}
                            </Link>
                          </td>
                          <td className="px-4 py-3"><Badge tone={aStatusTone[a.status]}>{t(locale, `assignment.status_${a.status}`)}</Badge></td>
                          <td className="px-4 py-3 text-ink-muted">{a.dueAt ? formatDate(locale, a.dueAt) : "—"}</td>
                          <td className="px-4 py-3 text-ink-muted">{a.maxScore}</td>
                          <td className="px-4 py-3 text-ink-muted">
                            {a.submittedCount} {t(locale, "assignment.submittedShort")} · {a.gradedCount} {t(locale, "assignment.gradedShort")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          )}

          {list.total > list.limit && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-ink-muted">{t(locale, "assignment.showing", { from: String(list.offset + 1), to: String(Math.min(list.offset + list.limit, list.total)), total: String(list.total) })}</span>
              <div className="flex gap-2">
                {list.offset > 0 && (
                  <Link to={`/admin/assignments${buildQuery({ status, q, courseId, offset: String(Math.max(list.offset - list.limit, 0)) })}`} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-50">
                    {t(locale, "assignment.prev")}
                  </Link>
                )}
                {list.offset + list.limit < list.total && (
                  <Link to={`/admin/assignments${buildQuery({ status, q, courseId, offset: String(list.offset + list.limit) })}`} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-slate-50">
                    {t(locale, "assignment.next")}
                  </Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
