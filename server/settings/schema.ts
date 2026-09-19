import { z } from "zod";

export const localeCodeSchema = z.enum(["ar", "en"]);
export type LocaleCode = z.infer<typeof localeCodeSchema>;

/**
 * External platform URL field. Empty string = "not configured" (the entry is
 * hidden). Any non-empty value MUST be a well-formed https URL — this is the
 * write-side validation for admin-pasted external links; rendering code also
 * re-validates (see app/lib/question-platform.ts) so a malformed value can never
 * become a clickable href. javascript:/data:/vbscript:/protocol-relative values
 * are rejected here, fail-closed.
 */
function isAbsoluteHttpsUrl(value: string): boolean {
  if (value === "") return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const externalHttpsUrlOrEmpty = z
  .string()
  .max(500)
  .refine(isAbsoluteHttpsUrl, "must be an https URL")
  .default("");

export const platformSettingsSchema = z.object({
  nameAr: z.string().min(1).max(120).default("د/ مصطفى تيتو"),
  nameEn: z.string().min(1).max(120).default("Dr mostafa tito"),
  taglineAr: z.string().max(200).default("الفلسفة وعلم النفس"),
  taglineEn: z.string().max(200).default("Philosophy & Psychology"),
  maintenance: z.boolean().default(false),
  supportEmail: z.string().email().nullish().default(null),
  supportPhone: z.string().max(32).nullish().default(null),
  whatsapp: z.string().max(32).nullish().default(null),
  /**
   * Show a floating WhatsApp button on the PUBLIC HOMEPAGE ONLY. Deliberately
   * scoped to the homepage: a fixed overlay would cover video controls, exam
   * questions and forms on course/lesson/exam pages.
   */
  whatsappFloating: z.boolean().default(false),
  /** Optional pre-filled first message for the floating button's wa.me link. */
  whatsappMessage: z.string().max(300).default(""),
  /**
   * EXTERNAL Questions & Exams Platform (the internal question bank/exams were
   * retired in favour of a standalone platform). When enabled AND the URL is a
   * valid https link, students see a clearly-labelled external entry point;
   * when disabled or unconfigured the entry is hidden entirely.
   */
  questionPlatformEnabled: z.boolean().default(false),
  questionPlatformUrl: externalHttpsUrlOrEmpty,
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
  // Owner-friendly defaults: a learner (or the owner testing around) commonly
  // uses phone + laptop + preview browser. Hitting the cap evicts the OLDEST
  // device instead of hard-blocking the login (ADR-005 policy stays tunable).
  maxPerStudent: z.number().int().min(1).max(10).default(3),
  onLimit: z.enum(["block", "replace_oldest"]).default("replace_oldest"),
  /** 0 = unlimited device changes */
  changeLimitPer30d: z.number().int().min(0).max(100).default(0),
});
export type DeviceSettings = z.infer<typeof deviceSettingsSchema>;

export const securitySettingsSchema = z.object({
  sessionDays: z.number().int().min(1).max(90).default(30),
  /** Short, bounded bearer-token lifetime. */
  resetTokenMinutes: z.number().int().min(10).max(30).default(30),
  rateLimits: z
    .object({
      loginPerMinute: z.number().int().min(1).max(100).default(10),
      registerPerHour: z.number().int().min(1).max(50).default(5),
      /** Per source IP, while forgotPerAccountHour also stops distributed abuse. */
      forgotPerHour: z.number().int().min(1).max(20).default(5),
      forgotPerAccountHour: z.number().int().min(1).max(10).default(3),
      /** Combined exchange + password submissions per IP and token digest. */
      resetAttemptsPer15Minutes: z.number().int().min(2).max(30).default(10),
      /** Keep reset traffic below Resend Free's 100-email daily ceiling. */
      resetEmailsPerDay: z.number().int().min(1).max(90).default(80),
      emailChangePerHour: z.number().int().min(1).max(20).default(5),
    })
    .default({
      loginPerMinute: 10,
      registerPerHour: 5,
      forgotPerHour: 5,
      forgotPerAccountHour: 3,
      resetAttemptsPer15Minutes: 10,
      resetEmailsPerDay: 80,
      emailChangePerHour: 5,
    }),
});
export type SecuritySettings = z.infer<typeof securitySettingsSchema>;

/** Phase 2 — video pipeline (provider selection + policy knobs, admin-controlled). */
export const videoSettingsSchema = z.object({
  /** Active adapter — switching providers never touches business logic (ADR-006). */
  provider: z.enum(["mock", "mux"]).default("mock"),
  /** Minimum signed-playback viewing window in seconds. */
  // Mux validates every HLS segment after start, so this is a viewing-window
  // floor rather than a seconds-long handshake token. Service code also ensures
  // duration + 30 minutes and caps the final value at 24 hours.
  playbackTokenTtlSeconds: z.number().int().min(1_800).max(86_400).default(3_600),
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

/**
 * Phase 6 — commerce/payments knobs (PAYMENTS.md §3 manual rail; FEATURE-SPEC §7).
 *
 * MANUAL PAYMENT ONLY. No gateway (Paymob/Fawry/Stripe/…) is wired here or
 * anywhere else in this codebase.
 *
 * Every destination/account value is OWNER DATA entered in Admin → Appearance →
 * Payments. Nothing is seeded, defaulted or hardcoded: an unconfigured method is
 * treated as "does not exist" and is never shown to a student (see
 * `server/commerce/payment-methods.ts`).
 */
export const PAYMENT_METHOD_KEYS = ["instapay", "vodafone_cash", "etisalat_cash", "bank_transfer", "other"] as const;
export type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];

export const paymentMethodSchema = z.object({
  /** stable row id (uuid) — the value stored on `payments.method` */
  id: z.string().max(40).default(""),
  key: z.enum(PAYMENT_METHOD_KEYS).default("other"),
  /** master switch: a disabled method is invisible everywhere publicly */
  enabled: z.boolean().default(false),
  labelAr: z.string().max(80).default(""),
  labelEn: z.string().max(80).default(""),
  /**
   * Where the student sends the money (InstaPay handle, wallet number, IBAN…).
   * Empty = NOT CONFIGURED ⇒ the method is hidden, even when `enabled`.
   * Deliberately a free-form string: the owner's real destination is unknown to
   * the codebase and must never be guessed or placeholdered.
   */
  destination: z.string().trim().max(160).default(""),
  /** account holder name shown next to the destination so the student verifies it */
  accountNameAr: z.string().max(160).default(""),
  accountNameEn: z.string().max(160).default(""),
  /** per-method instructions ("حوّل المبلغ ثم أرسل الإيصال على واتساب …") */
  instructionsAr: z.string().max(2000).default(""),
  instructionsEn: z.string().max(2000).default(""),
  sortOrder: z.number().int().min(0).max(99).default(0),
});
export type PaymentMethodSetting = z.infer<typeof paymentMethodSchema>;

export const paymentsSettingsSchema = z.object({
  /** Manual rail master switch: when off, checkout refuses to create manual payments. */
  manualEnabled: z.boolean().default(true),
  /** Admin-configured transfer instructions shown on pending manual payments (bank/Instapay/wallet). */
  manualInstructionsAr: z.string().max(2000).default(""),
  manualInstructionsEn: z.string().max(2000).default(""),
  /**
   * The three rails the owner asked for (InstaPay, Vodafone Cash, Etisalat Cash)
   * plus room for a bank transfer / custom rail. All ship DISABLED and EMPTY —
   * the owner fills in real destinations in the admin panel.
   */
  methods: z.array(paymentMethodSchema).max(12).default([
    { id: "instapay", key: "instapay", enabled: false, labelAr: "إنستاباي", labelEn: "InstaPay", destination: "", accountNameAr: "", accountNameEn: "", instructionsAr: "", instructionsEn: "", sortOrder: 0 },
    { id: "vodafone_cash", key: "vodafone_cash", enabled: false, labelAr: "فودافون كاش", labelEn: "Vodafone Cash", destination: "", accountNameAr: "", accountNameEn: "", instructionsAr: "", instructionsEn: "", sortOrder: 1 },
    { id: "etisalat_cash", key: "etisalat_cash", enabled: false, labelAr: "اتصالات كاش", labelEn: "Etisalat Cash", destination: "", accountNameAr: "", accountNameEn: "", instructionsAr: "", instructionsEn: "", sortOrder: 2 },
  ]),
  /**
   * Receipt hand-off. WhatsApp is a MANUAL channel: the platform builds a
   * click-to-chat link with a structured message from real order data and the
   * student attaches the receipt inside WhatsApp. No WhatsApp API is called and
   * no receipt is ever received automatically by the system.
   */
  receiptWhatsappEnabled: z.boolean().default(true),
  /** extra owner note appended to the generated message (optional) */
  receiptNoteAr: z.string().max(600).default(""),
  receiptNoteEn: z.string().max(600).default(""),
  /** Pending (unconfirmed) orders/payments older than this are auto-expired by the sweep (PAYMENTS.md §4). */
  orderTtlMinutes: z.number().int().min(10).max(43200).default(4320),
  /** Refund window (days) after payment for admin refunds; 0 = no window limit. */
  refundWindowDays: z.number().int().min(0).max(3650).default(0),
});
export type PaymentsSettings = z.infer<typeof paymentsSettingsSchema>;

/** Phase 3 — site identity & branding (owner brief §BRANDING). File ids reference the files table (public visibility). */
const fileIdOrEmpty = z.string().max(36).refine((s) => s === "" || /^[0-9a-f-]{36}$/i.test(s), "file id must be a uuid").default("");
const httpsOrEmpty = z.string().max(500).refine(isAbsoluteHttpsUrl, "must be an https URL").default("");

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
  primary: hex("#2b518f"),
  secondary: hex("#1f3f72"),
  accent: hex("#c9932a"),
  background: hex("#f7f9fc"),
  surface: hex("#ffffff"),
  text: hex("#0f172a"),
  mutedText: hex("#5b6b80"),
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
    // Public vocabulary is «المحتوى التعليمي» (owner brief §10): the card's
    // label never sells a separate "course" product, and the destination is the
    // study surface (see server/cms/render.server.ts). Owner can still edit it.
    ctaLabelAr: z.string().max(60).default("افتح المحتوى"),
    ctaLabelEn: z.string().max(60).default("Open content"),
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
