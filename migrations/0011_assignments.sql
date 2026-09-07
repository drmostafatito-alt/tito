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
	`max_score` real NOT NULL DEFAULT 100,
	`due_at` integer,
	`allowed_submission_types` text NOT NULL,
	`status` text NOT NULL DEFAULT 'draft',
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assignment_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`student_id` text NOT NULL,
	`status` text NOT NULL DEFAULT 'submitted',
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
CREATE INDEX `assignments_status_idx` ON `assignments` (`status`);
--> statement-breakpoint
CREATE INDEX `assignments_lesson_idx` ON `assignments` (`lesson_id`);
--> statement-breakpoint
CREATE INDEX `assignments_course_idx` ON `assignments` (`course_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_submissions_uidx` ON `assignment_submissions` (`assignment_id`, `student_id`);
--> statement-breakpoint
CREATE INDEX `assignment_submissions_assignment_idx` ON `assignment_submissions` (`assignment_id`, `submitted_at`);
--> statement-breakpoint
CREATE INDEX `assignment_submissions_student_idx` ON `assignment_submissions` (`student_id`);
--> statement-breakpoint
CREATE INDEX `assignment_submissions_status_idx` ON `assignment_submissions` (`status`);
