import { z } from "zod";

/**
 * CMS block registry (Phase 3, Stage 1) — the SINGLE SOURCE OF TRUTH for:
 *  - allowed block types and their props (zod derived from field descriptors),
 *  - the admin builder UI (rendered generically from the same descriptors),
 *  - form-data reconstruction on save (readProps walks descriptors),
 *  - rich-text sanitization targets (kind === "lrichtext"),
 *  - which blocks need server-side data at render time (`dynamic`).
 *
 * Adding a new block type later = one entry here + one renderer component.
 * Nothing else in the CMS changes (owner brief: "the architecture must make it
 * possible to add more block types later without rewriting the whole CMS").
 *
 * Deliberately NOT shipped (documented in DECISIONS.md ADR-019):
 *  - custom_html: cannot be sandboxed safely without an iframe+CSP escape hatch;
 *    rich_text (server-sanitized whitelist) covers the need.
 *  - latest_exams / question_bank_cta / student_results / student_reviews:
 *    depend on the assessment phase; registry extension point stays open.
 *  - header/footer blocks: site-wide chrome is menu-driven (menus table), not
 *    per-page content.
 */

// ---------------------------------------------------------------------------
// Icons — controlled registry of SAFE IDENTIFIERS only (never raw SVG storage).
// Rendered by <Icon name=…> in app/cms/icons.tsx.
// ---------------------------------------------------------------------------
export const ICON_IDS = [
  "book-open", "play-circle", "graduation-cap", "file-text", "check", "check-circle",
  "star", "phone", "mail", "map-pin", "clock", "calendar", "users", "user", "award",
  "target", "zap", "shield", "lock", "heart", "arrow-right", "arrow-left", "chevron-down",
  "chevron-up", "menu", "close", "search", "settings", "image", "video", "microphone",
  "download", "external-link", "quote", "help-circle", "info", "alert-triangle",
  "sparkles", "briefcase", "globe", "credit-card", "tag", "layers", "grid", "list",
  "monitor", "smartphone", "tablet", "sun", "moon", "palette", "message-circle",
  "send", "thumbs-up", "trophy", "medal", "chart", "whatsapp", "telegram", "facebook",
  "youtube", "instagram", "tiktok", "twitter", "linkedin",
  // generic academic / philosophy & psychology visual language (homepage redesign)
  "brain", "scale", "lightbulb", "landmark", "pencil", "puzzle", "compass", "scroll",
] as const;
export type IconId = (typeof ICON_IDS)[number];

export const SOCIAL_NETWORKS = ["whatsapp", "telegram", "facebook", "youtube", "instagram", "tiktok", "twitter", "linkedin"] as const;

// ---------------------------------------------------------------------------
// Link safety — internal relative paths or https externals ONLY.
// No javascript:, data:, vbscript:, no protocol-relative //, no bare domains.
// ---------------------------------------------------------------------------
export function safeHref(href: string): boolean {
  if (href === "") return true; // empty = no link
  if (href.startsWith("/") && !href.startsWith("//")) {
    // internal route: path chars only, no embedded credentials/backslashes
    return /^\/[A-Za-z0-9\-._~%!$&'()*+,;=:@/[\]?#]*$/.test(href) && !href.includes("\\");
  }
  if (/^https:\/\//i.test(href)) {
    try {
      const u = new URL(href);
      return u.protocol === "https:" && Boolean(u.hostname) && !u.hostname.includes("\\");
    } catch {
      return false;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Field descriptors (drive validation + builder UI + form parsing)
// ---------------------------------------------------------------------------
export type FieldKind =
  | "ltext" | "ltextarea" | "lrichtext"          // localized {ar,en} strings
  | "text" | "number" | "select" | "toggle"      // scalars
  | "icon" | "image" | "link" | "datetime"       // constrained scalars
  | "refPicker" | "formRef" | "videoRef"         // DB references (uuid strings)
  | "repeater";                                  // array of objects

export interface FieldOption { value: string; labelKey: string }

export interface FieldDef {
  name: string;
  kind: FieldKind;
  labelKey: string;               // i18n key under cms.f.*
  max?: number;                   // text length cap / number max
  min?: number;                   // number min
  options?: FieldOption[];        // select choices
  items?: FieldDef[];             // repeater subfields
  itemLabelKey?: string;          // repeater item title
  maxItems?: number;              // repeater cap
  picker?: "course" | "subject" | "program"; // refPicker source
  helpKey?: string;
}

export interface BlockDef {
  labelKey: string;               // i18n key under cms.blocks.*
  group: "layout" | "content" | "media" | "cta" | "social" | "data" | "form";
  section?: boolean;              // top-level container (may hold components)
  dynamic?: "courses" | "subjects" | "programs" | "free_content" | "featured" | "latest_lessons";
  fields: FieldDef[];
}

const lstr = (max: number) =>
  z.object({ ar: z.string().max(max).default(""), en: z.string().max(max).default("") }).default({ ar: "", en: "" });

export function zodForField(f: FieldDef): z.ZodTypeAny {
  switch (f.kind) {
    case "ltext":
    case "ltextarea":
    case "lrichtext":
      return lstr(f.max ?? (f.kind === "ltext" ? 200 : 2000));
    case "text":
      return z.string().max(f.max ?? 200).default("");
    case "number":
      return z.number().int().min(f.min ?? 0).max(f.max ?? 100).default(f.min ?? 0);
    case "select": {
      const values = (f.options ?? []).map((o) => o.value);
      return z.enum(values as [string, ...string[]]).default(values[0] ?? "");
    }
    case "toggle":
      return z.boolean().default(false);
    case "icon":
      return z.string().max(40).refine((s) => s === "" || (ICON_IDS as readonly string[]).includes(s), "unknown icon id").default("");
    case "image":
    case "formRef":
    case "videoRef":
      return z.string().max(36).refine((s) => s === "" || /^[0-9a-f-]{36}$/i.test(s), "invalid reference").default("");
    case "refPicker":
      return z.array(z.string().uuid()).max(24).default([]);
    case "link":
      return z.string().max(500).refine(safeHref, "unsafe or malformed link").default("");
    case "datetime":
      return z.union([z.number().int().min(0), z.null()]).default(null);
    case "repeater":
      return z.array(z.object(Object.fromEntries((f.items ?? []).map((s) => [s.name, zodForField(s)])))).max(f.maxItems ?? 12).default([]);
  }
}

export function zodForBlock(type: string): z.ZodObject<z.ZodRawShape> | null {
  const def = BLOCKS[type];
  if (!def) return null;
  return z.object(Object.fromEntries(def.fields.map((f) => [f.name, zodForField(f)])));
}

export function defaultPropsFor(type: string): Record<string, unknown> {
  const schema = zodForBlock(type);
  return schema ? (schema.parse({}) as Record<string, unknown>) : {};
}

/** Walks a props object; calls visit(path, field, value) for every descriptor-mapped field. */
export function walkFields(fields: FieldDef[], props: Record<string, unknown>, visit: (path: string[], f: FieldDef, value: unknown) => void, prefix: string[] = []): void {
  for (const f of fields) {
    const path = [...prefix, f.name];
    const value = props[f.name];
    visit(path, f, value);
    if (f.kind === "repeater" && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i] as Record<string, unknown>;
        if (item && typeof item === "object") walkFields(f.items ?? [], item, visit, [...path, String(i)]);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Shared option sets
// ---------------------------------------------------------------------------
const targetOpts: FieldOption[] = [
  { value: "_self", labelKey: "cms.f.targetSelf" },
  { value: "_blank", labelKey: "cms.f.targetBlank" },
];
const alignOpts: FieldOption[] = [
  { value: "start", labelKey: "cms.f.alignStart" },
  { value: "center", labelKey: "cms.f.alignCenter" },
  { value: "end", labelKey: "cms.f.alignEnd" },
];
const iconSizeOpts: FieldOption[] = ["sm", "md", "lg", "xl"].map((v) => ({ value: v, labelKey: `cms.size.${v}` }));
const colorRoleOpts: FieldOption[] = ["default", "brand", "accent", "success", "warning", "error", "muted"].map((v) => ({ value: v, labelKey: `cms.color.${v}` }));
const variantOpts: FieldOption[] = ["primary", "secondary", "outline", "ghost"].map((v) => ({ value: v, labelKey: `cms.variant.${v}` }));
const badgePosOpts: FieldOption[] = ["top-start", "top-end", "bottom-start", "bottom-end"].map((v) => ({ value: v, labelKey: `cms.badge.${v.replace("-", "_")}` }));

/** Layout fields shared by the section container (spacing/alignment/background/columns). */
export const SECTION_FIELDS: FieldDef[] = [
  { name: "heading", kind: "ltext", labelKey: "cms.f.heading", max: 200 },
  { name: "subheading", kind: "ltextarea", labelKey: "cms.f.subheading", max: 400 },
  { name: "bg", kind: "select", labelKey: "cms.f.bg", options: ["default", "surface", "muted", "brand", "dark", "image"].map((v) => ({ value: v, labelKey: `cms.bg.${v}` })) },
  { name: "bgImage", kind: "image", labelKey: "cms.f.bgImage" },
  { name: "padding", kind: "select", labelKey: "cms.f.padding", options: ["none", "sm", "md", "lg", "xl"].map((v) => ({ value: v, labelKey: `cms.space.${v}` })) },
  { name: "container", kind: "select", labelKey: "cms.f.container", options: ["narrow", "normal", "wide", "full"].map((v) => ({ value: v, labelKey: `cms.container.${v}` })) },
  { name: "columns", kind: "select", labelKey: "cms.f.columns", options: ["1", "2", "3", "4"].map((v) => ({ value: v, labelKey: `cms.columns.c${v}` })) },
  { name: "gap", kind: "select", labelKey: "cms.f.gap", options: ["none", "sm", "md", "lg"].map((v) => ({ value: v, labelKey: `cms.space.${v}` })) },
  { name: "align", kind: "select", labelKey: "cms.f.align", options: alignOpts },
  { name: "hideMobile", kind: "toggle", labelKey: "cms.f.hideMobile" },
];

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------
export const BLOCKS: Record<string, BlockDef> = {
  section: {
    labelKey: "cms.blocks.section", group: "layout", section: true, fields: SECTION_FIELDS,
  },

  hero: {
    labelKey: "cms.blocks.hero", group: "content",
    fields: [
      { name: "heading", kind: "ltext", labelKey: "cms.f.heading", max: 200 },
      { name: "subheading", kind: "ltextarea", labelKey: "cms.f.subheading", max: 600 },
      { name: "image", kind: "image", labelKey: "cms.f.image" },
      { name: "height", kind: "select", labelKey: "cms.f.height", options: ["sm", "md", "lg"].map((v) => ({ value: v, labelKey: `cms.height.${v}` })) },
      { name: "align", kind: "select", labelKey: "cms.f.align", options: alignOpts },
      {
        name: "ctas", kind: "repeater", labelKey: "cms.f.ctas", itemLabelKey: "cms.f.ctaItem", maxItems: 3,
        items: [
          { name: "label", kind: "ltext", labelKey: "cms.f.label", max: 80 },
          { name: "href", kind: "link", labelKey: "cms.f.link" },
          { name: "target", kind: "select", labelKey: "cms.f.target", options: targetOpts },
          { name: "variant", kind: "select", labelKey: "cms.f.variant", options: variantOpts },
          { name: "icon", kind: "icon", labelKey: "cms.f.icon" },
        ],
      },
    ],
  },

  // Premium split hero (homepage redesign): eyebrow + headline + rich subtitle +
  // CTA group + optional intro video, plus a large configurable image with a
  // decorative gradient and optional floating feature badges. Fully CMS-driven —
  // every string/image/video/badge is editable; nothing is hardcoded.
  hero_showcase: {
    labelKey: "cms.blocks.hero_showcase", group: "content",
    fields: [
      { name: "eyebrow", kind: "ltext", labelKey: "cms.f.eyebrow", max: 120 },
      { name: "heading", kind: "ltext", labelKey: "cms.f.heading", max: 200 },
      { name: "subtitle", kind: "lrichtext", labelKey: "cms.f.subtitle", max: 4000 },
      {
        name: "ctas", kind: "repeater", labelKey: "cms.f.ctas", itemLabelKey: "cms.f.ctaItem", maxItems: 3,
        items: [
          { name: "label", kind: "ltext", labelKey: "cms.f.label", max: 80 },
          { name: "href", kind: "link", labelKey: "cms.f.link" },
          { name: "target", kind: "select", labelKey: "cms.f.target", options: targetOpts },
          { name: "variant", kind: "select", labelKey: "cms.f.variant", options: variantOpts },
          { name: "icon", kind: "icon", labelKey: "cms.f.icon" },
        ],
      },
      { name: "videoLabel", kind: "ltext", labelKey: "cms.f.videoLabel", max: 80 },
      { name: "videoId", kind: "videoRef", labelKey: "cms.f.video" },
      { name: "image", kind: "image", labelKey: "cms.f.image" },
      { name: "imageAlt", kind: "ltext", labelKey: "cms.f.alt", max: 200 },
      {
        name: "badges", kind: "repeater", labelKey: "cms.f.badges", itemLabelKey: "cms.f.badgeItem", maxItems: 4,
        items: [
          { name: "icon", kind: "icon", labelKey: "cms.f.icon" },
          { name: "title", kind: "ltext", labelKey: "cms.f.title", max: 80 },
          { name: "text", kind: "ltext", labelKey: "cms.f.text", max: 160 },
          { name: "position", kind: "select", labelKey: "cms.f.badgePos", options: badgePosOpts },
        ],
      },
    ],
  },

  // --- content ---
  text: {
    labelKey: "cms.blocks.text", group: "content",
    fields: [
      { name: "content", kind: "ltextarea", labelKey: "cms.f.content", max: 2000 },
      { name: "size", kind: "select", labelKey: "cms.f.size", options: ["body", "lead", "h3", "h2", "h1"].map((v) => ({ value: v, labelKey: `cms.size.${v}` })) },
      { name: "align", kind: "select", labelKey: "cms.f.align", options: alignOpts },
    ],
  },
  rich_text: {
    labelKey: "cms.blocks.rich_text", group: "content",
    fields: [{ name: "html", kind: "lrichtext", labelKey: "cms.f.html", max: 20000 }],
  },
  faq: {
    labelKey: "cms.blocks.faq", group: "content",
    fields: [{
      name: "items", kind: "repeater", labelKey: "cms.f.items", itemLabelKey: "cms.f.faqItem", maxItems: 20,
      items: [
        { name: "q", kind: "ltext", labelKey: "cms.f.question", max: 200 },
        { name: "a", kind: "ltextarea", labelKey: "cms.f.answer", max: 2000 },
      ],
    }],
  },
  accordion: {
    labelKey: "cms.blocks.accordion", group: "content",
    fields: [{
      name: "items", kind: "repeater", labelKey: "cms.f.items", itemLabelKey: "cms.f.panel", maxItems: 20,
      items: [
        { name: "title", kind: "ltext", labelKey: "cms.f.title", max: 200 },
        { name: "content", kind: "lrichtext", labelKey: "cms.f.content", max: 10000 },
      ],
    }],
  },
  announcement: {
    labelKey: "cms.blocks.announcement", group: "content",
    fields: [
      { name: "text", kind: "ltext", labelKey: "cms.f.text", max: 300 },
      { name: "tone", kind: "select", labelKey: "cms.f.tone", options: ["info", "success", "warning", "brand"].map((v) => ({ value: v, labelKey: `cms.tone.${v}` })) },
      { name: "icon", kind: "icon", labelKey: "cms.f.icon" },
      { name: "href", kind: "link", labelKey: "cms.f.link" },
      { name: "ctaLabel", kind: "ltext", labelKey: "cms.f.ctaLabel", max: 60 },
    ],
  },
  countdown: {
    labelKey: "cms.blocks.countdown", group: "content",
    fields: [
      { name: "target", kind: "datetime", labelKey: "cms.f.target" },
      { name: "heading", kind: "ltext", labelKey: "cms.f.heading", max: 200 },
      { name: "labelDays", kind: "ltext", labelKey: "cms.f.labelDays", max: 30 },
      { name: "labelHours", kind: "ltext", labelKey: "cms.f.labelHours", max: 30 },
      { name: "labelMinutes", kind: "ltext", labelKey: "cms.f.labelMinutes", max: 30 },
      { name: "labelSeconds", kind: "ltext", labelKey: "cms.f.labelSeconds", max: 30 },
    ],
  },
  divider: {
    labelKey: "cms.blocks.divider", group: "layout",
    fields: [{ name: "variant", kind: "select", labelKey: "cms.f.variant", options: ["line", "gradient", "dots"].map((v) => ({ value: v, labelKey: `cms.variant.${v}` })) }],
  },
  spacer: {
    labelKey: "cms.blocks.spacer", group: "layout",
    fields: [{ name: "size", kind: "select", labelKey: "cms.f.size", options: ["sm", "md", "lg", "xl"].map((v) => ({ value: v, labelKey: `cms.space.${v}` })) }],
  },

  // --- media ---
  image: {
    labelKey: "cms.blocks.image", group: "media",
    fields: [
      { name: "fileId", kind: "image", labelKey: "cms.f.image" },
      { name: "alt", kind: "ltext", labelKey: "cms.f.alt", max: 200 },
      { name: "href", kind: "link", labelKey: "cms.f.link" },
      { name: "target", kind: "select", labelKey: "cms.f.target", options: targetOpts },
      { name: "fit", kind: "select", labelKey: "cms.f.fit", options: ["cover", "contain"].map((v) => ({ value: v, labelKey: `cms.fit.${v}` })) },
      { name: "aspect", kind: "select", labelKey: "cms.f.aspect", options: ["auto", "16:9", "4:3", "1:1", "3:4"].map((v) => ({ value: v, labelKey: `cms.aspect.${v.replace(":", "x")}` })) },
      { name: "rounded", kind: "toggle", labelKey: "cms.f.rounded" },
    ],
  },
  image_text: {
    labelKey: "cms.blocks.image_text", group: "media",
    fields: [
      { name: "fileId", kind: "image", labelKey: "cms.f.image" },
      { name: "alt", kind: "ltext", labelKey: "cms.f.alt", max: 200 },
      { name: "heading", kind: "ltext", labelKey: "cms.f.heading", max: 200 },
      { name: "text", kind: "ltextarea", labelKey: "cms.f.text", max: 2000 },
      { name: "imagePosition", kind: "select", labelKey: "cms.f.imagePosition", options: ["start", "end"].map((v) => ({ value: v, labelKey: `cms.f.pos${v === "start" ? "Start" : "End"}` })) },
      { name: "ctaLabel", kind: "ltext", labelKey: "cms.f.ctaLabel", max: 60 },
      { name: "href", kind: "link", labelKey: "cms.f.link" },
    ],
  },
  gallery: {
    labelKey: "cms.blocks.gallery", group: "media",
    fields: [{
      name: "items", kind: "repeater", labelKey: "cms.f.items", itemLabelKey: "cms.f.galleryItem", maxItems: 12,
      items: [
        { name: "fileId", kind: "image", labelKey: "cms.f.image" },
        { name: "alt", kind: "ltext", labelKey: "cms.f.alt", max: 200 },
        { name: "href", kind: "link", labelKey: "cms.f.link" },
      ],
    }],
  },
  logo_cloud: {
    labelKey: "cms.blocks.logo_cloud", group: "media",
    fields: [
      { name: "heading", kind: "ltext", labelKey: "cms.f.heading", max: 200 },
      {
        name: "items", kind: "repeater", labelKey: "cms.f.items", itemLabelKey: "cms.f.logoItem", maxItems: 12,
        items: [
          { name: "fileId", kind: "image", labelKey: "cms.f.image" },
          { name: "label", kind: "ltext", labelKey: "cms.f.label", max: 100 },
        ],
      },
    ],
  },
  video: {
    labelKey: "cms.blocks.video", group: "media",
    fields: [
      { name: "videoId", kind: "videoRef", labelKey: "cms.f.video" },
      { name: "showPoster", kind: "toggle", labelKey: "cms.f.showPoster" },
      { name: "caption", kind: "ltextarea", labelKey: "cms.f.caption", max: 400 },
    ],
  },

  // --- cta ---
  buttons: {
    labelKey: "cms.blocks.buttons", group: "cta",
    fields: [
      {
        name: "items", kind: "repeater", labelKey: "cms.f.items", itemLabelKey: "cms.f.buttonItem", maxItems: 5,
        items: [
          { name: "label", kind: "ltext", labelKey: "cms.f.label", max: 80 },
          { name: "href", kind: "link", labelKey: "cms.f.link" },
          { name: "target", kind: "select", labelKey: "cms.f.target", options: targetOpts },
          { name: "variant", kind: "select", labelKey: "cms.f.variant", options: variantOpts },
          { name: "icon", kind: "icon", labelKey: "cms.f.icon" },
        ],
      },
      { name: "align", kind: "select", labelKey: "cms.f.align", options: alignOpts },
      { name: "stackMobile", kind: "toggle", labelKey: "cms.f.stackMobile" },
    ],
  },
  icon_feature: {
    labelKey: "cms.blocks.icon_feature", group: "content",
    fields: [
      { name: "icon", kind: "icon", labelKey: "cms.f.icon" },
      { name: "size", kind: "select", labelKey: "cms.f.iconSize", options: iconSizeOpts },
      { name: "colorRole", kind: "select", labelKey: "cms.f.iconColor", options: colorRoleOpts },
      { name: "align", kind: "select", labelKey: "cms.f.align", options: alignOpts },
      { name: "label", kind: "ltext", labelKey: "cms.f.label", max: 120 },
    ],
  },
  icon_grid: {
    labelKey: "cms.blocks.icon_grid", group: "content",
    fields: [{
      name: "items", kind: "repeater", labelKey: "cms.f.items", itemLabelKey: "cms.f.iconItem", maxItems: 12,
      items: [
        { name: "icon", kind: "icon", labelKey: "cms.f.icon" },
        { name: "title", kind: "ltext", labelKey: "cms.f.title", max: 120 },
        { name: "text", kind: "ltextarea", labelKey: "cms.f.text", max: 300 },
        { name: "href", kind: "link", labelKey: "cms.f.link" },
      ],
    }],
  },
  feature_cards: {
    labelKey: "cms.blocks.feature_cards", group: "content",
    fields: [{
      name: "items", kind: "repeater", labelKey: "cms.f.items", itemLabelKey: "cms.f.card", maxItems: 9,
      items: [
        { name: "icon", kind: "icon", labelKey: "cms.f.icon" },
        { name: "title", kind: "ltext", labelKey: "cms.f.title", max: 120 },
        { name: "text", kind: "ltextarea", labelKey: "cms.f.text", max: 400 },
        { name: "ctaLabel", kind: "ltext", labelKey: "cms.f.ctaLabel", max: 60 },
        { name: "href", kind: "link", labelKey: "cms.f.link" },
        { name: "tint", kind: "select", labelKey: "cms.f.iconColor", options: colorRoleOpts },
      ],
    }],
  },
  pricing_cards: {
    labelKey: "cms.blocks.pricing_cards", group: "content",
    fields: [
      { name: "style", kind: "select", labelKey: "cms.f.style", options: ["pricing", "package"].map((v) => ({ value: v, labelKey: `cms.style.${v}` })) },
      {
        name: "items", kind: "repeater", labelKey: "cms.f.items", itemLabelKey: "cms.f.plan", maxItems: 6,
        items: [
          { name: "name", kind: "ltext", labelKey: "cms.f.name", max: 80 },
          { name: "price", kind: "text", labelKey: "cms.f.price", max: 40 },
          { name: "period", kind: "ltext", labelKey: "cms.f.period", max: 40 },
          { name: "features", kind: "ltextarea", labelKey: "cms.f.featuresPerLine", max: 600 },
          { name: "ctaLabel", kind: "ltext", labelKey: "cms.f.ctaLabel", max: 60 },
          { name: "ctaHref", kind: "link", labelKey: "cms.f.ctaLink" },
          { name: "highlighted", kind: "toggle", labelKey: "cms.f.highlighted" },
        ],
      },
    ],
  },
  statistics: {
    labelKey: "cms.blocks.statistics", group: "content",
    fields: [
      { name: "style", kind: "select", labelKey: "cms.f.style", options: ["cards", "bar"].map((v) => ({ value: v, labelKey: `cms.statStyle.${v}` })) },
      {
        name: "items", kind: "repeater", labelKey: "cms.f.items", itemLabelKey: "cms.f.stat", maxItems: 8,
        items: [
          { name: "value", kind: "text", labelKey: "cms.f.value", max: 40 },
          { name: "label", kind: "ltext", labelKey: "cms.f.label", max: 120 },
          { name: "icon", kind: "icon", labelKey: "cms.f.icon" },
          { name: "href", kind: "link", labelKey: "cms.f.link" },
        ],
      },
    ],
  },
  testimonials: {
    labelKey: "cms.blocks.testimonials", group: "content",
    fields: [{
      name: "items", kind: "repeater", labelKey: "cms.f.items", itemLabelKey: "cms.f.testimonial", maxItems: 12,
      items: [
        { name: "quote", kind: "ltextarea", labelKey: "cms.f.quote", max: 600 },
        { name: "name", kind: "ltext", labelKey: "cms.f.name", max: 80 },
        { name: "role", kind: "ltext", labelKey: "cms.f.role", max: 80 },
        { name: "image", kind: "image", labelKey: "cms.f.photo" },
      ],
    }],
  },
  teacher_profile: {
    labelKey: "cms.blocks.teacher_profile", group: "content",
    fields: [
      { name: "useIdentity", kind: "toggle", labelKey: "cms.f.useIdentity" },
      { name: "name", kind: "ltext", labelKey: "cms.f.name", max: 120 },
      { name: "title", kind: "ltext", labelKey: "cms.f.title", max: 120 },
      { name: "photo", kind: "image", labelKey: "cms.f.photo" },
      { name: "bio", kind: "lrichtext", labelKey: "cms.f.bio", max: 10000 },
    ],
  },
  login_cta: {
    labelKey: "cms.blocks.login_cta", group: "cta",
    fields: [
      { name: "label", kind: "ltext", labelKey: "cms.f.label", max: 80 },
      { name: "sublabel", kind: "ltextarea", labelKey: "cms.f.sublabel", max: 300 },
    ],
  },
  register_cta: {
    labelKey: "cms.blocks.register_cta", group: "cta",
    fields: [
      { name: "label", kind: "ltext", labelKey: "cms.f.label", max: 80 },
      { name: "sublabel", kind: "ltextarea", labelKey: "cms.f.sublabel", max: 300 },
    ],
  },

  // --- social/contact ---
  promo_banner: {
    labelKey: "cms.blocks.promo_banner", group: "cta",
    fields: [
      { name: "heading", kind: "ltext", labelKey: "cms.f.heading", max: 200 },
      { name: "text", kind: "ltextarea", labelKey: "cms.f.text", max: 600 },
      { name: "image", kind: "image", labelKey: "cms.f.image" },
      { name: "ctaLabel", kind: "ltext", labelKey: "cms.f.ctaLabel", max: 60 },
      { name: "ctaHref", kind: "link", labelKey: "cms.f.ctaLink" },
      { name: "startsAt", kind: "datetime", labelKey: "cms.f.startsAt" },
      { name: "endsAt", kind: "datetime", labelKey: "cms.f.endsAt" },
    ],
  },
  social_links: {
    labelKey: "cms.blocks.social_links", group: "social",
    fields: [
      { name: "style", kind: "select", labelKey: "cms.f.style", options: ["icons", "buttons"].map((v) => ({ value: v, labelKey: `cms.style.${v}` })) },
      {
        name: "items", kind: "repeater", labelKey: "cms.f.items", itemLabelKey: "cms.f.socialItem", maxItems: 10,
        items: [
          { name: "network", kind: "select", labelKey: "cms.f.network", options: SOCIAL_NETWORKS.map((v) => ({ value: v, labelKey: `cms.social.${v}` })) },
          { name: "url", kind: "link", labelKey: "cms.f.url" },
          { name: "label", kind: "ltext", labelKey: "cms.f.label", max: 60 },
        ],
      },
    ],
  },
  contact_info: {
    labelKey: "cms.blocks.contact_info", group: "social",
    fields: [
      { name: "showPhone", kind: "toggle", labelKey: "cms.f.showPhone" },
      { name: "showEmail", kind: "toggle", labelKey: "cms.f.showEmail" },
      { name: "showAddress", kind: "toggle", labelKey: "cms.f.showAddress" },
      { name: "addressOverride", kind: "ltextarea", labelKey: "cms.f.addressOverride", max: 300 },
    ],
  },
  whatsapp_cta: {
    labelKey: "cms.blocks.whatsapp_cta", group: "social",
    fields: [
      { name: "label", kind: "ltext", labelKey: "cms.f.label", max: 80 },
      { name: "phone", kind: "text", labelKey: "cms.f.phoneOverride", max: 32 },
      { name: "style", kind: "select", labelKey: "cms.f.style", options: ["button", "floating"].map((v) => ({ value: v, labelKey: `cms.style.${v}` })) },
    ],
  },
  telegram_cta: {
    labelKey: "cms.blocks.telegram_cta", group: "social",
    fields: [
      { name: "label", kind: "ltext", labelKey: "cms.f.label", max: 80 },
      { name: "url", kind: "link", labelKey: "cms.f.url" },
      { name: "style", kind: "select", labelKey: "cms.f.style", options: ["button", "floating"].map((v) => ({ value: v, labelKey: `cms.style.${v}` })) },
    ],
  },

  // --- forms ---
  form_block: {
    labelKey: "cms.blocks.form_block", group: "form",
    fields: [
      { name: "formId", kind: "formRef", labelKey: "cms.f.form" },
      { name: "heading", kind: "ltext", labelKey: "cms.f.heading", max: 200 },
    ],
  },
  newsletter_form: {
    labelKey: "cms.blocks.newsletter_form", group: "form",
    fields: [
      { name: "formId", kind: "formRef", labelKey: "cms.f.form" },
      { name: "heading", kind: "ltext", labelKey: "cms.f.heading", max: 200 },
      { name: "text", kind: "ltextarea", labelKey: "cms.f.text", max: 400 },
    ],
  },

  // --- data-driven (resolved server-side at render; authorization stays server-side) ---
  course_cards: {
    labelKey: "cms.blocks.course_cards", group: "data", dynamic: "courses",
    fields: [
      { name: "heading", kind: "ltext", labelKey: "cms.f.heading", max: 200 },
      { name: "subheading", kind: "ltextarea", labelKey: "cms.f.subheading", max: 400 },
      { name: "source", kind: "select", labelKey: "cms.f.source", options: ["featured", "latest", "manual"].map((v) => ({ value: v, labelKey: `cms.source.${v}` })) },
      { name: "manualIds", kind: "refPicker", labelKey: "cms.f.pickCourses", picker: "course" },
      { name: "limit", kind: "number", labelKey: "cms.f.limit", min: 1, max: 12 },
      { name: "ctaLabelOverride", kind: "ltext", labelKey: "cms.f.ctaLabelOverride", max: 60 },
    ],
  },
  subject_cards: {
    labelKey: "cms.blocks.subject_cards", group: "data", dynamic: "subjects",
    fields: [
      { name: "heading", kind: "ltext", labelKey: "cms.f.heading", max: 200 },
      { name: "source", kind: "select", labelKey: "cms.f.source", options: ["all", "manual"].map((v) => ({ value: v, labelKey: `cms.source.${v}` })) },
      { name: "manualIds", kind: "refPicker", labelKey: "cms.f.pickSubjects", picker: "subject" },
      { name: "limit", kind: "number", labelKey: "cms.f.limit", min: 1, max: 12 },
    ],
  },
  program_cards: {
    labelKey: "cms.blocks.program_cards", group: "data", dynamic: "programs",
    fields: [
      { name: "heading", kind: "ltext", labelKey: "cms.f.heading", max: 200 },
      { name: "source", kind: "select", labelKey: "cms.f.source", options: ["all", "manual"].map((v) => ({ value: v, labelKey: `cms.source.${v}` })) },
      { name: "manualIds", kind: "refPicker", labelKey: "cms.f.pickPrograms", picker: "program" },
      { name: "limit", kind: "number", labelKey: "cms.f.limit", min: 1, max: 12 },
    ],
  },
  free_content: {
    labelKey: "cms.blocks.free_content", group: "data", dynamic: "free_content",
    fields: [
      { name: "heading", kind: "ltext", labelKey: "cms.f.heading", max: 200 },
      { name: "limit", kind: "number", labelKey: "cms.f.limit", min: 1, max: 12 },
    ],
  },
  featured_content: {
    labelKey: "cms.blocks.featured_content", group: "data", dynamic: "featured",
    fields: [
      { name: "heading", kind: "ltext", labelKey: "cms.f.heading", max: 200 },
      { name: "kind", kind: "select", labelKey: "cms.f.kind", options: ["courses", "subjects", "programs"].map((v) => ({ value: v, labelKey: `cms.kind.${v}` })) },
      { name: "limit", kind: "number", labelKey: "cms.f.limit", min: 1, max: 12 },
    ],
  },
  latest_lessons: {
    labelKey: "cms.blocks.latest_lessons", group: "data", dynamic: "latest_lessons",
    fields: [
      { name: "heading", kind: "ltext", labelKey: "cms.f.heading", max: 200 },
      { name: "courseIds", kind: "refPicker", labelKey: "cms.f.filterCourses", picker: "course" },
      { name: "limit", kind: "number", labelKey: "cms.f.limit", min: 1, max: 12 },
    ],
  },
};

export type BlockType = keyof typeof BLOCKS;

/** Component types the builder offers inside sections (everything except the section itself). */
export const COMPONENT_TYPES = Object.keys(BLOCKS).filter((k) => !BLOCKS[k].section);
export const BLOCK_GROUPS = ["content", "media", "cta", "social", "form", "data", "layout"] as const;

// ---------------------------------------------------------------------------
// Page SEO (per-page metadata, validated)
// ---------------------------------------------------------------------------
export const seoSchema = z.object({
  title: lstr(120),
  description: lstr(300),
  canonical: z.string().max(500).refine((s) => s === "" || /^https:\/\/[^\s]+$/i.test(s), "canonical must be an absolute https URL").default(""),
  ogTitle: lstr(120),
  ogDescription: lstr(300),
  ogImage: z.string().max(36).refine((s) => s === "" || /^[0-9a-f-]{36}$/i.test(s)).default(""),
  robots: z.enum(["index,follow", "noindex,follow", "noindex,nofollow", "index,nofollow"]).default("index,follow"),
});
export type PageSeo = z.infer<typeof seoSchema>;
export const seoFields: FieldDef[] = [
  { name: "title", kind: "ltext", labelKey: "cms.seo.title", max: 120 },
  { name: "description", kind: "ltextarea", labelKey: "cms.seo.description", max: 300 },
  { name: "canonical", kind: "text", labelKey: "cms.seo.canonical", max: 500 },
  { name: "ogTitle", kind: "ltext", labelKey: "cms.seo.ogTitle", max: 120 },
  { name: "ogDescription", kind: "ltextarea", labelKey: "cms.seo.ogDescription", max: 300 },
  { name: "ogImage", kind: "image", labelKey: "cms.seo.ogImage" },
  { name: "robots", kind: "select", labelKey: "cms.seo.robots", options: ["index,follow", "noindex,follow", "noindex,nofollow", "index,nofollow"].map((v) => ({ value: v, labelKey: `cms.robots.${v.replace(",", "_")}` })) },
];

// ---------------------------------------------------------------------------
// Snapshot shape (what publishing serializes and the public route renders)
// ---------------------------------------------------------------------------
export interface SnapshotComponent { id: string; type: string; props: Record<string, unknown>; visible: boolean }
export interface SnapshotSection extends SnapshotComponent { type: "section"; children: SnapshotComponent[] }
export interface PageSnapshot {
  v: 1;
  page: { slug: string; titleAr: string; titleEn: string; seo: PageSeo };
  sections: SnapshotSection[];
}

/** Slugs a CMS page may never take (app routes + reserved system paths). */
export const RESERVED_SLUGS = new Set([
  "admin", "api", "assets", "courses", "dashboard", "exams", "files", "learn", "login",
  "logout", "my", "p", "preview", "profile", "register", "forgot-password", "reset-password",
  "set-locale", "security", "student", "theme", "favicon", "cart", "checkout", "orders",
  "results", "devices", "notifications", "webhooks", "beacons", "f",
]);

export const PAGE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

export function validPageSlug(slug: string): boolean {
  return PAGE_SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug);
}

/** Localized string helper for renderers. */
export type LStr = { ar: string; en: string };
export function ls(value: unknown, locale: "ar" | "en"): string {
  if (value && typeof value === "object") {
    const o = value as Partial<LStr>;
    return (locale === "ar" ? o.ar : o.en) || o.ar || o.en || "";
  }
  return typeof value === "string" ? value : "";
}

// ---------------------------------------------------------------------------
// Bilingual labels for the registry (self-contained: adding a block type never
// requires touching locale files). Resolved with cmsLabel(key, locale).
// ---------------------------------------------------------------------------
export const CMS_LABELS: Record<string, { ar: string; en: string }> = {
  // block types
  "cms.blocks.section": { ar: "قسم", en: "Section" },
  "cms.blocks.hero": { ar: "واجهة رئيسية (Hero)", en: "Hero" },
  "cms.blocks.hero_showcase": { ar: "واجهة رئيسية مميزة (Hero)", en: "Showcase hero" },
  "cms.f.height": { ar: "الارتفاع", en: "Height" },
  "cms.height.sm": { ar: "منخفض", en: "Short" },
  "cms.height.md": { ar: "متوسط", en: "Medium" },
  "cms.height.lg": { ar: "مرتفع", en: "Tall" },
  "cms.f.ctas": { ar: "أزرار الدعوة", en: "Call-to-action buttons" },
  "cms.f.ctaItem": { ar: "زر دعوة", en: "CTA button" },
  "cms.blocks.text": { ar: "نص", en: "Text" },
  "cms.blocks.rich_text": { ar: "نص منسّق", en: "Rich text" },
  "cms.blocks.faq": { ar: "الأسئلة الشائعة", en: "FAQ" },
  "cms.blocks.accordion": { ar: "أكورديون", en: "Accordion" },
  "cms.blocks.announcement": { ar: "تنويه", en: "Announcement" },
  "cms.blocks.countdown": { ar: "عد تنازلي", en: "Countdown" },
  "cms.blocks.divider": { ar: "فاصل", en: "Divider" },
  "cms.blocks.spacer": { ar: "مسافة", en: "Spacer" },
  "cms.blocks.image": { ar: "صورة", en: "Image" },
  "cms.blocks.image_text": { ar: "صورة ونص", en: "Image + text" },
  "cms.blocks.gallery": { ar: "معرض صور", en: "Gallery" },
  "cms.blocks.logo_cloud": { ar: "شعارات", en: "Logo cloud" },
  "cms.blocks.video": { ar: "فيديو", en: "Video" },
  "cms.blocks.buttons": { ar: "أزرار", en: "Buttons" },
  "cms.blocks.icon_feature": { ar: "أيقونة", en: "Icon" },
  "cms.blocks.icon_grid": { ar: "شبكة أيقونات", en: "Icon grid" },
  "cms.blocks.feature_cards": { ar: "بطاقات مميزات", en: "Feature cards" },
  "cms.blocks.pricing_cards": { ar: "بطاقات أسعار/باقات", en: "Pricing / package cards" },
  "cms.blocks.statistics": { ar: "أرقام وإحصاءات", en: "Statistics" },
  "cms.blocks.testimonials": { ar: "آراء الطلاب", en: "Testimonials" },
  "cms.blocks.teacher_profile": { ar: "بطاقة المعلم", en: "Teacher profile" },
  "cms.blocks.login_cta": { ar: "دعوة لتسجيل الدخول", en: "Login CTA" },
  "cms.blocks.register_cta": { ar: "دعوة لإنشاء حساب", en: "Register CTA" },
  "cms.blocks.promo_banner": { ar: "بانر ترويجي", en: "Promotional banner" },
  "cms.blocks.social_links": { ar: "روابط التواصل", en: "Social links" },
  "cms.blocks.contact_info": { ar: "بيانات التواصل", en: "Contact info" },
  "cms.blocks.whatsapp_cta": { ar: "زر واتساب", en: "WhatsApp CTA" },
  "cms.blocks.telegram_cta": { ar: "زر تليجرام", en: "Telegram CTA" },
  "cms.blocks.form_block": { ar: "نموذج", en: "Form" },
  "cms.blocks.newsletter_form": { ar: "نشرة بريدية", en: "Newsletter form" },
  "cms.blocks.course_cards": { ar: "بطاقات كورسات", en: "Course cards" },
  "cms.blocks.subject_cards": { ar: "بطاقات مواد", en: "Subject cards" },
  "cms.blocks.program_cards": { ar: "بطاقات مراحل", en: "Program cards" },
  "cms.blocks.free_content": { ar: "محتوى مجاني", en: "Free content" },
  "cms.blocks.featured_content": { ar: "محتوى مميز", en: "Featured content" },
  "cms.blocks.latest_lessons": { ar: "أحدث الدروس", en: "Latest lessons" },
  // field labels
  "cms.f.heading": { ar: "العنوان", en: "Heading" },
  "cms.f.subheading": { ar: "العنوان الفرعي", en: "Subheading" },
  "cms.f.eyebrow": { ar: "الشارة العلوية", en: "Eyebrow / badge" },
  "cms.f.subtitle": { ar: "النص التعريفي (منسّق)", en: "Intro text (rich)" },
  "cms.f.videoLabel": { ar: "نص زر الفيديو", en: "Video button label" },
  "cms.f.badges": { ar: "البطاقات العائمة", en: "Floating badges" },
  "cms.f.badgeItem": { ar: "بطاقة عائمة", en: "Floating badge" },
  "cms.f.badgePos": { ar: "موضع البطاقة", en: "Badge position" },
  "cms.badge.top_start": { ar: "أعلى البداية", en: "Top start" },
  "cms.badge.top_end": { ar: "أعلى النهاية", en: "Top end" },
  "cms.badge.bottom_start": { ar: "أسفل البداية", en: "Bottom start" },
  "cms.badge.bottom_end": { ar: "أسفل النهاية", en: "Bottom end" },
  "cms.statStyle.cards": { ar: "بطاقات", en: "Cards" },
  "cms.statStyle.bar": { ar: "شريط أفقي مميز", en: "Premium bar" },
  "cms.f.bg": { ar: "الخلفية", en: "Background" },
  "cms.f.bgImage": { ar: "صورة الخلفية", en: "Background image" },
  "cms.f.padding": { ar: "الحشو", en: "Padding" },
  "cms.f.container": { ar: "عرض المحتوى", en: "Content width" },
  "cms.f.columns": { ar: "عدد الأعمدة", en: "Columns" },
  "cms.f.gap": { ar: "التباعد", en: "Gap" },
  "cms.f.align": { ar: "المحاذاة", en: "Alignment" },
  "cms.f.hideMobile": { ar: "إخفاء على الموبايل", en: "Hide on mobile" },
  "cms.f.content": { ar: "المحتوى", en: "Content" },
  "cms.f.size": { ar: "الحجم", en: "Size" },
  "cms.f.html": { ar: "النص المنسّق", en: "Rich text (safe HTML)" },
  "cms.f.items": { ar: "العناصر", en: "Items" },
  "cms.f.faqItem": { ar: "سؤال", en: "Question" },
  "cms.f.question": { ar: "السؤال", en: "Question" },
  "cms.f.answer": { ar: "الإجابة", en: "Answer" },
  "cms.f.panel": { ar: "لوحة", en: "Panel" },
  "cms.f.title": { ar: "العنوان", en: "Title" },
  "cms.f.text": { ar: "النص", en: "Text" },
  "cms.f.tone": { ar: "النغمة", en: "Tone" },
  "cms.f.icon": { ar: "الأيقونة", en: "Icon" },
  "cms.f.link": { ar: "الرابط", en: "Link" },
  "cms.f.target": { ar: "هدف الرابط", en: "Link target" },
  "cms.f.targetSelf": { ar: "نفس النافذة", en: "Same tab" },
  "cms.f.targetBlank": { ar: "نافذة جديدة", en: "New tab" },
  "cms.f.alignStart": { ar: "بداية", en: "Start" },
  "cms.f.alignCenter": { ar: "وسط", en: "Center" },
  "cms.f.alignEnd": { ar: "نهاية", en: "End" },
  "cms.f.labelDays": { ar: "تسمية الأيام", en: "Days label" },
  "cms.f.labelHours": { ar: "تسمية الساعات", en: "Hours label" },
  "cms.f.labelMinutes": { ar: "تسمية الدقائق", en: "Minutes label" },
  "cms.f.labelSeconds": { ar: "تسمية الثواني", en: "Seconds label" },
  "cms.f.variant": { ar: "الشكل", en: "Variant" },
  "cms.f.image": { ar: "الصورة", en: "Image" },
  "cms.f.alt": { ar: "النص البديل", en: "Alt text" },
  "cms.f.fit": { ar: "طريقة العرض", en: "Fit" },
  "cms.f.aspect": { ar: "نسبة الأبعاد", en: "Aspect ratio" },
  "cms.f.rounded": { ar: "حواف دائرية", en: "Rounded corners" },
  "cms.f.imagePosition": { ar: "موضع الصورة", en: "Image position" },
  "cms.f.posStart": { ar: "البداية", en: "Start" },
  "cms.f.posEnd": { ar: "النهاية", en: "End" },
  "cms.f.ctaLabel": { ar: "نص الزر", en: "Button label" },
  "cms.f.ctaLink": { ar: "رابط الزر", en: "Button link" },
  "cms.f.galleryItem": { ar: "صورة", en: "Image" },
  "cms.f.logoItem": { ar: "شعار", en: "Logo" },
  "cms.f.label": { ar: "التسمية", en: "Label" },
  "cms.f.video": { ar: "الفيديو", en: "Video" },
  "cms.f.showPoster": { ar: "إظهار الملصق", en: "Show poster" },
  "cms.f.caption": { ar: "الوصف", en: "Caption" },
  "cms.f.buttonItem": { ar: "زر", en: "Button" },
  "cms.f.stackMobile": { ar: "تكديس الأزرار على الموبايل", en: "Stack buttons on mobile" },
  "cms.f.iconSize": { ar: "حجم الأيقونة", en: "Icon size" },
  "cms.f.iconColor": { ar: "لون الأيقونة", en: "Icon color" },
  "cms.f.card": { ar: "بطاقة", en: "Card" },
  "cms.f.style": { ar: "الأسلوب", en: "Style" },
  "cms.f.plan": { ar: "باقة", en: "Plan" },
  "cms.f.name": { ar: "الاسم", en: "Name" },
  "cms.f.price": { ar: "السعر (نصًا)", en: "Price (as text)" },
  "cms.f.period": { ar: "المدة/الدورية", en: "Period" },
  "cms.f.featuresPerLine": { ar: "المميزات (سطر لكل ميزة)", en: "Features (one per line)" },
  "cms.f.highlighted": { ar: "مميّزة", en: "Highlighted" },
  "cms.f.stat": { ar: "رقم", en: "Statistic" },
  "cms.f.value": { ar: "القيمة", en: "Value" },
  "cms.f.testimonial": { ar: "رأي", en: "Testimonial" },
  "cms.f.quote": { ar: "النص", en: "Quote" },
  "cms.f.role": { ar: "الصفة", en: "Role" },
  "cms.f.photo": { ar: "الصورة الشخصية", en: "Photo" },
  "cms.f.useIdentity": { ar: "استخدام بيانات المعلم من الهوية", en: "Use site identity values" },
  "cms.f.bio": { ar: "السيرة", en: "Biography" },
  "cms.f.sublabel": { ar: "نص ثانوي", en: "Sublabel" },
  "cms.f.startsAt": { ar: "يبدأ في", en: "Starts at" },
  "cms.f.endsAt": { ar: "ينتهي في", en: "Ends at" },
  "cms.f.socialItem": { ar: "حساب", en: "Account" },
  "cms.f.network": { ar: "الشبكة", en: "Network" },
  "cms.f.url": { ar: "الرابط", en: "URL" },
  "cms.f.showPhone": { ar: "إظهار الهاتف", en: "Show phone" },
  "cms.f.showEmail": { ar: "إظهار البريد", en: "Show email" },
  "cms.f.showAddress": { ar: "إظهار العنوان", en: "Show address" },
  "cms.f.addressOverride": { ar: "عنوان مخصص", en: "Address override" },
  "cms.f.phoneOverride": { ar: "رقم مخصص", en: "Phone override" },
  "cms.f.form": { ar: "النموذج", en: "Form" },
  "cms.f.source": { ar: "المصدر", en: "Source" },
  "cms.f.pickCourses": { ar: "اختر الكورسات", en: "Pick courses" },
  "cms.f.pickSubjects": { ar: "اختر المواد", en: "Pick subjects" },
  "cms.f.pickPrograms": { ar: "اختر المراحل", en: "Pick programs" },
  "cms.f.filterCourses": { ar: "تصفية بالكورس", en: "Filter by course" },
  "cms.f.limit": { ar: "الحد الأقصى", en: "Limit" },
  "cms.f.ctaLabelOverride": { ar: "نص زر مخصص", en: "CTA label override" },
  "cms.f.kind": { ar: "النوع", en: "Kind" },
  // enums
  "cms.size.sm": { ar: "صغير", en: "Small" },
  "cms.size.md": { ar: "متوسط", en: "Medium" },
  "cms.size.lg": { ar: "كبير", en: "Large" },
  "cms.size.xl": { ar: "كبير جدًا", en: "Extra large" },
  "cms.size.body": { ar: "نص عادي", en: "Body" },
  "cms.size.lead": { ar: "نص بارز", en: "Lead" },
  "cms.size.h1": { ar: "عنوان 1", en: "Heading 1" },
  "cms.size.h2": { ar: "عنوان 2", en: "Heading 2" },
  "cms.size.h3": { ar: "عنوان 3", en: "Heading 3" },
  "cms.space.none": { ar: "بدون", en: "None" },
  "cms.space.sm": { ar: "صغير", en: "Small" },
  "cms.space.md": { ar: "متوسط", en: "Medium" },
  "cms.space.lg": { ar: "كبير", en: "Large" },
  "cms.space.xl": { ar: "كبير جدًا", en: "Extra large" },
  "cms.container.narrow": { ar: "ضيق", en: "Narrow" },
  "cms.container.normal": { ar: "عادي", en: "Normal" },
  "cms.container.wide": { ar: "عريض", en: "Wide" },
  "cms.container.full": { ar: "كامل العرض", en: "Full width" },
  "cms.columns.c1": { ar: "عمود واحد", en: "1 column" },
  "cms.columns.c2": { ar: "عمودان", en: "2 columns" },
  "cms.columns.c3": { ar: "٣ أعمدة", en: "3 columns" },
  "cms.columns.c4": { ar: "٤ أعمدة", en: "4 columns" },
  "cms.bg.default": { ar: "افتراضية", en: "Default" },
  "cms.bg.surface": { ar: "سطح", en: "Surface" },
  "cms.bg.muted": { ar: "رمادية", en: "Muted" },
  "cms.bg.brand": { ar: "بلون العلامة", en: "Brand" },
  "cms.bg.dark": { ar: "داكنة", en: "Dark" },
  "cms.bg.image": { ar: "صورة", en: "Image" },
  "cms.variant.primary": { ar: "أساسي", en: "Primary" },
  "cms.variant.secondary": { ar: "ثانوي", en: "Secondary" },
  "cms.variant.outline": { ar: "محيط", en: "Outline" },
  "cms.variant.ghost": { ar: "شفاف", en: "Ghost" },
  "cms.variant.line": { ar: "خط", en: "Line" },
  "cms.variant.gradient": { ar: "تدرج", en: "Gradient" },
  "cms.variant.dots": { ar: "نقاط", en: "Dots" },
  "cms.tone.info": { ar: "معلومة", en: "Info" },
  "cms.tone.success": { ar: "نجاح", en: "Success" },
  "cms.tone.warning": { ar: "تحذير", en: "Warning" },
  "cms.tone.brand": { ar: "العلامة", en: "Brand" },
  "cms.fit.cover": { ar: "تغطية", en: "Cover" },
  "cms.fit.contain": { ar: "احتواء", en: "Contain" },
  "cms.aspect.auto": { ar: "تلقائي", en: "Auto" },
  "cms.aspect.16x9": { ar: "١٦:٩", en: "16:9" },
  "cms.aspect.4x3": { ar: "٤:٣", en: "4:3" },
  "cms.aspect.1x1": { ar: "١:١", en: "1:1" },
  "cms.aspect.3x4": { ar: "٣:٤", en: "3:4" },
  "cms.style.pricing": { ar: "أسعار", en: "Pricing" },
  "cms.style.package": { ar: "باقات", en: "Packages" },
  "cms.style.icons": { ar: "أيقونات", en: "Icons" },
  "cms.style.buttons": { ar: "أزرار", en: "Buttons" },
  "cms.style.button": { ar: "زر", en: "Button" },
  "cms.style.floating": { ar: "عائم", en: "Floating" },
  "cms.source.featured": { ar: "المميزة", en: "Featured" },
  "cms.source.latest": { ar: "الأحدث", en: "Latest" },
  "cms.source.manual": { ar: "اختيار يدوي", en: "Manual pick" },
  "cms.source.all": { ar: "الكل", en: "All" },
  "cms.kind.courses": { ar: "كورسات", en: "Courses" },
  "cms.kind.subjects": { ar: "مواد", en: "Subjects" },
  "cms.kind.programs": { ar: "مراحل", en: "Programs" },
  "cms.social.whatsapp": { ar: "واتساب", en: "WhatsApp" },
  "cms.social.telegram": { ar: "تليجرام", en: "Telegram" },
  "cms.social.facebook": { ar: "فيسبوك", en: "Facebook" },
  "cms.social.youtube": { ar: "يوتيوب", en: "YouTube" },
  "cms.social.instagram": { ar: "إنستجرام", en: "Instagram" },
  "cms.social.tiktok": { ar: "تيك توك", en: "TikTok" },
  "cms.social.twitter": { ar: "إكس/تويتر", en: "X / Twitter" },
  "cms.social.linkedin": { ar: "لينكدإن", en: "LinkedIn" },
  "cms.color.default": { ar: "افتراضي", en: "Default" },
  "cms.color.brand": { ar: "العلامة", en: "Brand" },
  "cms.color.accent": { ar: "المميز", en: "Accent" },
  "cms.color.success": { ar: "نجاح", en: "Success" },
  "cms.color.warning": { ar: "تحذير", en: "Warning" },
  "cms.color.error": { ar: "خطأ", en: "Error" },
  "cms.color.muted": { ar: "باهت", en: "Muted" },
  "cms.seo.title": { ar: "عنوان SEO", en: "SEO title" },
  "cms.seo.description": { ar: "وصف SEO", en: "Meta description" },
  "cms.seo.canonical": { ar: "الرابط القانوني", en: "Canonical URL" },
  "cms.seo.ogTitle": { ar: "عنوان المشاركة", en: "OG title" },
  "cms.seo.ogDescription": { ar: "وصف المشاركة", en: "OG description" },
  "cms.seo.ogImage": { ar: "صورة المشاركة", en: "OG image" },
  "cms.seo.robots": { ar: "محركات البحث", en: "Robots" },
  "cms.robots.index_follow": { ar: "فهرسة ومتابعة", en: "index, follow" },
  "cms.robots.noindex_follow": { ar: "بدون فهرسة", en: "noindex, follow" },
  "cms.robots.noindex_nofollow": { ar: "بدون فهرسة أو متابعة", en: "noindex, nofollow" },
  "cms.robots.index_nofollow": { ar: "فهرسة بدون متابعة", en: "index, nofollow" },
  "cms.group.layout": { ar: "تخطيط", en: "Layout" },
  "cms.group.content": { ar: "محتوى", en: "Content" },
  "cms.group.media": { ar: "وسائط", en: "Media" },
  "cms.group.cta": { ar: "دعوة لإجراء", en: "Calls to action" },
  "cms.group.data": { ar: "بيانات المنصة", en: "Platform data" },
  "cms.group.form": { ar: "نماذج", en: "Forms" },
  "cms.group.social": { ar: "تواصل", en: "Social & contact" },
  "cms.ui.fieldName": { ar: "اسم الحقل (إنجليزي صغير)", en: "Field name (lowercase)" },
  "cms.ui.fieldType": { ar: "نوع الحقل", en: "Field type" },
  "cms.ui.required": { ar: "مطلوب", en: "Required" },
  "cms.ui.enabled": { ar: "مفعّل", en: "Enabled" },
  "cms.ui.placeholder": { ar: "نص المثال", en: "Placeholder" },
  "cms.ui.helpText": { ar: "نص المساعدة", en: "Help text" },
  "cms.ui.optionsJson": { ar: "الخيارات (JSON)", en: "Options (JSON)" },
  "cms.ui.optionsHint": { ar: '[{"value":"x","labelAr":"…","labelEn":"…"}]', en: '[{"value":"x","labelAr":"…","labelEn":"…"}]' },
  "cms.ui.validationJson": { ar: "قواعد التحقق (JSON)", en: "Validation rules (JSON)" },
  "cms.ui.validationHint": { ar: '{"minLen":2,"maxLen":500}', en: '{"minLen":2,"maxLen":500}' },
  "cms.ui.defaultValue": { ar: "القيمة الافتراضية", en: "Default value" },
  "cms.ui.consentRequired": { ar: "يتطلب موافقة", en: "Requires consent" },
  "cms.ui.consentText": { ar: "نص الموافقة", en: "Consent text" },
  "cms.ui.storeSubmissions": { ar: "حفظ الطلبات", en: "Store submissions" },
  "cms.ui.formStatus": { ar: "حالة النموذج", en: "Form status" },
  "cms.ui.actionType": { ar: "نوع الاستخدام", en: "Purpose" },
  "cms.ui.successMsg": { ar: "رسالة النجاح", en: "Success message" },
  "cms.ui.failureMsg": { ar: "رسالة الفشل", en: "Failure message" },
  "cms.ui.noFields": { ar: "لا توجد حقول — أضف أول حقل.", en: "No fields yet — add the first one." },
  "cms.ui.noSubmissions": { ar: "لا توجد طلبات مستلمة بعد.", en: "No submissions yet." },
  "cms.ui.formSettings": { ar: "إعدادات النموذج", en: "Form settings" },
  "cms.ui.badJson": { ar: "JSON غير صالح", en: "Invalid JSON" },
  "cms.set.shortName": { ar: "الاسم المختصر", en: "Short name" },
  "cms.set.ownerName": { ar: "اسم المدرب/المالك", en: "Owner name" },
  "cms.set.ownerTitle": { ar: "الوصف الوظيفي للمالك", en: "Owner title" },
  "cms.set.ownerPhoto": { ar: "صورة المالك", en: "Owner photo" },
  "cms.set.logo": { ar: "الشعار (Logo)", en: "Logo" },
  "cms.set.favicon": { ar: "أيقونة المتصفح (Favicon)", en: "Favicon" },
  "cms.set.heroImage": { ar: "صورة الواجهة", en: "Hero image" },
  "cms.set.aboutImage": { ar: "صورة (عن المنصة)", en: "About image" },
  "cms.set.contactPhone": { ar: "هاتف التواصل", en: "Contact phone" },
  "cms.set.contactEmail": { ar: "بريد التواصل", en: "Contact email" },
  "cms.set.contactAddress": { ar: "العنوان", en: "Address" },
  "cms.set.copyright": { ar: "حقوق النشر", en: "Copyright" },
  "cms.set.primary": { ar: "اللون الأساسي", en: "Primary color" },
  "cms.set.secondary": { ar: "اللون الثانوي", en: "Secondary color" },
  "cms.set.accent": { ar: "لون التمييز", en: "Accent color" },
  "cms.set.background": { ar: "لون الخلفية", en: "Background" },
  "cms.set.surface": { ar: "لون الأسطح", en: "Surface" },
  "cms.set.text": { ar: "لون النص", en: "Text color" },
  "cms.set.mutedText": { ar: "لون النص الثانوي", en: "Muted text" },
  "cms.set.border": { ar: "لون الحدود", en: "Border color" },
  "cms.set.success": { ar: "لون النجاح", en: "Success color" },
  "cms.set.warning": { ar: "لون التحذير", en: "Warning color" },
  "cms.set.error": { ar: "لون الخطأ", en: "Error color" },
  "cms.set.radiusBase": { ar: "استدارة الأساس (px)", en: "Base radius (px)" },
  "cms.set.radiusButton": { ar: "استدارة الأزرار (px)", en: "Button radius (px)" },
  "cms.set.radiusCard": { ar: "استدارة البطاقات (px)", en: "Card radius (px)" },
  "cms.set.shadow": { ar: "الظل", en: "Shadow" },
  "cms.set.density": { ar: "الكثافة", en: "Density" },
  "cms.set.fontScale": { ar: "حجم الخط", en: "Font scale" },
  "cms.set.showImage": { ar: "إظهار الصورة", en: "Show image" },
  "cms.set.showTeacher": { ar: "إظهار اسم المدرس", en: "Show teacher" },
  "cms.set.showLessonCount": { ar: "إظهار عدد الدروس", en: "Show lesson count" },
  "cms.set.showSubject": { ar: "إظهار المادة", en: "Show subject" },
  "cms.set.showBadge": { ar: "إظهار الشارة", en: "Show badge" },
  "cms.set.showCourseCount": { ar: "إظهار عدد الكورسات", en: "Show course count" },
  "cms.set.ctaLabel": { ar: "تسمية زر الإجراء", en: "CTA label" },
  "cms.set.layout": { ar: "التخطيط", en: "Layout" },
  "cms.set.courseCard": { ar: "بطاقة الكورس", en: "Course card" },
  "cms.set.subjectCard": { ar: "بطاقة المادة", en: "Subject card" },
  "cms.set.lessonPage": { ar: "صفحة الدرس", en: "Lesson page" },
  "cms.set.showDescription": { ar: "إظهار الوصف", en: "Show description" },
  "cms.set.showAttachments": { ar: "إظهار المرفقات", en: "Show attachments" },
  "cms.set.showPrevNext": { ar: "إظهار السابق/التالي", en: "Show prev/next" },
  "cms.set.showRelated": { ar: "إظهار المحتوى المرتبط", en: "Show related" },
  "cms.set.videoBlock": { ar: "مشغل الفيديو", en: "Video player" },
  "cms.set.showPoster": { ar: "إظهار الملصق", en: "Show poster" },
  "cms.set.showTitle": { ar: "إظهار العنوان", en: "Show title" },
  "cms.set.allowSpeed": { ar: "السماح بتغيير السرعة", en: "Allow speed control" },
  "cms.set.allowFullscreen": { ar: "السماح بملء الشاشة", en: "Allow fullscreen" },
  "cms.set.welcome": { ar: "رسالة الترحيب", en: "Welcome message" },
  "cms.set.modules": { ar: "وحدات اللوحة", en: "Dashboard modules" },
  "cms.set.mod.my_courses": { ar: "كورساتي", en: "My courses" },
  "cms.set.mod.quick_actions": { ar: "إجراءات سريعة", en: "Quick actions" },
  "cms.set.mod.support": { ar: "الدعم", en: "Support" },
  "cms.set.mod.continue": { ar: "استكمل التعلم", en: "Continue learning" },
  "cms.set.mod.stats": { ar: "إحصاءات التقدم", en: "Progress stats" },
  "cms.set.colorHint": { ar: "قيم الألوان تُتحقق منها الخادم (#rrggbb) — لا يسمح بـ CSS حر.", en: "Color values are server-validated (#rrggbb) — arbitrary CSS is never accepted." },
  // --- admin chrome (builder UI strings; NOT public marketing copy) ---
  "cms.ui.pages": { ar: "الصفحات", en: "Pages" },
  "cms.ui.newPage": { ar: "صفحة جديدة", en: "New page" },
  "cms.ui.titleAr": { ar: "العنوان (عربي)", en: "Title (Arabic)" },
  "cms.ui.titleEn": { ar: "العنوان (إنجليزي)", en: "Title (English)" },
  "cms.ui.slug": { ar: "المعرّف (Slug)", en: "Slug" },
  "cms.ui.status": { ar: "الحالة", en: "Status" },
  "cms.ui.updated": { ar: "آخر تحديث", en: "Updated" },
  "cms.ui.actions": { ar: "إجراءات", en: "Actions" },
  "cms.ui.edit": { ar: "تعديل", en: "Edit" },
  "cms.ui.duplicate": { ar: "نسخ", en: "Duplicate" },
  "cms.ui.archive": { ar: "أرشفة", en: "Archive" },
  "cms.ui.unarchive": { ar: "إرجاع كمسودة", en: "Restore to draft" },
  "cms.ui.delete": { ar: "حذف", en: "Delete" },
  "cms.ui.moveUp": { ar: "أعلى", en: "Up" },
  "cms.ui.moveDown": { ar: "أسفل", en: "Down" },
  "cms.ui.publish": { ar: "نشر", en: "Publish" },
  "cms.ui.unpublish": { ar: "إلغاء النشر", en: "Unpublish" },
  "cms.ui.save": { ar: "حفظ", en: "Save" },
  "cms.ui.saveSettings": { ar: "حفظ الإعدادات", en: "Save settings" },
  "cms.ui.preview": { ar: "معاينة", en: "Preview" },
  "cms.ui.versions": { ar: "سجل النسخ", en: "Version history" },
  "cms.ui.versionNote": { ar: "ملاحظة النشر", en: "Publish note" },
  "cms.ui.restoreVersion": { ar: "استعادة", en: "Restore" },
  "cms.ui.sections": { ar: "الأقسام", en: "Sections" },
  "cms.ui.addSection": { ar: "إضافة قسم", en: "Add section" },
  "cms.ui.addBlock": { ar: "إضافة مكوّن", en: "Add block" },
  "cms.ui.blockSettings": { ar: "إعدادات المكوّن", en: "Block settings" },
  "cms.ui.sectionSettings": { ar: "إعدادات القسم", en: "Section settings" },
  "cms.ui.pageSettings": { ar: "إعدادات الصفحة", en: "Page settings" },
  "cms.ui.visible": { ar: "ظاهر", en: "Visible" },
  "cms.ui.hide": { ar: "إخفاء", en: "Hide" },
  "cms.ui.show": { ar: "إظهار", en: "Show" },
  "cms.ui.seo": { ar: "تحسين محركات البحث", en: "SEO" },
  "cms.ui.menus": { ar: "القوائم", en: "Menus" },
  "cms.ui.forms": { ar: "النماذج", en: "Forms" },
  "cms.ui.appearance": { ar: "المظهر والهوية", en: "Appearance & identity" },
  "cms.ui.menu.header": { ar: "قائمة الرأس", en: "Header menu" },
  "cms.ui.menu.footer": { ar: "قائمة التذييل", en: "Footer menu" },
  "cms.ui.menu.student": { ar: "قائمة الطالب", en: "Student menu" },
  "cms.ui.menu.legal": { ar: "الروابط القانونية", en: "Legal links" },
  "cms.ui.addItem": { ar: "إضافة عنصر", en: "Add item" },
  "cms.ui.label": { ar: "التسمية", en: "Label" },
  "cms.ui.href": { ar: "الرابط", en: "Link" },
  "cms.ui.external": { ar: "رابط خارجي", en: "External link" },
  "cms.ui.parent": { ar: "عنصر أب", en: "Parent item" },
  "cms.ui.topLevel": { ar: "مستوى أول", en: "Top level" },
  "cms.ui.submissions": { ar: "الطلبات المستلمة", en: "Submissions" },
  "cms.ui.fields": { ar: "الحقول", en: "Fields" },
  "cms.ui.addField": { ar: "إضافة حقل", en: "Add field" },
  "cms.ui.newForm": { ar: "نموذج جديد", en: "New form" },
  "cms.ui.messages": { ar: "الرسائل", en: "Messages" },
  "cms.ui.backToPages": { ar: "رجوع إلى الصفحات", en: "Back to pages" },
  "cms.ui.builder": { ar: "محرر الصفحة", en: "Page builder" },
  "cms.ui.noPages": { ar: "لا توجد صفحات بعد — أنشئ أول صفحة.", en: "No pages yet — create your first page." },
  "cms.ui.noVersions": { ar: "لم يتم النشر بعد.", en: "Not published yet." },
  "cms.ui.noSections": { ar: "لا توجد أقسام — أضف قسمًا للبدء.", en: "No sections — add one to start." },
  "cms.ui.pickBlock": { ar: "اختر نوع المكوّن", en: "Choose block type" },
  "cms.ui.addRow": { ar: "إضافة عنصر", en: "Add item" },
  "cms.ui.removeRow": { ar: "حذف", en: "Remove" },
  "cms.ui.emptyPicker": { ar: "لا توجد خيارات متاحة بعد.", en: "No options available yet." },
  "cms.ui.saved": { ar: "تم الحفظ", en: "Saved" },
  "cms.ui.published": { ar: "تم النشر", en: "Published" },
  "cms.ui.draftOnly": { ar: "مسودة (غير منشور)", en: "Draft (unpublished)" },
  "cms.ui.validationFailed": { ar: "تحقق من الحقول المطلوبة.", en: "Check the highlighted fields." },
  "cms.ui.richtextHint": { ar: "HTML بسيط مسموح: فقرات، روابط، قوائم، تنسيق. يتم تعقيمه عند الحفظ.", en: "Simple HTML allowed: paragraphs, links, lists, emphasis. Sanitized on save." },
  "cms.ui.linkHint": { ar: "رابط داخلي (/…) أو https://", en: "Internal path (/…) or https://" },
  "cms.ui.theme": { ar: "الألوان والتصميم", en: "Colors & design" },
  "cms.ui.identity": { ar: "الهوية والتواصل", en: "Identity & contact" },
  "cms.ui.presentation": { ar: "عرض المحتوى", en: "Content presentation" },
  "cms.ui.dashboardCfg": { ar: "لوحة الطالب", en: "Student dashboard" },
  "cms.ui.saveGroup": { ar: "حفظ المجموعة", en: "Save group" },
  "cms.ui.permissionDenied": { ar: "لا تملك صلاحية لهذا الإجراء.", en: "You do not have permission for this action." },
  "cms.ui.viewPage": { ar: "عرض الصفحة", en: "View page" },
  "cms.ui.homeSlugNote": { ar: "الصفحة ذات المعرّف home تظهر على الرابط /", en: "The page with slug home is served at /" },
  "cms.ui.system": { ar: "إعدادات النظام", en: "System settings" },
  "cms.ui.systemPlatform": { ar: "هوية المنصة", en: "Platform identity" },
  "cms.ui.systemVideo": { ar: "مزود الفيديو (للمسؤول الأعلى فقط)", en: "Video provider (super admin only)" },
  "cms.f.platformNameAr": { ar: "اسم المنصة (عربي)", en: "Platform name (Arabic)" },
  "cms.f.platformNameEn": { ar: "اسم المنصة (إنجليزي)", en: "Platform name (English)" },
  "cms.f.taglineAr": { ar: "الوصف المختصر (عربي)", en: "Tagline (Arabic)" },
  "cms.f.taglineEn": { ar: "الوصف المختصر (إنجليزي)", en: "Tagline (English)" },
  "cms.f.supportEmail": { ar: "بريد الدعم", en: "Support email" },
  "cms.f.supportPhone": { ar: "هاتف الدعم", en: "Support phone" },
  "cms.f.whatsapp": { ar: "رقم واتساب", en: "WhatsApp number" },
  "cms.f.maintenance": { ar: "وضع الصيانة (يظهر للزوار صفحة صيانة)", en: "Maintenance mode (visitors see a maintenance page)" },
  "cms.f.videoProvider": { ar: "المزود النشط", en: "Active provider" },
  "cms.f.playbackTtl": { ar: "مدة رمز التشغيل (ثانية، 10–60)", en: "Playback token TTL (seconds, 10–60)" },
  "cms.f.fileTtl": { ar: "مدة رابط الملف الخاص (ثانية، 30–600)", en: "Private file URL TTL (seconds, 30–600)" },
};

export function cmsLabel(key: string, locale: "ar" | "en"): string {
  const entry = CMS_LABELS[key];
  if (!entry) return key;
  return (locale === "ar" ? entry.ar : entry.en) || entry.en || entry.ar || key;
}

/** Form field types (shared client/server — the forms admin UI renders these). */
export const FORM_FIELD_TYPES = ["text", "email", "phone", "number", "textarea", "select", "multiselect", "radio", "checkbox", "date", "hidden"] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];
