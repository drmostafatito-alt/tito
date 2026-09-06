# تخصيص المنصة / Admin customization

دليل المشرف (عربي) ثم English. لا يحتاج أي تغيير هنا إلى نشر كود جديد.

---

## العربية

### 1) الدخول إلى لوحة الإدارة

- المصدر: حساب يُنشأ عبر `scripts/bootstrap-admin.mjs` (الإنتاج) أو `npm run db:seed:local` (تطوير محلي فقط).
- البريد: متغير البيئة `ADMIN_BOOTSTRAP_EMAIL` أو `.dev.vars` أو `--email=you@example.com`. لا يوجد بريد إنتاج ثابت في الكود.
- مثال التطوير في `.dev.vars.example`: `admin@educore.local` — **ليس هوية إنتاج**. `bootstrap-admin --remote` يرفضه. الإنتاج يضبط البريد من البيئة فقط.
- كلمة المرور: لا تُطبع من الـ seed. في bootstrap الإنتاج تُعرض مرة واحدة للمشغّل ثم تُغيَّر فورًا من **الملف الشخصي ← الأمان**.
- بيانات الفيزياء / `*.educore.local` في الـ seed هي تجهيزات تجريبية لـ LMS/e2e وليست هوية الموقع (الفلسفة وعلم النفس). لا تُحذف الجداول بسببها.

### 2) أين تُحرَّر الواجهة العامة؟

| العنصر | أين يُحرَّر | ملاحظات |
|---|---|---|
| الشعار / الاسم / صورة المالك | المظهر ← الهوية | ملفات من المكتبة |
| قائمة الرأس والتذييل | CMS ← القوائم | عناصر ثنائية اللغة |
| روابط السوشيال | المظهر ← وسائل التواصل | قائمة مفتوحة، ليست منصات ثابتة |
| الصفحة الرئيسية وأي صفحة تسويق | CMS ← الصفحات ← المحرر | تُنشر صراحة |
| SEO لكل صفحة | محرر الصفحة ← SEO | يحتاج صلاحية SEO |
| الألوان / الخط / الكثافة | المظهر ← الألوان والتصميم | توكنات فقط عبر `/theme.css` |
| بطاقات الكورس/المادة | المظهر ← عرض المحتوى | الشكل لا البيانات |
| لوحة الطالب | المظهر ← لوحة الطالب | الوحدات الموجودة فقط |
| تسميات النظام (دخول، أخطاء، صيانة) | ملفات الترجمة `app/locales` | ليست محتوى تسويقيًا |
| نصوص قانونية/أمنية | ثابتة في الكود عن قصد | لا تُحوَّل إلى CMS |

لا يوجد محتوى تسويقي ثابت في الواجهة العامة عدا السلاسل النظامية (أخطاء، صيانة، مصادقة).

### 3) محرر الصفحات

من `/admin/cms/pages/:id`:

- إضافة / حذف / نسخ / إعادة ترتيب / إخفاء / إظهار الأقسام والمكوّنات.
- الحقول ثنائية اللغة (عربي/إنجليزي).
- **حفظ** = مسودة. الزوّار لا يرون المسودة أبدًا.
- **نشر** = التحقق + تعقيم النص المنسّق + تجميد لقطة.
- **استعادة نسخة** تعيد المسودة دون مسح السجل.

### 4) النص المنسّق

مسموح: عريض، مائل، تسطير، رابط، عناوين، محاذاة، ألوان من توكنات الثيم فقط (`rt-c-brand`…).

ممنوع: HTML/CSS/JS حر، `javascript:`, `style=`, صور/iframe عشوائية. يُعقَّم على الخادم عند النشر. CSP يبقى كما هو.

### 5) الخطوط (عربي أولًا)

- الافتراضي: **Cairo** (ملفات `woff2` ذاتية الاستضافة في `/fonts/cairo`).
- البديل: **IBM Plex Sans Arabic**.
- من المظهر: خط العناوين وخط النص (`cairo` أو `ibm`) + مقياس الخط.

### 6) اللغة

- الزائر الجديد: `lang=ar` و `dir=rtl` حتى لو كان المتصفح `en-US`.
- اختيار صريح (مبدّل اللغة ← كوكي `edu_locale`) يتقدّم على `Accept-Language`.
- تفضيل الحساب المسجّل يُستخدم إن لم توجد كوكي.
- على `http://localhost` الكوكي ليست `Secure` حتى تُحفظ.

### 7) السوشيال

من المظهر: إضافة / تعديل / حذف / تفعيل / ترتيب / مواضع (`رأس | تذييل | الرئيسية | تواصل`). لا تُعرض أيقونة بلا رابط أو إن كانت معطّلة.

### 8) القوالب

`/admin/cms/templates` + من محرر الصفحة: تطبيق قالب (يؤكد استبدال **المسودة** فقط) أو حفظ الصفحة كقالب. التطبيق ينسخ أقسامًا بمعرّفات جديدة؛ تعديل القالب لاحقًا لا يغيّر الصفحات المنشورة.

### 9) المكتبة

`/admin/files`: رفع، معاينة، إعادة تسمية، نص بديل عربي/إنجليزي، استبدال مع الإبقاء على نفس المعرّف، عرض الاستخدام، حذف إن لم يكن مستخدمًا. الاختيار داخل المحرر من الملفات العامة.

### 10) الأداء

الصفحة الرئيسية ترسم لقطة CMS مجمّدة (بدون مسودات). مشغّل الفيديو يُحمَّل كسولة. الخطوط ذاتية. الصور عبر المكتبة (فضّل WebP). لا تضع فيديو تلقائي في الهيرو إن لم تكن بحاجة إليه.

---

## English

### 1) Admin login

- Source: `scripts/bootstrap-admin.mjs`.
- Email: `ADMIN_BOOTSTRAP_EMAIL`, `.dev.vars`, or `--email=`.
- Dev example in `.dev.vars.example`: `admin@educore.local` (technical name — not visitor-facing).
- Password is supplied via env at bootstrap and is never printed. Change it immediately under **Profile → Security**.

### 2) Editable vs hardcoded

Public marketing copy lives in the CMS builder, Appearance (identity/theme/presentation/dashboard), or i18n for chrome/system strings. Legal, security, and error strings stay in code on purpose.

### 3) Page builder

Add / delete / duplicate / reorder / hide / show / edit sections and blocks. Localized fields. Save = draft (never public). Publish validates, sanitizes rich text, and freezes a snapshot. Restore copies a version back into the draft.

### 4) Rich text

Allowlist only: bold/italic/underline/link/headings/alignment and **theme-token colors**. No arbitrary HTML/CSS/JS. Sanitized on publish. CSP/XSS protections stay in place.

### 5) Fonts

Arabic-first self-hosted **Cairo**; optional **IBM Plex Sans Arabic**. Heading/body/scale are admin-controlled and emitted through `/theme.css`.

### 6) Locale

Fresh visitors get Arabic+RTL even when `Accept-Language` is `en-US`. An explicit switcher cookie beats Accept-Language. Logged-in `localePref` applies when no cookie is set. The locale cookie omits `Secure` on HTTP localhost.

### 7) Social media

Data-driven list (not a closed platform enum): add/edit/delete/enable/reorder and placements header|footer|home|contact. Hidden when URL empty or disabled.

### 8) Templates

Applying a template copies an **independent** section snapshot into the draft (confirm required). Published pages are unchanged until you publish. Later template edits do not mutate existing pages.

### 9) Media library

Upload, preview, rename, bilingual alt, replace in place (same id), usage check, delete only if unused. CMS image pickers use public files.

### 10) Design tokens

Colors, radii, shadow, density, and font scale are shared tokens. Templates and blocks use roles (`bg=brand`, `tint=accent`) — never per-template hex values.

### Permissions

CMS actions require `cms.read` / `cms.edit` / `cms.publish` / `cms.manage_seo` / `cms.delete` as already documented in `docs/CMS.md`.
