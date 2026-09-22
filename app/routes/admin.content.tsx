import type { Route } from "./+types/admin.content";
import { useEffect, useMemo, useState } from "react";
import { Form, Link, useActionData, useLoaderData, useRouteLoaderData, useNavigation } from "react-router";
import { z } from "zod";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  adminTree,
  createAcademicYear,
  createCourse,
  createGrade,
  createLesson,
  createProgram,
  createSubject,
  createTerm,
  createUnit,
  ensureDefaultUnit,
  listAcademicYears,
  listTerms,
  type AdminTreeNode,
} from "~server/content/service.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { t, type Locale } from "~/lib/i18n";

/** Admin content tree: full hierarchy, create programs, jump to node editors. */
export async function loader({ context, request }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const [tree, years, termRows] = await Promise.all([adminTree(db), listAcademicYears(db), listTerms(db)]);
  return {
    tree,
    years: years.map((y) => ({ id: y.id, titleAr: y.titleAr, titleEn: y.titleEn, status: y.status, isCurrent: y.isCurrent, startYear: y.startYear, endYear: y.endYear })),
    terms: termRows.map((tm) => ({ id: tm.id, titleAr: tm.titleAr, titleEn: tm.titleEn, status: tm.status })),
  };
}

export async function action({ context, request }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");

  if (intent === "create-program") {
    const parsed = z
      .object({
        titleAr: z.string().trim().min(1).max(200),
        titleEn: z.string().trim().min(1).max(200),
        status: z.enum(["draft", "published"]).catch("draft"),
      })
      .safeParse({
        titleAr: form.get("titleAr"),
        titleEn: form.get("titleEn"),
        status: form.get("status") ?? "draft",
      });
    if (!parsed.success) return { error: "validation" as const };
    await createProgram(
      db,
      { ...parsed.data, descriptionAr: null, descriptionEn: null, sortOrder: 0, slug: undefined },
      { userId: auth.user.id, role: auth.user.roleId, ipHash: await sha256Hex(clientIpOf(request) ?? "unknown", env.SESSION_PEPPER) }
    );
    return { ok: true as const };
  }

  // Academic years & terms: owner-created reference rows (never auto-generated,
  // never hardcoded). Both are ordinary content nodes (status/sortOrder/audit).
  if (intent === "create-academic-year") {
    const startYear = Number(String(form.get("startYear") ?? ""));
    const endYearRaw = String(form.get("endYear") ?? "").trim();
    const endYear = endYearRaw === "" ? startYear + 1 : Number(endYearRaw);
    const titleAr = String(form.get("titleAr") ?? "").trim();
    const titleEn = String(form.get("titleEn") ?? "").trim() || `${startYear}/${endYear}`;
    if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || (!titleAr && !titleEn)) {
      return { error: "validation" as const };
    }
    await createAcademicYear(
      db,
      {
        titleAr: titleAr || titleEn,
        titleEn,
        startYear,
        endYear,
        isCurrent: form.get("isCurrent") === "on",
        status: (String(form.get("status") ?? "draft") as "draft" | "published") || "draft",
        sortOrder: 0,
        slug: undefined,
      },
      { userId: auth.user.id, role: auth.user.roleId, ipHash: await sha256Hex(clientIpOf(request) ?? "unknown", env.SESSION_PEPPER) }
    );
    return { ok: true as const };
  }

  if (intent === "create-term") {
    const titleAr = String(form.get("titleAr") ?? "").trim();
    const titleEn = String(form.get("titleEn") ?? "").trim();
    if (!titleAr || !titleEn) return { error: "validation" as const };
    await createTerm(
      db,
      {
        titleAr,
        titleEn,
        startsAt: null,
        endsAt: null,
        status: (String(form.get("status") ?? "draft") as "draft" | "published") || "draft",
        sortOrder: 0,
        slug: undefined,
      },
      { userId: auth.user.id, role: auth.user.roleId, ipHash: await sha256Hex(clientIpOf(request) ?? "unknown", env.SESSION_PEPPER) }
    );
    return { ok: true as const };
  }

  // Hub-level creation for the rest of the hierarchy (grade→…→lesson). Each
  // type requires its correct parent (selector above prevents orphan rows);
  // server logic is reused via the existing create* services.
  if (intent === "create-content") {
    const S = (k: string) => (form.get(k) === null ? "" : String(form.get(k)));
    const type = S("contentType");
    const parentId = S("parentId");
    const titleAr = S("titleAr").trim();
    const titleEn = S("titleEn").trim();
    if (!parentId || !titleAr || !titleEn) return { error: "validation" as const };
    const status = (S("status") as "draft" | "published") || "draft";
    const actor = {
      userId: auth.user.id,
      role: auth.user.roleId,
      ipHash: await sha256Hex(clientIpOf(request) ?? "unknown", env.SESSION_PEPPER),
    };
    switch (type) {
      case "grade":
        await createGrade(db, { programId: parentId, titleAr, titleEn, status, sortOrder: 0, slug: undefined }, actor);
        break;
      case "subject":
        await createSubject(
          db,
          { gradeId: parentId, titleAr, titleEn, status, sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, slug: undefined },
          actor
        );
        break;
      case "course": {
        // A term container: subject + academic year + term. The admin never
        // re-types the grade or subject — they are implied by the parent subject.
        const academicYearId = S("academicYearId") || null;
        const termId = S("termId") || null;
        await createCourse(
          db,
          {
            subjectId: parentId, titleAr, titleEn, status,
            academicYearId, termId,
            visibility: "catalog", accessLevel: "entitled", sortOrder: 0,
            descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null,
            publishAt: null, expiresAt: null, slug: undefined,
          },
          actor
        );
        break;
      }
      case "unit":
        await createUnit(db, { courseId: parentId, titleAr, titleEn, status, sortOrder: 0 }, actor);
        break;
      case "lesson":
        await createLesson(
          db,
          {
            unitId: parentId, titleAr, titleEn, status,
            accessLevel: accessFromForm(S("access")), freePreview: false, sortOrder: 0,
            descriptionAr: S("descriptionAr") || null, descriptionEn: null, publishAt: null, expiresAt: null, slug: undefined,
          },
          actor
        );
        break;
      case "termLesson": {
        // Lesson straight inside a term container: the internal unit row the
        // schema requires is ensured automatically, so the owner only thinks in
        // سنة → صف → مادة → ترم → درس.
        const unitRow = await ensureDefaultUnit(db, parentId, actor);
        await createLesson(
          db,
          {
            unitId: unitRow.id, titleAr, titleEn, status,
            accessLevel: accessFromForm(S("access")), freePreview: false, sortOrder: 0,
            descriptionAr: S("descriptionAr") || null, descriptionEn: null, publishAt: null, expiresAt: null, slug: undefined,
          },
          actor
        );
        break;
      }
      default:
        return { error: "generic" as const };
    }
    return { ok: true as const };
  }

  return { error: "generic" as const };
}

/**
 * Admin access choice → the existing `access_level` enum (no new column, no new
 * resolver branch):
 *   مجاني (للمسجّلين) → authenticated · مجاني للجميع → public · مدفوع → entitled
 */
function accessFromForm(value: string): "public" | "authenticated" | "entitled" {
  if (value === "free") return "authenticated";
  if (value === "public") return "public";
  return "entitled";
}

function StatusBadge({ status, locale }: { status: string; locale: Locale }) {
  const tone = status === "published" ? "success" : status === "archived" ? "neutral" : "warning";
  const key = status === "published" ? "content.statusPublished" : status === "archived" ? "content.statusArchived" : "content.statusDraft";
  return <Badge tone={tone}>{t(locale, key)}</Badge>;
}

function TreeNode({ node, locale, depth = 0 }: { node: AdminTreeNode; locale: Locale; depth?: number }) {
  const label = locale === "ar" ? node.titleAr : node.titleEn;
  return (
    <li className={depth === 0 ? "mb-3" : "mb-1.5"}>
      <div className={`flex min-w-0 flex-col gap-0.5 py-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 ${["", "ps-4", "ps-8", "ps-12", "ps-16", "ps-20", "ps-24", "ps-28"][Math.min(depth, 7)]}`}>
        <div className="flex min-w-0 items-center gap-2">
          <StatusBadge status={node.status} locale={locale} />
          <Link
            to={`/admin/content/${node.type}/${node.id}`}
            className="min-w-0 truncate text-sm font-medium text-slate-800 hover:underline"
          >
            {label}
          </Link>
        </div>
        {node.slug && (
          <span dir="ltr" className="min-w-0 truncate text-xs text-slate-500 sm:max-w-[45%]">
            /{node.slug}
          </span>
        )}
      </div>
      {node.children.length > 0 && (
        <ul className="list-none p-0">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} locale={locale} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Flatten the tree for search/filter results (each hit keeps its breadcrumb). */
function flatten(nodes: AdminTreeNode[], trail: AdminTreeNode[] = []): Array<{ node: AdminTreeNode; trail: AdminTreeNode[] }> {
  const out: Array<{ node: AdminTreeNode; trail: AdminTreeNode[] }> = [];
  for (const n of nodes) {
    out.push({ node: n, trail });
    if (n.children.length) out.push(...flatten(n.children, [...trail, n]));
  }
  return out;
}

function matches(node: AdminTreeNode, needle: string): boolean {
  if (!needle) return true;
  return (
    node.titleAr.toLowerCase().includes(needle) ||
    node.titleEn.toLowerCase().includes(needle) ||
    (node.slug ?? "").toLowerCase().includes(needle)
  );
}

const TYPE_LABEL_KEY: Record<string, string> = {
  academicYear: "content.academicYear",
  term: "content.term",
  program: "content.program",
  grade: "content.grade",
  subject: "content.subject",
  course: "content.termContainer",
  unit: "content.unit",
  lesson: "content.lesson",
};

function ContentTree({ tree, locale }: { tree: AdminTreeNode[]; locale: Locale }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const needle = q.trim().toLowerCase();

  const filtering = Boolean(needle || status || type);
  const rows = useMemo(() => {
    if (!filtering) return null;
    return flatten(tree).filter(({ node }) =>
      matches(node, needle) && (!status || node.status === status) && (!type || node.type === type)
    );
  }, [tree, needle, status, type, filtering]);

  const selectCls = "min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t(locale, "content.searchTree")}
          aria-label={t(locale, "content.searchTree")}
          className="min-h-11 min-w-[12rem] flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm"
          data-testid="content-tree-search"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t(locale, "content.status")} className={selectCls} data-testid="content-tree-status">
          <option value="">{t(locale, "content.status")}: {t(locale, "content.all")}</option>
          <option value="draft">{t(locale, "content.statusDraft")}</option>
          <option value="published">{t(locale, "content.statusPublished")}</option>
          <option value="archived">{t(locale, "content.statusArchived")}</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label={t(locale, "content.filterType")} className={selectCls} data-testid="content-tree-type">
          <option value="">{t(locale, "content.filterType")}: {t(locale, "content.all")}</option>
          {Object.entries(TYPE_LABEL_KEY).map(([ty, key]) => (
            <option key={ty} value={ty}>{t(locale, key)}</option>
          ))}
        </select>
      </div>

      {rows ? (
        <>
          <p className="text-xs text-slate-500">{t(locale, "content.resultsCount", { n: rows.length })}</p>
          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              {t(locale, "content.filterNoMatch")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5" data-testid="content-tree-results">
              {rows.map(({ node, trail }) => (
                <li key={node.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5">
                  <StatusBadge status={node.status} locale={locale} />
                  {trail.length > 0 && (
                    <span className="hidden truncate text-xs text-slate-500 sm:inline">
                      {trail.map((a) => (locale === "ar" ? a.titleAr : a.titleEn)).join(" › ")} ›
                    </span>
                  )}
                  <Link to={`/admin/content/${node.type}/${node.id}`} className="min-w-0 flex-1 text-sm font-medium text-slate-800 hover:underline">
                    {locale === "ar" ? node.titleAr : node.titleEn}
                  </Link>
                  <Badge tone="neutral">{t(locale, TYPE_LABEL_KEY[node.type] ?? "content.type")}</Badge>
                  {node.slug && <span dir="ltr" className="hidden max-w-[30%] shrink truncate text-xs text-slate-500 md:inline">/{node.slug}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : tree.length === 0 ? (
        <p className="text-sm text-slate-500">{t(locale, "content.catalogEmpty")}</p>
      ) : (
        <ul className="list-none p-0" data-testid="content-tree-full">{tree.map((n) => <TreeNode key={n.id} node={n} locale={locale} />)}</ul>
      )}
    </div>
  );
}

function collectByType(nodes: AdminTreeNode[], type: string, locale: Locale): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  const walk = (list: AdminTreeNode[]) => {
    for (const n of list) {
      if (n.type === type) out.push({ id: n.id, label: locale === "ar" ? n.titleAr : n.titleEn });
      if (n.children && n.children.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

// For each creatable child, which ancestor type is its required parent.
// `course` is the internal TERM CONTAINER (subject + academic year + term);
// `termLesson` is a lesson placed directly inside that container.
const PARENT_OF: Record<string, string> = {
  grade: "program",
  subject: "grade",
  course: "subject",
  unit: "course",
  lesson: "unit",
  termLesson: "course",
};

/** i18n key for a node type in admin selectors (term container ≠ "كورس"). */
const TYPE_PARENT_LABEL_KEY: Record<string, string> = {
  program: "content.program",
  grade: "content.grade",
  subject: "content.subject",
  course: "content.termContainer",
  unit: "content.unit",
  lesson: "content.lesson",
};

export default function AdminContent({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();

  return (
    <div className="space-y-6">
      <h1 className="sr-only">{t(locale, "admin.navContent")}</h1>
      <Card>
        <CardHeader title={t(locale, "admin.navContent")} description={t(locale, "content.treeHint")} />
        <CardBody>
          <ContentTree tree={loaderData.tree} locale={locale} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(locale, "content.addProgram")} />
        <CardBody>
          <Form method="post" className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="_action" value="create-program" />
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.titleAr")}</span>
              <input name="titleAr" required dir="rtl" className="rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.titleEn")}</span>
              <input name="titleEn" required dir="ltr" className="rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.status")}</span>
              <select name="status" className="rounded-lg border border-slate-300 px-3 py-2">
                <option value="draft">{t(locale, "content.statusDraft")}</option>
                <option value="published">{t(locale, "content.statusPublished")}</option>
              </select>
            </label>
            <div className="sm:col-span-3">
              <SubmitButton>{t(locale, "content.addProgram")}</SubmitButton>
              {actionData?.ok && <span className="ms-2 text-sm text-green-600">{t(locale, "content.created")}</span>}
            </div>
          </Form>
        </CardBody>
      </Card>

      {/* السنة الدراسية — owner-created, never hardcoded, never auto-added. */}
      <Card>
        <CardHeader title={t(locale, "content.yearsTitle")} description={t(locale, "content.yearsHint")} />
        <CardBody className="space-y-4">
          {loaderData.years.length > 0 && (
            <ul className="flex flex-col gap-1.5 text-sm" data-testid="admin-years">
              {loaderData.years.map((y) => (
                <li key={y.id} className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={y.status} locale={locale} />
                  <Link to={`/admin/content/academicYear/${y.id}`} className="font-medium text-slate-800 hover:underline">
                    {locale === "ar" ? y.titleAr : y.titleEn}
                  </Link>
                  <span dir="ltr" className="text-xs text-slate-500">{y.startYear}/{y.endYear}</span>
                  {y.isCurrent && <Badge tone="brand">{t(locale, "content.isCurrent")}</Badge>}
                </li>
              ))}
            </ul>
          )}
          <Form method="post" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input type="hidden" name="_action" value="create-academic-year" />
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.startYear")}</span>
              <input name="startYear" type="number" min={1990} max={2999} required dir="ltr" className="rounded-lg border border-slate-300 px-3 py-2" placeholder="2026" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.endYear")}</span>
              <input name="endYear" type="number" min={1990} max={2999} dir="ltr" className="rounded-lg border border-slate-300 px-3 py-2" placeholder="2027" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.titleAr")}</span>
              <input name="titleAr" dir="rtl" className="rounded-lg border border-slate-300 px-3 py-2" placeholder="2026/2027" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.status")}</span>
              <select name="status" className="rounded-lg border border-slate-300 px-3 py-2">
                <option value="draft">{t(locale, "content.statusDraft")}</option>
                <option value="published">{t(locale, "content.statusPublished")}</option>
              </select>
            </label>
            <div className="flex flex-col justify-end gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isCurrent" />
                {t(locale, "content.isCurrent")}
              </label>
              <SubmitButton>{t(locale, "content.addAcademicYear")}</SubmitButton>
            </div>
          </Form>
        </CardBody>
      </Card>

      {/* الترم — a free list: the platform never assumes two terms. */}
      <Card>
        <CardHeader title={t(locale, "content.termsTitle")} description={t(locale, "content.termsHint")} />
        <CardBody className="space-y-4">
          {loaderData.terms.length > 0 && (
            <ul className="flex flex-wrap gap-2 text-sm" data-testid="admin-terms">
              {loaderData.terms.map((tm) => (
                <li key={tm.id} className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1">
                  <StatusBadge status={tm.status} locale={locale} />
                  <Link to={`/admin/content/term/${tm.id}`} className="font-medium text-slate-800 hover:underline">
                    {locale === "ar" ? tm.titleAr : tm.titleEn}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Form method="post" className="grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="_action" value="create-term" />
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.titleAr")}</span>
              <input name="titleAr" required dir="rtl" className="rounded-lg border border-slate-300 px-3 py-2" placeholder="الترم الأول" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.titleEn")}</span>
              <input name="titleEn" required dir="ltr" className="rounded-lg border border-slate-300 px-3 py-2" placeholder="Term 1" />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.status")}</span>
              <select name="status" className="rounded-lg border border-slate-300 px-3 py-2">
                <option value="draft">{t(locale, "content.statusDraft")}</option>
                <option value="published">{t(locale, "content.statusPublished")}</option>
              </select>
            </label>
            <div className="flex items-end">
              <SubmitButton>{t(locale, "content.addTerm")}</SubmitButton>
            </div>
          </Form>
        </CardBody>
      </Card>

      <ContentCreator tree={loaderData.tree} locale={locale} years={loaderData.years} terms={loaderData.terms} />
    </div>
  );
}

function ContentCreator({
  tree,
  locale,
  years,
  terms,
}: {
  tree: AdminTreeNode[];
  locale: Locale;
  years: Array<{ id: string; titleAr: string; titleEn: string }>;
  terms: Array<{ id: string; titleAr: string; titleEn: string }>;
}) {
  const actionData = useActionData<typeof action>();
  const [type, setType] = useState("grade");
  const [parentId, setParentId] = useState("");
  const options = useMemo(
    () => collectByType(tree, PARENT_OF[type], locale),
    [tree, type, locale]
  );
  const isTermContainer = type === "course";
  const isLesson = type === "lesson" || type === "termLesson";
  // Auto-pick the first available parent whenever the type or options change.
  useEffect(() => {
    if (!options.some((o) => o.id === parentId) && options[0]) setParentId(options[0].id);
  }, [options, parentId]);
  const TypeCap = type.charAt(0).toUpperCase() + type.slice(1);
  const selectParentLabel = t(locale, "content.selectParent", {
    type: t(locale, TYPE_PARENT_LABEL_KEY[PARENT_OF[type]] ?? `content.${PARENT_OF[type]}`),
  });
  const submitKey = type === "termLesson" ? "content.addTermLesson" : type === "course" ? "content.addTermContainer" : `content.add${TypeCap}`;
  return (
    <Card>
      <CardHeader title={t(locale, "content.createNewSection")} />
      <CardBody>
        <Form method="post" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="_action" value="create-content" />
          <label className="grid gap-1 text-sm">
            <span>{t(locale, "content.type")}</span>
            <select
              name="contentType"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2"
            >
              {(["grade", "subject", "course", "termLesson", "unit", "lesson"] as const).map((tType) => (
                <option key={tType} value={tType}>
                  {tType === "course"
                    ? t(locale, "content.addTermContainer")
                    : tType === "termLesson"
                      ? t(locale, "content.addTermLesson")
                      : t(locale, `content.add${tType.charAt(0).toUpperCase() + tType.slice(1)}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span>{selectParentLabel}</span>
            <select
              name="parentId"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2"
            >
              {options.length === 0 && <option value="">—</option>}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span>{t(locale, "content.titleAr")}</span>
            <input name="titleAr" required dir="rtl" className="rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="grid gap-1 text-sm">
            <span>{t(locale, "content.titleEn")}</span>
            <input name="titleEn" required dir="ltr" className="rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="grid gap-1 text-sm">
            <span>{t(locale, "content.status")}</span>
            <select name="status" className="rounded-lg border border-slate-300 px-3 py-2">
              <option value="draft">{t(locale, "content.statusDraft")}</option>
              <option value="published">{t(locale, "content.statusPublished")}</option>
            </select>
          </label>

          {/* Academic scope — only for the term container. The grade and the
              subject are already implied by the parent subject, so the admin
              never re-enters them. */}
          {isTermContainer && (
            <>
              <label className="grid gap-1 text-sm">
                <span>{t(locale, "content.academicYear")}</span>
                <select name="academicYearId" className="rounded-lg border border-slate-300 px-3 py-2" data-testid="creator-year">
                  <option value="">—</option>
                  {years.map((y) => (
                    <option key={y.id} value={y.id}>{locale === "ar" ? y.titleAr : y.titleEn}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t(locale, "content.term")}</span>
                <select name="termId" className="rounded-lg border border-slate-300 px-3 py-2" data-testid="creator-term">
                  <option value="">—</option>
                  {terms.map((tm) => (
                    <option key={tm.id} value={tm.id}>{locale === "ar" ? tm.titleAr : tm.titleEn}</option>
                  ))}
                </select>
              </label>
            </>
          )}

          {/* Free / Paid — maps onto the existing access_level enum. */}
          {isLesson && (
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.accessLabel")}</span>
              <select name="access" defaultValue="paid" className="rounded-lg border border-slate-300 px-3 py-2" data-testid="creator-access">
                <option value="paid">{t(locale, "content.accessPaid")}</option>
                <option value="free">{t(locale, "content.accessFree")}</option>
                <option value="public">{t(locale, "content.accessFreeForAll")}</option>
              </select>
            </label>
          )}
          {isLesson && (
            <label className="grid gap-1 text-sm sm:col-span-2">
              <span>{t(locale, "content.descriptionAr")}</span>
              <input name="descriptionAr" dir="rtl" maxLength={4000} className="rounded-lg border border-slate-300 px-3 py-2" />
            </label>
          )}

          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
            <SubmitButton>{t(locale, submitKey)}</SubmitButton>
            {actionData?.ok && <span className="text-sm text-green-600">{t(locale, "content.created")}</span>}
          </div>
        </Form>
        {options.length === 0 && (
          <p className="mt-3 text-xs text-amber-600">
            {t(locale, "content.selectParent", { type: t(locale, `content.${PARENT_OF[type]}`) })} —{" "}
            {t(locale, "content.needParentFirst")}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
