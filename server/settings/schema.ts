import { z } from "zod";

export const localeCodeSchema = z.enum(["ar", "en"]);
export type LocaleCode = z.infer<typeof localeCodeSchema>;

export const platformSettingsSchema = z.object({
  nameAr: z.string().min(1).max(120).default("منصة إيدوكور"),
  nameEn: z.string().min(1).max(120).default("EduCore"),
  taglineAr: z.string().max(200).default("تعلم بثقة — من مرحلة إلى مرحلة"),
  taglineEn: z.string().max(200).default("Learn with confidence"),
  maintenance: z.boolean().default(false),
  supportEmail: z.string().email().nullish().default(null),
  supportPhone: z.string().max(32).nullish().default(null),
  whatsapp: z.string().max(32).nullish().default(null),
});
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export const localeSettingsSchema = z.object({
  default: localeCodeSchema.default("ar"),
  enabled: z.array(localeCodeSchema).default(["ar", "en"]),
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
    })
    .default({ loginPerMinute: 10, registerPerHour: 5, forgotPerHour: 5 }),
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
});
export type VideoSettings = z.infer<typeof videoSettingsSchema>;

export const settingsGroupSchemas = {
  platform: platformSettingsSchema,
  locale: localeSettingsSchema,
  devices: deviceSettingsSchema,
  security: securitySettingsSchema,
  video: videoSettingsSchema,
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
];
