# SEO Content Map — Dr Mostafa Tito (د/ مصطفى تيتو)

**Date:** 2026-09-15 · **Phase:** SEO Lesson/Topic Level (Keyword Universe)
**Source:** Real Egyptian Ministry curriculum + live DB content hierarchy (program → grade → subject → course → unit → lesson)
**Principle:** كل درس حقيقي = Keyword Cluster خاص به. لا تخمين، لا صفحات وهمية، Canonical واحد قوي لكل Intent.

---

## 1. المنهجية (Mapping Rules)

### 1.1 مصدر الحقيقة
- **البراند:** إعدادات المنصة (Appearance → Identity) — د/ مصطفى تيتو
- **المواد والصفوف:** صفوف `grades`, `subjects` المنشورة في DB (published, non-deleted, مع parent منشور)
- **الكورسات والوحدات والدروس:** صفوف `courses` (catalog/featured + publish window) + `units` + `lessons` المنشورة
- **الكلمات الدلالية:** خريطة مفاهيم حقيقية من المنهج الوزاري (ليست أسماء دروس مخترعة) — تُستخدم لبناء topical authority فقط

### 1.2 Canonical Strategy (واحد قوي لكل Intent)
| Intent | Canonical Target | السبب |
|--------|-----------------|-------|
| branded (مصطفى تيتو) | `/` | Homepage is brand-core |
| brand_entity (دكتور مصطفى تيتو) | `/about` | Person + ProfilePage |
| subject (فلسفة) | `/subjects/:slug` | Subject page يحمل المادة + الصف في title |
| grade (الصف الثالث) | `/grades/:slug` | Grade page cross-links للمواد |
| grade_subject (تالتة ثانوي فلسفة) | `/subjects/:slug` (title = مادة — صف — براند) | Subject wins, grade في title + breadcrumb |
| course (كورس) | `/courses/:slug` | Course page هو شرح/محاضرة |
| unit (وحدة) | `/courses/:slug/units/:unitId` | Unit page public, lists lessons, indexable |
| lesson_discovery | `/courses/:slug/units/:unitId` | Lesson titles public في unit page, lesson content private (learn noindex) |
| lesson_explanation / summary / revision / video / pdf | `/courses/:slug` | كورس واحد قوي لكل صيغ البحث |
| lesson_questions / exam / practice | `/courses/:slug` (داخل تيتو) → external Questions Platform | Tito لا يستضيف أسئلة — entry point في course page |
| resources (ملخص PDF) | `/p/resources` + subject page | مكتبة المصادر |
| academic_year (فلسفة 2026) | نفس الصفحات الديناميكية (year في metadata فقط) | لا year في URL, no doorway |

### 1.3 صيغ البحث الطبيعية المغطاة
لكل درس حقيقي نغطي:
- شرح، ملخص، مراجعة، أسئلة، امتحان، تدريبات، حل أسئلة، فيديو شرح، PDF
- + المادة والصف والسنة واسم مصطفى تيتو عندما يكون منطقيًا
- مثال: "شرح الفلسفة وقضايا البيئة تالتة ثانوي مصطفى تيتو"، "ملخص الاستدلال الاستقرائي PDF"، "مراجعة الذكاء والتعلم علم نفس"

### 1.4 Topical Authority
Google يفهم العلاقة عبر:
- **BreadcrumbList** كامل: الرئيسية → البرامج → الصف → المادة → الكورس → الوحدة
- **Course JSON-LD** مع `hasPart` للوحدات، `teaches` للمفاهيم، `educationalLevel` للصف
- **LearningResource** للوحدات والدروس
- **DefinedTermSet** للمفاهيم الدلالية (semantic keywords)
- **Person** مع `knowsAbout` (فلسفة، علم نفس، منطق)

---

## 2. Brand Clusters

| Keyword | Intent | Subject | Grade | Term/Part | Unit | Chapter | Lesson | Target URL | Indexability | Primary/Secondary |
|---------|--------|---------|-------|-----------|------|---------|--------|------------|--------------|-------------------|
| مصطفى تيتو | branded | الفلسفة وعلم النفس | الثانوية العامة | - | - | - | - | `/` | index | Primary: مصطفى تيتو / Secondary: مستر مصطفى تيتو، دكتور مصطفى تيتو، منصة مصطفى تيتو |
| دكتور مصطفى تيتو | branded | الفلسفة وعلم النفس | الثانوية العامة | - | - | - | - | `/about` | index (when identity set) | Primary: دكتور مصطفى تيتو / Secondary: مدرس مصطفى تيتو، د/ مصطفى تيتو |
| مصطفى تيتو فلسفة | brand_subject | فلسفة | الصف الثالث الثانوي | - | - | - | - | `/subjects/{philosophy-slug}` | index | Primary: مصطفى تيتو فلسفة / Secondary: شرح فلسفة مصطفى تيتو، مستر فلسفة تيتو |
| مصطفى تيتو علم نفس | brand_subject | علم النفس | الصف الثالث الثانوي | - | - | - | - | `/subjects/{psychology-slug}` | index | Primary: مصطفى تيتو علم نفس / Secondary: شرح علم نفس مصطفى تيتو |
| منصة مصطفى تيتو | branded | الفلسفة وعلم النفس | الثانوية العامة | - | - | - | - | `/` | index | Primary: منصة مصطفى تيتو / Secondary: منصة مستر مصطفى تيتو |

---

## 3. Subject Clusters (المادة)

| Keyword | Intent | Subject | Grade | Term/Part | Unit | Chapter | Lesson | Target URL | Indexability | Primary/Secondary |
|---------|--------|---------|-------|-----------|------|---------|--------|------------|--------------|-------------------|
| فلسفة | subject | فلسفة | الصف الثالث الثانوي | - | - | - | - | `/subjects/{philosophy-slug}` | index | Primary: فلسفة / Secondary: مادة الفلسفة، شرح الفلسفة، دروس الفلسفة، منهج الفلسفة |
| علم النفس | subject | علم النفس | الصف الثالث الثانوي | - | - | - | - | `/subjects/{psychology-slug}` | index | Primary: علم النفس / Secondary: علم نفس، مادة علم النفس، شرح علم النفس |
| منطق | subject | منطق | الصف الثالث الثانوي | - | - | - | - | `/subjects/{logic-slug}` (if published) | index (only if published) | Primary: منطق / Secondary: المنطق، مادة المنطق، شرح المنطق |
| فلسفة ومنطق | subject | فلسفة ومنطق | الصف الثالث الثانوي | - | - | - | - | `/subjects/{philosophy-slug}` + `/subjects/{logic-slug}` | index | Primary: فلسفة ومنطق / Secondary: فلسفة وعلم نفس، فلسفة ومنطق وعلم نفس |
| علم النفس والاجتماع | subject | علم النفس والاجتماع | الصف الثالث الثانوي | - | - | - | - | `/subjects/{psychology-slug}` | index | Primary: علم النفس والاجتماع / Secondary: علم نفس واجتماع، مادة علم النفس والاجتماع |

---

## 4. Grade Clusters (الصف)

| Keyword | Intent | Subject | Grade | Term/Part | Unit | Chapter | Lesson | Target URL | Indexability | Primary/Secondary |
|---------|--------|---------|-------|-----------|------|---------|--------|------------|--------------|-------------------|
| الصف الأول الثانوي | grade | الفلسفة والمنطق | الصف الأول الثانوي | الترم الأول | - | - | - | `/grades/{grade-1-slug}` | index | Primary: الصف الأول الثانوي / Secondary: أولى ثانوي، اولى ثانوي |
| الصف الثاني الثانوي | grade | علم النفس والاجتماع | الصف الثاني الثانوي | الترم الأول | - | - | - | `/grades/{grade-2-slug}` | index | Primary: الصف الثاني الثانوي / Secondary: تانية ثانوي، ثانية ثانوي |
| الصف الثالث الثانوي | grade | فلسفة ومنطق + علم نفس واجتماع | الصف الثالث الثانوي | - | - | - | - | `/grades/{grade-3-slug}` | index | Primary: الصف الثالث الثانوي / Secondary: تالتة ثانوي، الثانوية العامة، ثانوية عامة |
| الثانوية العامة | grade | الفلسفة وعلم النفس | الثانوية العامة | - | - | - | - | `/programs/{thanaweya-slug}` + `/grades/{grade-3-slug}` | index | Primary: الثانوية العامة / Secondary: ثانوية عامة، تالتة ثانوي |

---

## 5. Grade+Subject Clusters (قيمة عالية)

| Keyword | Intent | Subject | Grade | Term/Part | Unit | Chapter | Lesson | Target URL | Indexability | Primary/Secondary |
|---------|--------|---------|-------|-----------|------|---------|--------|------------|--------------|-------------------|
| أولى ثانوي فلسفة | grade_subject | فلسفة | الصف الأول الثانوي | الترم الأول | - | - | - | `/subjects/{philosophy-1-slug}` | index | Primary: أولى ثانوي فلسفة / Secondary: فلسفة أولى ثانوي، شرح فلسفة أولى ثانوي |
| تانية ثانوي علم نفس | grade_subject | علم النفس | الصف الثاني الثانوي | الترم الأول | - | - | - | `/subjects/{psychology-2-slug}` | index | Primary: تانية ثانوي علم نفس / Secondary: علم نفس تانية ثانوي |
| تالتة ثانوي فلسفة | grade_subject | فلسفة | الصف الثالث الثانوي | - | - | - | - | `/subjects/{philosophy-3-slug}` | index | Primary: تالتة ثانوي فلسفة / Secondary: فلسفة تالتة ثانوي، شرح فلسفة تالتة ثانوي، مصطفى تيتو فلسفة تالتة ثانوي |
| تالتة ثانوي علم نفس | grade_subject | علم النفس | الصف الثالث الثانوي | - | - | - | - | `/subjects/{psychology-3-slug}` | index | Primary: تالتة ثانوي علم نفس / Secondary: علم نفس تالتة ثانوي، شرح علم نفس تالتة ثانوي |
| تالتة ثانوي منطق | grade_subject | منطق | الصف الثالث الثانوي | - | - | - | - | `/subjects/{logic-3-slug}` | index (if published) | Primary: تالتة ثانوي منطق / Secondary: منطق تالتة ثانوي |

---

## 6. Course Clusters

| Keyword | Intent | Subject | Grade | Term/Part | Unit | Chapter | Lesson | Target URL | Indexability | Primary/Secondary |
|---------|--------|---------|-------|-----------|------|---------|--------|------------|--------------|-------------------|
| كورس فلسفة تالتة ثانوي | course | فلسفة | الصف الثالث الثانوي | - | - | - | - | `/courses/{philosophy-course-slug}` | index | Primary: كورس فلسفة تالتة ثانوي / Secondary: شرح فلسفة تالتة ثانوي، محاضرة فلسفة |
| مراجعة فلسفة نهائية | course | فلسفة | الصف الثالث الثانوي | مراجعة نهائية | - | - | - | `/courses/{philosophy-revision-slug}` | index | Primary: مراجعة فلسفة نهائية / Secondary: مراجعة نهائية فلسفة، مراجعة فلسفة تالتة ثانوي |
| كورس علم نفس تالتة ثانوي | course | علم النفس | الصف الثالث الثانوي | - | - | - | - | `/courses/{psychology-course-slug}` | index | Primary: كورس علم نفس تالتة ثانوي / Secondary: شرح علم نفس تالتة ثانوي |

---

## 7. Unit Clusters (الوحدة) — من المنهج الوزاري الحقيقي

### 7.1 فلسفة ومنطق — الصف الثالث الثانوي

| Keyword | Intent | Subject | Grade | Term/Part | Unit | Chapter | Lesson | Target URL | Indexability | Primary/Secondary |
|---------|--------|---------|-------|-----------|------|---------|--------|------------|--------------|-------------------|
| الوحدة الأولى فلسفة تالتة ثانوي | unit | فلسفة | الصف الثالث الثانوي | - | الوحدة الأولى: الفلسفة التطبيقية | - | - | `/courses/{course-slug}/units/{unit-1-id}` | index | Primary: الفلسفة التطبيقية / Secondary: الوحدة الأولى فلسفة، فلسفة تطبيقية |
| فلسفة البيئة تالتة ثانوي | unit | فلسفة | الصف الثالث الثانوي | - | الفلسفة التطبيقية | الفلسفة وقضايا البيئة | - | `/courses/{course-slug}/units/{unit-1-id}` | index | Primary: الفلسفة وقضايا البيئة / Secondary: شرح فلسفة البيئة، ملخص فلسفة البيئة، فلسفة البيئة مصطفى تيتو |
| الأخلاق البيولوجية والطبية | unit | فلسفة | الصف الثالث الثانوي | - | الفلسفة التطبيقية | رؤية الفلسفة للأخلاق البيولوجية والطبية | - | `/courses/{course-slug}/units/{unit-1-id}` | index | Primary: الأخلاق البيولوجية والطبية / Secondary: شرح الأخلاق الطبية، ملخص الأخلاق البيولوجية |
| أخلاقيات المهنة | unit | فلسفة | الصف الثالث الثانوي | - | الفلسفة التطبيقية | الفلسفة وأخلاقيات المهنة | - | `/courses/{course-slug}/units/{unit-1-id}` | index | Primary: الفلسفة وأخلاقيات المهنة / Secondary: شرح أخلاقيات المهنة |
| التفلسف وعلاقته بالقيم | unit | فلسفة | الصف الثالث الثانوي | - | الفلسفة التطبيقية | التفلسف وعلاقته بالقيم | - | `/courses/{course-slug}/units/{unit-1-id}` | index | Primary: التفلسف وعلاقته بالقيم / Secondary: شرح التفلسف، ملخص القيم |
| الوحدة الثانية منطق تالتة ثانوي | unit | منطق | الصف الثالث الثانوي | - | الوحدة الثانية: المنطق التطبيقي | - | - | `/courses/{course-slug}/units/{unit-2-id}` | index | Primary: المنطق التطبيقي / Secondary: الوحدة الثانية منطق |
| الاستدلال الاستقرائي | unit | منطق | الصف الثالث الثانوي | - | المنطق التطبيقي | الاستدلال الاستقرائي وتطبيقه في العلوم الطبيعية | - | `/courses/{course-slug}/units/{unit-2-id}` | index | Primary: الاستدلال الاستقرائي / Secondary: شرح الاستقراء، ملخص الاستدلال الاستقرائي، الاستقراء في العلوم الطبيعية |
| الاستنباط | unit | منطق | الصف الثالث الثانوي | - | المنطق التطبيقي | معنى الاستنباط وتطبيقه في العلوم الصورية | - | `/courses/{course-slug}/units/{unit-2-id}` | index | Primary: الاستنباط / Secondary: شرح الاستنباط، الاستنباط في العلوم الصورية، القياس |
| التكامل بين الاستقراء والاستنباط | unit | منطق | الصف الثالث الثانوي | - | المنطق التطبيقي | التكامل بين المنهج الاستقرائي والاستنباطي | - | `/courses/{course-slug}/units/{unit-2-id}` | index | Primary: التكامل بين المنهج الاستقرائي والاستنباطي / Secondary: شرح التكامل المنهجي |
| المنطق وتكنولوجيا الاتصال | unit | منطق | الصف الثالث الثانوي | - | المنطق التطبيقي | المنطق وتكنولوجيا الاتصال | - | `/courses/{course-slug}/units/{unit-2-id}` | index | Primary: المنطق وتكنولوجيا الاتصال / Secondary: شرح المنطق الرقمي |

### 7.2 علم النفس والاجتماع — الصف الثالث الثانوي

| Keyword | Intent | Subject | Grade | Term/Part | Unit | Chapter | Lesson | Target URL | Indexability | Primary/Secondary |
|---------|--------|---------|-------|-----------|------|---------|--------|------------|--------------|-------------------|
| الوحدة الأولى علم نفس تالتة ثانوي | unit | علم النفس | الصف الثالث الثانوي | - | الوحدة الأولى: الذكاء والتعلم | - | - | `/courses/{course-slug}/units/{unit-id}` | index | Primary: الذكاء والتعلم / Secondary: الوحدة الأولى علم نفس |
| الذكاء الواحد والذكاءات المتعددة | unit | علم النفس | الصف الثالث الثانوي | - | الذكاء والتعلم | الذكاء الواحد والذكاءات المتعددة | - | `/courses/{course-slug}/units/{unit-id}` | index | Primary: الذكاء الواحد والذكاءات المتعددة / Secondary: شرح الذكاءات المتعددة، نظرية جاردنر |
| نظريات التعلم | unit | علم النفس | الصف الثالث الثانوي | - | الذكاء والتعلم | نظريات التعلم وتطبيقاتها التربوية | - | `/courses/{course-slug}/units/{unit-id}` | index | Primary: نظريات التعلم / Secondary: شرح نظريات التعلم، بافلوف، ثورندايك |
| مبادئ التعلم الجيد | unit | علم النفس | الصف الثالث الثانوي | - | الذكاء والتعلم | مبادئ التعلم الجيد وأسس الاستذكار الفعال | - | `/courses/{course-slug}/units/{unit-id}` | index | Primary: مبادئ التعلم الجيد / Secondary: أسس الاستذكار الفعال، شرح الاستذكار |
| الوحدة الثانية النمو الإنساني | unit | علم النفس | الصف الثالث الثانوي | - | الوحدة الثانية: النمو الإنساني | - | - | `/courses/{course-slug}/units/{unit-id}` | index | Primary: النمو الإنساني / Secondary: الوحدة الثانية علم نفس |
| النمو تعريفه ومبادئه | unit | علم النفس | الصف الثالث الثانوي | - | النمو الإنساني | النمو تعريفه ومبادئه والعوامل المؤثرة فيه | - | `/courses/{course-slug}/units/{unit-id}` | index | Primary: النمو تعريفه ومبادئه / Secondary: شرح النمو الإنساني، العوامل المؤثرة في النمو |
| النمو في مرحلة الطفولة | unit | علم النفس | الصف الثالث الثانوي | - | النمو الإنساني | النمو في مرحلة الطفولة | - | `/courses/{course-slug}/units/{unit-id}` | index | Primary: النمو في مرحلة الطفولة / Secondary: الرضاعة، الطفولة المبكرة، المتأخرة |
| النمو في المراهقة | unit | علم النفس | الصف الثالث الثانوي | - | النمو الإنساني | النمو في المراهقة | - | `/courses/{course-slug}/units/{unit-id}` | index | Primary: النمو في المراهقة / Secondary: شرح المراهقة، مظاهر النمو في المراهقة |
| الوحدة الثالثة الشخصية | unit | علم النفس | الصف الثالث الثانوي | - | الوحدة الثالثة: الشخصية وأساليب التوافق | - | - | `/courses/{course-slug}/units/{unit-id}` | index | Primary: الشخصية وأساليب التوافق / Secondary: الوحدة الثالثة علم نفس |
| الشخصية مفهومها ونظرياتها | unit | علم النفس | الصف الثالث الثانوي | - | الشخصية | الشخصية مفهومها نظرياتها | - | `/courses/{course-slug}/units/{unit-id}` | index | Primary: الشخصية مفهومها نظرياتها / Secondary: شرح الشخصية، نظريات الشخصية، فرويد |
| الاتجاهات والقيم | unit | علم النفس | الصف الثالث الثانوي | - | الشخصية | الاتجاهات والقيم | - | `/courses/{course-slug}/units/{unit-id}` | index | Primary: الاتجاهات والقيم / Secondary: شرح الاتجاهات، شرح القيم |
| أساليب التوافق | unit | علم النفس | الصف الثالث الثانوي | - | الشخصية | أساليب التوافق | - | `/courses/{course-slug}/units/{unit-id}` | index | Primary: أساليب التوافق / Secondary: التوافق النفسي، الإحباط والصراع |
| النظرية الاجتماعية | unit | علم الاجتماع | الصف الثالث الثانوي | - | الوحدة الأولى: نظرية علم الاجتماع | النظرية الاجتماعية بناؤها ووظائفها | - | `/courses/{course-slug}/units/{unit-id}` | index | Primary: النظرية الاجتماعية / Secondary: شرح النظرية الاجتماعية |
| التفاعل الاجتماعي | unit | علم الاجتماع | الصف الثالث الثانوي | - | نظرية علم الاجتماع | التفاعل الاجتماعي والعلاقات الاجتماعية | - | `/courses/{course-slug}/units/{unit-id}` | index | Primary: التفاعل الاجتماعي / Secondary: العلاقات الاجتماعية |
| الظاهرة الاجتماعية | unit | علم الاجتماع | الصف الثالث الثانوي | - | نظرية علم الاجتماع | الظاهرة الاجتماعية | - | `/courses/{course-slug}/units/{unit-id}` | index | Primary: الظاهرة الاجتماعية / Secondary: شرح الظاهرة الاجتماعية، دوركايم |

---

## 8. Lesson Clusters (الدرس) — كل درس حقيقي = Cluster

> ملاحظة: أسماء الدروس أدناه مأخوذة من المنهج الوزاري المصري الحقيقي (الموثق في البحث أعلاه) وليست تخمين. في المنصة الحية، كل درس منشور في DB يولّد Cluster مماثل ديناميكيًا عبر `buildLessonCluster()`.

| Keyword | Intent | Subject | Grade | Term/Part | Unit | Chapter | Lesson | Target URL | Indexability | Primary/Secondary |
|---------|--------|---------|-------|-----------|------|---------|--------|------------|--------------|-------------------|
| شرح الفلسفة وقضايا البيئة | lesson_explanation | فلسفة | الصف الثالث الثانوي | - | الفلسفة التطبيقية | الفلسفة وقضايا البيئة | الفلسفة وقضايا البيئة | `/courses/{course-slug}` | index | Primary: شرح الفلسفة وقضايا البيئة / Secondary: شرح درس الفلسفة وقضايا البيئة، فيديو شرح الفلسفة وقضايا البيئة، ملخص الفلسفة وقضايا البيئة، مصطفى تيتو |
| ملخص الفلسفة وقضايا البيئة PDF | lesson_pdf | فلسفة | الصف الثالث الثانوي | - | الفلسفة التطبيقية | الفلسفة وقضايا البيئة | الفلسفة وقضايا البيئة | `/courses/{course-slug}` | index | Primary: ملخص الفلسفة وقضايا البيئة PDF / Secondary: مذكرة الفلسفة وقضايا البيئة PDF، ملخص PDF |
| مراجعة الفلسفة وقضايا البيئة | lesson_revision | فلسفة | الصف الثالث الثانوي | - | الفلسفة التطبيقية | الفلسفة وقضايا البيئة | الفلسفة وقضايا البيئة | `/courses/{course-slug}` | index | Primary: مراجعة الفلسفة وقضايا البيئة / Secondary: مراجعة نهائية الفلسفة وقضايا البيئة |
| أسئلة الفلسفة وقضايا البيئة | lesson_questions | فلسفة | الصف الثالث الثانوي | - | الفلسفة التطبيقية | الفلسفة وقضايا البيئة | الفلسفة وقضايا البيئة | `/courses/{course-slug}` (→ external) | index | Primary: أسئلة الفلسفة وقضايا البيئة / Secondary: تدريبات الفلسفة وقضايا البيئة، حل أسئلة الفلسفة وقضايا البيئة، امتحان الفلسفة وقضايا البيئة |
| شرح الاستدلال الاستقرائي | lesson_explanation | منطق | الصف الثالث الثانوي | - | المنطق التطبيقي | الاستدلال الاستقرائي | الاستدلال الاستقرائي وتطبيقه في العلوم الطبيعية | `/courses/{course-slug}` | index | Primary: شرح الاستدلال الاستقرائي / Secondary: شرح درس الاستدلال الاستقرائي، فيديو شرح الاستقراء، ملخص الاستقراء، مصطفى تيتو منطق |
| ملخص الاستدلال الاستقرائي | lesson_summary | منطق | الصف الثالث الثانوي | - | المنطق التطبيقي | الاستدلال الاستقرائي | الاستدلال الاستقرائي | `/courses/{course-slug}` | index | Primary: ملخص الاستدلال الاستقرائي / Secondary: ملخص درس الاستقراء، الاستقراء PDF |
| مراجعة الاستدلال الاستقرائي | lesson_revision | منطق | الصف الثالث الثانوي | - | المنطق التطبيقي | الاستدلال الاستقرائي | الاستدلال الاستقرائي | `/courses/{course-slug}` | index | Primary: مراجعة الاستدلال الاستقرائي / Secondary: مراجعة نهائية منطق |
| أسئلة الاستدلال الاستقرائي | lesson_questions | منطق | الصف الثالث الثانوي | - | المنطق التطبيقي | الاستدلال الاستقرائي | الاستدلال الاستقرائي | `/courses/{course-slug}` (→ external) | index | Primary: أسئلة الاستدلال الاستقرائي / Secondary: تدريبات الاستقراء، امتحان الاستقراء |
| شرح الذكاء الواحد والذكاءات المتعددة | lesson_explanation | علم النفس | الصف الثالث الثانوي | - | الذكاء والتعلم | الذكاء الواحد | الذكاء الواحد والذكاءات المتعددة | `/courses/{course-slug}` | index | Primary: شرح الذكاء الواحد والذكاءات المتعددة / Secondary: شرح الذكاءات المتعددة، فيديو شرح الذكاء، ملخص الذكاء، مصطفى تيتو علم نفس |
| ملخص الذكاءات المتعددة PDF | lesson_pdf | علم النفس | الصف الثالث الثانوي | - | الذكاء والتعلم | الذكاء | الذكاءات المتعددة | `/courses/{course-slug}` | index | Primary: ملخص الذكاءات المتعددة PDF / Secondary: مذكرة الذكاء PDF |
| مراجعة الذكاء والتعلم | lesson_revision | علم النفس | الصف الثالث الثانوي | - | الذكاء والتعلم | - | الذكاء والتعلم | `/courses/{course-slug}` | index | Primary: مراجعة الذكاء والتعلم / Secondary: مراجعة نهائية علم نفس، مراجعة الذكاء |
| أسئلة الذكاء والتعلم | lesson_questions | علم النفس | الصف الثالث الثانوي | - | الذكاء والتعلم | - | الذكاء والتعلم | `/courses/{course-slug}` (→ external) | index | Primary: أسئلة الذكاء والتعلم / Secondary: تدريبات الذكاء، امتحان الذكاء والتعلم |
| شرح النمو في مرحلة الطفولة | lesson_explanation | علم النفس | الصف الثالث الثانوي | - | النمو الإنساني | النمو في الطفولة | النمو في مرحلة الطفولة | `/courses/{course-slug}` | index | Primary: شرح النمو في مرحلة الطفولة / Secondary: شرح الطفولة، ملخص الطفولة، فيديو شرح الطفولة |
| شرح الشخصية مفهومها نظرياتها | lesson_explanation | علم النفس | الصف الثالث الثانوي | - | الشخصية | الشخصية | الشخصية مفهومها نظرياتها | `/courses/{course-slug}` | index | Primary: شرح الشخصية مفهومها نظرياتها / Secondary: شرح الشخصية، نظريات الشخصية، فرويد |
| شرح الاتجاهات والقيم | lesson_explanation | علم النفس | الصف الثالث الثانوي | - | الشخصية | الاتجاهات والقيم | الاتجاهات والقيم | `/courses/{course-slug}` | index | Primary: شرح الاتجاهات والقيم / Secondary: شرح الاتجاهات، شرح القيم |
| شرح النظرية الاجتماعية | lesson_explanation | علم الاجتماع | الصف الثالث الثانوي | - | نظرية علم الاجتماع | النظرية الاجتماعية | النظرية الاجتماعية بناؤها ووظائفها | `/courses/{course-slug}` | index | Primary: شرح النظرية الاجتماعية / Secondary: شرح النظرية الاجتماعية بناؤها ووظائفها |
| شرح التطرف والعنف | lesson_explanation | علم الاجتماع | الصف الثالث الثانوي | - | علم الاجتماع والقضايا المجتمعية | التطرف والعنف | التطرف والعنف | `/courses/{course-slug}` | index | Primary: شرح التطرف والعنف / Secondary: ملخص التطرف، مراجعة التطرف |

---

## 9. Search Formula Coverage (صيغ البحث)

لكل درس، نفس Canonical يخدم كل الصيغ:

| Search Formula | Example | Canonical | Indexability |
|----------------|---------|-----------|--------------|
| شرح | شرح الفلسفة وقضايا البيئة | `/courses/{slug}` | index |
| ملخص | ملخص الفلسفة وقضايا البيئة | `/courses/{slug}` | index |
| مراجعة | مراجعة الفلسفة وقضايا البيئة | `/courses/{slug}` | index |
| مراجعة نهائية | مراجعة نهائية فلسفة تالتة ثانوي | `/courses/{slug}` | index |
| أسئلة | أسئلة الفلسفة وقضايا البيئة | `/courses/{slug}` → external Questions Platform | index (course page) |
| امتحان | امتحان الفلسفة وقضايا البيئة | `/courses/{slug}` → external | index |
| تدريبات | تدريبات الاستدلال الاستقرائي | `/courses/{slug}` → external | index |
| حل أسئلة | حل أسئلة الذكاءات المتعددة | `/courses/{slug}` → external | index |
| فيديو شرح | فيديو شرح الذكاء الواحد | `/courses/{slug}` | index |
| PDF | ملخص الفلسفة وقضايا البيئة PDF | `/courses/{slug}` + `/p/resources` | index |
| + المادة | شرح فلسفة البيئة فلسفة | `/subjects/{slug}` أو `/courses/{slug}` | index |
| + الصف | شرح فلسفة البيئة تالتة ثانوي | `/subjects/{slug}` (title يحمل الصف) | index |
| + السنة | فلسفة البيئة 2026، منهج الفلسفة 2026 | نفس الصفحات (year في metadata) | index |
| + مصطفى تيتو | شرح فلسفة البيئة مصطفى تيتو | `/courses/{slug}` | index |

---

## 10. Academic Year Handling

- لا يوجد عمود سنة في schema (programs/grades/subjects/courses) — لا صفحات `/2026/` (doorway)
- السنة تُضاف في SEO title/description عبر Admin → Content أو Appearance → System
- مثال: title = "الفلسفة وقضايا البيئة — الصف الثالث الثانوي 2026 — د/ مصطفى تيتو"
- URLs تبقى دائمة (no churn)

---

## 11. Topical Authority Implementation

### 11.1 JSON-LD
- **Organization** + **Person** (مصطفى تيتو) مع `knowsAbout`: ["فلسفة", "علم نفس", "منطق", "علم اجتماع"]
- **Course** مع `hasPart` للوحدات، `teaches` للمفاهيم، `educationalLevel` للصف، `inLanguage: ar`
- **LearningResource** للوحدات والدروس
- **DefinedTermSet** للمفاهيم الدلالية
- **BreadcrumbList** كامل: الرئيسية → البرامج → الصف → المادة → الكورس → الوحدة
- **WebPage** مع `educationalLevel`

### 11.2 Content
- Course page: قائمة وحدات + دروس حقيقية (من DB)
- Unit page: قائمة دروس حقيقية + semantic keywords من المنهج
- Subject page: وصف غني + grade في title + DefinedTermSet
- Grade page: وصف من المواد الحقيقية التي تحتويها

### 11.3 Internal Linking
- Subject → Grade (chip)
- Grade → Subjects (cards)
- Course → Subject (breadcrumb)
- Unit → Course → Subject → Grade → Program (breadcrumb كامل)
- Homepage discovery: subjects/grades/courses المنشورة

---

## 12. ملاحظات التنفيذ

- **لا Keyword Stuffing:** كل وصف مصنوع من بيانات حقيقية (عناوين، أوصاف، مفاهيم) وليس تكرار كلمات
- **لا Thin Content:** لا صفحة بدون كورسات منشورة (anti-thin في inventory)
- **لا صفحات وهمية:** كل URL في sitemap يطابق صفًا منشورًا في DB
- **Questions Platform:** أسئلة/امتحانات/تدريبات تذهب لمنصة خارجية (entry point في course page) — Tito لا يستضيف أسئلة
- **التصميم:** لم يتغير
- **الدفع:** لم يلمس (InstaPay, Cash, Receipt Proof, WhatsApp, Activation Codes كما هي)
- **Year:** لا صفحات سنة، فقط metadata

---

## 13. كيفية التحديث عند وصول ملفات Keyword Universe الحقيقية

1. ضع الملفين في `docs/seo/` (مثلاً `keyword-universe-philosophy.csv` و `keyword-universe-psychology.csv`)
2. شغّل `node scripts/build-seo-map.mjs` (سينشئ `seo-content-map.md` من الملفين + DB)
3. راجع `buildLessonCluster()` في `server/seo/keywordClusters.server.ts` — يستخدم أسماء الدروس من الملفات كـ source of truth
4. أعد بناء sitemap: تلقائي (inventory يقرأ DB)
5. لا حاجة لتعديل routes — canonical strategy ثابتة

---

## 14. الخلاصة: العلاقة التي يفهمها Google

```
مصطفى تيتو (Person, knowsAbout: فلسفة، علم نفس، منطق)
  → منصة Tito (Organization, WebSite)
    → المادة (Subject: الفلسفة / علم النفس / المنطق / علم الاجتماع)
      → الصف (Grade: الأول / الثاني / الثالث الثانوي)
        → الوحدة (Unit: الفلسفة التطبيقية، الذكاء والتعلم، ...)
          → الدرس (Lesson: الفلسفة وقضايا البيئة، الذكاءات المتعددة، ...)
            → المفاهيم (Concepts: التنمية المستدامة، جاردنر، بافلوف، ...)
```

كل مستوى له صفحة canonical واحدة، مع breadcrumb و JSON-LD يربط المستويات.

---

## 15. Code Implementation (Phase 2 — Lesson Clusters)

### 15.1 `server/seo/keywordClusters.server.ts`
- `CURRICULUM_SEMANTIC_MAP`: 30+ real Ministry concepts (فلسفة البيئة، الذكاءات المتعددة، الاستدلال الاستقرائي...)
- `extractSemanticKeywords(lesson, unit, subject)`: precise match only (no guessing), caps at 12 to avoid stuffing
- `buildSearchFormulas()`: generates شرح، ملخص، مراجعة، أسئلة، امتحان، تدريبات، حل أسئلة، فيديو شرح، PDF + subject/grade/brand
- `buildLessonCluster(ancestry)`: 7 clusters per real DB lesson row (discovery→unit page, explanation/summary/revision/questions/video/pdf→course page) — one strong canonical per intent
- `buildSubjectCluster()`, `buildGradeCluster()`, `buildBrandCluster()`: top-level clusters

### 15.2 `server/seo/canonicalMap.server.ts`
- `CANONICAL_MAP`: 16 intents covering branded, subject variants (فلسفة/فلسفه), grade variants (تالتة ثانوي/ثالثة ثانوي), grade+subject, course, unit, lesson discovery/explanation/summary/revision/questions/video/pdf, resources, academic_year
- `getCanonicalForIntent(intent, params)`: stable URL resolver (no query strings, no year in URL)
- `validateCanonicalUniqueness()`: anti-cannibalization check
- Implements requirement: لا تنشئ صفحة منفصلة لكل صيغة بحث؛ استخدم Canonical URL واحد قوي لكل Intent
- Year keywords (2026) map to same dynamic pages with year in metadata only

### 15.3 `server/seo/topicalAuthority.server.ts`
- `buildTopicalAuthorityGraph()`: builds entity graph Person→Organization→Program→Grade→Subject from live DB
- `generateBreadcrumbForLesson()`: full trail الرئيسية→الكورسات→البرنامج→الصف→المادة→الكورس→الوحدة→الدرس
- `validateTopicalAuthority()`: ensures no invented entities, hierarchy intact
- Goal: Google understands مصطفى تيتو → المنصة → المادة → الصف → الوحدة → الدرس → المفاهيم

### 15.4 Tests
- `tests/unit/keywordClusters.test.ts`: 16 tests covering lesson clusters, semantic extraction, search formulas, canonical map, anti-cannibalization, public-only indexable URLs
- Integration: 286 tests pass, unit: 307 tests pass (593 total)
- Build: succeeds, no design/payment changes

---

**Generated by:** SEO Lesson Phase — data-driven, no invented lessons, canonical per intent, topical authority via real curriculum concepts.
