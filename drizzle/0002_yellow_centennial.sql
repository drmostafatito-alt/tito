CREATE TABLE `blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`parent_id` text,
	`type` text NOT NULL,
	`props` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `blocks_page_idx` ON `blocks` (`page_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `blocks_parent_idx` ON `blocks` (`parent_id`);--> statement-breakpoint
CREATE TABLE `form_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`form_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`label_ar` text NOT NULL,
	`label_en` text NOT NULL,
	`placeholder_ar` text,
	`placeholder_en` text,
	`help_ar` text,
	`help_en` text,
	`required` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`options` text,
	`validation` text,
	`default_value` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_fields_form_name_idx` ON `form_fields` (`form_id`,`name`);--> statement-breakpoint
CREATE INDEX `form_fields_form_idx` ON `form_fields` (`form_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `form_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`form_id` text NOT NULL,
	`data` text NOT NULL,
	`ip_hash` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `form_submissions_form_idx` ON `form_submissions` (`form_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `forms` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`action_type` text DEFAULT 'generic' NOT NULL,
	`store_submissions` integer DEFAULT true NOT NULL,
	`success_ar` text,
	`success_en` text,
	`failure_ar` text,
	`failure_en` text,
	`consent_required` integer DEFAULT false NOT NULL,
	`consent_ar` text,
	`consent_en` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forms_slug_unique` ON `forms` (`slug`);--> statement-breakpoint
CREATE INDEX `forms_status_idx` ON `forms` (`status`);--> statement-breakpoint
CREATE TABLE `menu_items` (
	`id` text PRIMARY KEY NOT NULL,
	`menu_id` text NOT NULL,
	`parent_id` text,
	`label_ar` text NOT NULL,
	`label_en` text NOT NULL,
	`href` text NOT NULL,
	`external` integer DEFAULT false NOT NULL,
	`icon` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `menu_items_menu_idx` ON `menu_items` (`menu_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `menus` (
	`id` text PRIMARY KEY NOT NULL,
	`location` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menus_location_unique` ON `menus` (`location`);--> statement-breakpoint
CREATE TABLE `page_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`snapshot` text NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `page_versions_page_no_idx` ON `page_versions` (`page_id`,`version_no`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`seo` text,
	`published_snapshot` text,
	`published_at` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_slug_unique` ON `pages` (`slug`);--> statement-breakpoint
CREATE INDEX `pages_status_idx` ON `pages` (`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`permission` text NOT NULL,
	`granted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_permissions_pk` ON `role_permissions` (`role_id`,`permission`);