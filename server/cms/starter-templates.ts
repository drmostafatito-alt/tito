import type { PageSnapshot } from "../../app/cms/registry";

/**
 * Built-in page templates. Applying copies an independent section snapshot —
 * later edits here (or to a saved DB template) never mutate published pages.
 * Copy uses design-token roles (bg/tint) — no per-template hardcoded colors.
 */
const L = (ar: string, en: string) => ({ ar, en });
const sid = (n: string) => `starter-${n}`;

function section(id: string, props: Record<string, unknown>, children: PageSnapshot["sections"][number]["children"]): PageSnapshot["sections"][number] {
  return {
    id,
    type: "section",
    props: {
      heading: L("", ""), subheading: L("", ""), bg: "default", padding: "md",
      container: "normal", columns: "1", gap: "md", align: "start", hideMobile: false,
      ...props,
    },
    visible: true,
    children,
  };
}

function block(id: string, type: string, props: Record<string, unknown>): PageSnapshot["sections"][number]["children"][number] {
  return { id, type, props, visible: true };
}

export interface StarterTemplate {
  id: string;
  slug: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  builtin: true;
  snapshot: Pick<PageSnapshot, "v" | "sections">;
}

const LANDING: StarterTemplate = {
  id: "starter-landing",
  slug: "starter-landing",
  titleAr: "صفحة هبوط تعليمية",
  titleEn: "Educational landing",
  descriptionAr: "واجهة، شريط ثقة، مميزات، ودعوة للتسجيل — كل النصوص قابلة للتحرير.",
  descriptionEn: "Hero, trust bar, features and a register CTA — every string is editable.",
  builtin: true,
  snapshot: {
    v: 1,
    sections: [
      section(sid("h"), { padding: "none", container: "full", bg: "default" }, [
        block(sid("hero"), "hero_showcase", {
          eyebrow: L("فلسفة وعلم نفس", "Philosophy & psychology"),
          heading: L("أهلاً بيكم في منصتكم!", "Welcome to your platform"),
          subtitle: L("<p>مساحة للتعلّم الهادئ في الفلسفة وعلم النفس.</p>", "<p>A calm space to learn philosophy and psychology.</p>"),
          ctas: [
            { label: L("ابدأ التعلم", "Start learning"), href: "/register", target: "_self", variant: "primary", icon: "" },
            { label: L("تصفح الكورسات", "Browse courses"), href: "/courses", target: "_self", variant: "secondary", icon: "" },
          ],
          videoLabel: L("", ""),
          videoId: "",
          image: "",
          imageAlt: L("واجهة المنصة", "Platform hero"),
          badges: [
            { icon: "brain", title: L("علم النفس", "Psychology"), text: L("مفاهيم وتطبيق", "Concepts and practice"), position: "top-end" },
            { icon: "landmark", title: L("فلسفة", "Philosophy"), text: L("تفكير نقدي", "Critical thinking"), position: "bottom-start" },
          ],
        }),
      ]),
      section(sid("t"), { padding: "sm", container: "wide", bg: "default" }, [
        block(sid("stats"), "statistics", {
          style: "bar",
          items: [
            { value: L("", ""), label: L("كورسات منظمة", "Structured courses"), icon: "book-open", href: "/courses" },
            { value: L("", ""), label: L("اختبارات", "Exams"), icon: "check-circle", href: "/exams" },
            { value: L("", ""), label: L("شروحات واضحة", "Clear lessons"), icon: "lightbulb", href: "/courses" },
            { value: L("", ""), label: L("متابعة التقدم", "Progress tracking"), icon: "chart", href: "/register" },
          ],
        }),
      ]),
      section(sid("f"), {
        heading: L("ليه المنصة دي؟", "Why this platform?"),
        subheading: L("محتوى يمكنك تعديله من لوحة التحكم.", "Content you can edit from the admin."),
        padding: "lg", container: "wide", align: "center",
      }, [
        block(sid("cards"), "feature_cards", {
          items: [
            { icon: "brain", title: L("علم النفس", "Psychology"), text: L("مفاهيم أساسية وتطبيق يومي.", "Core concepts and daily practice."), ctaLabel: L("", ""), href: "/courses", tint: "brand" },
            { icon: "scale", title: L("تفكير نقدي", "Critical thinking"), text: L("أسئلة أوضح وتمييز للحجج.", "Clearer questions and stronger arguments."), ctaLabel: L("", ""), href: "/courses", tint: "accent" },
            { icon: "scroll", title: L("نصوص وشروح", "Texts & lessons"), text: L("شروحات مرتبة يمكنك متابعتها.", "Structured lessons you can follow."), ctaLabel: L("", ""), href: "/courses", tint: "success" },
          ],
        }),
      ]),
      section(sid("c"), { padding: "lg", container: "narrow", bg: "default", align: "center" }, [
        block(sid("reg"), "register_cta", {
          label: L("أنشئ حسابك", "Create your account"),
          sublabel: L("ابدأ من هنا — التسجيل مجاني.", "Start here — registration is free."),
        }),
      ]),
    ],
  },
};

const SIMPLE: StarterTemplate = {
  id: "starter-simple",
  slug: "starter-simple",
  titleAr: "صفحة بسيطة",
  titleEn: "Simple page",
  descriptionAr: "عنوان ونص منسّق وزر واحد — مناسب للصفحات الداخلية.",
  descriptionEn: "Heading, rich text and one button — for interior pages.",
  builtin: true,
  snapshot: {
    v: 1,
    sections: [
      section(sid("s1"), { padding: "lg", container: "narrow", align: "start" }, [
        block(sid("rt"), "rich_text", {
          html: L(
            "<h2>عنوان الصفحة</h2><p>اكتب المحتوى هنا من محرر النص المنسّق.</p>",
            "<h2>Page title</h2><p>Write the content here in the rich-text editor.</p>",
          ),
        }),
        block(sid("btn"), "buttons", {
          items: [{ label: L("العودة للرئيسية", "Back home"), href: "/", target: "_self", variant: "primary", icon: "" }],
          align: "start",
          stackMobile: true,
        }),
      ]),
    ],
  },
};

const CONTACT: StarterTemplate = {
  id: "starter-contact",
  slug: "starter-contact",
  titleAr: "تواصل معنا",
  titleEn: "Contact",
  descriptionAr: "بيانات التواصل وروابط السوشيال (من الإعدادات إن تُركت فارغة).",
  descriptionEn: "Contact details and social links (falls back to settings when empty).",
  builtin: true,
  snapshot: {
    v: 1,
    sections: [
      section(sid("ct"), {
        heading: L("تواصل معنا", "Get in touch"),
        subheading: L("يسعدنا الرد على أسئلتكم.", "We are happy to answer your questions."),
        padding: "lg", container: "narrow", align: "center",
      }, [
        block(sid("info"), "contact_info", {
          showPhone: true, showEmail: true, showAddress: true,
          addressOverride: L("", ""),
        }),
        block(sid("soc"), "social_links", {
          style: "icons",
          items: [],
        }),
      ]),
    ],
  },
};

export const STARTER_TEMPLATES: StarterTemplate[] = [LANDING, SIMPLE, CONTACT];

export function starterById(id: string): StarterTemplate | null {
  return STARTER_TEMPLATES.find((t) => t.id === id || t.slug === id) ?? null;
}
