CREATE TABLE `course_prerequisites` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`prerequisite_course_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_prerequisites_uidx` ON `course_prerequisites` (`course_id`,`prerequisite_course_id`);
--> statement-breakpoint
CREATE INDEX `course_prerequisites_course_idx` ON `course_prerequisites` (`course_id`);
--> statement-breakpoint
CREATE INDEX `course_prerequisites_prereq_idx` ON `course_prerequisites` (`prerequisite_course_id`);
