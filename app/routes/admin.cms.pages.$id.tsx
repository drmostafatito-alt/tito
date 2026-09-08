import type { Route } from "./+types/admin.cms.pages.$id";
import { Form, Link, useActionData, useRouteLoaderData } from "react-router";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireRole } from "~server/auth/guards.server";
import { getDb } from "~server/db/client.server";
import { getEnv } from "~server/cf.server";
import { clientIpOf, sha256Hex } from "~server/http/rate-limit.server";
import {
  CmsReferenceError,
  CmsValidationError,
  addBlock,
  blocksForPage,
  canCms,
  deleteBlock,
  duplicateBlock,
  getPage,
  listForms,
  listVersions,
  moveBlock,
  publishPage,
  restoreVersion,
  toggleBlockVisible,
  updateBlockProps,
  updatePageMeta,
  updatePageSeo,
  type CmsPermission,
} from "~server/cms/service.server";
import { courses, files, programs, subjects, videos } from "~server/db/schema";
import { requestLocale } from "~server/cms/page-render.server";
import { applyTemplate, listTemplates, savePageAsTemplate } from "~server/cms/templates.server";
import { readPropsFromForm } from "~/cms/formdata";
import { BLOCKS, SECTION_FIELDS, cmsLabel, seoFields } from "~/cms/registry";
import { FieldEditors, type PickerData } from "~/components/cms/fields";
import { Alert } from "~/components/ui/Alert";
import { Badge } from "~/components/ui/Badge";
import { Card, CardBody, CardHeader } from "~/components/ui/Card";
import { Input } from "~/components/ui/Input";
import { SubmitButton } from "~/components/ui/Button";
import { formatDateTime, type Locale } from "~/lib/i18n";

/**
 * CMS page builder (Phase 3 stage 2). Non-developer UX: section cards with
 * visible/hide, move up/down, duplicate, delete; per-block settings generated
 * from the registry descriptors; explicit "publish" that validates, sanitizes
 * and freezes a version. Draft edits never touch the public page.
 */

async function requireCms(context: unknown, request: Request, permission: CmsPermission) {
  const guarded = await requireRole(context, request, 3);
  const env = getEnv(context);
  const db = getDb(env);
  const allowed = await canCms(db, guarded.auth, permission);
  if (!allowed) return { db, allowed: false as const, auth: guarded.auth, settings: guarded.settings };
  const ipHash = await sha256Hex(clientIpOf(request) ?? "unknown");
  return {
    db,
    allowed: true as const,
    auth: guarded.auth,
    settings: guarded.settings,
    actor: { userId: guarded.auth.user.id, role: guarded.auth.user.roleId, ipHash },
  };
}

async function loadPickers(db: ReturnType<typeof getDb>, locale: "ar" | "en"): Promise<PickerData> {
  const pick = (titleAr: string, titleEn: string) => (locale === "ar" ? titleAr || titleEn : titleEn || titleAr);
  const [imageRows, videoRows, formRows, courseRows, subjectRows, programRows] = await Promise.all([
    db.select({ id: files.id, name: files.originalFilename }).from(files)
      .where(and(eq(files.visibility, "public"), eq(files.kind, "image")))
      .orderBy(desc(files.createdAt)).limit(200),
    db.select({ id: videos.id, status: videos.status, provider: videos.provider, createdAt: videos.createdAt }).from(videos)
      .orderBy(desc(videos.createdAt)).limit(100),
    listForms(db),
    db.select({ id: courses.id, titleAr: courses.titleAr, titleEn: courses.titleEn }).from(courses)
      .where(isNull(courses.deletedAt)).limit(200),
    db.select({ id: subjects.id, titleAr: subjects.titleAr, titleEn: subjects.titleEn }).from(subjects)
      .where(isNull(subjects.deletedAt)).limit(200),
    db.select({ id: programs.id, titleAr: programs.titleAr, titleEn: programs.titleEn }).from(programs)
      .where(isNull(programs.deletedAt)).limit(200),
  ]);
  return {
    images: imageRows.map((r) => ({ id: r.id, label: r.name, url: `/files/${r.id}` })),
    videos: videoRows.map((r) => ({ id: r.id, label: `${r.id.slice(0, 8)} · ${r.provider} · ${r.status}` })),
    forms: (formRows as unknown as Array<{ id: string; titleAr: string; titleEn: string; status: string }>).map((r) => ({ id: r.id, label: `${pick(r.titleAr, r.titleEn)} (${r.status})` })),
    courses: courseRows.map((r) => ({ id: r.id, label: pick(r.titleAr, r.titleEn) })),
    subjects: subjectRows.map((r) => ({ id: r.id, label: pick(r.titleAr, r.titleEn) })),
    programs: programRows.map((r) => ({ id: r.id, label: pick(r.titleAr, r.titleEn) })),
  };
}

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const guard = await requireCms(context, request, "cms.read");
  const db = guard.db;
  const page = await getPage(db, params.id);
  if (!page) throw new Response("Not Found", { status: 404 });
  if (!guard.allowed) {
    return { denied: true as const, page: null, tree: [], versions: [], pickers: null, perms: null, templates: [] };
  }
  const adminLocale = requestLocale(request, guard.settings) === "en" ? "en" as const : "ar" as const;
  const [tree, versions, pickers, canEdit, canPublish, canSeo, templates] = await Promise.all([
    blocksForPage(db, page.id),
    listVersions(db, page.id),
    loadPickers(db, adminLocale),
    canCms(db, guard.auth, "cms.edit"),
    canCms(db, guard.auth, "cms.publish"),
    canCms(db, guard.auth, "cms.manage_seo"),
    listTemplates(db),
  ]);
  return {
    denied: false as const,
    page: { id: page.id, slug: page.slug, titleAr: page.titleAr, titleEn: page.titleEn, status: page.status, publishedAt: page.publishedAt, seo: page.seo },
    tree,
    versions,
    pickers,
    perms: { canEdit, canPublish, canSeo },
    templates,
  };
}

export async function action({ context, params, request }: Route.ActionArgs) {
  const form = await request.formData();
  const intent = String(form.get("_action") ?? "");
  const perm: CmsPermission =
    intent === "publish" || intent === "restore-version" ? "cms.publish"
    : intent === "save-seo" ? "cms.manage_seo"
    : "cms.edit";
  const guard = await requireCms(context, request, perm);
  if (!guard.allowed) return { error: "denied" as const };
  const { db, actor } = guard;
  const pageId = params.id;

  try {
    switch (intent) {
      case "save-page-meta":
        await updatePageMeta(db, pageId, {
          titleAr: String(form.get("titleAr") ?? ""),
          titleEn: String(form.get("titleEn") ?? ""),
          slug: String(form.get("slug") ?? ""),
        }, actor);
        return { ok: true as const };
      case "save-seo":
        await updatePageSeo(db, pageId, readPropsFromForm(form, seoFields), actor);
        return { ok: true as const };
      case "add-section":
        await addBlock(db, { pageId, parentId: null, type: "section" }, actor);
        return { ok: true as const };
      case "add-block": {
        const type = String(form.get("blockType") ?? "");
        const parentId = String(form.get("parentId") ?? "");
        await addBlock(db, { pageId, parentId, type }, actor);
        return { ok: true as const };
      }
      case "save-block": {
        const blockId = String(form.get("blockId") ?? "");
        const type = String(form.get("blockTypeDef") ?? "");
        const fields = type === "section" ? SECTION_FIELDS : (BLOCKS[type]?.fields ?? []);
        await updateBlockProps(db, blockId, readPropsFromForm(form, fields), actor);
        return { ok: true as const };
      }
      case "toggle-block":
        await toggleBlockVisible(db, String(form.get("blockId") ?? ""), actor);
        return { ok: true as const };
      case "move-block":
        await moveBlock(db, String(form.get("blockId") ?? ""), form.get("direction") === "up" ? "up" : "down", actor);
        return { ok: true as const };
      case "duplicate-block":
        await duplicateBlock(db, String(form.get("blockId") ?? ""), actor);
        return { ok: true as const };
      case "delete-block":
        await deleteBlock(db, String(form.get("blockId") ?? ""), actor);
        return { ok: true as const };
      case "publish": {
        const res = await publishPage(db, pageId, actor, String(form.get("note") ?? "") || undefined);
        return { ok: true as const, publishedVersion: res.versionNo };
      }
      case "restore-version":
        await restoreVersion(db, pageId, String(form.get("versionId") ?? ""), actor);
        return { ok: true as const };
      case "apply-template":
        await applyTemplate(db, pageId, String(form.get("templateId") ?? ""), actor, form.get("confirm") === "on");
        return { ok: true as const, templateApplied: true as const };
      case "save-as-template":
        await savePageAsTemplate(db, pageId, {
          titleAr: String(form.get("titleAr") ?? ""),
          titleEn: String(form.get("titleEn") ?? ""),
          descriptionAr: String(form.get("descriptionAr") ?? ""),
          descriptionEn: String(form.get("descriptionEn") ?? ""),
        }, actor);
        return { ok: true as const, templateSaved: true as const };
      default:
        return { error: "generic" as const };
    }
  } catch (err) {
    if (err instanceof CmsValidationError) return { error: "validation" as const, issues: err.issues.map((i) => `${i.type ?? ""} ${i.path}: ${i.message}`.trim()) };
    if (err instanceof CmsReferenceError) return { error: "reference" as const, issues: [err.message] };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

type Loc = "ar" | "en";

function MiniForm({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <Form method="post" className={`inline ${className}`}>{children}</Form>;
}

function ToolButton({ label, disabled = false, danger = false }: { label: string; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={`inline-flex min-h-9 items-center rounded-lg border px-2.5 text-xs font-medium disabled:opacity-40 max-sm:min-h-11 max-sm:px-3.5 max-sm:text-sm ${danger ? "border-error/30 text-error hover:bg-error-soft" : "border-line bg-surface text-ink-muted hover:bg-sand-100"}`}
    >
      {label}
    </button>
  );
}

function BlockControls({ blockId, visible, canEdit, L, first, last }: { blockId: string; visible: boolean; canEdit: boolean; L: (k: string) => string; first: boolean; last: boolean }) {
  return (
    <span className="ms-auto flex flex-wrap items-center gap-1.5">
      <MiniForm>
        <input type="hidden" name="_action" value="toggle-block" />
        <input type="hidden" name="blockId" value={blockId} />
        <ToolButton label={visible ? L("cms.ui.hide") : L("cms.ui.show")} disabled={!canEdit} />
      </MiniForm>
      <MiniForm>
        <input type="hidden" name="_action" value="move-block" />
        <input type="hidden" name="blockId" value={blockId} />
        <input type="hidden" name="direction" value="up" />
        <ToolButton label="↑" disabled={!canEdit || first} />
      </MiniForm>
      <MiniForm>
        <input type="hidden" name="_action" value="move-block" />
        <input type="hidden" name="blockId" value={blockId} />
        <input type="hidden" name="direction" value="down" />
        <ToolButton label="↓" disabled={!canEdit || last} />
      </MiniForm>
      <MiniForm>
        <input type="hidden" name="_action" value="duplicate-block" />
        <input type="hidden" name="blockId" value={blockId} />
        <ToolButton label={L("cms.ui.duplicate")} disabled={!canEdit} />
      </MiniForm>
      <MiniForm>
        <input type="hidden" name="_action" value="delete-block" />
        <input type="hidden" name="blockId" value={blockId} />
        <ToolButton label={L("cms.ui.delete")} disabled={!canEdit} danger />
      </MiniForm>
    </span>
  );
}

const BLOCK_GROUPS = ["layout", "content", "media", "cta", "data", "form", "social"];

export default function AdminCmsPageBuilder({ loaderData }: Route.ComponentProps) {
  const root = useRouteLoaderData("root") as { locale: Locale };
  const locale = (root?.locale ?? "ar") as Loc;
  const L = (k: string) => cmsLabel(k, locale);
  const actionData = useActionData<typeof action>();

  if (loaderData.denied || !loaderData.page || !loaderData.pickers || !loaderData.perms) {
    return <Alert kind="error">{L("cms.ui.permissionDenied")}</Alert>;
  }
  const { page, tree, versions, pickers, perms, templates } = loaderData;
  const title = locale === "ar" ? page.titleAr || page.titleEn : page.titleEn || page.titleAr;
  const statusTone = page.status === "published" ? "success" : page.status === "archived" ? "neutral" : "warning";
  const groupedBlocks = BLOCK_GROUPS.map((g) => ({
    group: g,
    types: Object.entries(BLOCKS).filter(([, def]) => def.group === g && !def.section && g !== "layout").map(([type]) => type),
  })).filter((g) => g.types.length > 0);

  return (
    <div className="flex flex-col gap-6" key={`page-${page?.id}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin/cms" className="inline-flex min-h-11 items-center text-sm text-ink-muted hover:text-ink"><span aria-hidden="true" className="inline-block rtl:rotate-180">←</span> {L("cms.ui.backToPages")}</Link>
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        <Badge tone={statusTone}>{page.status}</Badge>
        <span className="text-xs text-ink-muted" dir="ltr">/{page.slug === "home" ? "" : `p/${page.slug}`}</span>
        <Link to={`/admin/cms/preview/${page.id}`} className="inline-flex min-h-9 items-center rounded-lg border border-warning/40 bg-warning-soft px-3 text-xs font-medium text-warning hover:bg-warning-soft">
          {L("cms.ui.preview")}
        </Link>
        {page.status === "published" && (
          <Link to={page.slug === "home" ? "/" : `/p/${page.slug}`} className="inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-3 text-xs font-medium text-ink-muted hover:bg-sand-100">
            {L("cms.ui.viewPage")}
          </Link>
        )}
        {perms.canPublish && (
          <Form method="post" className="ms-auto flex items-center gap-2">
            <input type="hidden" name="_action" value="publish" />
            <input name="note" maxLength={300} placeholder={L("cms.ui.versionNote")} className="h-11 w-44 rounded-lg border border-line px-3 text-sm focus:border-brand-500 focus:outline-none" />
            <SubmitButton>{L("cms.ui.publish")}</SubmitButton>
          </Form>
        )}
      </div>

      {actionData && "error" in actionData && actionData.error === "denied" && <Alert kind="error">{L("cms.ui.permissionDenied")}</Alert>}
      {actionData && "issues" in actionData && actionData.issues && <Alert kind="error">{L("cms.ui.validationFailed")} — {actionData.issues.join(" · ")}</Alert>}
      {actionData && "ok" in actionData && actionData.ok && "publishedVersion" in actionData && (
        <Alert kind="success">{L("cms.ui.published")} — v{String(actionData.publishedVersion)}</Alert>
      )}
      {actionData && "ok" in actionData && actionData.ok && "templateApplied" in actionData && (
        <Alert kind="success">{L("cms.ui.templateApplied")}</Alert>
      )}
      {actionData && "ok" in actionData && actionData.ok && "templateSaved" in actionData && (
        <Alert kind="success">{L("cms.ui.templateSaved")}</Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Sections column */}
        <div className="flex flex-col gap-4">
          {tree.length === 0 && <p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-muted">{L("cms.ui.noSections")}</p>}
          {tree.map((section, sIdx) => {
            const sDef = BLOCKS[section.type];
            return (
              <Card key={section.id} className={section.visible ? "" : "opacity-60"}>
                <CardBody className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{L(sDef?.labelKey ?? "cms.blocks.section")} #{sIdx + 1}</span>
                    {!section.visible && <Badge tone="neutral">{L("cms.ui.hide")}</Badge>}
                    <BlockControls blockId={section.id} visible={section.visible} canEdit={perms.canEdit} L={L} first={sIdx === 0} last={sIdx === tree.length - 1} />
                  </div>

                  {/* section settings */}
                  <details className="rounded-lg border border-line bg-sand-100 px-3 py-2">
                    <summary className="min-h-9 cursor-pointer text-sm font-medium text-ink-soft">{L("cms.ui.sectionSettings")}</summary>
                    <Form method="post" className="mt-3 flex flex-col gap-4" key={`${section.id}-${section.updatedAt}`}>
                      <input type="hidden" name="_action" value="save-block" />
                      <input type="hidden" name="blockId" value={section.id} />
                      <input type="hidden" name="blockTypeDef" value="section" />
                      <FieldEditors fields={SECTION_FIELDS} values={section.props} pickers={pickers} locale={locale} />
                      {perms.canEdit && <SubmitButton className="w-fit">{L("cms.ui.saveSettings")}</SubmitButton>}
                    </Form>
                  </details>

                  {/* child blocks */}
                  <ul className="flex flex-col gap-2">
                    {section.children.map((child, cIdx) => {
                      const def = BLOCKS[child.type];
                      return (
                        <li key={child.id} className={`rounded-lg border border-line px-3 py-2 ${child.visible ? "bg-surface" : "bg-sand-100 opacity-60"}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-ink">{def ? L(def.labelKey) : child.type}</span>
                            <BlockControls blockId={child.id} visible={child.visible} canEdit={perms.canEdit} L={L} first={cIdx === 0} last={cIdx === section.children.length - 1} />
                          </div>
                          {def && (
                            <details className="mt-1">
                              <summary className="min-h-9 cursor-pointer text-xs font-medium text-brand-700">{L("cms.ui.blockSettings")}</summary>
                              <Form method="post" className="mt-2 flex flex-col gap-4" key={`${child.id}-${child.updatedAt}`}>
                                <input type="hidden" name="_action" value="save-block" />
                                <input type="hidden" name="blockId" value={child.id} />
                                <input type="hidden" name="blockTypeDef" value={child.type} />
                                <FieldEditors fields={def.fields} values={child.props} pickers={pickers} locale={locale} />
                                {perms.canEdit && <SubmitButton className="w-fit">{L("cms.ui.saveSettings")}</SubmitButton>}
                              </Form>
                            </details>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  {/* add block to this section */}
                  {perms.canEdit && (
                    <Form method="post" className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="_action" value="add-block" />
                      <input type="hidden" name="parentId" value={section.id} />
                      <select name="blockType" required aria-label={L("cms.ui.pickBlock")} className="h-11 min-w-52 rounded-lg border border-line bg-surface px-3 text-sm">
                        <option value="">{L("cms.ui.pickBlock")}…</option>
                        {groupedBlocks.map((g) => (
                          <optgroup key={g.group} label={L(`cms.group.${g.group}`)}>
                            {g.types.map((type) => (
                              <option key={type} value={type}>{L(BLOCKS[type].labelKey)}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <SubmitButton variant="secondary">{L("cms.ui.addBlock")}</SubmitButton>
                    </Form>
                  )}
                </CardBody>
              </Card>
            );
          })}

          {perms.canEdit && (
            <Form method="post" className="w-fit">
              <input type="hidden" name="_action" value="add-section" />
              <SubmitButton variant="secondary">+ {L("cms.ui.addSection")}</SubmitButton>
            </Form>
          )}
        </div>

        {/* Side column: page settings, SEO, versions */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={L("cms.ui.pageSettings")} />
            <CardBody>
              <Form method="post" className="flex flex-col gap-3">
                <input type="hidden" name="_action" value="save-page-meta" />
                <Input label={L("cms.ui.titleAr")} name="titleAr" defaultValue={page.titleAr} dir="rtl" />
                <Input label={L("cms.ui.titleEn")} name="titleEn" defaultValue={page.titleEn} dir="ltr" />
                <Input label={L("cms.ui.slug")} name="slug" defaultValue={page.slug} dir="ltr" pattern="[a-z0-9-]*" hint={L("cms.ui.homeSlugNote")} />
                {perms.canEdit && <SubmitButton variant="secondary">{L("cms.ui.save")}</SubmitButton>}
              </Form>
            </CardBody>
          </Card>

          {perms.canEdit && (
            <Card>
              <CardHeader title={L("cms.ui.templates")} />
              <CardBody className="flex flex-col gap-4">
                <Form method="post" className="flex flex-col gap-2">
                  <input type="hidden" name="_action" value="apply-template" />
                  <select name="templateId" required aria-label={L("cms.ui.applyTemplate")} className="h-11 rounded-lg border border-line bg-surface px-3 text-sm">
                    <option value="">{L("cms.ui.applyTemplate")}…</option>
                    {templates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {locale === "ar" ? tpl.titleAr || tpl.titleEn : tpl.titleEn || tpl.titleAr}
                        {tpl.builtin ? ` · ${L("cms.ui.builtin")}` : ""}
                      </option>
                    ))}
                  </select>
                  <label className="flex items-start gap-2 text-sm text-ink-muted">
                    <input type="checkbox" name="confirm" className="mt-1 h-4 w-4" required />
                    <span>{L("cms.ui.confirmReplace")}</span>
                  </label>
                  <SubmitButton variant="secondary">{L("cms.ui.applyTemplate")}</SubmitButton>
                </Form>
                <Form method="post" className="flex flex-col gap-2 border-t border-line pt-3">
                  <input type="hidden" name="_action" value="save-as-template" />
                  <Input label={L("cms.ui.titleAr")} name="titleAr" defaultValue={page.titleAr} dir="rtl" />
                  <Input label={L("cms.ui.titleEn")} name="titleEn" defaultValue={page.titleEn} dir="ltr" />
                  <Input label={L("cms.ui.descriptionAr")} name="descriptionAr" dir="rtl" />
                  <Input label={L("cms.ui.descriptionEn")} name="descriptionEn" dir="ltr" />
                  <SubmitButton variant="secondary">{L("cms.ui.saveAsTemplate")}</SubmitButton>
                </Form>
              </CardBody>
            </Card>
          )}

          {perms.canSeo && page.seo !== undefined && (
            <Card>
              <CardHeader title={L("cms.ui.seo")} />
              <CardBody>
                <Form method="post" className="flex flex-col gap-4" key={`seo-${page.id}`}>
                  <input type="hidden" name="_action" value="save-seo" />
                  <FieldEditors fields={seoFields} values={(page.seo ?? {}) as Record<string, unknown>} pickers={pickers} locale={locale} />
                  <SubmitButton variant="secondary">{L("cms.ui.save")}</SubmitButton>
                </Form>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title={L("cms.ui.versions")} />
            <CardBody>
              {versions.length === 0 ? (
                <p className="text-sm text-ink-muted">{L("cms.ui.noVersions")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {versions.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2">
                      <span className="text-sm font-semibold text-ink">v{v.versionNo}</span>
                      <span className="text-xs text-ink-muted">{formatDateTime(locale, v.createdAt)}</span>
                      {v.note && <span className="w-full text-xs text-ink-muted">{v.note}</span>}
                      {perms.canPublish && (
                        <MiniForm className="ms-auto">
                          <input type="hidden" name="_action" value="restore-version" />
                          <input type="hidden" name="versionId" value={v.id} />
                          <ToolButton label={L("cms.ui.restoreVersion")} />
                        </MiniForm>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
