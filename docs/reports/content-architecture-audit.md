# Content Architecture Audit — Tito (48 Real Lessons)

**Date:** 2026-09-15
**Branch:** arena/01a0a1a9-tito
**Base SEO SHA:** a624948ae3d7001bb5bd1bdbd0d8febe837f65f9
**Last SEO Content Map Commit:** 7ab1c3f
**Real Lessons:** 48 (24 فلسفة ومنطق + 24 علم نفس)

---

## 1. Routes الحالية (Public)

| Route | File | Purpose | Indexable | Content Source |
|-------|------|---------|-----------|----------------|
| `/` | public/home.tsx | Homepage | yes | CMS pages + catalog |
| `/programs` | public.programs.tsx | Programs list | yes if published programs exist | DB programs |
| `/programs/:slug` | public.programs.$slug.tsx | Program → grades | yes | DB |
| `/grades/:slug` | public.grades.$slug.tsx | Grade → subjects + curriculum outline | yes | DB + realLessons semantic |
| `/subjects/:slug` | public.subjects.$slug.tsx | Subject → courses + semantic | yes | DB + semanticKeywords |
| `/courses` | public.courses.tsx | Courses catalog | yes if catalog has courses | catalogCourses() |
| `/courses/:slug` | public.courses.$slug.tsx | Course → units → lessons (with progress) | yes | DB course + units + lessons |
| `/courses/:slug/units/:unitId` | public.courses.$slug.units.$unitId.tsx | Unit → lessons list | yes (lesson discovery) | DB unit + lessons |
| `/learn/:courseSlug/:lessonSlug` | learn.$courseSlug.$lessonSlug.tsx | Lesson content (video/file/link) | **noindex** (private, per-user) | DB lesson + lesson_items |
| `/p/:slug` | p.$slug.tsx | CMS pages | yes | DB pages |
| `/about` | public/about.tsx | Person + Organization | yes if owner identity set | settings.identity |
| `/sitemap.xml` | sitemap[.]xml.tsx | Sitemap | yes | indexablePublicUrls() |
| `/robots.txt` | robots[.]txt.tsx | Robots | yes | ROBOTS_PRIVATE_PATHS |

**No dedicated curriculum or lesson hub route exists yet for the 48 real lessons.**

---

## 2. نظام courses / units / lessons الحالي

**Schema (server/db/schema/content.ts):**
- `programs`: id, slug, titleAr/En, descriptionAr/En, status, sortOrder
- `grades`: id, programId, slug, titleAr/En, status, sortOrder
- `subjects`: id, gradeId, slug, titleAr/En, descriptionAr/En, thumbnailFileId, status, sortOrder
- `courses`: id, subjectId, teacherId, slug, titleAr/En, descriptionAr/En, thumbnailFileId, accessLevel, status, visibility (hidden/catalog/featured), sortOrder, publishAt/expiresAt
- `units`: id, courseId, titleAr/En, status, sortOrder
- `lessons`: id, unitId, slug, titleAr/En, descriptionAr/En, accessLevel, freePreview, status, sortOrder, publishAt/expiresAt
- `lesson_items`: id, lessonId, itemType (video/file/exam/link), videoId, fileId, examId, linkUrl, titleAr/En, descriptionAr/En, sortOrder, required
- `videos`, `files`: provider assets

**Content Service (server/content/service.server.ts):**
- CRUD with app-enforced referential integrity (no DB FKs)
- `catalogCourses()` — public catalog: published, visible catalog/featured, publish window, ancestors published
- `allLessonsForCourse()`, `unitsForCourse()`, `lessonsForUnit()`, `itemsForLesson()`
- Slugify Arabic-aware, unique with -2 suffix

**Current Content Storage:**
- Lesson educational content = `descriptionAr/En` (max 4000 chars) + `lesson_items` (video/file/link)
- No dedicated fields for: summary, review, concepts, glossary, related lessons, term/part, chapter
- No curriculum-level table for fixed 48 lessons

**What exists in repo:**
- No real educational content for the 48 lessons beyond titles + semantic keywords from CSV
- No summary, review, شرح مفصل — only titles and semantic keywords

---

## 3. SEO Metadata الموجود

**Per-page SEO (app/cms/seo.ts, jsonld.ts):**
- `contentSeoMeta()`: title, description, canonical, OG, robots
- `siteEntitiesMeta()`: Organization + Person + WebSite (from settings)
- `courseJsonLd()`: Course with hasPart (units), teaches (semantic), educationalLevel (grade), inLanguage
- `learningResourceJsonLd()`: Unit/Lesson as LearningResource
- `definedTermSetJsonLd()`: Semantic keywords as DefinedTermSet
- `breadcrumbJsonLd()`: Full chain Home→Programs→Grade→Subject→Course→Unit
- `webPageJsonLd()`: CollectionPage with educationalLevel

**Current Pages:**
- Course page: Breadcrumb 6 items, Course JSON-LD with hasPart + teaches + educationalLevel, DefinedTermSet
- Unit page: Breadcrumb 7 items, LearningResource + DefinedTermSet + Course hasPart lessons
- Subject page: teaches + educationalLevel + DefinedTermSet
- Grade page: educationalLevel + DefinedTermSet
- Lesson page (`/learn/...`): noindex, branded title + canonical (for preview), no structured data (private)

**Inventory (server/seo/inventory.server.ts):**
- `indexablePublicUrls()`: single source of truth for sitemap
- Includes: /, /programs, /programs/:slug, /grades/:slug, /subjects/:slug (if has courses), /courses, /courses/:slug, /courses/:slug/units/:unitId, /products/:slug, /p/:slug, /about (if owner set)
- Excludes: /learn/, /admin/, /dashboard, etc. (ROBOTS_PRIVATE_PATHS)
- Anti-thin: subject only if has courses, etc.

**Canonical Map (server/seo/canonicalMap.server.ts):**
- 16 intents, one strong URL per intent, no duplicate keywords, year in metadata only

**Real Lessons (server/seo/realLessons.server.ts + realKeywordClusters.server.ts):**
- 48 real lessons from CSV, 384 clusters (8 per lesson), subject/grade clusters
- Mapped to: courseUrl, unitUrl, subjectUrl, gradeUrl (slugified patterns)
- Search formulas: شرح، ملخص، مراجعة، أسئلة، امتحان، تدريبات، حل أسئلة، فيديو شرح، PDF + brand + year

---

## 4. الـ48 Lesson Map والـ384 Clusters

**Source:** `docs/seo/keyword-universe.csv` (48 rows)
- Columns: المادة, الصف/المرحلة, الترم, الوحدة, القسم, اسم الدرس/الموضوع, الكلمات الدلالية
- 24 فلسفة ومنطق — الصف الأول الثانوي — الترم الأول (9) + الترم الثاني (15)
- 24 علم نفس — مرحلة البكالوريا المصرية — الجزء الأول (12) + الجزء الثاني (12)

**Example:**
- معنى التفكير الإنساني وتطبيقاته | فلسفة ومنطق | الصف الأول الثانوي | الترم الأول | الوحدة الأولى: الفلسفة | الفصل الأول: التفكير الإنساني | semantic: معنى التفكير الإنساني، التفكير الإنساني...
- من الفلسفة إلى المعمل: كيف نشأ علم النفس؟ | علم النفس | مرحلة البكالوريا المصرية | الجزء الأول | الوحدة الأولى: علم النفس؛ مفتاح نفسك والآخرين | الوحدة الأولى | semantic: علم النفس، نشأة علم النفس...

**Clusters (realKeywordClusters.server.ts):**
- Per lesson: discovery (unit), explanation, summary, revision, questions, video, pdf, academic_year
- All map to courseUrl except discovery → unitUrl
- Questions → external platform https://exams.mansa-eg.workers.dev/ (Tito entry point = course page)
- No doorway, no year in URL, one canonical per intent

**Current Limitation:**
- Clusters are Keyword→URL mapping, not Keyword→Real Educational Content
- No real شرح/ملخص/مراجعة content exists in repo — only titles + semantic keywords
- Cannot build full lesson pages with educational content without inventing

---

## 5. ما الذي يمكن تنفيذه الآن (Content الموجود)

**Can do now (safe, no inventing):**
1. **Curriculum Index Page** (`/curriculum`): lists 48 real lessons grouped by subject→grade→term→unit→chapter, with internal links to existing subject/grade pages, semantic keywords as chips, related lessons. Not thin — provides curriculum navigation value. Indexable.
2. **Lesson Hub Page** (`/curriculum/:lessonSlug`): one strong page per real lesson (48 pages) that shows: official name, subject, grade, term, unit, chapter, semantic keywords (DefinedTermSet), related lessons in same unit/chapter, breadcrumbs (Home→Curriculum→Subject→Grade→Unit→Lesson), internal links to subject/grade, link to external exams platform for questions. No invented educational content — only metadata from CSV + internal linking. Honest structured data: LearningResource + BreadcrumbList + DefinedTermSet. This serves all intents (شرح+ملخص+مراجعة+فيديو+PDF) as one strong page, per requirement "يمكن أن تخدمها صفحة محتوى قوية واحدة".
   - **Risk:** Could be considered thin if only metadata. Mitigation: include rich internal linking, semantic keywords, related lessons, hierarchy context, and clear statement that educational content will be added via import pipeline. Must have enough value to avoid thin.
3. **Enhance Subject Pages**: show curriculum outline for that subject from real lessons (e.g., for فلسفة ومنطق — الصف الأول الثانوي, list all 24 lessons grouped by term/unit/chapter with links to lesson hubs)
4. **Enhance Grade Pages**: show curriculum outline for that grade
5. **Design Content Schema**: new table or JSON structure for future real content (summary, review, concepts, etc.) that can be imported without rebuilding
6. **Import Pipeline**: script that reads CSV and can populate curriculum table or enhance existing courses/units/lessons when content becomes available

**Cannot do now (needs source content):**
- Actual شرح، ملخص، مراجعة text for each lesson (requires real curriculum books or teacher content)
- Video شرح, PDF مذكرة (requires files)
- Detailed concepts definitions, glossary
- Exercises with answers (beyond external platform link)

**Best way to insert 48 lessons later without rebuilding:**
- Option A: New table `curriculum_lessons` with fields: id, slug, subject, grade, term, unit, chapter, lesson (official), semanticKeywords (JSON), summaryAr/En (nullable, for future), reviewAr/En (nullable), concepts (JSON), status, etc. Admin UI to edit, or import script from JSON.
- Option B: Extend existing `lessons` table with nullable fields for curriculum metadata (term, chapter, semanticKeywords) and use descriptionAr for summary, but keep real lessons as separate reference (not DB lessons that require course/unit parent)
- Option C: Static JSON `docs/seo/lesson-contents.json` mapping lesson slug → { summary, review, concepts } that can be edited and loaded server-side, without DB migration. Simplest for now, allows future content without schema change, but not admin-editable.

Recommended: **Option A + C hybrid**: Create `server/db/schema/curriculum.ts` with `curriculum_lessons` table (for future DB storage) + keep static JSON as import source, and implement service that reads from DB if exists, else falls back to static realLessons. This allows:
- Now: curriculum pages use static realLessons (no DB needed)
- Later: when real content available, import via script into DB, and pages automatically show richer content without code change

---

## 6. SEO Quality Rules Check (Current)

- No keyword stuffing: ✅ semantic capped at 12, descriptions from real titles
- No doorway pages: ✅ one canonical per intent, no /2026/ URLs
- No thin pages: ✅ subject only if has courses, unit only if course in catalog, lesson learn is noindex
- No duplicate pages: ✅ canonical map validates no duplicates
- No year pages: ✅ year in metadata only
- No hidden text: ✅
- No metadata spam: ✅ titles from real rows
- No invent facts: ✅ realLessons from CSV, no invented lesson names
- No fake structured data: ✅ only honest fields (hasPart from real rows, teaches from real semantic)

**Risk for new curriculum pages:**
- If lesson hub pages only show title + breadcrumbs with no additional value, they could be thin. Must include: hierarchy, semantic keywords, related lessons, internal links, external exams link, and clear educational context.

---

## 7. UX

- Current design: Tailwind, Card, Badge, Icon, brand colors, RTL support, no redesign needed
- Must keep same design system for new pages
- No "المجلس" style, no visual redesign

---

## 8. Plan (Safe Implementation)

**Batch 1 — Audit + Schema Design (this doc):**
- Audit done (this file)
- Design curriculum schema (new table + JSON import pipeline)

**Batch 2 — Curriculum Service + Routes (safe, no inventing):**
- Create `server/db/schema/curriculum.ts` (curriculum_lessons table, for future)
- Create `server/curriculum/service.server.ts`: loads realLessons, groups by subject/grade/term/unit/chapter, provides related lessons, slugify
- Create public routes:
  - `/curriculum` — index, grouped, internal links
  - `/curriculum/:lessonSlug` — lesson hub, one strong page per real lesson, honest structured data, no invented content
- Enhance `/subjects/:slug` and `/grades/:slug` to show curriculum outline from realLessons when relevant
- Update sitemap inventory to include /curriculum and /curriculum/:lessonSlug (if not thin, with enough content)
- Add tests for new service and routes
- Ensure typecheck, unit, integration, build green

**Batch 3 — Import Pipeline + Admin Preview (optional, if time):**
- Script `scripts/import-curriculum.mjs` that reads CSV and can seed DB or generate JSON
- Admin SEO dashboard already shows real stats, could add link to curriculum

**What will NOT be done now:**
- No inventing شرح/ملخص/مراجعة
- No new Question Bank
- No Paymob/Fawry/Stripe
- No visual redesign
- No 8 pages per lesson

---

## 9. Risks & Next Steps

- **Risk:** 48 new lesson hub pages could be seen as thin if not enough content. Mitigation: include rich hierarchy, semantic, related, internal links, and make them clearly curriculum navigation pages, not just title.
- **Risk:** Slug collisions for lesson names with special chars (e.g., "من الفلسفة إلى المعمل: كيف نشأ علم النفس؟"). Mitigation: robust slugify that handles Arabic, punctuation, and ensures uniqueness.
- **Next Steps:**
  1. Get real educational content for 48 lessons (from teachers or curriculum books) — summary, review, concepts
  2. Import via pipeline into curriculum_lessons table
  3. Enhance lesson hub pages to show real content when available
  4. Add video/file items via existing lesson_items system, linked to curriculum lessons

---

**Audit by:** Content Architecture Phase — no guessing, real CSV names only, safe implementation plan.
