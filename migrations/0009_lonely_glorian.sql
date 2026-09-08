CREATE TABLE `email_change_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`new_email` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_change_token_uq` ON `email_change_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `email_change_user_idx` ON `email_change_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `course_prerequisites` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`prerequisite_course_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_prerequisites_uidx` ON `course_prerequisites` (`course_id`,`prerequisite_course_id`);--> statement-breakpoint
CREATE INDEX `course_prerequisites_course_idx` ON `course_prerequisites` (`course_id`);--> statement-breakpoint
CREATE INDEX `course_prerequisites_prereq_idx` ON `course_prerequisites` (`prerequisite_course_id`);--> statement-breakpoint
CREATE TABLE `assignment_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`student_id` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`text_answer` text,
	`file_id` text,
	`submitted_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`score` real,
	`feedback` text,
	`graded_by` text,
	`graded_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_submissions_uidx` ON `assignment_submissions` (`assignment_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `assignment_submissions_assignment_idx` ON `assignment_submissions` (`assignment_id`,`submitted_at`);--> statement-breakpoint
CREATE INDEX `assignment_submissions_student_idx` ON `assignment_submissions` (`student_id`);--> statement-breakpoint
CREATE INDEX `assignment_submissions_status_idx` ON `assignment_submissions` (`status`);--> statement-breakpoint
CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`description_ar` text,
	`description_en` text,
	`instructions_ar` text,
	`instructions_en` text,
	`course_id` text,
	`unit_id` text,
	`lesson_id` text,
	`max_score` real DEFAULT 100 NOT NULL,
	`due_at` integer,
	`allowed_submission_types` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assignments_status_idx` ON `assignments` (`status`);--> statement-breakpoint
CREATE INDEX `assignments_lesson_idx` ON `assignments` (`lesson_id`);--> statement-breakpoint
CREATE INDEX `assignments_course_idx` ON `assignments` (`course_id`);--> statement-breakpoint
ALTER TABLE `lesson_items` ADD `link_url` text;--> statement-breakpoint
ALTER TABLE `lesson_items` ADD `title_ar` text;--> statement-breakpoint
ALTER TABLE `lesson_items` ADD `title_en` text;--> statement-breakpoint
ALTER TABLE `lesson_items` ADD `description_ar` text;--> statement-breakpoint
ALTER TABLE `lesson_items` ADD `description_en` text;--> statement-breakpoint
ALTER TABLE `exam_answers` ADD `file_id` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `model_answer_ar` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `model_answer_en` text;