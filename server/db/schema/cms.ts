import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * CMS domain (Phase 3 — owner brief: fully admin-controlled UI).
 *
 * Model (ADR-019): a page's DRAFT is a tree of `blocks` rows (section blocks at
 * the top level, component blocks as children). Publishing serializes + validates
 * the tree into `pages.published_snapshot` (JSON) and appends a `page_versions`
 * row. The PUBLIC render path reads ONLY the snapshot — drafts can never leak,
 * rendering is one indexed row read, and rollback = copy a version snapshot back
 * into the draft tree (non-destructive; versions are never deleted silently).
 *
 * Integrity policy mirrors ADR-017: plain TEXT references + app-layer guards in
 * server/cms/service.server.ts (every referenced page/parent/menu/form/file is
 * validated before insert; CmsReferenceError surfaces as a validation error).
 */

export const pages = sqliteTable(
  "pages",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
    /** Page-level SEO (JSON, zod-validated): title, description, canonical, OG fields, robots. */
    seo: text("seo", { mode: "json" }).$type<Record<string, unknown>>(),
    /** Serialized validated block tree — what the public route renders. NULL = never published. */
    publishedSnapshot: text("published_snapshot", { mode: "json" }).$type<Record<string, unknown>>(),
    publishedAt: integer("published_at", { mode: "number" }),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (t) => [index("pages_status_idx").on(t.status, t.sortOrder)]
);

export const pageVersions = sqliteTable(
  "page_versions",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id").notNull(),
    versionNo: integer("version_no", { mode: "number" }).notNull(),
    snapshot: text("snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("page_versions_page_no_idx").on(t.pageId, t.versionNo)]
);

/** Draft working tree. parent_id NULL = section (top level); otherwise component inside a section. */
export const blocks = sqliteTable(
  "blocks",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id").notNull(),
    parentId: text("parent_id"),
    type: text("type").notNull(), // registry key (app/cms/registry.ts)
    props: text("props", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    visible: integer("visible", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("blocks_page_idx").on(t.pageId, t.sortOrder), index("blocks_parent_idx").on(t.parentId)]
);

export const menus = sqliteTable("menus", {
  id: text("id").primaryKey(),
  /** Site location — one menu per location. */
  location: text("location", { enum: ["header", "footer", "student", "legal"] }).notNull().unique(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

export const menuItems = sqliteTable(
  "menu_items",
  {
    id: text("id").primaryKey(),
    menuId: text("menu_id").notNull(),
    parentId: text("parent_id"), // one nesting level (dropdown / footer group)
    labelAr: text("label_ar").notNull(),
    labelEn: text("label_en").notNull(),
    /** Internal route (starts with '/') or external https URL — validated (no javascript:/data:). */
    href: text("href").notNull(),
    external: integer("external", { mode: "boolean" }).notNull().default(false),
    icon: text("icon"), // icon-registry id only (app/cms/icons.tsx) — never raw SVG
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    visible: integer("visible", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("menu_items_menu_idx").on(t.menuId, t.sortOrder)]
);

export const forms = sqliteTable(
  "forms",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    titleAr: text("title_ar").notNull(),
    titleEn: text("title_en").notNull(),
    /** Whitelisted behavior — NEVER arbitrary code. contact/newsletter/generic all store submissions. */
    actionType: text("action_type", { enum: ["contact", "newsletter", "generic"] }).notNull().default("generic"),
    storeSubmissions: integer("store_submissions", { mode: "boolean" }).notNull().default(true),
    successAr: text("success_ar"),
    successEn: text("success_en"),
    failureAr: text("failure_ar"),
    failureEn: text("failure_en"),
    consentRequired: integer("consent_required", { mode: "boolean" }).notNull().default(false),
    consentAr: text("consent_ar"),
    consentEn: text("consent_en"),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("forms_status_idx").on(t.status)]
);

export const formFields = sqliteTable(
  "form_fields",
  {
    id: text("id").primaryKey(),
    formId: text("form_id").notNull(),
    name: text("name").notNull(), // submission key: [a-z][a-z0-9_]{0,39}
    type: text("type", {
      enum: ["text", "email", "phone", "number", "textarea", "select", "multiselect", "radio", "checkbox", "date", "hidden"],
    }).notNull(),
    labelAr: text("label_ar").notNull(),
    labelEn: text("label_en").notNull(),
    placeholderAr: text("placeholder_ar"),
    placeholderEn: text("placeholder_en"),
    helpAr: text("help_ar"),
    helpEn: text("help_en"),
    required: integer("required", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** select/radio/multiselect choices (JSON array of {value,labelAr,labelEn}). */
    options: text("options", { mode: "json" }).$type<Array<Record<string, unknown>>>(),
    /** Declarative validation only (JSON {minLen,maxLen,min,max,pattern:'email'|'phone'|'url'|'text'}) — no code. */
    validation: text("validation", { mode: "json" }).$type<Record<string, unknown>>(),
    defaultValue: text("default_value"), // hidden fields
    sortOrder: integer("sort_order", { mode: "number" }).notNull().default(0),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("form_fields_form_name_idx").on(t.formId, t.name), index("form_fields_form_idx").on(t.formId, t.sortOrder)]
);

export const formSubmissions = sqliteTable(
  "form_submissions",
  {
    id: text("id").primaryKey(),
    formId: text("form_id").notNull(),
    /** Validated answers keyed by field name (JSON). */
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    ipHash: text("ip_hash"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [index("form_submissions_form_idx").on(t.formId, t.createdAt)]
);

/** Fine-grained CMS permissions per role (owner brief §PERMISSIONS). super_admin (rank 4) bypasses. */
/** Saved page templates (independent snapshots). Built-ins live in code; custom rows here. */
export const pageTemplates = sqliteTable("page_templates", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique("page_templates_slug_idx"),
  titleAr: text("title_ar").notNull(),
  titleEn: text("title_en").notNull(),
  descriptionAr: text("description_ar").notNull().default(""),
  descriptionEn: text("description_en").notNull().default(""),
  thumbnailFileId: text("thumbnail_file_id"),
  snapshot: text("snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  builtin: integer("builtin", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by"),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id").notNull(),
    permission: text("permission").notNull(), // cms.read | cms.create | cms.edit | cms.publish | cms.delete | cms.manage_theme | cms.manage_navigation | cms.manage_forms | cms.manage_seo
    grantedAt: integer("granted_at", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("role_permissions_pk").on(t.roleId, t.permission)]
);
