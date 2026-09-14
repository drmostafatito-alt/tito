# Content Architecture Final — Tito (48 Real Lessons → Real Content Hubs)

**Date:** 2026-09-15 (Africa/Cairo)
**Branch:** arena/01a0a1a9-tito
**Base SEO SHA:** a624948ae3d7001bb5bd1bdbd0d8febe837f65f9
**Last SEO Commit:** 7ab1c3f (seo: real 48 lessons from user Keyword Universe)
**This Commit:** Content Architecture Phase — transform 48 real lessons into indexable hubs

---

## 1. ما تم بناؤه (What Built)

### 1.1 Schema & DB (future-proof, no rebuild needed)
- `server/db/schema/curriculum.ts`:
  - `curriculum_lessons` table: id, slug unique, subject, grade, term, unit, chapter, lesson (official Arabic names حرفيا من CSV), semanticRaw, semanticJson, summaryAr/En, reviewAr/En, conceptsJson, subjectSlug, gradeSlug, courseSlug, unitId, status, sortOrder, createdAt, updatedAt
  - `curriculum_contents` table: blockType enum (explanation/summary/review/concepts/glossary/resources), contentAr/En, lessonId FK, sortOrder
- Migration: `drizzle/0010_curriculum_content.sql` (generated via `drizzle-kit generate --name curriculum_content` after fixing 0008 snapshot collision)
- Manifest: `tests/integration/migrations.generated.ts` regenerated to embed 10 migrations

### 1.2 Service Layer (client-safe split)
- `server/curriculum/constants.ts` (client-safe, no .server):
  - `EXTERNAL_EXAMS_URL = "https://exams.mansa-eg.workers.dev/"` — used in components, no server import
- `server/curriculum/service.server.ts` (server-only):
  - Reads from `server/seo/realLessons.server.ts` (48 real lessons, no guessing)
  - Pure functions: `getCurriculumLessons()`, `getLessonBySlug()`, `getLessonsBySubject()`, `getLessonsByGrade()`, `getRelatedLessons()` (same unit/chapter, ≤6, no self), `groupCurriculum()` (term→unit→chapter), `groupBySubject()` (2 subjects: فلسفة ومنطق 24, علم النفس 24), `getCurriculumStats()` (total 48, subjects, grades, units, chapters, bySubject, byGrade)
  - Slugify Arabic-aware, stable (no invent)
- All functions used via dynamic `await import("~server/curriculum/service.server")` inside loaders to keep client bundle clean (no server code in client)

### 1.3 Routes (public, indexable, no redesign)
- `app/routes.ts`: added 2 routes:
  - `route("curriculum", "routes/public.curriculum.tsx")` → `/curriculum`
  - `route("curriculum/:lessonSlug", "routes/public.curriculum.$lessonSlug.tsx")` → `/curriculum/:lessonSlug`
- `app/routes/public.curriculum.tsx`:
  - Loader: groupBySubject + stats
  - Meta: title "المنهج الدراسي — د/ مصطفى تيتو", description with 48 real lessons, subjects, grades, شرح/ملخص/مراجعة/أسئلة/امتحان/فيديو/PDF
  - SEO: CollectionPage + BreadcrumbList + ItemList (20 lessons), canonical `/curriculum`, no doorway, no thin (groups show real hierarchy)
  - UX: keeps Tito identity (Card, Badge), breadcrumbs Home › Curriculum, stats grid, term→unit→chapter→lessons, internal links to subjects/grades, external exams link
- `app/routes/public.curriculum.$lessonSlug.tsx`:
  - Loader: getLessonBySlug + getRelatedLessons
  - Meta: title `${lesson} — ${subject} — ${grade} — د/ مصطفى تيتو`, description with semantic (first 5 concepts), hierarchy, شرح/ملخص/مراجعة/أسئلة/امتحان/فيديو/PDF
  - SEO: WebPage (LearningResource) + LearningResource (teaches, educationalLevel, isPartOf) + DefinedTermSet (12 concepts) + BreadcrumbList (Home › Curriculum › subject › grade › unit › lesson)
  - Content: مكان الدرس في المنهج (subject, grade, term, unit, chapter with links), مفاهيم مرتبطة (Badge from semantic), المحتوى التعليمي (شرح/ملخص/مراجعة placeholders with honest notice that real content needs source), أسئلة وامتحانات → external platform button, روابط داخلية, دروس مرتبطة (same unit), SEO info (canonical, intent mapping)
  - One strong page per lesson: شرح+ملخص+مراجعة+فيديو+PDF = same canonical, questions → external (no internal Question Bank rebuild)
- `app/routes/public.subjects.$slug.tsx` + `public.grades.$slug.tsx`:
  - Enhanced to show curriculum outline when subject/grade matches real lessons (no guessing, filter by official names)
  - Grade matching fixed to avoid false positives (strict: must contain بكالوريا or الأول or exact substring ≥4 chars)
  - Internal links to `/curriculum/:slug` hubs
  - Dynamic import for service.server to keep client bundle clean

### 1.4 SEO Inventory & Sitemap
- `server/seo/inventory.server.ts`: already included curriculum routes (index + 48 lesson hubs) as static indexable URLs (no DB dependency, from CSV)
- Sitemap: `/curriculum` + 48 `/curriculum/:slug` now part of `indexablePublicUrls()`, consumed by `/sitemap.xml` route and admin SEO dashboard
- No doorway: each lesson page has real hierarchy, semantic concepts, related lessons, internal links, honest structured data only (no fake yearly /2026/, no hidden text, no invented facts)

### 1.5 Import Pipeline (future insertion without rebuild)
- `scripts/import-curriculum.mjs`:
  - `--check`: verifies 48 lessons from `docs/seo/keyword-universe.csv` (BOM-aware, Arabic comma handling), unique names, no guessing
  - `--json`: regenerates `docs/seo/keyword-universe.json` (55K) + `server/seo/realLessons.server.ts` (REAL_LESSONS 48) from CSV حرفيا, creates `docs/seo/lesson-contents.json` template (28K) with slug → {lesson, subject, grade, summaryAr null, reviewAr null, concepts from semantic, status draft}
  - `--seed-db` placeholder for future DB seed when real شرح/ملخص/مراجعة available
  - Usage: `node scripts/import-curriculum.mjs --check` / `--json`
- `docs/seo/lesson-contents.json`: template for future real content insertion (null summary/review, concepts from semantic, status draft) — can be filled when source available without rebuild
- `docs/seo/keyword-universe.json` regenerated (55K)

### 1.6 Tests
- `tests/unit/curriculum.test.ts` (13 tests, all green):
  - 48 count, official hierarchy (subject/grade/term/unit/chapter/lesson/semantic/slug truthy), slug stability (Arabic slug معنى-التفكير...), null for unknown, groupCurriculum term→unit→chapter, groupBySubject 2 subjects, getLessonsBySubject 24 each, getLessonsByGrade 24 each, getRelatedLessons same unit/chapter ≤6 no self, stats (total 48, subjects contain فلسفة ومنطق + علم النفس, grades contain الصف الأول الثانوي + مرحلة البكالوريا المصرية, bySubject 24 each), EXTERNAL_EXAMS_URL = https://exams.mansa-eg.workers.dev/, unique slugs, subjectSlug/gradeSlug no private paths
- `tests/integration/seo-crawl.test.ts` edited:
  - Regex allows `curriculum|curriculum/.+` (public locs)
  - Added test "includes curriculum index and 48 real lesson hubs" asserting 48 hubs + known Arabic slug `معنى-التفكير-الإنساني-وتطبيقاته` present
  - 13 tests green (was 12)
- Full unit suite: 335 tests green
- SEO integration suite: 53 tests green (6 files: seo-admin, seo-batch4, seo-crawl, seo-home, seo-jsonld, seo-meta)
- Build: `npm run build` green (client 185kB entry, server 1.7MB, 10 migrations embedded)
- Typecheck: `npx tsc --noEmit` green (after fixing server/client split and implicit any)

---

## 2. Files Changed / New

### New
- `server/db/schema/curriculum.ts` — curriculum_lessons + curriculum_contents schema
- `server/curriculum/constants.ts` — client-safe EXTERNAL_EXAMS_URL
- `server/curriculum/service.server.ts` — pure curriculum service (48 lessons)
- `app/routes/public.curriculum.tsx` — curriculum index (CollectionPage)
- `app/routes/public.curriculum.$lessonSlug.tsx` — lesson hub (LearningResource)
- `drizzle/0010_curriculum_content.sql` — migration for curriculum tables
- `scripts/import-curriculum.mjs` — import pipeline (--check/--json/--seed-db)
- `docs/seo/lesson-contents.json` — template for future real شرح/ملخص/مراجعة
- `tests/unit/curriculum.test.ts` — 13 unit tests
- `docs/reports/content-architecture-audit.md` — audit from previous step
- `docs/reports/content-architecture-final.md` — this file

### Modified
- `app/routes.ts` — added curriculum routes
- `app/routes/public.grades.$slug.tsx` — curriculum outline + strict matching + dynamic import + EXTERNAL_EXAMS_URL from constants
- `app/routes/public.subjects.$slug.tsx` — same
- `drizzle/meta/0008_snapshot.json` — fixed prevId self-reference collision (was "0008-cms-customization" self, now "ebb12c58-5815-48c7-b5bf-2fd5f076caa5" = 0007 id)
- `drizzle/meta/_journal.json` + `0010_snapshot.json` — via drizzle-kit generate
- `tests/integration/migrations.generated.ts` — embedded 10 migrations
- `tests/integration/seo-crawl.test.ts` — allow curriculum routes, 48 hubs assertion
- `server/seo/realLessons.server.ts` — regenerated from CSV (48 lessons)
- `docs/seo/keyword-universe.json` — regenerated 55K
- `server/seo/inventory.server.ts` — already had curriculum (no change needed, but verified)
- `server/db/schema/index.ts` — export curriculum schema

---

## 3. كيف تم ربط الـ 48 درس

- **Keyword → Intent → Real Lesson → Real Educational Content → Internal Links → SEO**:
  - Keyword Universe (docs/seo/keyword-universe.csv, 48 rows, official Arabic names حرفيا) → parsed by import pipeline → REAL_LESSONS (server/seo/realLessons.server.ts) → service.server.ts (pure functions) → routes:
    - `/curriculum` index: groups by subject (فلسفة ومنطق, علم النفس) → term → unit → chapter → lessons (internal links to each hub)
    - `/curriculum/:lessonSlug`: one strong canonical per lesson (شرح+ملخص+مراجعة+فيديو+PDF same page), questions → external https://exams.mansa-eg.workers.dev/, no internal Question Bank
    - `/subjects/:slug` + `/grades/:slug`: when subject/grade matches real CSV (strict filter), show curriculum outline with links to lesson hubs
    - Sitemap: inventory.server.ts includes `/curriculum` + 48 `/curriculum/:slug` as indexable
    - SEO: title/meta natural (لا stuffing), canonical correct, breadcrumbs Home › Curriculum › Subject › Grade › Unit › Lesson, structured data honest (WebPage, LearningResource, DefinedTermSet, BreadcrumbList, ItemList, CollectionPage) — no fake yearly pages /2026/, no hidden text, no metadata spam, no invented facts, no fake structured data
    - Topical authority: Google يفهم مصطفى تيتو → المنصة → المادة → الصف → الوحدة → الدرس → المفاهيم (semantic keywords from CSV, concepts as Badge + DefinedTermSet)

---

## 4. ما يحتاج مصدر حقيقي

- **المحتوى التعليمي التفصيلي** (شرح الدرس، ملخص، مراجعة) غير موجود حاليًا في الـrepo — الصفحات الحالية تعمل كـ hub قوي قابل للفهرسة مع placeholders صادقة + notice أن المحتوى يحتاج مصدر من الكتاب المدرسي أو ملازم المعلم
- **كيفية الإدخال لاحقًا بدون rebuild**:
  1. املأ `docs/seo/lesson-contents.json` (لكل slug: summaryAr, reviewAr, concepts, etc.)
  2. شغل `node scripts/import-curriculum.mjs --json` لتحديث JSON/TS
  3. (اختياري) شغل `--seed-db` لإدخال curriculum_lessons + curriculum_contents في D1 (عندما يتوفر DB seed)
  4. المحتوى سيظهر تلقائيًا في `/curriculum/:slug` (شرح/ملخص/مراجعة) بدون تغيير routes أو rebuild هيكلي — فقط ملء الحقول

- **لا حاجة لـ**:
  - إنشاء 8 صفحات لكل درس (شرح/ملخص/مراجعة/فيديو/PDF منفصلة) — تم دمجها في صفحة واحدة قوية
  - إعادة بناء Question Bank داخلي — الأسئلة تبقى على المنصة الخارجية
  - صفحات وهمية /2026/ أو yearly — ممنوعة

---

## 5. Test Results

- **typecheck**: `npx tsc --noEmit` — green (0 errors)
- **build**: `npm run build` — green (client 185kB entry, server 1.7MB, 10 migrations)
- **unit**: `vitest run --config vitest.unit.config.ts` — 335 tests passed (including 13 curriculum)
- **integration SEO**: `vitest run --config vitest.integration.config.ts tests/integration/seo-*.test.ts` — 53 tests passed (6 files)
  - seo-crawl: 13 tests (includes 48 hubs + known Arabic slug)
  - seo-batch4: 10 tests (grade with no subjects honest description, no false positive curriculum count)
  - seo-admin, seo-home, seo-jsonld, seo-meta: all green
- **E2E**: not run (no E2E config for curriculum yet, but build + unit + integration green suffices per task)

---

## 6. Git

- Branch: `arena/01a0a1a9-tito`
- Base SEO SHA: `a624948ae3d7001bb5bd1bdbd0d8febe837f65f9`
- Last SEO commit: `7ab1c3f seo: real 48 lessons from user Keyword Universe (no guessing)`
- This commit: `Content Architecture Phase — 48 real lessons → indexable hubs, no doorway, no thin`
- Files: schema + service + constants + 2 routes + migration fix + import pipeline + tests + reports
- No force/reset/PR/history touch — only commit to this branch, push, verify remote SHA

---

## 7. Risks / Next Steps

### Risks
- **Migration collision fixed**: 0008_snapshot.json prevId self-reference resolved (was pointing to itself, now points to 0007 id ebb12c58...). Verified manifest embeds 10 migrations. Risk low, but if future `drizzle-kit generate` run again, ensure no new collision.
- **Client bundle**: curriculum service is server-only, but also statically imported by inventory.server.ts (server-only). We use dynamic import in loaders to avoid client bundle inclusion. Build warns INEFFECTIVE_DYNAMIC_IMPORT but it's okay (server chunk). No server code in client.
- **Grade matching**: strict logic avoids false positives for "صف فارغ" etc. If new grade titles added, may need to extend matching (e.g., "الثاني", "الثالث") — currently only handles الأول + بكالوريا. Can be extended via same pattern.
- **Content placeholders**: honest notice that real شرح/ملخص/مراجعة needs source — no thin content penalty because pages have real hierarchy, semantic, related lessons, internal links, stats. But Google may still consider them thin until real content filled — acceptable as infrastructure, not doorway.

### Next Steps
1. **Fill real content**: when textbook/teacher notes available, fill `docs/seo/lesson-contents.json` → run import pipeline → seed DB → pages become rich.
2. **Add video/PDF**: when video files or PDFs available, add to curriculum_contents (blockType resources) and link in lesson hub.
3. **Monitor SEO**: after deploy, check Search Console for /curriculum/* indexing, no doorway flag, breadcrumb rich results.
4. **No redesign**: keep Tito identity (already done).
5. **No payment touch**: InstaPay/Cash/Receipt/WhatsApp/Activation untouched (verified).
6. **External exams**: ensure https://exams.mansa-eg.workers.dev/ is live and CORS allows linking.

---

## 8. Verification Commands

```bash
node scripts/import-curriculum.mjs --check   # 48 lessons
npx tsc --noEmit
npm run build
npx vitest run --config vitest.unit.config.ts tests/unit/curriculum.test.ts
node scripts/gen-migrations-manifest.mjs
npx vitest run --config vitest.integration.config.ts tests/integration/seo-crawl.test.ts
npx vitest run --config vitest.integration.config.ts tests/integration/seo-*.test.ts
git log --oneline -3
git push origin arena/01a0a1a9-tito
git ls-remote origin arena/01a0a1a9-tito
```
