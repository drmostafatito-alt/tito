CREATE TABLE `exam_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`question_id` text NOT NULL,
	`choice_ids` text,
	`text_answer` text,
	`points_earned` real,
	`is_correct` integer,
	`graded_by` text,
	`graded_at` integer,
	`feedback` text,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_answers_unique_idx` ON `exam_answers` (`attempt_id`,`question_id`);--> statement-breakpoint
CREATE INDEX `exam_answers_attempt_idx` ON `exam_answers` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `exam_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`student_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`started_at` integer NOT NULL,
	`deadline_at` integer,
	`submitted_at` integer,
	`time_used_seconds` integer,
	`score` real,
	`max_score` real,
	`passed` integer,
	`grading_status` text DEFAULT 'auto' NOT NULL,
	`random_seed` integer DEFAULT 0 NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_attempts_unique_idx` ON `exam_attempts` (`exam_id`,`student_id`,`attempt_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `exam_attempts_one_live_idx` ON `exam_attempts` (`exam_id`,`student_id`) WHERE status = 'in_progress';--> statement-breakpoint
CREATE INDEX `exam_attempts_student_idx` ON `exam_attempts` (`student_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `exam_questions` (
	`exam_id` text NOT NULL,
	`question_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`points` real DEFAULT 1 NOT NULL,
	PRIMARY KEY(`exam_id`, `question_id`)
);
--> statement-breakpoint
CREATE INDEX `exam_questions_order_idx` ON `exam_questions` (`exam_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`description_ar` text,
	`description_en` text,
	`course_id` text,
	`lesson_id` text,
	`config` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exams_slug_unique` ON `exams` (`slug`);--> statement-breakpoint
CREATE INDEX `exams_status_idx` ON `exams` (`status`);--> statement-breakpoint
CREATE INDEX `exams_lesson_idx` ON `exams` (`lesson_id`);--> statement-breakpoint
CREATE TABLE `question_choices` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`content_ar` text NOT NULL,
	`content_en` text NOT NULL,
	`is_correct` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`feedback` text
);
--> statement-breakpoint
CREATE INDEX `question_choices_q_idx` ON `question_choices` (`question_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `question_tags` (
	`question_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`question_id`, `tag_id`)
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`stem_ar` text NOT NULL,
	`stem_en` text NOT NULL,
	`explanation_ar` text,
	`explanation_en` text,
	`difficulty` text DEFAULT 'medium' NOT NULL,
	`points_default` real DEFAULT 1 NOT NULL,
	`subject_id` text,
	`course_id` text,
	`unit_id` text,
	`lesson_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text,
	`reviewed_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `questions_status_type_subject_idx` ON `questions` (`status`,`type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `questions_lesson_idx` ON `questions` (`lesson_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`label_ar` text NOT NULL,
	`label_en` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_slug_unique` ON `tags` (`slug`);

-- Phase 5: grant the admin role the assessment permission set (system config, not content).
-- Idempotent: role_permissions_pk unique index + INSERT OR IGNORE. super_admin (rank 4) bypasses in code.
INSERT OR IGNORE INTO `role_permissions` (`role_id`, `permission`, `granted_at`) VALUES
  ('admin', 'assessment.read', (strftime('%s','now') * 1000)),
  ('admin', 'assessment.create', (strftime('%s','now') * 1000)),
  ('admin', 'assessment.edit', (strftime('%s','now') * 1000)),
  ('admin', 'assessment.publish', (strftime('%s','now') * 1000)),
  ('admin', 'assessment.delete', (strftime('%s','now') * 1000)),
  ('admin', 'assessment.grade', (strftime('%s','now') * 1000));