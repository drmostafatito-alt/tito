import { z } from "zod";

export const localeCodeSchema = z.enum(["ar", "en"]);
export type LocaleCode = z.infer<typeof localeCodeSchema>;

export const platformSettingsSchema = z.object({
  nameAr: z.string().min(1).max(120).default("د/ مصطفى تيتو"),
  nameEn: z.string().min(1).max(120).default("Dr mostafa tito"),
  taglineAr: z.string().max(200).default("الفلسفة وعلم النفس"),
  taglineEn: z.string().max(200).default("Philosophy & Psychology"),
  maintenance: z.boolean().default(false),
  supportEmail: z.string().email().nullish().default(null),
  supportPhone: z.string().max(32).nullish().default(null),
  whatsapp: z.string().max(32).nullish().default(null),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const localeSettingsSchema = z
  .object({
    default: localeCodeSchema.default("ar"),
    enabled: z.array(localeCodeSchema).min(1).default(["ar", "en"]),
  })
  .refine((v) => v.enabled.includes(v.default), {
    message: "the default language must also be offered to visitors",
    path: ["default"],
  });
export type LocaleSettings = z.infer<typeof localeSettingsSchema>;

export const deviceSettingsSchema = z.object({
  maxPerStudent: z.number().int().min(1).max(10).default(1),
  onLimit: z.enum(["block", "replace_oldest"]).default("block"),
  /** 0 = unlimited device changes */
  changeLimitPer30d: z.number().int().min(0).max(100).default(2),
});
export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;

export const securitySettingsSchema = z.object({
  sessionDays: z.number().int().min(1).max(90).default(30),
  resetTokenMinutes: z.number().int().min(5).max(240).default(60),
    rateLimits: z
      .object({
        loginPerMinute: z.number().int().min(1).default(10),
        registerPerHour: z.number().int().min(1).default(5),
        forgotPerHour: z.number().int().min(1).default(5),
        emailChangePerHour: z.number().int().min(1).default(5),
      })
      .default({ loginPerMinute: 10, registerPerHour: 5, forgotPerHour: 5, emailChangePerHour: 5 }),
});
export type SecuritySettings = z.infer<typeof securitySettingsSchema>;

/** Phase 2 — video pipeline (provider selection + policy knobs, admin-controlled). */
export const videoSettingsSchema = z.object({
  /** Active adapter — switching providers never touches business logic (ADR-006). */
  provider: z.enum(["mock", "mux"]).default("mock"),
  /** Playback credential TTL seconds (≤ 60 for signed playback; enforced in service). */
  playbackTokenTtlSeconds: z.number().int().min(10).max(60).default(45),
  /** Private-file signed-URL TTL seconds. */
  fileUrlTtlSeconds: z.number().int().min(30).max(600).default(120),
  /** Phase 4 — a video counts as completed at this % of its duration (FEATURE-SPEC §4, default 90). */
  completionThresholdPct: z.number().int().min(50).max(100).default(90),
  /** Phase 4 — max playback-credential mints per student+video; 0 = unlimited (replay policy, server-enforced). */
  replayLimit: z.number().int().min(0).max(1000).default(0),
});
export type VideoSettings = z.infer<typeof videoSettingsSchema>;

/** Phase 5 — assessment engine knobs (FEATURE-SPEC §6 attempt rules). */
export const assessmentSettingsSchema = z.object({
  /** Grace window (seconds) after the server deadline that absorbs network loss on submit (FEATURE-SPEC §6, default 30). */
  graceSeconds: z.number().int().min(0).max(600).default(30),
});
export type AssessmentSettings = z.infer<typeof assessmentSettingsSchema>;

/** Phase 6 — commerce/payments knobs (PAYMENTS.md §3 manual rail; FEATURE-SPEC §7). */
export const paymentsSettingsSchema = z.object({
  /** Manual rail master switch: when off, checkout refuses to create manual payments. */
  manualEnabled: z.boolean().default(true),
  /** Admin-configured transfer instructions shown on pending manual payments (bank/Instapay/wallet). */
  manualInstructionsAr: z.string().max(2000).default(""),
  manualInstructionsEn: z.string().max(2000).default(""),
  /** Pending (unconfirmed) orders/payments older than this are auto-expired by the sweep (PAYMENTS.md §4). */
  orderTtlMinutes: z.number().int().min(10).max(43200).default(4320),
  /** Refund window (days) after payment for admin refunds; 0 = no window limit. */
  refundWindowDays: z.number().int().min(0).max(3650).default(0),
});
export type PaymentsSettings = z.infer<typeof paymentsSettingsSchema>;

/** Phase 3 — site identity & branding (owner brief §BRANDING). File ids reference the files table (public visibility). */
const fileIdOrEmpty = z.string().max(36).refine((s) => s === "" || /^[0-9a-f-]{36}$/i.test(s), "file id must be a uuid").default("");
const httpsOrEmpty = z.string().max(500).refine((s) => s === "" || /^https:\/\/[^\s]+$/i.test(s), "must be an https URL").default("");

export const identitySettingsSchema = z.object({
  shortNameAr: z.string().max(40).default(""),
  shortNameEn: z.string().max(40).default(""),
  ownerNameAr: z.string().max(120).default(""),
  ownerNameEn: z.string().max(120).default(""),
  ownerTitleAr: z.string().max(120).default(""),
  ownerTitleEn: z.string().max(120).default(""),
  ownerPhotoFileId: fileIdOrEmpty,
  logoFileId: fileIdOrEmpty,
  faviconFileId: fileIdOrEmpty,
  heroImageFileId: fileIdOrEmpty,
  aboutImageFileId: fileIdOrEmpty,
  contactPhone: z.string().max(32).default(""),
  contactEmail: z.string().max(200).refine((s) => s === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s), "invalid email").default(""),
  contactAddressAr: z.string().max(300).default(""),
  contactAddressEn: z.string().max(300).default(""),
  telegram: httpsOrEmpty,
  facebook: httpsOrEmpty,
  youtube: httpsOrEmpty,
  instagram: httpsOrEmpty,
  tiktok: httpsOrEmpty,
  twitter: httpsOrEmpty,
  linkedin: httpsOrEmpty,
  copyrightAr: z.string().max(200).default(""),
  copyrightEn: z.string().max(200).default(""),
  /** Data-driven social accounts (not a closed platform list). Empty → named URL fields are used. */
  socialLinks: z.array(z.object({
    id: z.string().max(40).default(""),
    network: z.string().max(40).default("globe"),
    url: httpsOrEmpty,
    labelAr: z.string().max(80).default(""),
    labelEn: z.string().max(80).default(""),
    enabled: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(99).default(0),
    showHeader: z.boolean().default(false),
    showFooter: z.boolean().default(true),
    showHome: z.boolean().default(true),
    showContact: z.boolean().default(true),
  })).max(20).default([]),
});
export type IdentitySettings = z.infer<typeof identitySettingsSchema>;

/** Phase 3 — validated design tokens ONLY (no arbitrary CSS). Rendered to /theme.css. */
const hex = (fallback: string) => z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be #rrggbb").default(fallback);

export const themeSettingsSchema = z.object({
  primary: hex("#7c3aed"),
  secondary: hex("#4f46e5"),
  accent: hex("#6366f1"),
  background: hex("#faf8ff"),
  surface: hex("#ffffff"),
  text: hex("#0f172a"),
  mutedText: hex("#64748b"),
  border: hex("#e2e8f0"),
  success: hex("#059669"),
  warning: hex("#d97706"),
  error: hex("#e11d48"),
  radiusBase: z.number().int().min(0).max(32).default(12),
  radiusButton: z.number().int().min(0).max(32).default(16),
  radiusCard: z.number().int().min(0).max(32).default(20),
  shadow: z.enum(["none", "sm", "md", "lg"]).default("md"),
  density: z.enum(["compact", "normal", "relaxed"]).default("normal"),
  fontScale: z.enum(["compact", "normal", "large"]).default("normal"),
  headingFont: z.enum(["cairo", "ibm"]).default("cairo"),
  bodyFont: z.enum(["cairo", "ibm"]).default("cairo"),
});
export type ThemeSettings = z.infer<typeof themeSettingsSchema>;

/** Phase 3 — presentation config: HOW content data is displayed (data itself stays in content tables). */
export const presentationSettingsSchema = z.object({
  courseCard: z.object({
    showImage: z.boolean().default(true),
    showTeacher: z.boolean().default(true),
    showLessonCount: z.boolean().default(true),
    showSubject: z.boolean().default(true),
    showBadge: z.boolean().default(true),
    ctaLabelAr: z.string().max(60).default("عرض الكورس"),
    ctaLabelEn: z.string().max(60).default("View course"),
    layout: z.enum(["standard", "compact", "wide"]).default("standard"),
  }).prefault({}),
  subjectCard: z.object({
    showImage: z.boolean().default(true),
    showCourseCount: z.boolean().default(true),
    ctaLabelAr: z.string().max(60).default("عرض المادة"),
    ctaLabelEn: z.string().max(60).default("View subject"),
  }).prefault({}),
  lesson: z.object({
    showDescription: z.boolean().default(true),
    showAttachments: z.boolean().default(true),
    showPrevNext: z.boolean().default(true),
    showRelated: z.boolean().default(true),
    video: z.object({
      showPoster: z.boolean().default(true),
      showTitle: z.boolean().default(true),
      showDescription: z.boolean().default(true),
      allowSpeed: z.boolean().default(true),
      allowFullscreen: z.boolean().default(true),
    }).prefault({}),
  }).prefault({}),
});
export type PresentationSettings = z.infer<typeof presentationSettingsSchema>;

/** Phase 3 — student dashboard module configuration (only IMPLEMENTED modules are offered). */
/** Phase 4 — additive module ids (continue/stats). Existing saved arrays keep working. */
/** Phase 7 — additive module ids (announcements/expiry). Existing saved arrays keep working. */
export const DASHBOARD_MODULE_IDS = ["my_courses", "continue", "stats", "quick_actions", "support", "announcements", "expiry"] as const;
export type DashboardModuleId = (typeof DASHBOARD_MODULE_IDS)[number];

export const dashboardSettingsSchema = z.object({
  welcomeAr: z.string().max(300).default(""),
  welcomeEn: z.string().max(300).default(""),
  modules: z
    .array(z.object({ id: z.enum(DASHBOARD_MODULE_IDS), enabled: z.boolean().default(true) }))
    .default(DASHBOARD_MODULE_IDS.map((id) => ({ id, enabled: true }))),
});
export type DashboardSettings = z.infer<typeof dashboardSettingsSchema>;

export const settingsGroupSchemas = {
  platform: platformSettingsSchema,
  locale: localeSettingsSchema,
  devices: deviceSettingsSchema,
  security: securitySettingsSchema,
  video: videoSettingsSchema,
  identity: identitySettingsSchema,
  theme: themeSettingsSchema,
  presentation: presentationSettingsSchema,
  dashboard: dashboardSettingsSchema,
  assessment: assessmentSettingsSchema,
  payments: paymentsSettingsSchema,
} as const;

export type SettingsGroupName = keyof typeof settingsGroupSchemas;

export type Settings = {
  [K in SettingsGroupName]: z.infer<(typeof settingsGroupSchemas)[K]>;
};

/** Groups that only admins may write. */
export const ADMIN_ONLY_GROUPS: SettingsGroupName[] = [
  "platform",
  "locale",
  "devices",
  "security",
  "video",
  "identity",
  "theme",
  "presentation",
  "dashboard",
  "assessment",
  "payments",
];
