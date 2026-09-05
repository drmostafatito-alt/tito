CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`user_id` text,
	`resource_type` text,
	`resource_id` text,
	`props` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_user_idx` ON `events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `lesson_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`completed_at` integer,
	`last_activity_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lesson_progress_student_lesson_idx` ON `lesson_progress` (`student_id`,`lesson_id`);--> statement-breakpoint
CREATE INDEX `lesson_progress_student_activity_idx` ON `lesson_progress` (`student_id`,`last_activity_at`);--> statement-breakpoint
CREATE TABLE `video_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`video_id` text NOT NULL,
	`lesson_id` text,
	`watch_count` integer DEFAULT 0 NOT NULL,
	`position_seconds` integer DEFAULT 0 NOT NULL,
	`max_position_seconds` integer DEFAULT 0 NOT NULL,
	`duration_seconds` integer,
	`completed` integer DEFAULT false NOT NULL,
	`completed_at` integer,
	`last_watched_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_progress_student_video_idx` ON `video_progress` (`student_id`,`video_id`);--> statement-breakpoint
CREATE INDEX `video_progress_student_watched_idx` ON `video_progress` (`student_id`,`last_watched_at`);--> statement-breakpoint
CREATE TABLE `video_watch_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`video_progress_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`watched_seconds` integer DEFAULT 0 NOT NULL,
	`device_id` text
);
--> statement-breakpoint
CREATE INDEX `watch_sessions_progress_idx` ON `video_watch_sessions` (`video_progress_id`,`started_at`);