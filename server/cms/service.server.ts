import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client.server";
import {
  blocks,
  files,
  formFields,
  formSubmissions,
  forms,
  menuItems,
  menus,
  pageVersions,
  pages,
  rolePermissions,
} from "../db/schema";
import { logAudit } from "../audit/log.server";
import { sanitizeRichText } from "./sanitize.server";
import {
  BLOCKS,
  ICON_IDS,
  type PageSnapshot,
  type PageSeo,
  seoSchema,
  safeHref,
  validPageSlug,
  walkFields,
  zodForBlock,
  defaultPropsFor,
  FORM_FIELD_TYPES,
  type FormFieldType,
} from "../../app/cms/registry";

/**
 * CMS service (Phase 3). All mutations: validated (zod, derived from the block
 * registry), referenced-row-checked (CmsReferenceError — ADR-017 discipline),
 * and audited. Publishing is the ONLY path that produces public content: it
 * re-validates every block, sanitizes rich text, and freezes a snapshot.
 */

export class CmsReferenceError extends Error {
  constructor(public field: string, public reason: string) {
    super(`cms reference error: ${field} — ${reason}`);
  }
}

export class CmsValidationError extends Error {
  constructor(public issues: Array<{ blockId?: string; type?: string; path: string; message: string }>) {
    super(`cms validation failed (${issues.length} issue(s))`);
  }
}

export interface ActorCtx {
  userId: string;
  role: string;
  ipHash?: string | null;
}

const now = () => Date.now();

// ---------------------------------------------------------------------------
// Permissions (owner brief §PERMISSIONS)
// ---------------------------------------------------------------------------
export const CMS_PERMISSIONS = [
  "cms.read", "cms.create", "cms.edit", "cms.publish", "cms.delete",
  "cms.manage_theme", "cms.manage_navigation", "cms.manage_forms", "cms.manage_seo",
] as const;
export type CmsPermission = (typeof CMS_PERMISSIONS)[number];

/** rank 4 (super_admin) bypasses; others need an explicit role_permissions row. */
export async function canCms(
  db: DB,
  auth: { user: { rank: number; roleId: string } } | null,
  permission: CmsPermission
): Promise<boolean> {
  if (!auth) return false;
  if (auth.user.rank >= 4) return true;
  if (auth.user.rank < 3) return false; // students/teachers: never
  const rows = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, auth.user.roleId), eq(rolePermissions.permission, permission)))
    .limit(1);
  return rows.length > 0;
}

/** Seed default grants (idempotent): admin role gets the full CMS set. */
export async function seedCmsPermissions(db: DB): Promise<void> {
  for (const permission of CMS_PERMISSIONS) {
    await db
      .insert(rolePermissions)
      .values({ roleId: "admin", permission, grantedAt: now() })
      .onConflictDoNothing();
  }
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------
export async function listPages(db: DB) {
  return db
    .select()
    .from(pages)
    .where(isNull(pages.deletedAt))
    .orderBy(asc(pages.sortOrder), asc(pages.createdAt));
}

export async function getPage(db: DB, id: string) {
  const rows = await db.select().from(pages).where(and(eq(pages.id, id), isNull(pages.deletedAt))).limit(1);
  return rows[0] ?? null;
}

export async function getPageBySlug(db: DB, slug: string) {
  const rows = await db.select().from(pages).where(and(eq(pages.slug, slug), isNull(pages.deletedAt))).limit(1);
  return rows[0] ?? null;
}

async function slugTaken(db: DB, slug: string, exceptId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(exceptId ? and(eq(pages.slug, slug), isNull(pages.deletedAt), sql`${pages.id} != ${exceptId}`) : and(eq(pages.slug, slug), isNull(pages.deletedAt)))
    .limit(1);
  return rows.length > 0;
}

/** Base slug from title (latin); falls back to 'page'. Uniqueness via -2, -3… */
function slugBase(titleEn: string, titleAr: string): string {
  const base = titleEn
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (base) return base;
  const ar = titleAr.replace(/[^\u0600-\u06FF0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return ar || "page";
}

export async function createPage(
  db: DB,
  input: { titleAr: string; titleEn: string; slug?: string },
  actor: ActorCtx
) {
  const titleAr = input.titleAr.trim().slice(0, 200);
  const titleEn = input.titleEn.trim().slice(0, 200);
  if (!titleAr && !titleEn) throw new CmsValidationError([{ path: "title", message: "title required (ar or en)" }]);
  let slug = (input.slug ?? "").trim().toLowerCase();
  if (slug) {
    if (!validPageSlug(slug)) throw new CmsValidationError([{ path: "slug", message: "invalid or reserved slug" }]);
    if (await slugTaken(db, slug)) throw new CmsValidationError([{ path: "slug", message: "slug already taken" }]);
  } else {
    const base = slugBase(titleEn, titleAr);
    slug = base;
    for (let i = 2; await slugTaken(db, slug) || !validPageSlug(slug); i++) {
      slug = `${base}-${i}`;
      if (i > 500) throw new CmsValidationError([{ path: "slug", message: "cannot derive unique slug" }]);
    }
  }
  const row = {
    id: crypto.randomUUID(),
    slug,
    titleAr: titleAr || titleEn,
    titleEn: titleEn || titleAr,
    status: "draft" as const,
    seo: seoSchema.parse({}) as unknown as Record<string, unknown>,
    publishedSnapshot: null,
    publishedAt: null,
    sortOrder: 0,
    createdBy: actor.userId,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
  };
  const [count] = await db.select({ n: sql<number>`count(*)` }).from(pages).where(isNull(pages.deletedAt));
  row.sortOrder = Number(count?.n ?? 0);
  await db.insert(pages).values(row);
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.page.created", entityType: "page", entityId: row.id, after: { slug, titleEn, titleAr }, ipHash: actor.ipHash });
  return row;
}

export async function updatePageMeta(
  db: DB,
  pageId: string,
  patch: { titleAr?: string; titleEn?: string; slug?: string },
  actor: ActorCtx
) {
  const page = await getPage(db, pageId);
  if (!page) throw new CmsReferenceError("pageId", "page not found");
  const next: Record<string, unknown> = { updatedAt: now() };
  if (patch.titleAr !== undefined) next.titleAr = patch.titleAr.trim().slice(0, 200) || page.titleAr;
  if (patch.titleEn !== undefined) next.titleEn = patch.titleEn.trim().slice(0, 200) || page.titleEn;
  if (patch.slug !== undefined && patch.slug.trim().toLowerCase() !== page.slug) {
    const slug = patch.slug.trim().toLowerCase();
    if (!validPageSlug(slug)) throw new CmsValidationError([{ path: "slug", message: "invalid or reserved slug" }]);
    if (await slugTaken(db, slug, pageId)) throw new CmsValidationError([{ path: "slug", message: "slug already taken" }]);
    next.slug = slug;
  }
  await db.update(pages).set(next).where(eq(pages.id, pageId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.page.updated", entityType: "page", entityId: pageId, before: { titleAr: page.titleAr, titleEn: page.titleEn, slug: page.slug }, after: next, ipHash: actor.ipHash });
  return getPage(db, pageId);
}

export async function updatePageSeo(db: DB, pageId: string, seoInput: unknown, actor: ActorCtx) {
  const page = await getPage(db, pageId);
  if (!page) throw new CmsReferenceError("pageId", "page not found");
  const seo = seoSchema.parse(seoInput) as PageSeo;
  await db.update(pages).set({ seo: seo as unknown as Record<string, unknown>, updatedAt: now() }).where(eq(pages.id, pageId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.page.seo_updated", entityType: "page", entityId: pageId, before: page.seo, after: seo as unknown as Record<string, unknown>, ipHash: actor.ipHash });
  return seo;
}

export async function duplicatePage(db: DB, pageId: string, actor: ActorCtx) {
  const page = await getPage(db, pageId);
  if (!page) throw new CmsReferenceError("pageId", "page not found");
  const copy = await createPage(db, { titleAr: page.titleAr, titleEn: `${page.titleEn} (copy)` }, actor);
  const tree = await blocksForPage(db, pageId);
  for (const section of tree) {
    const [newSection] = await insertBlock(db, { pageId: copy.id, parentId: null, type: section.type, props: section.props, sortOrder: section.sortOrder, visible: section.visible });
    for (const child of section.children) {
      await insertBlock(db, { pageId: copy.id, parentId: newSection.id, type: child.type, props: child.props, sortOrder: child.sortOrder, visible: child.visible });
    }
  }
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.page.duplicated", entityType: "page", entityId: copy.id, before: { sourcePageId: pageId }, ipHash: actor.ipHash });
  return copy;
}

export async function setPageStatus(db: DB, pageId: string, status: "archived" | "draft", actor: ActorCtx) {
  const page = await getPage(db, pageId);
  if (!page) throw new CmsReferenceError("pageId", "page not found");
  await db.update(pages).set({ status, updatedAt: now() }).where(eq(pages.id, pageId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: status === "archived" ? "cms.page.archived" : "cms.page.unpublished", entityType: "page", entityId: pageId, before: { status: page.status }, after: { status }, ipHash: actor.ipHash });
}

export async function deletePage(db: DB, pageId: string, actor: ActorCtx) {
  const page = await getPage(db, pageId);
  if (!page) throw new CmsReferenceError("pageId", "page not found");
  if (page.status === "published") throw new CmsValidationError([{ path: "status", message: "unpublish or archive before deleting" }]);
  // soft delete keeps versions for audit; blocks remain but page is unreachable
  await db.update(pages).set({ deletedAt: now(), updatedAt: now() }).where(eq(pages.id, pageId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.page.deleted", entityType: "page", entityId: pageId, before: { slug: page.slug, status: page.status }, ipHash: actor.ipHash });
}

export async function movePage(db: DB, pageId: string, direction: "up" | "down", actor: ActorCtx) {
  const siblings = await listPages(db);
  const idx = siblings.findIndex((p) => p.id === pageId);
  const neighborIdx = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0) throw new CmsReferenceError("pageId", "page not found");
  if (neighborIdx < 0 || neighborIdx >= siblings.length) return; // boundary no-op
  const a = siblings[idx];
  const b = siblings[neighborIdx];
  await db.update(pages).set({ sortOrder: b.sortOrder, updatedAt: now() }).where(eq(pages.id, a.id));
  await db.update(pages).set({ sortOrder: a.sortOrder, updatedAt: now() }).where(eq(pages.id, b.id));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.page.moved", entityType: "page", entityId: pageId, after: { direction }, ipHash: actor.ipHash });
}

// ---------------------------------------------------------------------------
// Blocks (draft tree)
// ---------------------------------------------------------------------------
export interface BlockRow {
  id: string;
  pageId: string;
  parentId: string | null;
  type: string;
  props: Record<string, unknown>;
  sortOrder: number;
  visible: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface SectionNode extends BlockRow { children: BlockRow[] }

export async function blocksForPage(db: DB, pageId: string): Promise<SectionNode[]> {
  const rows = (await db
    .select()
    .from(blocks)
    .where(eq(blocks.pageId, pageId))
    .orderBy(asc(blocks.sortOrder), asc(blocks.createdAt))) as unknown as BlockRow[];
  const sections = rows.filter((r) => r.parentId === null);
  return sections.map((s) => ({ ...s, children: rows.filter((r) => r.parentId === s.id) }));
}

export async function getBlock(db: DB, blockId: string): Promise<BlockRow | null> {
  const rows = (await db.select().from(blocks).where(eq(blocks.id, blockId)).limit(1)) as unknown as BlockRow[];
  return rows[0] ?? null;
}

async function insertBlock(
  db: DB,
  input: { pageId: string; parentId: string | null; type: string; props: Record<string, unknown>; sortOrder: number; visible: boolean }
): Promise<[BlockRow]> {
  const row: BlockRow = {
    id: crypto.randomUUID(),
    pageId: input.pageId,
    parentId: input.parentId,
    type: input.type,
    props: input.props,
    sortOrder: input.sortOrder,
    visible: input.visible,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.insert(blocks).values(row as never);
  return [row];
}

export async function addBlock(
  db: DB,
  input: { pageId: string; parentId: string | null; type: string; index?: number },
  actor: ActorCtx
): Promise<BlockRow> {
  const def = BLOCKS[input.type];
  if (!def) throw new CmsValidationError([{ type: input.type, path: "type", message: "unknown block type" }]);
  const page = await getPage(db, input.pageId);
  if (!page) throw new CmsReferenceError("pageId", "page not found");
  if (def.section) {
    if (input.parentId) throw new CmsValidationError([{ path: "parentId", message: "sections cannot nest" }]);
  } else {
    if (!input.parentId) throw new CmsValidationError([{ path: "parentId", message: "components must live inside a section" }]);
    const parent = await getBlock(db, input.parentId);
    if (!parent || parent.pageId !== input.pageId) throw new CmsReferenceError("parentId", "parent section not found on this page");
    if (parent.parentId !== null) throw new CmsValidationError([{ path: "parentId", message: "components cannot nest inside components" }]);
  }
  const siblings = (await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(input.parentId ? and(eq(blocks.pageId, input.pageId), eq(blocks.parentId, input.parentId)) : and(eq(blocks.pageId, input.pageId), isNull(blocks.parentId)))) as Array<{ id: string }>;
  const sortOrder = input.index !== undefined && input.index >= 0 && input.index <= siblings.length ? input.index : siblings.length;
  const [row] = await insertBlock(db, {
    pageId: input.pageId,
    parentId: def.section ? null : input.parentId,
    type: input.type,
    props: defaultPropsFor(input.type),
    sortOrder,
    visible: true,
  });
  if (input.index !== undefined && input.index < siblings.length) {
    // push later siblings down
    for (let i = input.index; i < siblings.length; i++) {
      await db.update(blocks).set({ sortOrder: i + 1, updatedAt: now() }).where(eq(blocks.id, siblings[i].id));
    }
  }
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.block.added", entityType: "block", entityId: row.id, after: { pageId: input.pageId, parentId: input.parentId, type: input.type, sortOrder }, ipHash: actor.ipHash });
  return row;
}

/** Sanitizes every rich-text field in a props tree (descriptor-driven, recursive). */
export async function sanitizeProps(type: string, props: Record<string, unknown>): Promise<Record<string, unknown>> {
  const def = BLOCKS[type];
  if (!def) return props;
  const out = structuredClone(props);
  await sanitizeInPlace(def.fields, out);
  return out;
}

async function sanitizeInPlace(fields: Parameters<typeof walkFields>[0], obj: Record<string, unknown>): Promise<void> {
  for (const f of fields) {
    const value = obj[f.name];
    if (f.kind === "lrichtext" && value && typeof value === "object") {
      const o = value as Record<string, unknown>;
      o.ar = await sanitizeRichText(typeof o.ar === "string" ? o.ar : "");
      o.en = await sanitizeRichText(typeof o.en === "string" ? o.en : "");
    }
    if (f.kind === "repeater" && Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object") await sanitizeInPlace(f.items ?? [], item as Record<string, unknown>);
      }
    }
  }
}

export function validateProps(type: string, props: unknown): Record<string, unknown> {
  const schema = zodForBlock(type);
  if (!schema) throw new CmsValidationError([{ type, path: "type", message: "unknown block type" }]);
  const parsed = schema.safeParse(props);
  if (!parsed.success) {
    throw new CmsValidationError(
      parsed.error.issues.slice(0, 20).map((i) => ({ type, path: i.path.join(".") || "(root)", message: i.message }))
    );
  }
  return parsed.data as Record<string, unknown>;
}

export async function updateBlockProps(db: DB, blockId: string, rawProps: Record<string, unknown>, actor: ActorCtx) {
  const block = await getBlock(db, blockId);
  if (!block) throw new CmsReferenceError("blockId", "block not found");
  const sanitized = await sanitizeProps(block.type, rawProps);
  const props = validateProps(block.type, sanitized);
  await db.update(blocks).set({ props, updatedAt: now() }).where(eq(blocks.id, blockId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.block.updated", entityType: "block", entityId: blockId, before: block.props, after: props, ipHash: actor.ipHash });
  return props;
}

export async function toggleBlockVisible(db: DB, blockId: string, actor: ActorCtx) {
  const block = await getBlock(db, blockId);
  if (!block) throw new CmsReferenceError("blockId", "block not found");
  await db.update(blocks).set({ visible: !block.visible, updatedAt: now() }).where(eq(blocks.id, blockId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.block.visibility", entityType: "block", entityId: blockId, before: { visible: block.visible }, after: { visible: !block.visible }, ipHash: actor.ipHash });
}

export async function moveBlock(db: DB, blockId: string, direction: "up" | "down", actor: ActorCtx) {
  const block = await getBlock(db, blockId);
  if (!block) throw new CmsReferenceError("blockId", "block not found");
  const siblings = (await db
    .select()
    .from(blocks)
    .where(block.parentId ? and(eq(blocks.pageId, block.pageId), eq(blocks.parentId, block.parentId)) : and(eq(blocks.pageId, block.pageId), isNull(blocks.parentId)))
    .orderBy(asc(blocks.sortOrder), asc(blocks.createdAt))) as unknown as BlockRow[];
  const idx = siblings.findIndex((s) => s.id === blockId);
  const neighborIdx = direction === "up" ? idx - 1 : idx + 1;
  if (neighborIdx < 0 || neighborIdx >= siblings.length) return; // boundary no-op
  for (let position = 0; position < siblings.length; position++) {
    const target = position === idx ? neighborIdx : position === neighborIdx ? idx : position;
    if (siblings[position].sortOrder !== target) {
      await db.update(blocks).set({ sortOrder: target, updatedAt: now() }).where(eq(blocks.id, siblings[position].id));
    }
  }
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.block.moved", entityType: "block", entityId: blockId, after: { direction }, ipHash: actor.ipHash });
}

export async function duplicateBlock(db: DB, blockId: string, actor: ActorCtx) {
  const block = await getBlock(db, blockId);
  if (!block) throw new CmsReferenceError("blockId", "block not found");
  const [copy] = await insertBlock(db, {
    pageId: block.pageId,
    parentId: block.parentId,
    type: block.type,
    props: structuredClone(block.props),
    sortOrder: block.sortOrder + 1,
    visible: block.visible,
  });
  // push later siblings down
  const siblings = (await db
    .select({ id: blocks.id, sortOrder: blocks.sortOrder })
    .from(blocks)
    .where(block.parentId ? and(eq(blocks.pageId, block.pageId), eq(blocks.parentId, block.parentId)) : and(eq(blocks.pageId, block.pageId), isNull(blocks.parentId)))
    .orderBy(asc(blocks.sortOrder))) as Array<{ id: string; sortOrder: number }>;
  for (const s of siblings) {
    if (s.id !== copy.id && s.id !== blockId && s.sortOrder >= copy.sortOrder) {
      await db.update(blocks).set({ sortOrder: s.sortOrder + 1, updatedAt: now() }).where(eq(blocks.id, s.id));
    }
  }
  // deep copy children when duplicating a section
  if (block.parentId === null) {
    const children = (await db.select().from(blocks).where(eq(blocks.parentId, blockId)).orderBy(asc(blocks.sortOrder))) as unknown as BlockRow[];
    for (const child of children) {
      await insertBlock(db, { pageId: block.pageId, parentId: copy.id, type: child.type, props: structuredClone(child.props), sortOrder: child.sortOrder, visible: child.visible });
    }
  }
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.block.duplicated", entityType: "block", entityId: copy.id, before: { sourceBlockId: blockId }, ipHash: actor.ipHash });
  return copy;
}

export async function deleteBlock(db: DB, blockId: string, actor: ActorCtx) {
  const block = await getBlock(db, blockId);
  if (!block) throw new CmsReferenceError("blockId", "block not found");
  if (block.parentId === null) {
    await db.delete(blocks).where(eq(blocks.parentId, blockId));
  }
  await db.delete(blocks).where(eq(blocks.id, blockId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.block.deleted", entityType: "block", entityId: blockId, before: { type: block.type, pageId: block.pageId }, ipHash: actor.ipHash });
}

// ---------------------------------------------------------------------------
// Publish / versions / restore (draft → preview → publish lifecycle)
// ---------------------------------------------------------------------------
export async function buildSnapshot(db: DB, pageId: string): Promise<PageSnapshot> {
  const page = await getPage(db, pageId);
  if (!page) throw new CmsReferenceError("pageId", "page not found");
  const tree = await blocksForPage(db, pageId);
  const issues: CmsValidationError["issues"] = [];
  const sections: PageSnapshot["sections"] = [];
  for (const section of tree) {
    const sProps = await sanitizeProps(section.type, section.props);
    const parsed = zodForBlock(section.type)?.safeParse(sProps);
    if (!parsed?.success) {
      issues.push({ blockId: section.id, type: section.type, path: "(section)", message: parsed?.error.issues[0]?.message ?? "invalid" });
      continue;
    }
    const children: PageSnapshot["sections"][number]["children"] = [];
    for (const child of section.children) {
      const cProps = await sanitizeProps(child.type, child.props);
      const cParsed = zodForBlock(child.type)?.safeParse(cProps);
      if (!cParsed?.success) {
        issues.push({ blockId: child.id, type: child.type, path: "(props)", message: cParsed?.error.issues[0]?.message ?? "invalid" });
        continue; // broken optional block: excluded from publish, surfaced to admin
      }
      children.push({ id: child.id, type: child.type, props: cParsed.data as Record<string, unknown>, visible: child.visible });
    }
    sections.push({
      id: section.id,
      type: "section",
      props: parsed.data as Record<string, unknown>,
      visible: section.visible,
      children,
    });
  }
  if (issues.length) throw new CmsValidationError(issues);
  const seo = seoSchema.safeParse(page.seo ?? {});
  return {
    v: 1,
    page: {
      slug: page.slug,
      titleAr: page.titleAr,
      titleEn: page.titleEn,
      seo: (seo.success ? seo.data : seoSchema.parse({})) as PageSeo,
    },
    sections,
  };
}

export async function publishPage(db: DB, pageId: string, actor: ActorCtx, note?: string) {
  const snapshot = await buildSnapshot(db, pageId); // throws CmsValidationError on invalid blocks
  const [maxRow] = await db
    .select({ n: sql<number>`coalesce(max(${pageVersions.versionNo}), 0)` })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, pageId));
  const versionNo = Number(maxRow?.n ?? 0) + 1;
  const versionId = crypto.randomUUID();
  await db.insert(pageVersions).values({
    id: versionId,
    pageId,
    versionNo,
    snapshot: snapshot as unknown as Record<string, unknown>,
    note: (note ?? "").slice(0, 300) || null,
    createdBy: actor.userId,
    createdAt: now(),
  });
  await db
    .update(pages)
    .set({ status: "published", publishedSnapshot: snapshot as unknown as Record<string, unknown>, publishedAt: now(), updatedAt: now() })
    .where(eq(pages.id, pageId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.page.published", entityType: "page", entityId: pageId, after: { versionNo, sections: snapshot.sections.length }, ipHash: actor.ipHash });
  return { versionNo, versionId };
}

export async function listVersions(db: DB, pageId: string) {
  return db
    .select({ id: pageVersions.id, versionNo: pageVersions.versionNo, note: pageVersions.note, createdBy: pageVersions.createdBy, createdAt: pageVersions.createdAt })
    .from(pageVersions)
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(sql`${pageVersions.versionNo} DESC`);
}

/** Restores a version INTO THE DRAFT tree (non-destructive; versions never deleted). Admin previews, then publishes. */
export async function restoreVersion(db: DB, pageId: string, versionId: string, actor: ActorCtx) {
  const page = await getPage(db, pageId);
  if (!page) throw new CmsReferenceError("pageId", "page not found");
  const rows = await db.select().from(pageVersions).where(and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId))).limit(1);
  const version = rows[0];
  if (!version) throw new CmsReferenceError("versionId", "version not found for this page");
  const snapshot = version.snapshot as unknown as PageSnapshot;
  if (!snapshot || snapshot.v !== 1 || !Array.isArray(snapshot.sections)) {
    throw new CmsValidationError([{ path: "snapshot", message: "version snapshot is malformed" }]);
  }
  // auto-safety snapshot of the current draft before overwriting it
  const currentDraft = await blocksForPage(db, pageId);
  if (currentDraft.length) {
    const [maxRow] = await db.select({ n: sql<number>`coalesce(max(${pageVersions.versionNo}), 0)` }).from(pageVersions).where(eq(pageVersions.pageId, pageId));
    await db.insert(pageVersions).values({
      id: crypto.randomUUID(),
      pageId,
      versionNo: Number(maxRow?.n ?? 0) + 1,
      snapshot: { v: 1, page: snapshot.page, sections: currentDraft.map((s) => ({ id: s.id, type: s.type, props: s.props, visible: s.visible, children: s.children.map((c) => ({ id: c.id, type: c.type, props: c.props, visible: c.visible })) })) } as unknown as Record<string, unknown>,
      note: `auto-saved draft before restoring v${version.versionNo}`,
      createdBy: actor.userId,
      createdAt: now(),
    });
  }
  await db.delete(blocks).where(eq(blocks.pageId, pageId));
  for (const s of snapshot.sections) {
    const props = validateProps("section", s.props);
    const [sectionRow] = await insertBlock(db, { pageId, parentId: null, type: "section", props, sortOrder: snapshot.sections.indexOf(s), visible: s.visible !== false });
    for (const c of s.children ?? []) {
      if (!BLOCKS[c.type]) continue; // unknown legacy type: skip (registry shrank) — logged below
      const cProps = validateProps(c.type, c.props);
      await insertBlock(db, { pageId, parentId: sectionRow.id, type: c.type, props: cProps, sortOrder: (s.children ?? []).indexOf(c), visible: c.visible !== false });
    }
  }
  await db.update(pages).set({ titleAr: snapshot.page.titleAr || page.titleAr, titleEn: snapshot.page.titleEn || page.titleEn, seo: snapshot.page.seo as unknown as Record<string, unknown>, updatedAt: now() }).where(eq(pages.id, pageId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.page.version_restored", entityType: "page", entityId: pageId, before: { versionNo: version.versionNo, versionId }, ipHash: actor.ipHash });
}

/** Preview: serialize the CURRENT DRAFT like publish would, without persisting. Invalid blocks surface as error entries. */
export async function previewSnapshot(db: DB, pageId: string): Promise<PageSnapshot> {
  return buildSnapshot(db, pageId);
}

// ---------------------------------------------------------------------------
// Menus (navigation builder)
// ---------------------------------------------------------------------------
export type MenuLocation = "header" | "footer" | "student" | "legal";

export async function ensureMenu(db: DB, location: MenuLocation) {
  const rows = await db.select().from(menus).where(eq(menus.location, location)).limit(1);
  if (rows[0]) return rows[0];
  const row = { id: crypto.randomUUID(), location, updatedAt: now() };
  await db.insert(menus).values(row);
  return row;
}

export async function menuItemsFor(db: DB, location: MenuLocation) {
  const menu = await ensureMenu(db, location);
  const rows = (await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.menuId, menu.id))
    .orderBy(asc(menuItems.sortOrder), asc(menuItems.createdAt))) as Array<Record<string, unknown>>;
  const items = rows.map((r) => ({
    id: r.id as string,
    parentId: (r.parentId as string | null) ?? null,
    labelAr: r.labelAr as string,
    labelEn: r.labelEn as string,
    href: r.href as string,
    external: Boolean(r.external),
    icon: (r.icon as string | null) ?? null,
    sortOrder: r.sortOrder as number,
    visible: Boolean(r.visible),
  }));
  return { menu, items, topLevel: items.filter((i) => i.parentId === null), childOf: (id: string) => items.filter((i) => i.parentId === id) };
}

function validateMenuItem(input: { labelAr: string; labelEn: string; href: string; icon?: string | null }) {
  if (!input.labelAr.trim() && !input.labelEn.trim()) throw new CmsValidationError([{ path: "label", message: "label required (ar or en)" }]);
  if (!safeHref(input.href) || input.href === "") throw new CmsValidationError([{ path: "href", message: "links must be internal (/…) or https:// — javascript:/data: rejected" }]);
  if (input.icon && !(ICON_IDS as readonly string[]).includes(input.icon)) throw new CmsValidationError([{ path: "icon", message: "icon must come from the registry" }]);
}

export async function addMenuItem(db: DB, location: MenuLocation, input: { labelAr: string; labelEn: string; href: string; icon?: string; parentId?: string | null }, actor: ActorCtx) {
  validateMenuItem(input);
  const menu = await ensureMenu(db, location);
  if (input.parentId) {
    const parent = await db.select({ id: menuItems.id, parentId: menuItems.parentId }).from(menuItems).where(and(eq(menuItems.id, input.parentId), eq(menuItems.menuId, menu.id))).limit(1);
    if (!parent[0]) throw new CmsReferenceError("parentId", "parent menu item not found");
    if (parent[0].parentId) throw new CmsValidationError([{ path: "parentId", message: "only one nesting level" }]);
  }
  const siblings = await db.select({ id: menuItems.id }).from(menuItems).where(and(eq(menuItems.menuId, menu.id), input.parentId ? eq(menuItems.parentId, input.parentId) : isNull(menuItems.parentId)));
  const href = input.href.trim();
  const row = {
    id: crypto.randomUUID(),
    menuId: menu.id,
    parentId: input.parentId ?? null,
    labelAr: input.labelAr.trim().slice(0, 120),
    labelEn: input.labelEn.trim().slice(0, 120),
    href,
    external: href.startsWith("https://"),
    icon: input.icon || null,
    sortOrder: siblings.length,
    visible: true,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.insert(menuItems).values(row);
  await db.update(menus).set({ updatedAt: now() }).where(eq(menus.id, menu.id));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.menu.item_added", entityType: "menu", entityId: menu.id, after: { location, href, labelEn: row.labelEn }, ipHash: actor.ipHash });
  return row;
}

export async function updateMenuItem(db: DB, itemId: string, patch: { labelAr?: string; labelEn?: string; href?: string; icon?: string | null }, actor: ActorCtx) {
  const rows = await db.select().from(menuItems).where(eq(menuItems.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new CmsReferenceError("itemId", "menu item not found");
  const next = {
    labelAr: patch.labelAr !== undefined ? patch.labelAr.trim().slice(0, 120) : (item.labelAr as string),
    labelEn: patch.labelEn !== undefined ? patch.labelEn.trim().slice(0, 120) : (item.labelEn as string),
    href: patch.href !== undefined ? patch.href.trim() : (item.href as string),
    icon: patch.icon !== undefined ? patch.icon || null : (item.icon as string | null),
  };
  validateMenuItem(next);
  await db.update(menuItems).set({ ...next, external: next.href.startsWith("https://"), updatedAt: now() }).where(eq(menuItems.id, itemId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.menu.item_updated", entityType: "menu_item", entityId: itemId, before: { href: item.href, labelEn: item.labelEn }, after: next, ipHash: actor.ipHash });
}

export async function moveMenuItem(db: DB, itemId: string, direction: "up" | "down", actor: ActorCtx) {
  const rows = await db.select().from(menuItems).where(eq(menuItems.id, itemId)).limit(1);
  const item = rows[0];
  if (!item) throw new CmsReferenceError("itemId", "menu item not found");
  const siblings = (await db
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.menuId, item.menuId as string), item.parentId ? eq(menuItems.parentId, item.parentId as string) : isNull(menuItems.parentId)))
    .orderBy(asc(menuItems.sortOrder), asc(menuItems.createdAt))) as Array<{ id: string; sortOrder: number }>;
  const idx = siblings.findIndex((s) => s.id === itemId);
  const neighborIdx = direction === "up" ? idx - 1 : idx + 1;
  if (neighborIdx < 0 || neighborIdx >= siblings.length) return;
  for (let position = 0; position < siblings.length; position++) {
    const target = position === idx ? neighborIdx : position === neighborIdx ? idx : position;
    if (siblings[position].sortOrder !== target) {
      await db.update(menuItems).set({ sortOrder: target, updatedAt: now() }).where(eq(menuItems.id, siblings[position].id));
    }
  }
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.menu.item_moved", entityType: "menu_item", entityId: itemId, after: { direction }, ipHash: actor.ipHash });
}

export async function toggleMenuItem(db: DB, itemId: string, actor: ActorCtx) {
  const rows = await db.select().from(menuItems).where(eq(menuItems.id, itemId)).limit(1);
  if (!rows[0]) throw new CmsReferenceError("itemId", "menu item not found");
  await db.update(menuItems).set({ visible: !rows[0].visible, updatedAt: now() }).where(eq(menuItems.id, itemId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.menu.item_visibility", entityType: "menu_item", entityId: itemId, after: { visible: !rows[0].visible }, ipHash: actor.ipHash });
}

export async function deleteMenuItem(db: DB, itemId: string, actor: ActorCtx) {
  const rows = await db.select().from(menuItems).where(eq(menuItems.id, itemId)).limit(1);
  if (!rows[0]) throw new CmsReferenceError("itemId", "menu item not found");
  await db.delete(menuItems).where(eq(menuItems.parentId, itemId)); // one level of children
  await db.delete(menuItems).where(eq(menuItems.id, itemId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.menu.item_deleted", entityType: "menu_item", entityId: itemId, before: { href: rows[0].href }, ipHash: actor.ipHash });
}

// ---------------------------------------------------------------------------
// Forms (configurable, declarative validation only — NEVER code execution)
// ---------------------------------------------------------------------------
export { FORM_FIELD_TYPES };
export type { FormFieldType };

export async function listForms(db: DB) {
  return db.select().from(forms).orderBy(asc(forms.createdAt));
}

export async function getFormBySlug(db: DB, slug: string) {
  const rows = await db.select().from(forms).where(eq(forms.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getForm(db: DB, id: string) {
  const rows = await db.select().from(forms).where(eq(forms.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createForm(db: DB, input: { titleAr: string; titleEn: string; actionType?: "contact" | "newsletter" | "generic" }, actor: ActorCtx) {
  const titleAr = input.titleAr.trim().slice(0, 200);
  const titleEn = input.titleEn.trim().slice(0, 200);
  if (!titleAr && !titleEn) throw new CmsValidationError([{ path: "title", message: "title required" }]);
  let base = slugBase(titleEn, titleAr);
  let slug = base;
  for (let i = 2; (await db.select({ id: forms.id }).from(forms).where(eq(forms.slug, slug)).limit(1)).length; i++) slug = `${base}-${i}`;
  const row = {
    id: crypto.randomUUID(),
    slug,
    titleAr: titleAr || titleEn,
    titleEn: titleEn || titleAr,
    actionType: input.actionType ?? ("generic" as const),
    storeSubmissions: true,
    successAr: null, successEn: null, failureAr: null, failureEn: null,
    consentRequired: false, consentAr: null, consentEn: null,
    status: "active" as const,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.insert(forms).values(row);
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.form.created", entityType: "form", entityId: row.id, after: { slug }, ipHash: actor.ipHash });
  return row;
}

export async function updateForm(db: DB, formId: string, patch: Record<string, unknown>, actor: ActorCtx) {
  const form = await getForm(db, formId);
  if (!form) throw new CmsReferenceError("formId", "form not found");
  const allowed: Record<string, unknown> = { updatedAt: now() };
  for (const key of ["titleAr", "titleEn"] as const) {
    if (typeof patch[key] === "string" && patch[key].trim()) allowed[key] = patch[key].trim().slice(0, 200);
  }
  for (const key of ["successAr", "successEn", "failureAr", "failureEn", "consentAr", "consentEn"] as const) {
    if (typeof patch[key] === "string") allowed[key] = patch[key].slice(0, 500) || null;
  }
  if (patch.actionType && ["contact", "newsletter", "generic"].includes(String(patch.actionType))) allowed.actionType = String(patch.actionType);
  if (patch.consentRequired !== undefined) allowed.consentRequired = patch.consentRequired === true || patch.consentRequired === "on";
  if (patch.storeSubmissions !== undefined) allowed.storeSubmissions = patch.storeSubmissions === true || patch.storeSubmissions === "on";
  if (patch.status && ["active", "disabled"].includes(String(patch.status))) allowed.status = String(patch.status);
  await db.update(forms).set(allowed).where(eq(forms.id, formId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.form.updated", entityType: "form", entityId: formId, before: form as unknown as Record<string, unknown>, after: allowed, ipHash: actor.ipHash });
}

export async function fieldsForForm(db: DB, formId: string) {
  return db.select().from(formFields).where(eq(formFields.formId, formId)).orderBy(asc(formFields.sortOrder), asc(formFields.createdAt));
}

const FIELD_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;

export async function addFormField(db: DB, formId: string, input: Record<string, unknown>, actor: ActorCtx) {
  const form = await getForm(db, formId);
  if (!form) throw new CmsReferenceError("formId", "form not found");
  const name = String(input.name ?? "").trim().toLowerCase();
  if (!FIELD_NAME_RE.test(name)) throw new CmsValidationError([{ path: "name", message: "field name must be [a-z][a-z0-9_]{0,39}" }]);
  const type = String(input.type ?? "text");
  if (!(FORM_FIELD_TYPES as readonly string[]).includes(type)) throw new CmsValidationError([{ path: "type", message: "unsupported field type" }]);
  const dup = await db.select({ id: formFields.id }).from(formFields).where(and(eq(formFields.formId, formId), eq(formFields.name, name))).limit(1);
  if (dup.length) throw new CmsValidationError([{ path: "name", message: "field name already used in this form" }]);
  const labelAr = String(input.labelAr ?? "").slice(0, 200);
  const labelEn = String(input.labelEn ?? "").slice(0, 200);
  if (!labelAr && !labelEn && type !== "hidden") throw new CmsValidationError([{ path: "label", message: "label required" }]);
  const siblings = await db.select({ id: formFields.id }).from(formFields).where(eq(formFields.formId, formId));
  const row = {
    id: crypto.randomUUID(),
    formId,
    name,
    type: type as FormFieldType,
    labelAr: labelAr || labelEn,
    labelEn: labelEn || labelAr,
    placeholderAr: String(input.placeholderAr ?? "").slice(0, 200) || null,
    placeholderEn: String(input.placeholderEn ?? "").slice(0, 200) || null,
    helpAr: String(input.helpAr ?? "").slice(0, 300) || null,
    helpEn: String(input.helpEn ?? "").slice(0, 300) || null,
    required: input.required === true || input.required === "on",
    enabled: input.enabled === undefined ? true : input.enabled === true || input.enabled === "on",
    options: Array.isArray(input.options) ? (input.options as Array<Record<string, unknown>>) : null,
    validation: (input.validation && typeof input.validation === "object" ? input.validation : null) as Record<string, unknown> | null,
    defaultValue: String(input.defaultValue ?? "").slice(0, 500) || null,
    sortOrder: siblings.length,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.insert(formFields).values(row as never);
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.form.field_added", entityType: "form_field", entityId: row.id, after: { formId, name, type }, ipHash: actor.ipHash });
  return row;
}

export async function updateFormField(db: DB, fieldId: string, patch: Record<string, unknown>, actor: ActorCtx) {
  const rows = await db.select().from(formFields).where(eq(formFields.id, fieldId)).limit(1);
  const field = rows[0];
  if (!field) throw new CmsReferenceError("fieldId", "field not found");
  const allowed: Record<string, unknown> = { updatedAt: now() };
  for (const key of ["labelAr", "labelEn", "placeholderAr", "placeholderEn", "helpAr", "helpEn", "defaultValue"] as const) {
    if (typeof patch[key] === "string") allowed[key] = patch[key].slice(0, 500) || null;
  }
  if (patch.required !== undefined) allowed.required = patch.required === true || patch.required === "on";
  if (patch.enabled !== undefined) allowed.enabled = patch.enabled === true || patch.enabled === "on";
  if (Array.isArray(patch.options)) allowed.options = patch.options;
  if (patch.validation && typeof patch.validation === "object") allowed.validation = patch.validation;
  await db.update(formFields).set(allowed).where(eq(formFields.id, fieldId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.form.field_updated", entityType: "form_field", entityId: fieldId, before: field as unknown as Record<string, unknown>, after: allowed, ipHash: actor.ipHash });
}

export async function moveFormField(db: DB, fieldId: string, direction: "up" | "down", actor: ActorCtx) {
  const rows = await db.select().from(formFields).where(eq(formFields.id, fieldId)).limit(1);
  const field = rows[0];
  if (!field) throw new CmsReferenceError("fieldId", "field not found");
  const siblings = (await db
    .select()
    .from(formFields)
    .where(eq(formFields.formId, field.formId as string))
    .orderBy(asc(formFields.sortOrder), asc(formFields.createdAt))) as Array<{ id: string; sortOrder: number }>;
  const idx = siblings.findIndex((s) => s.id === fieldId);
  const neighborIdx = direction === "up" ? idx - 1 : idx + 1;
  if (neighborIdx < 0 || neighborIdx >= siblings.length) return;
  for (let position = 0; position < siblings.length; position++) {
    const target = position === idx ? neighborIdx : position === neighborIdx ? idx : position;
    if (siblings[position].sortOrder !== target) {
      await db.update(formFields).set({ sortOrder: target, updatedAt: now() }).where(eq(formFields.id, siblings[position].id));
    }
  }
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.form.field_moved", entityType: "form_field", entityId: fieldId, after: { direction }, ipHash: actor.ipHash });
}

export async function deleteFormField(db: DB, fieldId: string, actor: ActorCtx) {
  const rows = await db.select().from(formFields).where(eq(formFields.id, fieldId)).limit(1);
  if (!rows[0]) throw new CmsReferenceError("fieldId", "field not found");
  await db.delete(formFields).where(eq(formFields.id, fieldId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.form.field_deleted", entityType: "form_field", entityId: fieldId, before: { name: rows[0].name }, ipHash: actor.ipHash });
}

/** Builds a zod validator from ENABLED field definitions — declarative rules only. */
export function buildFormValidator(fields: Array<Record<string, unknown>>) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    if (!f.enabled) continue;
    const v = (f.validation ?? {}) as Record<string, unknown>;
    const minLen = typeof v.minLen === "number" ? v.minLen : undefined;
    const maxLen = typeof v.maxLen === "number" ? Math.min(v.maxLen, 5000) : 2000;
    let field: z.ZodTypeAny;
    switch (f.type as FormFieldType) {
      case "email":
        field = z.string().trim().email().max(200);
        break;
      case "phone":
        field = z.string().trim().regex(/^\+?[0-9\s-]{6,20}$/, "invalid phone");
        break;
      case "number":
        field = z.coerce.number({ error: "must be a number" }).int();
        if (typeof v.min === "number") field = (field as z.ZodNumber).min(v.min);
        if (typeof v.max === "number") field = (field as z.ZodNumber).max(v.max);
        break;
      case "textarea":
        field = z.string().trim().min(minLen ?? 0).max(maxLen);
        break;
      case "select":
      case "radio": {
        const opts = ((f.options ?? []) as Array<Record<string, unknown>>).map((o) => String(o.value ?? ""));
        field = z.enum(opts.length ? (opts as [string, ...string[]]) : (["__empty__"] as [string, ...string[]]));
        break;
      }
      case "multiselect": {
        const opts = ((f.options ?? []) as Array<Record<string, unknown>>).map((o) => String(o.value ?? ""));
        field = z.array(z.string()).max(20).refine((arr) => arr.every((x) => opts.includes(x)), "unknown option");
        break;
      }
      case "checkbox":
        field = z.union([z.boolean(), z.literal("on"), z.literal("true")]).transform((x) => x === true || x === "on" || x === "true");
        break;
      case "date":
        field = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalid date");
        break;
      case "hidden":
        field = z.string().max(500);
        break;
      default:
        field = z.string().trim().min(minLen ?? 0).max(maxLen);
    }
    if (f.required && f.type !== "checkbox") {
      field = (field as z.ZodTypeAny).refine((x) => x !== "" && x !== null && x !== undefined, "required");
    }
    if (f.type === "checkbox" && f.required) {
      field = (field as z.ZodTypeAny).refine((x) => x === true, "required");
    }
    shape[f.name as string] = f.type === "hidden" ? field.default(String(f.defaultValue ?? "")) : f.required ? field : field.optional().or(z.literal(""));
  }
  return z.object(shape);
}

export async function submitForm(
  db: DB,
  formSlug: string,
  raw: Record<string, unknown>,
  ctx: { ipHash?: string | null }
): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const form = await getFormBySlug(db, formSlug);
  if (!form || form.status !== "active") return { ok: false, errors: { __form: "unavailable" } };
  const fields = (await fieldsForForm(db, form.id)) as unknown as Array<Record<string, unknown>>;
  const validator = buildFormValidator(fields);
  const parsed = validator.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues.slice(0, 20)) errors[issue.path.join(".") || "__form"] = issue.message;
    return { ok: false, errors };
  }
  if (form.consentRequired && parsed.data.__consent !== true && raw.__consent !== "on" && raw.__consent !== true) {
    return { ok: false, errors: { __consent: "required" } };
  }
  const enabledNames = new Set(fields.filter((f) => f.enabled).map((f) => f.name as string));
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data as Record<string, unknown>)) {
    if (enabledNames.has(k)) clean[k] = v;
  }
  if (form.storeSubmissions) {
    await db.insert(formSubmissions).values({
      id: crypto.randomUUID(),
      formId: form.id,
      data: clean,
      ipHash: ctx.ipHash ?? null,
      createdAt: now(),
    });
  }
  return { ok: true };
}

export async function listSubmissions(db: DB, formId: string, limit = 100) {
  return db
    .select()
    .from(formSubmissions)
    .where(eq(formSubmissions.formId, formId))
    .orderBy(sql`${formSubmissions.createdAt} DESC`)
    .limit(limit);
}

/** Returns the subset of file ids that do NOT exist (dangling-ref guard, ADR-017 discipline). */
export async function findMissingFileRefs(db: DB, fileIds: string[]): Promise<string[]> {
  if (!fileIds.length) return [];
  const rows = await db.select({ id: files.id }).from(files).where(inArray(files.id, fileIds));
  const found = new Set(rows.map((r) => r.id));
  return fileIds.filter((id) => !found.has(id));
}

/** Collects all image/file references inside a props tree (descriptor-driven). */
export function collectFileRefs(type: string, props: Record<string, unknown>): string[] {
  const def = BLOCKS[type];
  if (!def) return [];
  const refs: string[] = [];
  walkFields(def.fields, props, (_p, f, value) => {
    if ((f.kind === "image" || f.kind === "formRef") && typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)) refs.push(value);
    if (f.name === "ogImage" && typeof value === "string" && value) refs.push(value);
  });
  return refs;
}
