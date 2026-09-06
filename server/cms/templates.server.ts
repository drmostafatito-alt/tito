import { and, asc, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client.server";
import { blocks, pageTemplates, pageVersions, pages } from "../db/schema";
import { logAudit } from "../audit/log.server";
import { STARTER_TEMPLATES, starterById } from "./starter-templates";
import { BLOCKS, type PageSnapshot, zodForBlock } from "../../app/cms/registry";
import { CmsReferenceError, CmsValidationError, type ActorCtx, getPage, blocksForPage, validateProps } from "./service.server";

export interface TemplateListItem {
  id: string;
  slug: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  builtin: boolean;
  updatedAt: number;
}

/** Independent copy: new ids so later template edits cannot mutate applied pages. */
export function cloneSectionsIndependent(sections: PageSnapshot["sections"]): PageSnapshot["sections"] {
  return sections.map((s) => ({
    id: crypto.randomUUID(),
    type: "section" as const,
    props: structuredClone(s.props ?? {}),
    visible: s.visible !== false,
    children: (s.children ?? []).map((c) => ({
      id: crypto.randomUUID(),
      type: c.type,
      props: structuredClone(c.props ?? {}),
      visible: c.visible !== false,
    })),
  }));
}

export async function listTemplates(db: DB): Promise<TemplateListItem[]> {
  const rows = await db.select().from(pageTemplates).orderBy(asc(pageTemplates.createdAt));
  const custom: TemplateListItem[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    titleAr: r.titleAr,
    titleEn: r.titleEn,
    descriptionAr: r.descriptionAr,
    descriptionEn: r.descriptionEn,
    builtin: Boolean(r.builtin),
    updatedAt: r.updatedAt,
  }));
  const starters: TemplateListItem[] = STARTER_TEMPLATES.map((t) => ({
    id: t.id,
    slug: t.slug,
    titleAr: t.titleAr,
    titleEn: t.titleEn,
    descriptionAr: t.descriptionAr,
    descriptionEn: t.descriptionEn,
    builtin: true,
    updatedAt: 0,
  }));
  const seen = new Set(custom.map((c) => c.slug));
  return [...starters.filter((s) => !seen.has(s.slug)), ...custom];
}

async function snapshotOfTemplate(db: DB, templateId: string): Promise<{ titleAr: string; titleEn: string; sections: PageSnapshot["sections"] }> {
  const starter = starterById(templateId);
  if (starter) {
    return { titleAr: starter.titleAr, titleEn: starter.titleEn, sections: starter.snapshot.sections };
  }
  const rows = await db.select().from(pageTemplates).where(eq(pageTemplates.id, templateId)).limit(1);
  const row = rows[0];
  if (!row) throw new CmsReferenceError("templateId", "template not found");
  const snap = row.snapshot as unknown as PageSnapshot;
  if (!snap || !Array.isArray(snap.sections)) throw new CmsValidationError([{ path: "snapshot", message: "template snapshot is malformed" }]);
  return { titleAr: row.titleAr, titleEn: row.titleEn, sections: snap.sections };
}

export async function savePageAsTemplate(
  db: DB,
  pageId: string,
  input: { titleAr: string; titleEn: string; descriptionAr?: string; descriptionEn?: string },
  actor: ActorCtx
) {
  const page = await getPage(db, pageId);
  if (!page) throw new CmsReferenceError("pageId", "page not found");
  const tree = await blocksForPage(db, pageId);
  const sections: PageSnapshot["sections"] = tree.map((s) => ({
    id: s.id,
    type: "section",
    props: s.props,
    visible: s.visible,
    children: s.children.map((c) => ({ id: c.id, type: c.type, props: c.props, visible: c.visible })),
  }));
  const titleAr = input.titleAr.trim().slice(0, 200) || page.titleAr;
  const titleEn = input.titleEn.trim().slice(0, 200) || page.titleEn;
  const slugBase = (titleEn || titleAr || "template")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "template";
  let slug = slugBase;
  for (let i = 2; (await db.select({ id: pageTemplates.id }).from(pageTemplates).where(eq(pageTemplates.slug, slug)).limit(1)).length; i++) {
    slug = `${slugBase}-${i}`;
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const snapshot = { v: 1 as const, page: { slug: page.slug, titleAr, titleEn, seo: { title: { ar: "", en: "" }, description: { ar: "", en: "" }, canonical: "", ogTitle: { ar: "", en: "" }, ogDescription: { ar: "", en: "" }, ogImage: "", robots: "index,follow" as const } }, sections };
  await db.insert(pageTemplates).values({
    id,
    slug,
    titleAr,
    titleEn,
    descriptionAr: (input.descriptionAr ?? "").slice(0, 400),
    descriptionEn: (input.descriptionEn ?? "").slice(0, 400),
    thumbnailFileId: null,
    snapshot: snapshot as unknown as Record<string, unknown>,
    builtin: false,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  });
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.template.created", entityType: "page_template", entityId: id, after: { slug, sourcePageId: pageId }, ipHash: actor.ipHash });
  return { id, slug };
}

export async function deleteTemplate(db: DB, templateId: string, actor: ActorCtx) {
  if (starterById(templateId)) throw new CmsValidationError([{ path: "templateId", message: "built-in templates cannot be deleted" }]);
  const rows = await db.select().from(pageTemplates).where(eq(pageTemplates.id, templateId)).limit(1);
  if (!rows[0]) throw new CmsReferenceError("templateId", "template not found");
  if (rows[0].builtin) throw new CmsValidationError([{ path: "templateId", message: "built-in templates cannot be deleted" }]);
  await db.delete(pageTemplates).where(eq(pageTemplates.id, templateId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.template.deleted", entityType: "page_template", entityId: templateId, ipHash: actor.ipHash });
}

/**
 * Replaces the DRAFT tree with an independent copy of the template.
 * Does NOT touch publishedSnapshot — the public page is unchanged until Publish.
 * Requires `confirm === true` so accidental replace is blocked.
 */
export async function applyTemplate(db: DB, pageId: string, templateId: string, actor: ActorCtx, confirm: boolean) {
  if (!confirm) throw new CmsValidationError([{ path: "confirm", message: "applying a template replaces the draft — confirm required" }]);
  const page = await getPage(db, pageId);
  if (!page) throw new CmsReferenceError("pageId", "page not found");
  const tpl = await snapshotOfTemplate(db, templateId);
  const independent = cloneSectionsIndependent(tpl.sections);

  const currentDraft = await blocksForPage(db, pageId);
  if (currentDraft.length) {
    const [maxRow] = await db.select({ n: sql<number>`coalesce(max(${pageVersions.versionNo}), 0)` }).from(pageVersions).where(eq(pageVersions.pageId, pageId));
    await db.insert(pageVersions).values({
      id: crypto.randomUUID(),
      pageId,
      versionNo: Number(maxRow?.n ?? 0) + 1,
      snapshot: {
        v: 1,
        page: { slug: page.slug, titleAr: page.titleAr, titleEn: page.titleEn, seo: page.seo ?? {} },
        sections: currentDraft.map((s) => ({
          id: s.id, type: s.type, props: s.props, visible: s.visible,
          children: s.children.map((c) => ({ id: c.id, type: c.type, props: c.props, visible: c.visible })),
        })),
      } as unknown as Record<string, unknown>,
      note: `auto-saved draft before applying template ${templateId}`,
      createdBy: actor.userId,
      createdAt: Date.now(),
    });
  }

  await db.delete(blocks).where(eq(blocks.pageId, pageId));
  const now = Date.now();
  for (let si = 0; si < independent.length; si++) {
    const s = independent[si];
    const props = validateProps("section", s.props);
    await db.insert(blocks).values({
      id: s.id,
      pageId,
      parentId: null,
      type: "section",
      props,
      sortOrder: si,
      visible: s.visible !== false,
      createdAt: now,
      updatedAt: now,
    });
    for (let ci = 0; ci < (s.children ?? []).length; ci++) {
      const c = s.children[ci];
      if (!BLOCKS[c.type] || !zodForBlock(c.type)) continue;
      const cProps = validateProps(c.type, c.props);
      await db.insert(blocks).values({
        id: c.id,
        pageId,
        parentId: s.id,
        type: c.type,
        props: cProps,
        sortOrder: ci,
        visible: c.visible !== false,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  await db.update(pages).set({ updatedAt: now }).where(eq(pages.id, pageId));
  await logAudit(db, { actorUserId: actor.userId, actorRole: actor.role, action: "cms.template.applied", entityType: "page", entityId: pageId, after: { templateId, sections: independent.length }, ipHash: actor.ipHash });
}

export async function getTemplate(db: DB, templateId: string) {
  const starter = starterById(templateId);
  if (starter) return { ...starter, snapshot: starter.snapshot };
  const rows = await db.select().from(pageTemplates).where(and(eq(pageTemplates.id, templateId))).limit(1);
  return rows[0] ?? null;
}
