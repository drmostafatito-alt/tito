-- External quiz / link lesson items (owner-managed Google Forms).
--
-- `lesson_items.item_type` is plain TEXT with no CHECK constraint, so adding the
-- "link" kind needs no DDL. The link's own fields do need columns: a link has no
-- row in videos/files/exams to point at, and the owner supplies the title and
-- description in both locales.
--
-- Additive only — no data is rewritten and no existing column changes meaning.
ALTER TABLE `lesson_items` ADD `link_url` text;--> statement-breakpoint
ALTER TABLE `lesson_items` ADD `title_ar` text;--> statement-breakpoint
ALTER TABLE `lesson_items` ADD `title_en` text;--> statement-breakpoint
ALTER TABLE `lesson_items` ADD `description_ar` text;--> statement-breakpoint
ALTER TABLE `lesson_items` ADD `description_en` text;
