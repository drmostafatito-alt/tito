# SEO Discovery Final — 48 Real Lessons (SEO YES, Homepage NO)

**Date:** 2026-09-15 Africa/Cairo
**Branch:** arena/01a0a1a9-tito
**Base SHA:** a624948ae3d7001bb5bd1bdbd0d8febe837f65f9
**Previous Commit (content architecture):** 4898092
**This Commit (SEO discovery correction):** to be pushed
**Source:** docs/seo/keyword-universe.csv (48), docs/seo/keyword-universe.json, server/seo/realLessons.server.ts, server/seo/realKeywordClusters.server.ts
**External Exams:** https://exams.mansa-eg.workers.dev/ (unchanged)

---

## 1. تصحيح النطاق (Scope Correction)

المهمة السابقة أنشأت `/curriculum` و `/curriculum/:lessonSlug` كصفحات منهج جديدة مع UI يعرض 48 درس للطلاب — هذا يخالف المطلوب الجديد:

> لا تظهر الـ48 درس في Homepage، لا navigation، لا menus، لا قائمة جديدة للطلاب، لا منهج جديد، لا شرح/ملخص جديد، لا صفحات SEO وهمية/doorway.

**تم التصحيح:**

- حذف `app/routes/public.curriculum.tsx` و `public.curriculum.$lessonSlug.tsx`
- حذف المسارات من `app/routes.ts` (`route("curriculum", ...)` و `route("curriculum/:lessonSlug", ...)`)
- إرجاع `server/seo/inventory.server.ts` إلى حالته الأصلية (بدون curriculum) — sitemap يحتوي فقط على الصفحات العامة الحقيقية الموجودة (programs, grades, subjects, courses, units, products, p/*, about)
- إرجاع `tests/integration/seo-crawl.test.ts` إلى الأصل (12 tests، لا يتوقع curriculum)
- إرجاع `app/routes/public.grades.$slug.tsx` و `public.subjects.$slug.tsx` إلى الأصل ثم إضافة تحسين SEO discovery فقط (بدون UI جديد)

---

## 2. ما الذي تغير؟ (What Changed)

### الملفات المحذوفة
- `app/routes/public.curriculum.tsx` — curriculum index (كان يعرض 48 درس)
- `app/routes/public.curriculum.$lessonSlug.tsx` — lesson hub (كان يعرض شرح/ملخص/مراجعة placeholders)

### الملفات المعدلة (minimal, no visual redesign)
- `app/routes.ts`: حذف مساري curriculum
- `server/seo/inventory.server.ts`: إزالة استيراد `getCurriculumLessons` وإزالة إضافة `/curriculum` و 48 hub إلى sitemap — الآن sitemap يحتوي فقط على الصفحات الحقيقية من DB (published, non-deleted)
- `app/routes/public.grades.$slug.tsx`:
  - إضافة import `getRealLessonsForGrade`, `getLessonNamesForMeta`, `getSemanticForLessons` من `realLessonsMapping.server.ts`
  - في loader: حساب `realLessonsForGrade` (من CSV حرفيا، matching strict) + `realLessonNames` (أول 3) + `realLessonsSemantic` (أول 12 مصطلح)
  - في meta: fallbackDescription يضيف مثالين من أسماء الدروس الحقيقية فقط إذا كان الصف يطابق أحد الصفين الحقيقيين (الأول أو بكالوريا) — طبيعي، لا stuffing. مثال: "الصف الأول الثانوي — مواد: الفلسفة... تشمل دروس: معنى التفكير الإنساني، نشأة الفلسفة."
  - في structured data: DefinedTermSet يدمج semanticKeywords الأصلية + semantic من الدروس المطابقة (حتى 20 مصطلح، من CSV حرفيا، لا اختراع)
  - **UI بدون تغيير**: الطالب يرى فقط قائمة المواد المنشورة من DB (Card مع courseCount)، لا يرى قائمة 48 درس

- `app/routes/public.subjects.$slug.tsx`: نفس المنطق
  - loader يحسب `realLessonsForSubject` (فلسفة ↔ فلسفة ومنطق، نفس ↔ علم النفس)
  - meta يضيف مثالين من الدروس في الوصف إذا كانت المادة تطابق فلسفة/منطق/نفس
  - DefinedTermSet يدمج semanticKeywords + semantic من الدروس المطابقة
  - **UI بدون تغيير**: الطالب يرى فقط كورسات المادة من DB، لا 48 درس

### الملفات الجديدة (SEO mapping, no UI)
- `server/seo/realLessonsMapping.server.ts`:
  - `getRealLessonsForGrade(gradeTitleAr)`: strict matching (بكالوريا ↔ بكالوريا، الأول ↔ الأول، substring ≥4 أحرف لتجنب false positive مثل "صف فارغ")
  - `getRealLessonsForSubject(subjectTitleAr)`: فلسفة ومنطق matching (فلسفة+منطق، فلسفة، منطق، نفس/سيكولوجي)
  - `getLessonNamesForMeta(lessons, max=3)`, `getSemanticForLessons(lessons, max=12)`: للوصف والـ structured data
  - `auditLessonsWithoutRealTarget(existingGrades, existingSubjects)`: للـ audit فقط، لا ينشئ صفحات

### الملفات المحتفظ بها (not visible to students)
- `server/curriculum/constants.ts`: EXTERNAL_EXAMS_URL (client-safe)
- `server/curriculum/service.server.ts`: pure functions for 48 lessons (getCurriculumLessons, getLessonBySlug, etc.) — يستخدم فقط في SEO mapping، لا UI
- `server/db/schema/curriculum.ts` + `drizzle/0010_curriculum_content.sql`: جدول curriculum_lessons + curriculum_contents — موجود في DB لكن غير مستخدم في UI (لا يظهر للطالب). إذا اعتبر هذا "منهج جديد" يمكن حذفه في مرحلة لاحقة، لكنه لا يخالف "لا تظهر للطالب" لأنه غير معروض.
- `scripts/import-curriculum.mjs` + `docs/seo/lesson-contents.json` + `docs/seo/keyword-universe.json`: أدوات وصيانة، لا تظهر للطالب
- `tests/unit/curriculum.test.ts`: 13 tests تتحقق 48 درس حقيقي، hierarchy، slug stability، grouping، etc. — لا UI

---

## 3. ما هي target URLs للـ48 درس؟ (Existing Public Pages Only)

حسب `realKeywordClusters.server.ts`، كل درس كان يُربط بـ:

- `/courses/{inferredSlug}` — canonical لشرح/ملخص/مراجعة/فيديو/PDF/أسئلة (داخل Tito)
- `/courses/{slug}/units/{unitId}` — lesson_discovery
- `/subjects/{inferredSlug}` — subject cluster
- `/grades/{inferredSlug}` — grade cluster

**لكن هذه الـ slugs inferred (placeholders) وليست real DB slugs.**

**الـ target URLs الحقيقية الموجودة فعليًا في المنصة (من DB):**

- `/grades/:slug` — الصفحات الحقيقية للصفوف المنشورة (مثل "الصف الثالث الثانوي" في seed، أو "الصف الأول الثانوي" و "مرحلة البكالوريا المصرية" إذا أنشأها المالك في production)
- `/subjects/:slug` — الصفحات الحقيقية للمواد المنشورة (مثل "الفلسفة" في seed، أو "فلسفة ومنطق" و "علم النفس" في production)
- `/courses/:slug` — كورسات المادة المنشورة
- `/courses/:slug/units/:unitId` — وحدات الكورس المنشورة
- `/programs/:slug`, `/programs`, `/courses`, `/products/:slug`, `/p/:slug`, `/about`, `/`

**Mapping الفعلي بعد التصحيح (SEO discovery, no new pages):**

- دروس "فلسفة ومنطق / الصف الأول الثانوي" (24 درس):
  - إذا وجد grade "الصف الأول الثانوي" منشور → `/grades/{realSlugForFirstSecondary}` هو target (مثال: `/grades/grade-1-secondary` إذا كان slug كذلك، أو slug الفعلي من DB)
  - إذا وجد subject "فلسفة ومنطق" أو "الفلسفة" منشور → `/subjects/{realSlug}` هو target (مثال: `/subjects/falsafa` أو `/subjects/falsafa-manteq-1st`)
  - أمثلة بحث:
    - "معنى التفكير الإنساني وتطبيقاته" → Google يكتشف `/subjects/falsafa` أو `/grades/grade-1-secondary` لأن meta description تحتوي "معنى التفكير الإنساني..."
    - "شرح التفكير الإنساني" → نفس الصفحة (canonical واحد)
    - "نشأة الفلسفة أولى ثانوي" → `/grades/{firstSecondary}` أو `/subjects/{philosophy}`

- دروس "علم النفس / مرحلة البكالوريا المصرية" (24 درس):
  - إذا وجد grade "مرحلة البكالوريا المصرية" → `/grades/{bacSlug}`
  - إذا وجد subject "علم النفس" → `/subjects/{psychologySlug}`
  - أمثلة:
    - "الذكاءات المتعددة علم النفس" → `/subjects/psychology` أو `/grades/baccalaureate`
    - "المراهقة وتكوين الهوية" → نفس

**لا يوجد 48 URL منفصلة لكل درس — يوجد عدد أقل من الصفحات الحقيقية (grades + subjects + courses + units) التي تخدم كل الدروس كـ canonical واحد قوي لكل Intent (شرح/ملخص/مراجعة/فيديو/PDF → نفس الصفحة، أسئلة → external https://exams.mansa-eg.workers.dev/).**

---

## 4. هل أي درس احتاج إنشاء صفحة جديدة؟

**لا — حسب التعليمات الجديدة، لا ننشئ صفحات جديدة.**

**Audit للـ 48 درس بدون real target (في seed الحالي):**

- Seed الحالي يحتوي فقط على:
  - program: "الثانوية العامة"
  - grade: "الصف الثالث الثانوي" (ليس "الصف الأول الثانوي" ولا "مرحلة البكالوريا المصرية")
  - subject: "الفلسفة" (ليس "فلسفة ومنطق" بالضبط، وليس "علم النفس")
  - course: "كورس الفلسفة"
  - unit: "الوحدة الأولى: الفلسفة التطبيقية"

- النتيجة:
  - 24 درس "فلسفة ومنطق / الصف الأول الثانوي": لا يوجد grade "الصف الأول الثانوي" ولا subject "فلسفة ومنطق" مطابق 100% في seed → **يفتقد target دقيق**، لكن subject "الفلسفة" قريب وقد يساعد في الاكتشاف الجزئي عبر matching "فلسفة"
  - 24 درس "علم النفس / مرحلة البكالوريا المصرية": لا يوجد grade "مرحلة البكالوريا المصرية" ولا subject "علم النفس" في seed → **يفتقد target تمامًا**

**في production:** إذا أنشأ المالك الصفوف والمواد الحقيقية (الصف الأول الثانوي، مرحلة البكالوريا المصرية، فلسفة ومنطق، علم النفس) كـ published rows، فإن الـ target URLs ستوجد تلقائيًا وسيعمل الاكتشاف بدون كود إضافي (لأن mapping يعتمد على عنوان الصف/المادة الحقيقي من DB).

**نحن لم ننشئ صفحات جديدة — سجلنا المشكلة فقط كما طلبت.**

---

## 5. ما الذي سيظهر للطالب؟ (Student Visible)

- **Homepage:** CMS sections + discover subjects/grades من DB فقط (لا 48 درس)
- **Grade page:** عنوان الصف + قائمة المواد المنشورة من DB (Card مع courseCount) + breadcrumb → لا قائمة 48 درس، لا curriculum outline
- **Subject page:** عنوان المادة + وصف المادة (إن وجد) + link للصف + buy CTA (إن وجد) + قائمة كورسات المادة من DB → لا 48 درس
- **Course page:** عنوان الكورس + وحدات + دروس من DB (ليس 48 CSV)
- **Unit page:** قائمة دروس الوحدة من DB
- **Navigation/Menus:** لا تغيير — لا يوجد link لـ /curriculum
- **No visual redesign**

---

## 6. ما الذي سيظهر فقط لمحركات البحث؟ (SEO Only, not Student UI)

- **Title:** يبقى `المادة — الصف — brand` (deterministic) — لا stuffing
- **Meta description:**
  - Grade: "مواد {grade} على منصة {site}: {subjects}. تشمل دروس: {lesson1}، {lesson2}." — فقط إذا كان الصف يطابق أحد الصفين الحقيقيين (الأول أو بكالوريا) لتجنب false positive مثل "صف فارغ"
  - Subject: " {subject} — {grade}: كورسات... تشمل دروس: {lesson1}، {lesson2}." — فقط إذا كانت المادة تطابق فلسفة/منطق/نفس
  - Natural, أول مثالين فقط، لا قائمة 48
- **Canonical:** `/grades/:slug`, `/subjects/:slug`, `/courses/:slug`, etc. — واحد قوي لكل Intent
- **Sitemap:** فقط الصفحات الحقيقية من DB (programs, grades, subjects, courses, units, products, p/*, about) — لا curriculum
- **Robots:** Allow: /, Disallow: /admin/, /dashboard, /learn/, etc. — لا curriculum (لأنه محذوف)
- **Structured data:**
  - WebPage (CollectionPage) + BreadcrumbList (Home → Programs → Grade أو Home → Courses → Subject)
  - DefinedTermSet: مفاهيم من subject titles + semantic من الدروس المطابقة (من CSV حرفيا، حتى 20 مصطلح، لا اختراع) — مثال: "معنى التفكير الإنساني، التفكير الناقد، نشأة الفلسفة، مباحث الفلسفة..."
  - EducationalLevel: اسم الصف
  - No fake yearly /2026/ URLs — السنة في metadata فقط إذا كانت موجودة في CSV (لا ننشئ /2026/)
  - No hidden text, no metadata spam, no invented facts, no fake structured data

- **Internal linking:** يبقى طبيعي (grade → subjects → courses → units) — لا links جديدة لـ curriculum

---

## 7. نتائج الاختبارات

- **typecheck:** `npx tsc --noEmit` — ✅ 0 errors
- **build:** `npm run build` — ✅ (server 1.7MB, client entry ~185kB, 10 migrations embedded, لا warning لـ curriculum)
- **unit:** `vitest run --config vitest.unit.config.ts` — ✅ 335 tests passed (30 files)
  - `curriculum.test.ts` 13 tests: 48 count, hierarchy حرفيا, slug stability, unique slugs, grouping, related, stats, EXTERNAL_EXAMS_URL
  - `seo-inventory.test.ts` 10 tests, `keywordClusters.test.ts` 16 tests, etc.
- **integration SEO:** `vitest run --config vitest.integration.config.ts tests/integration/seo-*.test.ts` — ✅ 52 tests passed (6 files)
  - `seo-crawl.test.ts` 12 tests (no curriculum expectation, only real public paths)
  - `seo-batch4.test.ts` 10 tests (grade with no subjects honest empty description, no false curriculum count)
  - `seo-admin`, `seo-home`, `seo-jsonld`, `seo-meta` all green
- **E2E:** لم يشغل (لا E2E config للـ SEO discovery، لكن build+unit+integration كافية)

---

## 8. Git

- Branch: `arena/01a0a1a9-tito`
- Previous commit (content architecture): `4898092d699e8899ec8ea67de52acf97a03e5c58`
- This commit (SEO discovery correction): to be pushed after this report
- Files changed in this correction:
  - Deleted: `app/routes/public.curriculum.tsx`, `public.curriculum.$lessonSlug.tsx`
  - Modified: `app/routes.ts` (remove curriculum routes), `server/seo/inventory.server.ts` (revert to original, no curriculum), `tests/integration/seo-crawl.test.ts` (revert), `app/routes/public.grades.$slug.tsx` (SEO discovery enrichment, no UI), `app/routes/public.subjects.$slug.tsx` (same), `app/routes/public.grades.$slug.tsx` and `subjects` previously had curriculum outline UI removed
  - New: `server/seo/realLessonsMapping.server.ts` (mapping helper), `docs/reports/seo-discovery-audit.md`, `docs/reports/seo-discovery-final.md`
  - Kept: `server/curriculum/constants.ts`, `service.server.ts`, `server/db/schema/curriculum.ts`, `drizzle/0010...`, `scripts/import-curriculum.mjs`, `docs/seo/lesson-contents.json`, `tests/unit/curriculum.test.ts` (not visible to students)
- No force/reset/PR/history touch
- Push: `git push origin arena/01a0a1a9-tito` + verify remote SHA via `git ls-remote`

---

## 9. Verification Commands

```bash
node scripts/import-curriculum.mjs --check
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
