CREATE TABLE `activation_code_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`note` text,
	`spec` text NOT NULL,
	`count` integer NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activation_code_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`code_id` text NOT NULL,
	`student_id` text NOT NULL,
	`entitlement_id` text,
	`created_at` integer NOT NULL,
	`ip_hash` text,
	FOREIGN KEY (`code_id`) REFERENCES `activation_codes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activation_redemptions_code_student_uidx` ON `activation_code_redemptions` (`code_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `activation_redemptions_student_idx` ON `activation_code_redemptions` (`student_id`);--> statement-breakpoint
CREATE TABLE `activation_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text,
	`code_hash` text NOT NULL,
	`prefix` text DEFAULT '' NOT NULL,
	`product_id` text,
	`entitlement_spec` text NOT NULL,
	`max_uses` integer DEFAULT 1 NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `activation_code_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activation_codes_hash_uidx` ON `activation_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `activation_codes_batch_idx` ON `activation_codes` (`batch_id`);--> statement-breakpoint
CREATE INDEX `activation_codes_status_idx` ON `activation_codes` (`status`);--> statement-breakpoint
CREATE TABLE `discount_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`prefix` text DEFAULT '' NOT NULL,
	`type` text NOT NULL,
	`value` integer NOT NULL,
	`max_uses` integer,
	`used_count` integer DEFAULT 0 NOT NULL,
	`per_user_limit` integer,
	`min_order_minor` integer,
	`applies_to` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discount_codes_hash_uidx` ON `discount_codes` (`code_hash`);--> statement-breakpoint
CREATE TABLE `discount_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`code_id` text NOT NULL,
	`order_id` text NOT NULL,
	`student_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`code_id`) REFERENCES `discount_codes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `discount_redemptions_code_student_idx` ON `discount_redemptions` (`code_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `discount_redemptions_order_idx` ON `discount_redemptions` (`order_id`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`price_plan_id` text NOT NULL,
	`title_snapshot_ar` text NOT NULL,
	`title_snapshot_en` text NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`entitlement_spec` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_items_order_idx` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_number` text NOT NULL,
	`student_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`subtotal_minor` integer NOT NULL,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`total_minor` integer NOT NULL,
	`discount_code_id` text,
	`source` text DEFAULT 'self' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_number_uidx` ON `orders` (`order_number`);--> statement-breakpoint
CREATE INDEX `orders_student_idx` ON `orders` (`student_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text,
	`provider` text NOT NULL,
	`event_type` text NOT NULL,
	`provider_event_id` text,
	`signature_valid` integer DEFAULT false NOT NULL,
	`payload` text,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	`processing_result` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_events_provider_uidx` ON `payment_events` (`provider_event_id`);--> statement-breakpoint
CREATE INDEX `payment_events_provider_idx` ON `payment_events` (`provider`,`received_at`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`provider` text DEFAULT 'manual' NOT NULL,
	`method` text,
	`amount_minor` integer NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reference` text,
	`instructions` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`paid_at` integer,
	`idempotency_key` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_idem_uidx` ON `payments` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `payments_order_idx` ON `payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `payments_provider_ref_idx` ON `payments` (`provider`,`reference`);--> statement-breakpoint
CREATE INDEX `payments_status_idx` ON `payments` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `price_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`amount_minor` integer NOT NULL,
	`kind` text DEFAULT 'one_time' NOT NULL,
	`period` text,
	`period_days` integer,
	`fixed_ends_at` integer,
	`label_ar` text,
	`label_en` text,
	`compare_at_minor` integer,
	`promo_price_minor` integer,
	`promo_starts_at` integer,
	`promo_ends_at` integer,
	`active` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `price_plans_product_idx` ON `price_plans` (`product_id`,`active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `product_items` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_items_uidx` ON `product_items` (`product_id`,`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `product_items_resource_idx` ON `product_items` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`description_ar` text DEFAULT '' NOT NULL,
	`description_en` text DEFAULT '' NOT NULL,
	`thumbnail_file_id` text,
	`active` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_uidx` ON `products` (`slug`);--> statement-breakpoint
CREATE INDEX `products_kind_active_idx` ON `products` (`kind`,`active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `refunds_payment_idx` ON `refunds` (`payment_id`);--> statement-breakpoint
CREATE TABLE `subscription_events` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`type` text NOT NULL,
	`at` integer NOT NULL,
	`by` text,
	`metadata` text,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `subscription_events_sub_idx` ON `subscription_events` (`subscription_id`,`at`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`price_plan_id` text NOT NULL,
	`plan_snapshot` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`started_at` integer,
	`current_period_start` integer,
	`current_period_end` integer,
	`expires_at` integer,
	`auto_renew` integer DEFAULT false NOT NULL,
	`cancelled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`price_plan_id`) REFERENCES `price_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `subscriptions_student_idx` ON `subscriptions` (`student_id`,`status`);--> statement-breakpoint
CREATE INDEX `subscriptions_sweep_idx` ON `subscriptions` (`status`,`current_period_end`);
--> statement-breakpoint
-- Phase 6: grant the admin role the full commerce permission set (mirrors the CMS/assessment seeds).
-- Idempotent: role_permissions_pk unique index + INSERT OR IGNORE. super_admin (rank 4) bypasses in code.
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`, `granted_at`) VALUES
  ('admin', 'commerce.read', (strftime('%s','now') * 1000)),
  ('admin', 'commerce.products', (strftime('%s','now') * 1000)),
  ('admin', 'commerce.orders', (strftime('%s','now') * 1000)),
  ('admin', 'commerce.payments', (strftime('%s','now') * 1000)),
  ('admin', 'commerce.refunds', (strftime('%s','now') * 1000)),
  ('admin', 'commerce.codes', (strftime('%s','now') * 1000)),
  ('admin', 'commerce.discounts', (strftime('%s','now') * 1000));
