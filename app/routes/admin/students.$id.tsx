import type { Route } from "./+types/students.$id";
import { Link, redirect, useRouteLoaderData } from "react-router";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { canPlatform } from "~server/auth/permissions.server";
import { canAssignment } from "~server/assignments/service.server";
import { auditStudent360Access, student360 } from "~server/students/service.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { EmptyState } from "~/components/ui/EmptyState";
import { Alert } from "~/components/ui/Alert";
import { t, formatDate, type Locale } from "~/lib/i18n";

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const env = getEnv(context);
  if (!(await canPlatform(db, auth, "users.read"))) throw new Response("Forbidden", { status: 403 });

  const data = await student360(db, params.id);
  if (!data.isStudent || !data.identity) {
    // not a student — hand off to the generic user detail page
    return redirect(`/admin/users/${params.id}`);
  }
  const nowMs = Date.now();
  void nowMs;
  const perms = {
    manage: await canPlatform(db, auth, "users.manage"),
    assignmentRead: await canAssignment(db, auth, "assignment.read"),
  };
  // audit staff inspection (actor is the staff member, never the student)
  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown");
  await auditStudent360Access(db, { userId: auth.user.id, role: auth.user.roleId }, params.id, ipHash);
  void env;
  return { data, perms, now: Date.now() };
}

function accessBadge(state: string, locale: Locale) {
  const map: Record<string, "success" | "warning" | "danger" | "neutral"> = {
    active: "success",
    upcoming: "warning",
    expired: "neutral",
    revoked: "danger",
  };
  return <Badge tone={map[state] ?? "neutral"}>{t(locale, `s360.access.${state}`)}</Badge>;
}

function attemptStatusKey(s: string) {
  switch (s) {
    case "graded": return "graded";
    case "in_progress": return "inProgress";
    case "submitted": return "submitted";
    case "grading": return "grading";
    default: return "other";
  }
}

function SectionTitle({ icon, children }: { icon: string; children: React.ReactNode }) {
  return <h2 className="mb-2 flex items-center gap-2 text-base font-bold text-ink"><span aria-hidden>{icon}</span>{children}</h2>;
}

export default function AdminStudent360({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { data, perms } = loaderData;
  const u = data.identity!;
  const L = (k: string, params?: Record<string, string | number>) => t(locale, k, params);
  const titleOf = (a?: string | null, e?: string | null) => (locale === "ar" ? (a || e || "") : (e || a || ""));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-ink">{L("s360.title")}</h1>
        <Link to="/admin/users" className="text-sm text-ink hover:underline">{L("adminUsers.backToList")}</Link>
      </div>

      {/* Profile header */}
      <Card>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-2xl font-bold text-ink" aria-hidden>
              {u.fullName.trim().charAt(0).toUpperCase() || "؟"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-ink">{u.fullName}</h2>
                <Badge tone={u.status === "active" ? "success" : "danger"}>{L(`s360.status.${u.status}`)}</Badge>
                {u.emailVerified && <Badge tone="brand">{L("s360.verified")}</Badge>}
              </div>
              <p className="mt-1 break-all text-sm text-ink-muted" dir="ltr">{u.email}</p>
              {u.phone && <p className="text-sm text-ink-muted" dir="ltr">{u.phone}</p>}
            </div>
            {perms.manage && (
              <Link to={`/admin/users/${u.id}`} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink hover:border-ink">
                {L("s360.manageAccount")}
              </Link>
            )}
          </div>
          <div className="grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><p className="text-ink-muted">{L("s360.memberSince")}</p><p className="font-medium text-ink">{formatDate(locale, u.createdAt)}</p></div>
            <div><p className="text-ink-muted">{L("s360.lastLogin")}</p><p className="font-medium text-ink">{u.lastLoginAt ? formatDate(locale, u.lastLoginAt) : "—"}</p></div>
            <div><p className="text-ink-muted">{L("s360.locale")}</p><p className="font-medium text-ink">{u.localePref === "en" ? "English" : "العربية"}</p></div>
            <div><p className="text-ink-muted">{L("s360.activeCourses")}</p><p className="font-medium text-ink">{data.summary.activeCourses}</p></div>
          </div>
        </CardBody>
      </Card>

      {/* Quick summary chips */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: L("s360.lessonsCompleted"), value: data.summary.lessonsCompleted },
          { label: L("s360.attempts"), value: data.summary.attempts },
          { label: L("s360.pendingManual"), value: data.summary.pendingManual },
          { label: L("s360.assignmentsAwaiting"), value: data.summary.assignmentsAwaiting },
        ].map((c) => (
          <Card key={c.label}>
            <CardBody>
              <p className="text-2xl font-bold text-ink">{c.value}</p>
              <p className="text-sm text-ink-muted">{c.label}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Access / enrollment */}
      <section aria-labelledby="s360-access">
        <SectionTitle icon="○">{L("s360.accessSection")}</SectionTitle>
        {data.entitlements.length === 0 ? (
          <EmptyState title={L("s360.noAccess")} body={L("s360.noAccessBody")} icon="○" />
        ) : (
          <Card><CardBody className="space-y-2">
            {data.entitlements.map((en) => (
              <div key={en.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {titleOf(en.resourceTitleAr, en.resourceTitleEn) || L(`s360.resource.${en.resourceType}`) || en.resourceType}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {L(`s360.resource.${en.resourceType}`)} · {L(`s360.source.${en.sourceType}`)} · {L("s360.granted")} {formatDate(locale, en.grantedAt)}
                    {en.expiresAt ? ` · ${L("s360.expires")} ${formatDate(locale, en.expiresAt)}` : ""}
                  </p>
                </div>
                {accessBadge(en.state, locale)}
              </div>
            ))}
          </CardBody></Card>
        )}
      </section>

      {/* Course progress */}
      <section aria-labelledby="s360-progress">
        <SectionTitle icon="○">{L("s360.courseProgress")}</SectionTitle>
        {data.courses.length === 0 ? (
          <EmptyState title={L("s360.noProgress")} body={L("s360.noProgressBody")} icon="○" />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.courses.map((c) => (
              <Card key={c.courseId}><CardBody className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-ink">{titleOf(c.titleAr, c.titleEn)}</p>
                  <Badge tone={c.pct === 100 ? "success" : c.pct > 0 ? "brand" : "neutral"}>{c.pct}%</Badge>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={c.pct} aria-valuemin={0} aria-valuemax={100} aria-label={titleOf(c.titleAr, c.titleEn)}>
                  <div className="h-full rounded-full bg-brand-700" style={{ width: `${c.pct}%` }} />
                </div>
                <p className="text-xs text-ink-muted">{L("s360.completedOf")} {c.completedLessons} / {c.totalLessons}</p>
              </CardBody></Card>
            ))}
          </div>
        )}
      </section>

      {/* Assessments */}
      <section aria-labelledby="s360-assessments">
        <SectionTitle icon="○">{L("s360.assessments")}</SectionTitle>
        {data.attempts.length === 0 ? (
          <EmptyState title={L("s360.noAssessments")} body={L("s360.noAssessmentsBody")} icon="○" />
        ) : (
          <Card><CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-muted">
                    <th className="px-4 py-3 font-medium">{L("s360.colExam")}</th>
                    <th className="px-4 py-3 font-medium">{L("s360.colDate")}</th>
                    <th className="px-4 py-3 font-medium">{L("s360.colStatus")}</th>
                    <th className="px-4 py-3 font-medium">{L("s360.colScore")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.attempts.map((a) => (
                    <tr key={a.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-3">
                        <Link to={`/admin/assessment/attempts/${a.id}`} className="font-medium text-ink hover:underline">{titleOf(a.examTitleAr, a.examTitleEn)}</Link>
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{formatDate(locale, a.submittedAt ?? a.startedAt)}</td>
                      <td className="px-4 py-3">
                        {a.needsManual
                          ? <Badge tone="warning">{L("s360.attempt.needsManual")}</Badge>
                          : <Badge tone="neutral">{L(`s360.attempt.${attemptStatusKey(a.status)}`)}</Badge>}
                      </td>
                      <td className="px-4 py-3 text-ink">{a.score != null ? `${a.score} / ${a.maxScore ?? ""}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody></Card>
        )}
      </section>

      {/* Assignments */}
      <section aria-labelledby="s360-assignments-section">
        <SectionTitle icon="○">{L("s360.assignments")}</SectionTitle>
        {data.assignments.length === 0 ? (
          <EmptyState title={L("s360.noAssignments")} body={L("s360.noAssignmentsBody")} icon="○" />
        ) : (
          <Card><CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-muted">
                    <th className="px-4 py-3 font-medium">{L("s360.colAssignment")}</th>
                    <th className="px-4 py-3 font-medium">{L("s360.colSubmittedAt")}</th>
                    <th className="px-4 py-3 font-medium">{L("s360.colStatus")}</th>
                    <th className="px-4 py-3 font-medium">{L("s360.colScore")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.assignments.map((a) => (
                    <tr key={a.assignmentId} className="border-b border-line last:border-0">
                      <td className="px-4 py-3">
                        {perms.assignmentRead
                          ? <Link to={`/admin/assignments/${a.assignmentId}`} className="font-medium text-ink hover:underline">{titleOf(a.assignmentTitleAr, a.assignmentTitleEn)}</Link>
                          : <span className="font-medium text-ink">{titleOf(a.assignmentTitleAr, a.assignmentTitleEn)}</span>}
                        {a.hasFile && <span className="ml-1 text-xs text-ink-muted" title={L("s360.privateFile")}>📎</span>}
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{formatDate(locale, a.submittedAt)}</td>
                      <td className="px-4 py-3"><Badge tone={a.status === "graded" ? "success" : "warning"}>{L(`s360.assignment.${a.status}`)}</Badge></td>
                      <td className="px-4 py-3 text-ink">{a.status === "graded" && a.score != null ? `${a.score} / ${a.maxScore}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody></Card>
        )}
      </section>

      {/* Activity timeline */}
      <section aria-labelledby="s360-timeline">
        <SectionTitle icon="○">{L("s360.activity")}</SectionTitle>
        {data.timeline.length === 0 ? (
          <Alert kind="info">{L("s360.noActivity")}</Alert>
        ) : (
          <Card><CardBody className="space-y-1">
            <ol className="relative space-y-0">
              {data.timeline.map((item, i) => (
                <li key={`${item.ts}-${i}`} className="flex gap-3 py-2">
                  <div className="relative mt-1 flex flex-col items-center">
                    <span className={`h-2.5 w-2.5 rounded-full ${i === 0 ? "bg-brand-700" : "bg-slate-300"}`} aria-hidden />
                    {i < data.timeline.length - 1 && <span className="w-px flex-1 bg-slate-200" aria-hidden />}
                  </div>
                  <div className="min-w-0 flex-1 pb-1 text-sm">
                    <p className="font-medium text-ink">{L(item.labelKey)}</p>
                    {item.detail && <p className="truncate text-xs text-ink-muted">{item.detail}</p>}
                  </div>
                  <span className="shrink-0 pt-0.5 text-xs text-ink-muted">{formatDate(locale, item.ts)}</span>
                </li>
              ))}
            </ol>
          </CardBody></Card>
        )}
      </section>
    </div>
  );
}
