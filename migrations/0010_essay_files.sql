ALTER TABLE `exam_answers` ADD `file_id` text;
--> statement-breakpoint
CREATE INDEX `exam_answers_file_idx` ON `exam_answers` (`file_id`);
