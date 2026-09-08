import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Static role catalog. rank: student 1 < teacher 2 < admin 3 < super_admin 4 */
export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(), // 'student' | 'teacher' | 'admin' | 'super_admin'
  label: text("label").notNull(),
  rank: integer("rank").notNull(),
});

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(), // normalized lowercase
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    localePref: text("locale_pref").notNull().default("ar"),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
    status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
    emailVerifiedAt: integer("email_verified_at", { mode: "number" }),
    lastLoginAt: integer("last_login_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "number" }),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    index("users_role_idx").on(t.roleId),
    index("users_status_idx").on(t.status),
  ]
);

export const teacherProfiles = sqliteTable("teacher_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  bioAr: text("bio_ar"),
  bioEn: text("bio_en"),
  photoFileId: text("photo_file_id"),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

export const emailChangeTokens = sqliteTable(
  "email_change_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    newEmail: text("new_email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
    usedAt: integer("used_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("email_change_token_uq").on(t.tokenHash),
    index("email_change_user_idx").on(t.userId),
  ]
);

export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    keyHash: text("key_hash").notNull(), // sha256 of the device cookie value
    label: text("label").notNull(),
    platform: text("platform", { enum: ["ios", "android", "windows", "mac", "linux", "other"] }).notNull(),
    userAgentHash: text("user_agent_hash").notNull(),
    status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
    firstSeenAt: integer("first_seen_at", { mode: "number" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "number" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "number" }),
  },
  (t) => [
    uniqueIndex("devices_user_key_uq").on(t.userId, t.keyHash),
    index("devices_user_status_idx").on(t.userId, t.status),
  ]
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id),
    tokenHash: text("token_hash").notNull(), // sha256(pepper + token)
    ipHash: text("ip_hash"),
    userAgentHash: text("user_agent_hash"),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "number" }).notNull(),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "number" }),
    revokedReason: text("revoked_reason"),
  },
  (t) => [
    uniqueIndex("sessions_token_uq").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
    index("sessions_device_idx").on(t.deviceId),
    index("sessions_expires_idx").on(t.expiresAt),
  ]
);

export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
    usedAt: integer("used_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("password_reset_token_uq").on(t.tokenHash),
    index("password_reset_user_idx").on(t.userId),
  ]
);

export const securityEvents = sqliteTable(
  "security_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id),
    type: text("type", {
      enum: [
        "login_success",
        "login_failed",
        "logout",
        "device_added",
        "device_evicted",
        "device_limit_block",
        "device_change_limit_block",
        "device_revoked_login",
        "password_reset_requested",
        "password_reset_completed",
        "password_changed",
        "sessions_revoked_all",
        "session_revoked",
        "rate_limited",
        "permission_denied",
        "registration",
        "profile_updated",
        "email_change_requested",
        "email_changed",
      ],
    }).notNull(),
    ipHash: text("ip_hash"),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("security_events_user_idx").on(t.userId, t.createdAt),
    index("security_events_type_idx").on(t.type, t.createdAt),
  ]
);

/** Fixed-window counters. PK (bucket, window_start); swept opportunistically. */
export const rateLimitCounters = sqliteTable(
  "rate_limit_counters",
  {
    bucket: text("bucket").notNull(),
    windowStart: integer("window_start", { mode: "number" }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.windowStart] })]
);
