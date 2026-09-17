import { eq, sql } from "drizzle-orm";
import presetJson from "./home-preset.json";
import { BLOCKS, zodForBlock } from "../../app/cms/registry";
import type { DB } from "../db/client.server";
import { pageVersions } from "../db/schema";
import {
  CmsValidationError,
  addBlock,
  blocksForPage,
  createPage,
  deleteBlock,
  getPageBySlug,
  publishPage,
  updateBlockProps,
  type ActorCtx,
} from "./service.server";

/**
 * Recommended homepage preset (owner brief: premium homepage + public SEO
 * curriculum pages).
 *
 * WHAT IT IS: a versioned, CMS-editable composition of the homepage — the same
 * data the local seed publishes (`scripts/seed.mjs` reads this JSON too, so a
 * fresh install and an existing production database converge on one layout).
 *
 * WHY IT EXISTS: the homepage is a CMS page, not code. Shipping new block types
 * alone would never change the owner's live homepage; this module applies the
 * composition THROUGH the existing CMS service, which means:
 *   - every block is sanitized + schema-validated exactly like an admin edit,
 *   - the result is a normal draft that is then published as a new page version,
 *   - the pre-existing draft/published content is preserved as a page version
 *     first, so "Restore version" in the builder rolls the change back.
 *
 * HONESTY RULES (unchanged): the preset contains copy and links only. Every
 * content-bearing section — the ONE subject shelf (`study_subjects`), videos,
 * books/notes, free lessons, exams — is a data-driven block that renders real
 * published rows and collapses when its table is empty. So the preset can never
 * invent a subject, a book, a statistic or an exam, and a fresh install shows a
 * short, honest page instead of empty bands.
 */

interface PresetComponent {
  id: string;
  type: string;
  props: Record<string, unknown>;
  visible: boolean;
}
interface PresetSection extends PresetComponent {
  children: PresetComponent[];
}

export interface HomePreset {
  v: number;
  page: { slug: string; titleAr: string; titleEn: string; seo: Record<string, unknown> };
  sections: PresetSection[];
}

/** Raised when the homepage already has content and `replace` was not confirmed. */
export class HomePresetConflictError extends Error {
  constructor(public readonly existingSections: number) {
    super("homepage already has content");
    this.name = "HomePresetConflictError";
  }
}

export interface HomePresetReport {
  pageId: string;
  created: boolean;
  replaced: boolean;
  sections: number;
  blocks: number;
  versionNo: number;
}

const PRESET = presetJson as unknown as HomePreset;

export const HOME_PRESET_SECTION_COUNT = PRESET.sections.length;
export const HOME_PRESET_NOTE = "Recommended homepage layout (applied from the admin panel)";

/**
 * Validate the whole preset against the registry BEFORE touching the database:
 * an invalid composition must fail atomically with a named block, never leave a
 * half-built page behind.
 */
export function validateHomePreset(): { sections: number; blocks: number } {
  const issues: CmsValidationError["issues"] = [];
  let blocksCount = 0;
  for (const section of PRESET.sections) {
    const sParsed = zodForBlock(section.type)?.safeParse(section.props);
    if (!sParsed?.success) {
      issues.push({ blockId: section.id, type: section.type, path: "(section)", message: sParsed?.error.issues[0]?.message ?? "invalid" });
      continue;
    }
    blocksCount += 1;
    for (const child of section.children ?? []) {
      if (!BLOCKS[child.type]) {
        issues.push({ blockId: child.id, type: child.type, path: "(type)", message: "unknown block type" });
        continue;
      }
      const cParsed = zodForBlock(child.type)?.safeParse(child.props);
      if (!cParsed?.success) {
        issues.push({ blockId: child.id, type: child.type, path: "(props)", message: cParsed?.error.issues[0]?.message ?? "invalid" });
        continue;
      }
      blocksCount += 1;
    }
  }
  if (issues.length) throw new CmsValidationError(issues);
  return { sections: PRESET.sections.length, blocks: blocksCount };
}

/** Public description of the preset for the admin UI (no DB access). */
export function homePresetSummary() {
  return {
    sections: PRESET.sections.length,
    page: { titleAr: PRESET.page.titleAr, titleEn: PRESET.page.titleEn, slug: PRESET.page.slug },
  };
}

/**
 * Apply the preset to the `home` page.
 *
 * @param replace when the page already has blocks, the caller must pass `true`
 *                (the admin UI asks for an explicit confirmation). The current
 *                draft is always archived as a page version first.
 */
export async function applyHomePreset(db: DB, actor: ActorCtx, opts: { replace?: boolean } = {}): Promise<HomePresetReport> {
  validateHomePreset();

  const existing = await getPageBySlug(db, "home");
  let created = false;
  let replaced = false;

  if (existing) {
    const current = await blocksForPage(db, existing.id);
    if (current.length > 0) {
      if (!opts.replace) throw new HomePresetConflictError(current.length);
      // safety net: keep the current draft/published content as a restorable version
      const [maxRow] = await db
        .select({ n: sql<number>`coalesce(max(${pageVersions.versionNo}), 0)` })
        .from(pageVersions)
        .where(eq(pageVersions.pageId, existing.id));
      await db.insert(pageVersions).values({
        id: crypto.randomUUID(),
        pageId: existing.id,
        versionNo: Number(maxRow?.n ?? 0) + 1,
        snapshot: {
          v: 1,
          page: { slug: existing.slug, titleAr: existing.titleAr, titleEn: existing.titleEn, seo: existing.seo ?? {} },
          sections: current.map((s) => ({
            id: s.id,
            type: s.type,
            props: s.props,
            visible: s.visible,
            children: s.children.map((c) => ({ id: c.id, type: c.type, props: c.props, visible: c.visible })),
          })),
        } as unknown as Record<string, unknown>,
        note: "auto-saved before applying the recommended homepage layout",
        createdBy: actor.userId,
        createdAt: Date.now(),
      });
      for (const section of current) await deleteBlock(db, section.id, actor);
      replaced = true;
    }
  } else {
    await createPage(db, { titleAr: PRESET.page.titleAr, titleEn: PRESET.page.titleEn, slug: PRESET.page.slug }, actor);
    created = true;
  }

  const page = await getPageBySlug(db, "home");
  if (!page) throw new CmsValidationError([{ path: "slug", message: "home page could not be created" }]);

  let blocksCount = 0;
  for (const section of PRESET.sections) {
    const sectionRow = await addBlock(db, { pageId: page.id, parentId: null, type: "section" }, actor);
    await updateBlockProps(db, sectionRow.id, section.props, actor);
    blocksCount += 1;
    for (const child of section.children ?? []) {
      const childRow = await addBlock(db, { pageId: page.id, parentId: sectionRow.id, type: child.type }, actor);
      await updateBlockProps(db, childRow.id, child.props, actor);
      blocksCount += 1;
    }
  }

  const { versionNo } = await publishPage(db, page.id, actor, HOME_PRESET_NOTE);
  return { pageId: page.id, created, replaced, sections: PRESET.sections.length, blocks: blocksCount, versionNo };
}
