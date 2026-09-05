import type { Route } from "./+types/admin.content.$type.$id";
import { Form, Link, useActionData, useLoaderData, useRouteLoaderData, useNavigation } from "react-router";
import { z } from "zod";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import {
  adminTree,
  archiveNode,
  createCourse,
  createGrade,
  createLesson,
  createLessonItem,
  createSubject,
  createUnit,
  getNode,
  itemsForLesson,
  moveNode,
  updateNode,
  videosByIds,
  filesByIds,
  type ContentType,
} from "~server/content/service.server";
import { listVideos } from "~server/video/service.server";
import { listFiles } from "~server/files/storage.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { SubmitButton } from "~/components/ui/Button";
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

export async function loader({ context, request, params }: Route.LoaderArgs) {
  const { auth } = await requireRole(context, request, 3);
  const db = getDb(getEnv(context));
  const type = params.type as ContentType;
  if (!VALID_TYPES.includes(type)) throw new Response("Not Found", { status: 404 });
  const node = await getNode(db, type, params.id);
  if (!node) throw new Response("Not Found", { status: 404 });

  let childRows: Array<{ id: string; titleAr?: string; titleEn?: string; slug?: string; status?: string; label?: string }> = [];
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
  }

  const imageFiles = type === "subject" || type === "course" ? await listFiles(db, 200) : [];
  const allFiles = type === "lesson" ? await listFiles(db, 200) : [];
  const allVideos = type === "lesson" ? await listVideos(db, 200) : [];
  const items = type === "lesson" ? await itemsForLesson(db, params.id) : [];
  const videoMap = await videosByIds(db, items.filter((i) => i.itemType === "video" && i.videoId).map((i) => i.videoId!));
  const fileMap = await filesByIds(db, items.filter((i) => i.itemType === "file" && i.fileId).map((i) => i.fileId!));

  void auth;
  return {
    type,
    node,
    childRows,
    childAction:
      type === "program" ? "create-grade" :
      type === "grade" ? "create-subject" :
      type === "subject" ? "create-course" :
      type === "course" ? "create-unit" :
      type === "unit" ? "create-lesson" : null,
    imageFiles: imageFiles.map((f) => ({ id: f.id, name: f.originalFilename })),
    allFiles: allFiles.map((f) => ({ id: f.id, name: f.originalFilename, kind: f.kind, visibility: f.visibility })),
    allVideos: allVideos.map((v) => ({ id: v.id, status: v.status, title: (v.metadata as { title?: string } | null)?.title ?? v.playbackId ?? v.id })),
    lessonItems: items.map((i) => ({
      id: i.id, itemType: i.itemType, required: i.required, sortOrder: i.sortOrder,
      label: i.itemType === "video" ? (videoMap.get(i.videoId!)?.playbackId ?? "video") : i.itemType === "file" ? (fileMap.get(i.fileId!)?.originalFilename ?? "file") : (i.examId ?? "exam"),
    })),
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
      const itemType = str(form, "itemType") as "video" | "file" | null;
      if (!itemType) return { error: "validation" as const };
      const refId = itemType === "video" ? str(form, "videoId") : str(form, "fileId");
      if (!refId) return { error: "validation" as const };
      const maxOrder = (await itemsForLesson(db, lessonId)).reduce((m, i) => Math.max(m, i.sortOrder), -1);
      await createLessonItem(db, {
        lessonId, itemType,
        videoId: itemType === "video" ? refId : null,
        fileId: itemType === "file" ? refId : null,
        examId: null,
        sortOrder: maxOrder + 1,
        required: form.get("required") === "on",
      }, actor);
      return { ok: true as const };
    }
    default:
      return { error: "generic" as const };
  }
}

export default function NodeEditor({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = root?.locale ?? "ar";
  const actionData = useActionData<typeof action>();
  const nav = useNavigation();
  const { type, node, childRows, childAction, imageFiles, allFiles, allVideos, lessonItems } = loaderData;
  const label = locale === "ar" ? String(node.titleAr ?? node.id) : String(node.titleEn ?? node.id);

  const input = "rounded-lg border border-slate-300 px-3 py-2";
  const isCourse = type === "course";
  const isLesson = type === "lesson";
  const hasThumb = type === "subject" || isCourse;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin/content" className="text-sm text-slate-500 hover:underline">← {t(locale, "admin.navContent")}</Link>
        <h1 className="text-xl font-bold">{label}</h1>
        <Badge tone="neutral">{type}</Badge>
        {typeof node.slug === "string" && <span className="text-xs text-slate-400">/{String(node.slug)}</span>}
      </div>

      <Card>
        <CardHeader
          title={t(locale, "content.edit")}
          action={
            <div className="flex gap-2">
              <Form method="post">
                <input type="hidden" name="_action" value="move-up" />
                <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" disabled={nav.state === "submitting"}>↑ {t(locale, "content.moveUp")}</button>
              </Form>
              <Form method="post">
                <input type="hidden" name="_action" value="move-down" />
                <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50" disabled={nav.state === "submitting"}>↓ {t(locale, "content.moveDown")}</button>
              </Form>
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
              <label className="grid gap-1 text-sm">
                <span>{t(locale, "content.thumbnail")}</span>
                <select name="thumbnailFileId" defaultValue={String(node.thumbnailFileId ?? "")} className={input}>
                  <option value="">—</option>
                  {imageFiles.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </label>
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
                    {c.slug && <span className="text-xs text-slate-400">/{c.slug}</span>}
                    {c.status && <span className="text-xs text-slate-400">({c.status})</span>}
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
                  {i.required && <span className="text-xs text-slate-400">{t(locale, "content.required")}</span>}
                </li>
              ))}
              {lessonItems.length === 0 && <li className="text-sm text-slate-400">—</li>}
            </ul>
            <Form method="post" className="grid gap-3 sm:grid-cols-4">
              <input type="hidden" name="_action" value="add-item" />
              <label className="grid gap-1 text-sm">
                <span>{t(locale, "content.items")}</span>
                <select name="itemType" className={input}>
                  <option value="video">{t(locale, "content.videoItem")}</option>
                  <option value="file">{t(locale, "content.fileItem")}</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <span>{t(locale, "content.videoItem")}</span>
                <select name="videoId" className={input}>
                  <option value="">—</option>
                  {allVideos.map((v) => (
                    <option key={v.id} value={v.id}>{v.title} ({v.status})</option>
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
