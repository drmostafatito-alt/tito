import type { Route } from "./+types/assignments";
import { Link, useRouteLoaderData } from "react-router";
import { requireUser } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { listStudentAssignments } from "~server/assignments/service.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody } from "~/components/ui/Card";
import { EmptyState } from "~/components/ui/EmptyState";
import { t, formatDate, type Locale } from "~/lib/i18n";

interface ListItem {
  id: string;
  titleAr: string;
  titleEn: string;
  maxScore: number;
  dueAt: number | null;
  courseId: string | null;
  unitId: string | null;
  lessonId: string | null;
  open: boolean;
  myStatus: string | null;
  myScore: number | null;
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireUser(context, request);
  const db = getDb(getEnv(context));
  const raw = await listStudentAssignments(db, { userId: auth.user.id, roleRank: auth.user.rank, roleId: auth.user.roleId }, Date.now());
  const items: ListItem[] = raw.map((r) => ({
    id: String(r.id ?? ""),
    titleAr: String(r.titleAr ?? ""),
    titleEn: String(r.titleEn ?? ""),
    maxScore: Number(r.maxScore ?? 0),
    dueAt: r.dueAt == null ? null : Number(r.dueAt),
    courseId: r.courseId == null ? null : String(r.courseId),
    unitId: r.unitId == null ? null : String(r.unitId),
    lessonId: r.lessonId == null ? null : String(r.lessonId),
    open: Boolean(r.open),
    myStatus: r.myStatus == null ? null : String(r.myStatus),
    myScore: r.myScore == null ? null : Number(r.myScore),
  }));
  return { items };
}

function stateOf(a: ListItem): "available" | "awaiting" | "graded" | "closed" {
  if (a.myStatus === "graded") return "graded";
  if (a.myStatus === "submitted") return "awaiting";
  if (a.open) return "available";
  return "closed";
}

const stateTone: Record<string, "neutral" | "warning" | "success" | "brand"> = {
  available: "success",
  awaiting: "warning",
  graded: "brand",
  closed: "neutral",
};

export default function StudentAssignmentsPage({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const { items } = loaderData;
  const now = Date.now();
  const titleOf = (a: ListItem) => (locale === "ar" ? a.titleAr : a.titleEn);
  const byState = (s: string) => items.filter((i) => stateOf(i) === s);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-brand-800 pb-4">
        <h1 className="sig-display text-3xl text-ink">{t(locale, "assignment.myAssignments")}</h1>
      </div>

      {items.length === 0 ? (
        <EmptyState title={t(locale, "assignment.noAssignmentsForYou")} body={t(locale, "assignment.noAssignmentsForYouBody")} icon={<span aria-hidden="true">○</span>} />
      ) : (
        <>
          {(["available", "awaiting", "graded", "closed"] as const).map((s) => {
            const group = byState(s);
            if (!group.length) return null;
            return (
              <div key={s} className="space-y-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
                  <span aria-hidden="true" className="inline-block h-2.5 w-2.5 bg-accent-500" />
                  {t(locale, `assignment.st_${s}`)} <span className="tabular-nums text-ink-muted">· {group.length}</span>
                </h2>
                <Card>
                  <CardBody className="space-y-3">
                    {group.map((a) => {
                      const st = stateOf(a);
                      return (
                        <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-btn)] border border-line p-3">
                          <div className="min-w-0 flex-1">
                            <Link to={`/assignments/${a.id}`} className="inline-flex min-h-9 items-center font-bold text-ink">
                              <span className="sig-u">{titleOf(a)}</span>
                            </Link>
                            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs tabular-nums text-ink-muted">
                              <span>{t(locale, "assignment.maxScore")}: {a.maxScore}</span>
                              {a.dueAt && <span dir="ltr">{t(locale, "assignment.dueAt")}: {formatDate(locale, a.dueAt)}</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {st === "graded" && <Badge tone="brand">{a.myScore}</Badge>}
                            <Badge tone={stateTone[st]}>{t(locale, `assignment.st_${st}`)}</Badge>
                            <Link to={`/assignments/${a.id}`} className="inline-flex min-h-9 items-center rounded-[var(--radius-btn)] border border-line px-3 py-1.5 text-xs font-bold text-ink transition-colors hover:border-brand-800">
                              {st === "available" ? t(locale, "assignment.submitNow") : t(locale, "assignment.view")}
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </CardBody>
                </Card>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
