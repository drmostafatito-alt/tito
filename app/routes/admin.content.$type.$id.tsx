import type { Route } from "./+types/admin.content.$type.$id";
import { Form, Link, redirect, useActionData, useLoaderData, useRouteLoaderData, useNavigation, useSearchParams } from "react-router";
import { z } from "zod";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { getExam, listExams } from "~server/assessment/service.server";
import {
  adminTree,
  archiveNode,
  chainForLesson,
  createCourse,
  createGrade,
  createLesson,
  createLessonItem,
  createSubject,
  createUnit,
  duplicateNode,
  getNode,
  itemsForLesson,
  moveNode,
  prerequisitesForCourse,
  setCoursePrerequisites,
  updateNode,
  videosByIds,
  filesByIds,
  ContentReferenceError,
  PrerequisiteCycleError,
  type ContentType,
} from "~server/content/service.server";
import { listVideos } from "~server/video/service.server";
import { listFiles } from "~server/files/storage.server";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { courses } from "~server/db/schema";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
import { ImagePicker } from "~/components/ui/ImagePicker";
import { t, type Locale } from "~/lib/i18n";

/** Node editor: edit fields, status/visibility/access, ordering, archive, children creation. */

const VALID_TYPES: ContentType[] = ["program", "grade", "subject", "course", "unit", "lesson", "lessonItem"];

const CHILD_LABEL: Partial<Record<ContentType, string>> = {
  program: "content.addGrade",
  grade: "content.addSubject",
  subject: "content.addCourse",
  course: "content.addUnit",
  unit: "content.addLesson",
};

/** Human label for a video row in Admin lists (owner title > playbackId > id). */
function videoLabel(v: { playbackId: string | null; metadata: unknown; id: string } | undefined): string {
  if (!v) return "video";
  const m = v.metadata as { title?: string | null; titleAr?: string | null; titleEn?: string | null } | null;
  return m?.title ?? m?.titleEn ?? m?.titleAr ?? v.playbackId ?? v.id;
}

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const type = params.type as ContentType;
  if (!VALID_TYPES.includes(type)) throw new Response("Not Found", { status: 404 });
  const node = await getNode(db, type, params.id);
  if (!node) throw new Response("Not Found", { status: 404 });

  let childRows: Array<{ id: string; titleAr?: string; titleEn?: string; slug?: string; status?: string; label?: string }> = [];
  let outline: Array<{
    id: string; titleAr: string; titleEn: string; status: string;
    lessons: Array<{ id: string; titleAr: string; titleEn: string; status: string; items: number }>;
  }> | null = null;
  if (type !== "lesson" && type !== "lessonItem") {
    const tree = await adminTree(db);
    const find = (nodes: typeof tree): (typeof tree)[number] | null => {
      for (const n of nodes) {
        if (n.type === type && n.id === params.id) return n;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    const self = find(tree);
    childRows = (self?.children ?? []).map((c) => ({
      id: c.id, titleAr: c.titleAr, titleEn: c.titleEn, slug: c.slug, status: c.status, label: c.type,
    }));
    // Course builder overview: units -> lessons (with their content-item counts).
    if (self && type === "course") {
      outline = (self?.children ?? []).map((u) => ({
        id: u.id, titleAr: String(u.titleAr), titleEn: String(u.titleEn), status: String(u.status),
        lessons: (u.children ?? []).map((l) => ({
          id: l.id, titleAr: String(l.titleAr), titleEn: String(l.titleEn), status: String(l.status),
          items: (l.children ?? []).length,
        })),
      }));
    }
  }

  // Course prerequisites: current set + the candidate pool (every other course).
  let prereqs: Array<{ courseId: string; slug: string; titleAr: string; titleEn: string }> = [];
  let prereqCandidates: Array<{ courseId: string; slug: string; titleAr: string; titleEn: string }> = [];
  if (type === "course") {
    prereqs = await prerequisitesForCourse(db, params.id);
    const rows = await db
      .select({ id: courses.id, slug: courses.slug, titleAr: courses.titleAr, titleEn: courses.titleEn })
      .from(courses)
      .where(and(isNull(courses.deletedAt), ne(courses.id, params.id)))
      .orderBy(asc(courses.titleEn));
    prereqCandidates = rows.map((c) => ({ courseId: c.id, slug: c.slug, titleAr: c.titleAr, titleEn: c.titleEn }));
  }

  const imageFiles = type === "subject" || type === "course" ? await listFiles(db, 200) : [];
  const allFiles = type === "lesson" ? await listFiles(db, 200) : [];
  const allVideos = type === "lesson" ? await listVideos(db, 200) : [];
  const items = type === "lesson" ? await itemsForLesson(db, params.id) : [];
  const videoMap = await videosByIds(db, items.filter((i) => i.itemType === "video" && i.videoId).map((i) => i.videoId!));
  const fileMap = await filesByIds(db, items.filter((i) => i.itemType === "file" && i.fileId).map((i) => i.fileId!));
  const allExams = type === "lesson" ? await listExams(db, { status: "published" }) : [];
  const examMap = new Map<string, { titleAr: string; titleEn: string }>();
  for (const eid of new Set(items.filter((i) => i.itemType === "exam" && i.examId).map((i) => i.examId!))) {
    const e = await getExam(db, eid);
    if (e) examMap.set(eid, { titleAr: e.titleAr, titleEn: e.titleEn });
  }

  void auth;

  // Public preview URL (only for node types that have a public page + slug).
  let publicUrl: string | null = null;
  const slug = typeof node.slug === "string" ? node.slug : null;
  if (slug) {
    if (type === "program") publicUrl = `/programs/${slug}`;
    else if (type === "subject") publicUrl = `/subjects/${slug}`;
    else if (type === "course") publicUrl = `/courses/${slug}`;
    else if (type === "lesson") {
      const chain = await chainForLesson(db, params.id);
      if (chain?.courseId) {
        const course = await getNode(db, "course", chain.courseId);
        if (course && typeof course.slug === "string" && course.slug) {
          publicUrl = `/learn/${course.slug}/${slug}`;
        }
      }
    }
  }

  return {
    type,
    node,
    publicUrl,
    childRows,
    childAction:
      type === "program" ? "create-grade" :
      type === "grade" ? "create-subject" :
      type === "subject" ? "create-course" :
      type === "course" ? "create-unit" :
      type === "unit" ? "create-lesson" : null,
    imageFiles: imageFiles.map((f) => ({ id: f.id, label: f.originalFilename })),
    outline,
    allFiles: allFiles.map((f) => ({ id: f.id, name: f.originalFilename, kind: f.kind, visibility: f.visibility })),
    allVideos: allVideos.map((v) => {
      const m = v.metadata as { title?: string | null; titleAr?: string | null; titleEn?: string | null } | null;
      return { id: v.id, status: v.status, title: m?.title ?? v.playbackId ?? v.id, titleAr: m?.titleAr ?? null, titleEn: m?.titleEn ?? null };
    }),
    lessonItems: items.map((i) => ({
      id: i.id, itemType: i.itemType, required: i.required, sortOrder: i.sortOrder,
      // A video's display name: the owner's title first, then playbackId, then a
      // stable fallback. YouTube rows have no playbackId, so without the title
      // they would all list as "video".
      label: i.itemType === "video" ? videoLabel(videoMap.get(i.videoId!)) : i.itemType === "file" ? (fileMap.get(i.fileId!)?.originalFilename ?? "file") : (examMap.get(i.examId ?? "")?.titleAr ?? i.examId ?? "exam"),
    })),
    allExams: allExams.map((e) => ({ id: e.id, titleAr: e.titleAr, titleEn: e.titleEn })),
    prereqs,
    prereqCandidates,
  };
}

function str(form: FormData, key: string): string | null {
  const v = form.get(key);
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(form: FormData, key: string): number | null {
  const v = str(form, key);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function dateMs(form: FormData, key: string): number | null {
  const v = str(form, key);
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

export async function action({ context, request, params }: Route.ActionArgs) {
  const { auth } = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  const type = params.type as ContentType;
  const id = params.id;
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const actor = { userId: auth.user.id, role: auth.user.roleId, ipHash: await sha256Hex(clientIpOf(request) ?? "unknown") };

  try {
    switch (intent) {
      case "save": {
        const patch: Record<string, unknown> = {};
        const S = (k: string) => (form.get(k) === null ? undefined : str(form, k));
        for (const k of ["titleAr", "titleEn", "descriptionAr", "descriptionEn", "status", "visibility", "accessLevel", "slug"]) {
          const v = S(k);
          if (v !== undefined) patch[k] = v;
        }
        const so = num(form, "sortOrder");
        if (so !== null) patch.sortOrder = so;
        const thumb = form.get("thumbnailFileId");
        if (thumb !== null) patch.thumbnailFileId = str(form, "thumbnailFileId") ?? null;
        const pa = form.get("publishAt");
        if (pa !== null) patch.publishAt = dateMs(form, "publishAt");
        const ea = form.get("expiresAt");
        if (ea !== null) patch.expiresAt = dateMs(form, "expiresAt");
        if (type === "lesson") patch.freePreview = form.get("freePreview") === "on";
        if (type === "lessonItem") {
          patch.required = form.get("required") === "on";
        }
        const res = await updateNode(db, type, id, patch, actor);
        return res.ok ? { ok: true as const } : { error: res.error };
      }
      case "archive":
        await archiveNode(db, type, id, actor);
        return { ok: true as const };
      case "set-prerequisites": {
        if (type !== "course") return { error: "generic" as const };
        const ids = form.getAll("prereqIds").map(String).filter(Boolean);
        await setCoursePrerequisites(db, id, ids, actor);
        return { ok: true as const };
      }
      case "duplicate": {
        if (type === "lessonItem") return { error: "generic" as const };
        const res = await duplicateNode(db, type, id, actor);
        if (!res.ok) return { error: res.error };
        // Land the admin directly in the copy's editor (obvious lifecycle).
        return redirect(`/admin/content/${type}/${res.id}?duplicated=1`);
      }
      case "move-up":
      case "move-down": {
        const res = await moveNode(db, type, id, intent === "move-up" ? "up" : "down");
        return res.ok ? { ok: true as const } : { error: res.error };
      }
      case "create-grade": {
        const parentId = str(form, "parentId");
        if (!parentId) return { error: "validation" as const };
        await createGrade(db, { programId: parentId, titleAr: str(form, "titleAr")!, titleEn: str(form, "titleEn")!, status: (str(form, "status") as "draft" | "published") ?? "draft", sortOrder: 0, slug: undefined }, actor);
        return { ok: true as const };
      }
      case "create-subject": {
        const parentId = str(form, "parentId");
        if (!parentId) return { error: "validation" as const };
        await createSubject(db, { gradeId: parentId, titleAr: str(form, "titleAr")!, titleEn: str(form, "titleEn")!, status: (str(form, "status") as "draft" | "published") ?? "draft", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, slug: undefined }, actor);
        return { ok: true as const };
      }
      case "create-course": {
        const parentId = str(form, "parentId");
        if (!parentId) return { error: "validation" as const };
        await createCourse(db, {
          subjectId: parentId, titleAr: str(form, "titleAr")!, titleEn: str(form, "titleEn")!,
          status: (str(form, "status") as "draft" | "published") ?? "draft",
          visibility: (str(form, "visibility") as "catalog" | "hidden" | "featured") ?? "catalog",
          accessLevel: (str(form, "accessLevel") as "public" | "authenticated" | "entitled") ?? "entitled",
          sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null,
          publishAt: null, expiresAt: null, slug: undefined,
        }, actor);
        return { ok: true as const };
      }
      case "create-unit": {
        const parentId = str(form, "parentId");
        if (!parentId) return { error: "validation" as const };
        await createUnit(db, { courseId: parentId, titleAr: str(form, "titleAr")!, titleEn: str(form, "titleEn")!, status: (str(form, "status") as "draft" | "published") ?? "draft", sortOrder: 0 }, actor);
        return { ok: true as const };
      }
      case "create-lesson": {
        const parentId = str(form, "parentId");
        if (!parentId) return { error: "validation" as const };
        await createLesson(db, {
          unitId: parentId, titleAr: str(form, "titleAr")!, titleEn: str(form, "titleEn")!,
          status: (str(form, "status") as "draft" | "published") ?? "draft",
          accessLevel: (str(form, "accessLevel") as "public" | "authenticated" | "entitled") ?? "entitled",
          freePreview: form.get("freePreview") === "on", sortOrder: 0,
          descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null, slug: undefined,
        }, actor);
        return { ok: true as const };
      }
      case "add-item": {
        const lessonId = id;
        const itemType = str(form, "itemType") as "video" | "file" | "exam" | null;
        if (!itemType) return { error: "validation" as const };
        const refId = itemType === "video" ? str(form, "videoId") : itemType === "file" ? str(form, "fileId") : str(form, "examId");
        if (!refId) return { error: "validation" as const };
        const maxOrder = (await itemsForLesson(db, lessonId)).reduce((m, i) => Math.max(m, i.sortOrder), -1);
        await createLessonItem(db, {
          lessonId, itemType,
          videoId: itemType === "video" ? refId : null,
          fileId: itemType === "file" ? refId : null,
          examId: itemType === "exam" ? refId : null,
          sortOrder: maxOrder + 1,
          required: form.get("required") === "on",
        }, actor);
        return { ok: true as const };
      }
      default:
        return { error: "generic" as const };
    }
  } catch (err) {
    // dangling parent/video/file reference → validation-shaped response, never a 500
    if (err instanceof ContentReferenceError) return { error: "validation" as const };
    if (err instanceof PrerequisiteCycleError) return { error: "prereq_cycle" as const };
    throw err;
  }
}

export default function NodeEditor({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const [params] = useSearchParams();
  const { type, node, childRows, childAction, imageFiles, allFiles, allVideos, lessonItems, allExams, outline, publicUrl, prereqs, prereqCandidates } = loaderData;
  const label = locale === "ar" ? String(node.titleAr ?? node.id) : String(node.titleEn ?? node.id);

  const input = "rounded-lg border border-slate-300 px-3 py-2";
  const isCourse = type === "course";
  const isLesson = type === "lesson";
  const hasThumb = type === "subject" || isCourse;
  const canDuplicate = type !== "lessonItem";

  return (
    <div className="space-y-6" key={`${type}-${String(node.id)}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin/content" className="inline-flex min-h-6 items-center text-sm text-slate-600 hover:underline"><span aria-hidden="true" className="inline-block rtl:rotate-180">←</span> {t(locale, "admin.navContent")}</Link>
        <h1 className="text-xl font-bold">{label}</h1>
        <Badge tone="neutral">{type}</Badge>
        {typeof node.slug === "string" && <span className="text-xs text-slate-600">/{String(node.slug)}</span>}
        {publicUrl && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            {t(locale, "content.viewSite")}
            <span aria-hidden="true" className="text-[10px]">↗</span>
          </a>
        )}
      </div>

      {params.get("duplicated") === "1" && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-medium text-green-800">
          {t(locale, "content.duplicated")}
        </div>
      )}

      <Card>
        <CardHeader
          title={t(locale, "content.edit")}
          action={
            <div className="flex flex-wrap gap-2">
              <Form method="post">
                <input type="hidden" name="_action" value="move-up" />
                <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" disabled={nav.state === "submitting"}>↑ {t(locale, "content.moveUp")}</button>
              </Form>
              <Form method="post">
                <input type="hidden" name="_action" value="move-down" />
                <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" disabled={nav.state === "submitting"}>↓ {t(locale, "content.moveDown")}</button>
              </Form>
              {canDuplicate && (
                <Form
                  method="post"
                  onSubmit={(e) => {
                    if (!confirm(t(locale, "content.confirmDuplicate"))) e.preventDefault();
                  }}
                >
                  <input type="hidden" name="_action" value="duplicate" />
                  <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" disabled={nav.state === "submitting"}>⧉ {t(locale, "content.duplicate")}</button>
                </Form>
              )}
              <Form method="post">
                <input type="hidden" name="_action" value="archive" />
                <button className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50" disabled={nav.state === "submitting"}>{t(locale, "content.archive")}</button>
              </Form>
            </div>
          }
        />
        <CardBody>
          <Form method="post" className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="_action" value="save" />
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.titleAr")}</span>
              <input name="titleAr" defaultValue={String(node.titleAr ?? "")} dir="rtl" required className={input} />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.titleEn")}</span>
              <input name="titleEn" defaultValue={String(node.titleEn ?? "")} dir="ltr" required className={input} />
            </label>
            {(type === "program" || type === "subject" || isCourse || isLesson) && (
              <>
                <label className="grid gap-1 text-sm">
                  <span>{t(locale, "content.descAr")}</span>
                  <textarea name="descriptionAr" defaultValue={String(node.descriptionAr ?? "")} dir="rtl" rows={2} className={input} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>{t(locale, "content.descEn")}</span>
                  <textarea name="descriptionEn" defaultValue={String(node.descriptionEn ?? "")} dir="ltr" rows={2} className={input} />
                </label>
              </>
            )}
            <label className="grid gap-1 text-sm">
              <span>{t(locale, "content.status")}</span>
              <select name="status" defaultValue={String(node.status ?? "draft")} className={input}>
                <option value="draft">{t(locale, "content.statusDraft")}</option>
                <option value="published">{t(locale, "content.statusPublished")}</option>
                <option value="archived">{t(locale, "content.statusArchived")}</option>
              </select>
            </label>
            {hasThumb && (
              <div className="sm:col-span-2">
                <ImagePicker name="thumbnailFileId" value={String(node.thumbnailFileId ?? "")} images={imageFiles} locale={locale} label={t(locale, "content.thumbnail")} compact />
              </div>
            )}
            {isCourse && (
              <>
                <label className="grid gap-1 text-sm">
                  <span>{t(locale, "content.visibility")}</span>
                  <select name="visibility" defaultValue={String(node.visibility ?? "catalog")} className={input}>
                    <option value="hidden">{t(locale, "content.visHidden")}</option>
                    <option value="catalog">{t(locale, "content.visCatalog")}</option>
                    <option value="featured">{t(locale, "content.visFeatured")}</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span>{t(locale, "content.accessLevel")}</span>
                  <select name="accessLevel" defaultValue={String(node.accessLevel ?? "entitled")} className={input}>
                    <option value="public">{t(locale, "content.accessPublic")}</option>
                    <option value="authenticated">{t(locale, "content.accessAuthenticated")}</option>
                    <option value="entitled">{t(locale, "content.accessEntitled")}</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span>{t(locale, "content.publishAt")}</span>
                  <input type="datetime-local" name="publishAt" className={input} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>{t(locale, "content.expiresAt")}</span>
                  <input type="datetime-local" name="expiresAt" className={input} />
                </label>
              </>
            )}
            {isLesson && (
              <>
                <label className="grid gap-1 text-sm">
                  <span>{t(locale, "content.accessLevel")}</span>
                  <select name="accessLevel" defaultValue={String(node.accessLevel ?? "entitled")} className={input}>
                    <option value="public">{t(locale, "content.accessPublic")}</option>
                    <option value="authenticated">{t(locale, "content.accessAuthenticated")}</option>
                    <option value="entitled">{t(locale, "content.accessEntitled")}</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 self-end text-sm">
                  <input type="checkbox" name="freePreview" defaultChecked={Boolean(node.freePreview)} className="h-4 w-4" />
                  {t(locale, "content.freePreviewFlag")}
                </label>
                <label className="grid gap-1 text-sm">
                  <span>{t(locale, "content.publishAt")}</span>
                  <input type="datetime-local" name="publishAt" className={input} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>{t(locale, "content.expiresAt")}</span>
                  <input type="datetime-local" name="expiresAt" className={input} />
                </label>
              </>
            )}
            <div className="sm:col-span-2 flex items-center gap-3">
              <SubmitButton>{t(locale, "content.save")}</SubmitButton>
              {actionData?.ok && <span className="text-sm text-green-600">{t(locale, "content.saved")}</span>}
              {actionData && "error" in actionData && actionData.error && (
                <span className="text-sm text-red-600">{String(actionData.error)}</span>
              )}
            </div>
          </Form>
        </CardBody>
      </Card>

      {isCourse && (
        <Card>
          <CardHeader
            title={t(locale, "content.prereqTitle")}
            description={t(locale, "content.prereqHint")}
          />
          <CardBody>
            <Form method="post" className="space-y-3">
              <input type="hidden" name="_action" value="set-prerequisites" />
              {prereqCandidates.length === 0 ? (
                <p className="text-sm text-slate-500">{t(locale, "content.prereqEmpty")}</p>
              ) : (
                <fieldset className="grid max-h-56 gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
                  {prereqCandidates.map((c) => {
                    const checked = prereqs.some((p) => p.courseId === c.courseId);
                    return (
                      <label key={c.courseId} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="prereqIds" value={c.courseId} defaultChecked={checked} className="h-4 w-4" />
                        <span>{locale === "ar" ? c.titleAr : c.titleEn}</span>
                        {c.slug && <span className="text-xs text-slate-400">/{c.slug}</span>}
                      </label>
                    );
                  })}
                </fieldset>
              )}
              <div className="flex items-center gap-3">
                <SubmitButton>{t(locale, "content.save")}</SubmitButton>
                {actionData && "error" in actionData && actionData.error === "prereq_cycle" && (
                  <span className="text-sm text-red-600">{t(locale, "content.prereqCycleError")}</span>
                )}
              </div>
            </Form>
          </CardBody>
        </Card>
      )}

      {isCourse && (
        <Card>
          <CardHeader
            title={t(locale, "content.courseOutline")}
            description={t(locale, "content.courseOutlineHint")}
          />
          <CardBody>
            {!outline || outline.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-8 text-center">
                <span className="text-3xl text-slate-300" aria-hidden="true">📚</span>
                <p className="font-medium text-slate-700">{t(locale, "content.noUnits")}</p>
                <p className="max-w-sm text-sm text-slate-500">{t(locale, "content.noUnitsHint")}</p>
                <span className="text-sm text-slate-500">{t(locale, "content.addFirstUnit")} ↓</span>
              </div>
            ) : (
              <ol className="flex flex-col gap-3">
                {outline.map((u, ui) => (
                  <li key={u.id} className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-brand-100 text-xs font-bold text-brand-700">{ui + 1}</span>
                      <Link to={`/admin/content/unit/${u.id}`} className="text-sm font-semibold text-slate-800 hover:text-brand-700 hover:underline">
                        {locale === "ar" ? u.titleAr : u.titleEn}
                      </Link>
                      {u.status !== "published" && <Badge tone="warning">{t(locale, "content.inDraft")}</Badge>}
                    </div>
                    {u.lessons.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-slate-500">{t(locale, "content.noUnitsHint")}</p>
                    ) : (
                      <ul className="flex flex-col">
                        {u.lessons.map((l) => (
                          <li key={l.id} className="flex items-center gap-2 border-b border-slate-50 px-4 py-2 text-sm last:border-0">
                            <Link to={`/admin/content/lesson/${l.id}`} className="flex min-w-0 flex-1 items-center gap-2 text-slate-700 hover:text-brand-700 hover:underline">
                              <span aria-hidden="true">▶</span>
                              <span className="truncate">{locale === "ar" ? l.titleAr : l.titleEn}</span>
                            </Link>
                            <span className="text-xs text-slate-500">{t(locale, "content.lessonItemsCount", { n: l.items })}</span>
                            {l.status !== "published" && <Badge tone="warning">{t(locale, "content.inDraft")}</Badge>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      )}

      {childAction && (
        <Card>
          <CardHeader title={t(locale, CHILD_LABEL[type] ?? "content.addItem")} />
          <CardBody>
            <Form method="post" className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="_action" value={childAction} />
              <input type="hidden" name="parentId" value={String(node.id)} />
              <label className="grid gap-1 text-sm">
                <span>{t(locale, "content.titleAr")}</span>
                <input name="titleAr" required dir="rtl" className={input} />
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t(locale, "content.titleEn")}</span>
                <input name="titleEn" required dir="ltr" className={input} />
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t(locale, "content.status")}</span>
                <select name="status" className={input}>
                  <option value="draft">{t(locale, "content.statusDraft")}</option>
                  <option value="published">{t(locale, "content.statusPublished")}</option>
                </select>
              </label>
              {(childAction === "create-course" || childAction === "create-lesson") && (
                <>
                  <label className="grid gap-1 text-sm">
                    <span>{t(locale, "content.accessLevel")}</span>
                    <select name="accessLevel" className={input}>
                      <option value="entitled">{t(locale, "content.accessEntitled")}</option>
                      <option value="authenticated">{t(locale, "content.accessAuthenticated")}</option>
                      <option value="public">{t(locale, "content.accessPublic")}</option>
                    </select>
                  </label>
                  {childAction === "create-course" && (
                    <label className="grid gap-1 text-sm">
                      <span>{t(locale, "content.visibility")}</span>
                      <select name="visibility" className={input}>
                        <option value="catalog">{t(locale, "content.visCatalog")}</option>
                        <option value="featured">{t(locale, "content.visFeatured")}</option>
                        <option value="hidden">{t(locale, "content.visHidden")}</option>
                      </select>
                    </label>
                  )}
                  {childAction === "create-lesson" && (
                    <label className="flex items-center gap-2 self-end text-sm">
                      <input type="checkbox" name="freePreview" className="h-4 w-4" />
                      {t(locale, "content.freePreviewFlag")}
                    </label>
                  )}
                </>
              )}
              <div className="sm:col-span-3">
                <SubmitButton>{t(locale, "content.created")}</SubmitButton>
              </div>
            </Form>

            {childRows.length > 0 && (
              <ul className="mt-4 space-y-1">
                {childRows.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    <Badge tone="neutral">{c.label}</Badge>
                    <Link to={`/admin/content/${c.label}/${c.id}`} className="hover:underline">
                      {locale === "ar" ? c.titleAr : c.titleEn}
                    </Link>
                    {c.slug && <span className="text-xs text-slate-500">/{c.slug}</span>}
                    {c.status && <span className="text-xs text-slate-500">({c.status})</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {isLesson && (
        <Card>
          <CardHeader title={t(locale, "content.items")} description={t(locale, "videosAdmin.attachedHint")} />
          <CardBody className="space-y-4">
            <ul className="space-y-1">
              {lessonItems.map((i) => (
                <li key={i.id} className="flex items-center gap-2 text-sm">
                  <Badge tone={i.itemType === "video" ? "brand" : i.itemType === "file" ? "neutral" : "warning"}>
                    {t(locale, i.itemType === "video" ? "content.videoItem" : i.itemType === "file" ? "content.fileItem" : "content.examItem")}
                  </Badge>
                  <span className="max-w-[50%] truncate text-slate-600">{i.label}</span>
                  {i.required && <span className="text-xs text-slate-500">{t(locale, "content.required")}</span>}
                </li>
              ))}
              {lessonItems.length === 0 && <li className="text-sm text-slate-500">—</li>}
            </ul>
            <Form method="post" className="grid gap-3 sm:grid-cols-4">
              <input type="hidden" name="_action" value="add-item" />
              <label className="grid gap-1 text-sm">
                <span>{t(locale, "content.items")}</span>
                <select name="itemType" className={input}>
                  <option value="video">{t(locale, "content.videoItem")}</option>
                  <option value="file">{t(locale, "content.fileItem")}</option>
                  <option value="exam">{t(locale, "content.examItem")}</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t(locale, "content.videoItem")}</span>
                <select name="videoId" className={input}>
                  <option value="">—</option>
                  {allVideos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {(locale === "ar" ? (v.titleAr ?? v.title) : (v.titleEn ?? v.title))} ({v.status})
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t(locale, "content.fileItem")}</span>
                <select name="fileId" className={input}>
                  <option value="">—</option>
                  {allFiles.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t(locale, "content.examItem")}</span>
                <select name="examId" className={input}>
                  <option value="">—</option>
                  {allExams.map((e) => (
                    <option key={e.id} value={e.id}>{locale === "ar" ? e.titleAr : e.titleEn}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 self-end text-sm">
                <input type="checkbox" name="required" defaultChecked className="h-4 w-4" />
                {t(locale, "content.required")}
              </label>
              <div className="sm:col-span-4">
                <SubmitButton>{t(locale, "content.addItem")}</SubmitButton>
              </div>
            </Form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
