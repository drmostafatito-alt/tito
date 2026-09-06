import { describe, expect, it } from "vitest";
import {
  BLOCKS,
  CMS_LABELS,
  cmsLabel,
  defaultPropsFor,
  ls,
  PAGE_SLUG_RE,
  RESERVED_SLUGS,
  safeHref,
  seoSchema,
  validPageSlug,
  zodForBlock,
} from "~/cms/registry";
import { readPropsFromForm } from "~/cms/formdata";

/**
 * CMS registry unit tests (Phase 3): the registry is the single source of
 * truth for block schemas — validation, defaults, safe links, icon ids and
 * the descriptor-driven form reader must all agree.
 */

describe("block registry", () => {
  it("every block type has a label key present in CMS_LABELS", () => {
    for (const [type, def] of Object.entries(BLOCKS)) {
      expect(CMS_LABELS[def.labelKey], `${type} → ${def.labelKey}`).toBeDefined();
    }
  });

  it("defaults come from zod (empty-first: no demo values anywhere)", () => {
    const text = defaultPropsFor("text");
    expect(text).toEqual({ content: { ar: "", en: "" }, size: "body", align: "start" });
    const hero = defaultPropsFor("hero");
    expect(hero.heading).toEqual({ ar: "", en: "" });
    expect(hero.ctas).toEqual([]);
  });

  it("cmsLabel is bilingual and falls back to the key when unknown", () => {
    expect(cmsLabel("cms.blocks.hero", "en")).toBe("Hero");
    expect(cmsLabel("cms.blocks.hero", "ar")).toContain("Hero");
    expect(cmsLabel("cms.does.not.exist", "en")).toBe("cms.does.not.exist");
  });

  it("ls() resolves bilingual strings with graceful fallbacks", () => {
    expect(ls({ ar: "ع", en: "E" }, "en")).toBe("E");
    expect(ls({ ar: "ع", en: "" }, "en")).toBe("ع");
    expect(ls("plain", "ar")).toBe("plain");
    expect(ls(null, "ar")).toBe("");
  });

  it("rejects unsafe links and references (no javascript:/data:, uuid-only refs)", () => {
    expect(safeHref("https://example.com")).toBe(true);
    expect(safeHref("/courses/x")).toBe(true);
    expect(safeHref("javascript:alert(1)")).toBe(false);
    expect(safeHref("data:text/html,x")).toBe(false);
    expect(safeHref("http://example.com")).toBe(false); // http not allowed

    const buttons = zodForBlock("buttons")!;
    const bad = buttons.safeParse({ items: [{ label: { ar: "", en: "x" }, href: "javascript:alert(1)", target: "_self", variant: "primary", icon: "" }] });
    expect(bad.success).toBe(false);

    const imageBlock = zodForBlock("image")!;
    const badRef = imageBlock.safeParse({ fileId: "not-a-uuid", alt: { ar: "", en: "" }, href: "", target: "_self", fit: "cover", aspect: "auto", rounded: false });
    expect(badRef.success).toBe(false);

    const badIcon = zodForBlock("icon_feature")!.safeParse({ icon: "<svg onload=x>", size: "md", colorRole: "brand", align: "center", label: { ar: "", en: "" } });
    expect(badIcon.success).toBe(false);
  });

  it("slugs: reserved system paths are rejected, charset enforced", () => {
    expect(RESERVED_SLUGS.has("admin")).toBe(true);
    expect(validPageSlug("about")).toBe(true);
    expect(validPageSlug("admin")).toBe(false);
    expect(validPageSlug("Hello World")).toBe(false);
    expect(PAGE_SLUG_RE.test("a-b-1")).toBe(true);
  });

  it("seo schema validates robots + canonical, defaults safe", () => {
    const d = seoSchema.parse({});
    expect(d.robots).toBe("index,follow");
    expect(seoSchema.safeParse({ canonical: "http://x" }).success).toBe(false);
    expect(seoSchema.safeParse({ robots: "hacked" }).success).toBe(false);
  });

  it("hero_showcase: full premium hero round-trips, video/image are uuid refs, badges constrained", () => {
    const schema = zodForBlock("hero_showcase")!;
    const ok = schema.safeParse({
      eyebrow: { ar: "الفلسفة وعلم النفس", en: "Philosophy & Psychology" },
      heading: { ar: "أهلاً بيكم!", en: "Welcome!" },
      subtitle: { ar: "<p>مقدمة</p>", en: "<p>Intro</p>" },
      ctas: [{ label: { ar: "ابدأ", en: "Start" }, href: "/courses", target: "_self", variant: "primary", icon: "" }],
      videoLabel: { ar: "شاهد", en: "Watch" },
      videoId: "00000000-0000-4000-8000-0000000000aa",
      image: "00000000-0000-4000-8000-0000000000bb",
      imageAlt: { ar: "صورة", en: "Image" },
      badges: [{ icon: "brain", title: { ar: "ت", en: "T" }, text: { ar: "", en: "" }, position: "top-start" }],
    });
    expect(ok.success).toBe(true);

    // invalid icon id and unsafe link are rejected
    expect(schema.safeParse({ badges: [{ icon: "<svg>", title: { ar: "", en: "" }, text: { ar: "", en: "" }, position: "top-start" }] }).success).toBe(false);
    expect(schema.safeParse({ ctas: [{ label: { ar: "", en: "" }, href: "javascript:x", target: "_self", variant: "primary", icon: "" }] }).success).toBe(false);
    // videoId must be a uuid (or empty) — never an arbitrary URL
    expect(schema.safeParse({ videoId: "https://youtube.com/x" }).success).toBe(false);
  });

  it("statistics: bar/cards styles, optional per-item link, value is localized (legacy string coerced)", () => {
    const schema = zodForBlock("statistics")!;
    const fromString = schema.safeParse({ style: "bar", items: [{ value: "الفلسفة", label: { ar: "", en: "" }, icon: "book-open", href: "/courses" }] });
    expect(fromString.success).toBe(true);
    if (fromString.success) {
      const items = fromString.data.items as Array<{ value: { ar: string; en: string } }>;
      expect(items[0].value).toEqual({ ar: "الفلسفة", en: "الفلسفة" });
    }
    const bilingual = schema.safeParse({
      style: "bar",
      items: [{ value: { ar: "الفلسفة", en: "Philosophy" }, label: { ar: "كورسات", en: "Courses" }, icon: "book-open", href: "/courses" }],
    });
    expect(bilingual.success).toBe(true);
    expect(schema.safeParse({ style: "cards", items: [] }).success).toBe(true);
    expect(schema.safeParse({ style: "nonsense", items: [] }).success).toBe(false);
    expect(schema.safeParse({ style: "bar", items: [{ value: "x", label: { ar: "", en: "" }, icon: "book-open", href: "javascript:x" }] }).success).toBe(false);
  });

  it("feature_cards: per-item tint is constrained to the color-role enum", () => {
    const schema = zodForBlock("feature_cards")!;
    expect(schema.safeParse({ items: [{ icon: "brain", title: { ar: "", en: "" }, text: { ar: "", en: "" }, ctaLabel: { ar: "", en: "" }, href: "", tint: "brand" }] }).success).toBe(true);
    expect(schema.safeParse({ items: [{ icon: "brain", title: { ar: "", en: "" }, text: { ar: "", en: "" }, ctaLabel: { ar: "", en: "" }, href: "", tint: "hotpink" }] }).success).toBe(false);
  });
});

describe("readPropsFromForm (descriptor-driven form reader)", () => {
  it("round-trips every field kind and matches zod validation", () => {
    const fd = new FormData();
    fd.set("f.heading.ar", "عنوان");
    fd.set("f.heading.en", "Heading");
    fd.set("f.subheading.ar", "");
    fd.set("f.subheading.en", "");
    fd.set("f.bg", "brand");
    fd.set("f.bgImage", "");
    fd.set("f.padding", "lg");
    fd.set("f.container", "normal");
    fd.set("f.columns", "2");
    fd.set("f.gap", "md");
    fd.set("f.align", "center");
    // toggle absent → false

    const props = readPropsFromForm(fd, BLOCKS.section.fields);
    expect(props.heading).toEqual({ ar: "عنوان", en: "Heading" });
    expect(props.bg).toBe("brand");
    expect(props.columns).toBe("2");
    expect(props.hideMobile).toBe(false);
    expect(zodForBlock("section")!.safeParse(props).success).toBe(true);
  });

  it("reads repeaters via __idx, datetimes to epoch ms, refPickers to uuid arrays", () => {
    const fd = new FormData();
    fd.append("f.items.__idx", "0");
    fd.append("f.items.__idx", "1");
    fd.set("f.items[0].label.ar", "");
    fd.set("f.items[0].label.en", "A");
    fd.set("f.items[0].href", "/a");
    fd.set("f.items[0].target", "_self");
    fd.set("f.items[0].variant", "primary");
    fd.set("f.items[0].icon", "star");
    fd.set("f.items[1].label.ar", "ب");
    fd.set("f.items[1].label.en", "B");
    fd.set("f.items[1].href", "https://b.example");
    fd.set("f.items[1].target", "_blank");
    fd.set("f.items[1].variant", "ghost");
    fd.set("f.items[1].icon", "");
    fd.set("f.align", "start");
    // stackMobile checkbox on
    fd.set("f.stackMobile", "on");

    const props = readPropsFromForm(fd, BLOCKS.buttons.fields);
    const items = props.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[1].label).toEqual({ ar: "ب", en: "B" });
    expect(props.stackMobile).toBe(true);
    expect(zodForBlock("buttons")!.safeParse(props).success).toBe(true);

    const fd2 = new FormData();
    fd2.set("f.target", "2026-01-02T03:04");
    fd2.set("f.heading.ar", "");
    fd2.set("f.heading.en", "");
    for (const k of ["labelDays", "labelHours", "labelMinutes", "labelSeconds"]) {
      fd2.set(`f.${k}.ar`, "");
      fd2.set(`f.${k}.en`, "");
    }
    const cd = readPropsFromForm(fd2, BLOCKS.countdown.fields);
    expect(typeof cd.target).toBe("number");
    expect(zodForBlock("countdown")!.safeParse(cd).success).toBe(true);

    const fd3 = new FormData();
    fd3.append("f.manualIds[]", "00000000-0000-4000-8000-0000000000aa");
    fd3.append("f.manualIds[]", "not-a-uuid"); // filtered out
    fd3.set("f.heading.ar", "");
    fd3.set("f.heading.en", "");
    fd3.set("f.heading.subheading", "");
    fd3.set("f.source", "manual");
    fd3.set("f.limit", "6");
    fd3.set("f.ctaLabelOverride.ar", "");
    fd3.set("f.ctaLabelOverride.en", "");
    const cc = readPropsFromForm(fd3, BLOCKS.course_cards.fields);
    expect(cc.manualIds).toEqual(["00000000-0000-4000-8000-0000000000aa"]);
    expect(cc.limit).toBe(6);
    expect(zodForBlock("course_cards")!.safeParse(cc).success).toBe(true);
  });
});
