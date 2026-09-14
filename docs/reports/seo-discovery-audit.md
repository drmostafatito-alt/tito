# SEO Discovery Audit — 48 Real Lessons (No Homepage Visibility)

**Date:** 2026-09-15
**Branch:** arena/01a0a1a9-tito
**Source:** docs/seo/keyword-universe.csv (48 lessons), docs/seo/keyword-universe.json, server/seo/realLessons.server.ts, server/seo/realKeywordClusters.server.ts
**Goal:** Google Search → lesson name → discover existing Tito public page (SEO visibility YES, Homepage visibility NO)

---

## 1. Current Public Routes (existing, real)

| Route | File | Indexable? | Purpose |
|-------|------|------------|---------|
| `/` | public/home.tsx | yes | CMS home (empty-first) + discover subjects/grades from DB |
| `/programs` | public.programs.tsx | yes if programs exist | Programs list |
| `/programs/:slug` | public.programs.$slug.tsx | yes | Program → grades |
| `/grades/:slug` | public.grades.$slug.tsx | yes | Grade → subjects |
| `/subjects/:slug` | public.subjects.$slug.tsx | yes | Subject → courses |
| `/courses` | public.courses.tsx | yes if catalog has courses | Courses catalog |
| `/courses/:slug` | public.courses.$slug.tsx | yes | Course → units |
| `/courses/:slug/units/:unitId` | public.courses.$slug.units.$unitId.tsx | yes (lesson discovery) | Unit → lessons |
| `/products/:slug` | public.products.$slug.tsx | yes if active plan | Product page |
| `/p/:slug` | p.$slug.tsx | yes | CMS pages |
| `/about` | public/about.tsx | yes if owner identity | Person entity |
| `/sitemap.xml` | sitemap[.]xml.tsx | yes | Sitemap from inventory |
| `/robots.txt` | robots[.]txt.tsx | yes | Robots |

**No curriculum routes** (`/curriculum`) after correction — removed to avoid doorway/homepage visibility.

---

## 2. Real Lessons (48) — Official Names حرفيا

From CSV (no guessing):

- فلسفة ومنطق / الصف الأول الثانوي (24):
  - معنى التفكير الإنساني وتطبيقاته
  - أهمية التفكير الإنساني
  - الفلسفة والدين والعلم
  - التفكير الناقد والتفكير الإبداعي
  - نشأة الفلسفة
  - مباحث الفلسفة ومشكلاتها الأساسية
  - تعريفات الفلسفة
  - أهمية الفلسفة للإنسان والمجتمع
  - مهارات التفكير الفلسفي
  - مفهوم المنهج العلمي
  - الاستقراء والمنهج العلمي في العصر الحديث
  - علماء مسلمون لهم دور في المنهج الاستقرائي التجريبي
  - الاستقراء والمنهج العلمي المعاصر
  - المنطق الرياضي
  - الفكر المنطقي والذكاء الاصطناعي
  - العلاقة بين المنطق والذكاء الاصطناعي
  - الفكر البيئي في العصور المختلفة
  - رؤية الفلسفة للأخلاق البيولوجية والطبية
  - أخلاقيات البحث المتعلقة بالوراثة البشرية
  - معايير الأخلاقيات الطبية الحديثة
  - الفلسفة وأخلاقيات المهنة
  - الفلسفة وعلاقتها بالقيم
  - القيم الفلسفية التي اكتسبها الفرد
  - الفلسفة التطبيقية

- علم النفس / مرحلة البكالوريا المصرية (24):
  - من الفلسفة إلى المعمل: كيف نشأ علم النفس؟
  - أنت لست مجرد رد فعل: سر المثير والاستجابة
  - علم النفس في حياتك: أكثر مما تتخيل
  - كيف يفكر عالم النفس؟
  - كيف يبدأ السلوك؟
  - لماذا أرى الأشياء بطريقتي؟ (أسرار الانتباه والإدراك)
  - كيف نتعلم ونحتفظ بالمعلومات؟
  - كيف نفكر ونتخذ قراراتنا؟
  - من الطفولة إلى المراهقة: كيف أتغير؟
  - المراهقة وتكوين الهوية (من أنا؟)
  - الانفعالات وتنظيمها (كيف أفهم مشاعري؟)
  - مهارات الحياة والتكيف النفسي
  - الفروق الفردية بين الناس
  - الذكاءات المتعددة (كيف نكون أذكياء بطرق مختلفة؟)
  - الذكاء الرقمي (كيف نستخدم قدراتنا في عالم التكنولوجيا؟)
  - الموهبة وتنميتها (كيف أكتشف موهبتي؟)
  - صحتي النفسية: كيف أحقق التوافق مع نفسي والآخرين؟
  - شخصيتي: كيف أفهمها وأطورها؟
  - جودة حياتي: كيف أحققها في عالم متغير؟
  - علم النفس الإيجابي: كيف أصنع به حياة أفضل؟
  - سلوكي الاجتماعي: كيف أفهم الآخرين؟
  - التأثير الاجتماعي: كيف يغير العالم الرقمي أفكاري؟
  - هويتي وانتمائي: كيف يشكلهما العالم الرقمي؟
  - سلوكي الرقمي: كيف أتعامل مع تحدياته؟

---

## 3. Target URLs per realKeywordClusters (inferred slugs, not real DB)

realKeywordClusters.server.ts maps each lesson to:

- `/courses/{inferredSlug}` (e.g., `falsafa-manteq-1st-...`) — canonical for شرح/ملخص/مراجعة/فيديو/PDF/أسئلة
- `/courses/{slug}/units/{unitId}` — lesson_discovery
- `/subjects/{inferredSlug}` (e.g., `falsafa-manteq-1st`, `psychology-bac`)
- `/grades/{inferredSlug}` (e.g., `grade-1-secondary`, `baccalaureate`)

**Problem:** These inferred slugs are placeholders; real DB slugs depend on seeding. In local seed, only physics-3s exists, not philosophy/psychology. In production, real slugs may differ.

**Current discovery issue:**

- If a subject "فلسفة ومنطق" does not exist as published subject row, its page `/subjects/falsafa-manteq-1st` will 404 and not be in sitemap → Google cannot discover lesson via that URL.
- Same for grade "الصف الأول الثانوي" — if no grade row with that title exists, `/grades/grade-1-secondary` 404s.
- Course pages: inferred course slugs like `falsafa-manteq-1st-الوحدة-الأولى` do not exist in DB → 404.

**What exists in DB (seed):**
- Only physics demo: program, grade "الصف الثالث الثانوي", subject "الفلسفة" (singular, not "فلسفة ومنطق"), course "كورس الفلسفة", unit "الوحدة الأولى: الفلسفة التطبيقية"
- No "الصف الأول الثانوي" grade, no "مرحلة البكالوريا المصرية", no "علم النفس" subject in seed.

**Conclusion:** Many of the 48 lessons do NOT have a real public page target in current DB. They would need real subjects/grades/courses to exist. But per new requirement, we must NOT invent pages. We must record problem in report.

---

## 4. SEO Discovery Fix (minimal, no homepage visibility)

**Goal:** Make existing real pages discoverable for lesson searches, without showing 48 lessons to students.

**Solution:**

1. **Remove curriculum routes** (`/curriculum`, `/curriculum/:slug`) from `app/routes.ts` and sitemap (`inventory.server.ts`) — already done in this audit correction.
2. **Remove curriculum outline UI** from `public.grades.$slug.tsx` and `public.subjects.$slug.tsx` — revert to original files (no list of 48 lessons for students).
3. **Enrich SEO metadata (no UI change)** of existing pages using real lessons that match their subject/grade:

   - In grade loader: get matching real lessons for that grade title (strict matching: grade contains "الأول" ↔ lessons with grade "الصف الأول الثانوي", grade contains "بكالوريا" ↔ lessons with "مرحلة البكالوريا المصرية")
   - In subject loader: get matching real lessons for subject title (فلسفة ↔ فلسفة ومنطق, نفس ↔ علم النفس)
   - Use those matching lessons to:
     - Add their names to meta description fallback (natural, first 2-3 examples, not stuffing)
     - Add their semantic keywords to DefinedTermSet structured data (honest, from CSV, no invented)
     - Keep canonical, title, breadcrumbs unchanged (honest)
     - No visual list for students — only meta/structured data for search engines

4. **Sitemap & robots:** Keep only real existing pages (programs, grades, subjects, courses, units, products, CMS pages, about). No curriculum.

5. **Internal linking:** Keep existing natural links (grade → subjects → courses → units). No new curriculum links.

6. **External exams:** Keep https://exams.mansa-eg.workers.dev/ as external, no internal Question Bank.

**What will be visible to students:**

- Homepage: CMS sections + discover subjects/grades from DB (no 48 lessons list)
- Grade page: lists its published subjects (from DB), no curriculum outline
- Subject page: lists its courses (from DB), no curriculum outline
- Course page: lists its units/lessons (from DB, not 48 CSV)
- No new navigation, menus, homepage sections

**What will be visible to search engines (SEO only):**

- Grade page meta description may include example lesson names that belong to that grade (e.g., "الصف الأول الثانوي — مواد: الفلسفة... تشمل دروس: معنى التفكير الإنساني، نشأة الفلسفة...")
- Subject page meta description may include example lesson names for that subject
- Structured data DefinedTermSet includes semantic keywords from matching real lessons (e.g., "معنى التفكير الإنساني، التفكير الناقد، نشأة الفلسفة...")
- Title remains brand-first, not stuffed
- Canonical correct, no doorway, no thin, no fake /2026/ URLs
- Sitemap lists only real pages, but those pages' metadata helps Google match lesson queries

---

## 5. Lessons Without Real Public Page Target (record only, no invention)

Based on current seed (only physics demo), most lessons lack real target:

- All 24 "الصف الأول الثانوي / فلسفة ومنطق" lessons: need grade "الصف الأول الثانوي" and subject "فلسفة ومنطق" to exist as published rows. Currently only "الصف الثالث الثانوي" and "الفلسفة" exist in seed → partial match, but not exact. Should be considered missing exact target, but close match may still help discovery via "الفلسفة" subject page.
- All 24 "مرحلة البكالوريا المصرية / علم النفس" lessons: need grade "مرحلة البكالوريا المصرية" and subject "علم النفس" — neither exists in seed → no real target.

**In production:** If owner creates real grades/subjects/courses for these, discovery will work automatically via enriched metadata. No code change needed.

**We will NOT create fake pages for them.** We record here that without real DB rows, Google cannot discover them via existing pages, but SEO metadata enrichment is ready.

---

## 6. Next Steps (minimal changes)

- Implement helper `server/seo/realLessonsMapping.server.ts` with `getRealLessonsForGrade(gradeTitle)` and `getRealLessonsForSubject(subjectTitle)`
- Update `public.grades.$slug.tsx` meta to include matching lessons (first 3) in fallback description and add their semantic to DefinedTermSet
- Update `public.subjects.$slug.tsx` similarly
- Ensure no UI change (no list)
- Run typecheck, build, unit, integration SEO tests
- Commit, push, verify remote SHA
- Final report: what changed, target URLs for 48 lessons (existing pages, not new), which lessons lack real target, what student sees vs search engine sees, test results, SHAs
