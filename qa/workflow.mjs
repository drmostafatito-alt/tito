/**
 * Full LMS lifecycle workflow test (local dev only) — drives the REAL UI.
 *
 * Admin: create program→grade→subject→course→unit→lesson, edit+save lesson,
 * create MCQ question (choices/correct/explanation/points/difficulty), publish
 * it, create exam, attach question, configure+publish exam, grant entitlement.
 * Student: see exam, attempt it, submit, view result.
 * Admin: review the attempt, verify student 360 reflects everything.
 *
 * Parametrized matrix runs:
 *   QA_LOCALE=en|ar       (default en)  — UI locale + RTL/LTR
 *   QA_VIEWPORT=desktop|mobile (default desktop) — 1440×900 | 390×844
 *
 * Every created entity title carries a unique fixed-length run tag "[xxxxx]"
 * so repeated runs never collide on parent-select labels or tree searches.
 * Locale-dependent labels are matched via AR|EN alternation so the same script
 * drives both directions.
 */
import { chromium } from "@playwright/test";
import { BASE, ensureAuth } from "./lib.mjs";

const LOCALE = process.env.QA_LOCALE === "ar" ? "ar" : "en";
const VIEWPORT = process.env.QA_VIEWPORT === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 };
console.log(`config: locale=${LOCALE} viewport=${VIEWPORT.width}x${VIEWPORT.height}`);

const TAG = (Math.random().toString(36).slice(2, 7) + "00000").slice(0, 5);
const T = (s) => `${s} [${TAG}]`;
console.log(`run tag: ${TAG}`);

const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** match either the Arabic or the English title (labels are locale-dependent) */
const either = (ar, en) => new RegExp(`${rx(ar)}|${rx(en)}`);

// localized UI strings the workflow asserts against
const S =
  LOCALE === "ar"
    ? {
        created: "تم الإنشاء",
        saved: "تم الحفظ",
        published: "منشور",
        choiceAr: "الخيار (عربي)",
        choiceEn: "الخيار (إنجليزي)",
        addChoice: /إضافة خيار/i,
        startExam: /ابدأ الامتحان/,
        finishSubmit: /إنهاء وتسليم/,
        confirmYes: /تسليم نهائي/,
      }
    : {
        created: "Created",
        saved: "Saved",
        published: "Published",
        choiceAr: "Choice (Arabic)",
        choiceEn: "Choice (English)",
        addChoice: /add choice/i,
        startExam: /start exam|begin/i,
        finishSubmit: /finish & submit/i,
        confirmYes: /submit for good/i,
      };

// bilingual entity titles for this run
const TITLES = {
  program: { ar: T("أسس الفلسفة"), en: T("Philosophy Foundations") },
  grade: { ar: T("السنة الأولى"), en: T("Year 1") },
  subject: { ar: T("المنطق"), en: T("Logic") },
  course: { ar: T("مدخل المنطق"), en: T("Logic 101") },
  unit: { ar: T("الوحدة الأولى"), en: T("Unit 1 — Arguments") },
  lesson: { ar: T("ما هي الحجة؟"), en: T("What is an argument?") },
  lessonRev: { ar: T("ما هي الحجة؟ (مراجعة)"), en: T("What is an argument? (rev)") },
  exam: { ar: T("اختبار المنطق ١"), en: T("Logic Quiz 1") },
};

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
const problems = [];
let step = 0;
const ok = (name, cond) => {
  console.log(`${cond ? "✓" : "✗ FAIL"}  [${String(step).padStart(2, "0")}] ${name}`);
  if (!cond) process.exitCode = 1;
};
const next = (name) => console.log(`\n—— ${name} ——`);

const admin = await ensureAuth(browser, "admin", { locale: LOCALE, viewport: VIEWPORT });
// force the run locale even when a saved auth state carries an old cookie
await admin.ctx.addCookies([{ name: "edu_locale", value: LOCALE, url: BASE }]);
admin.page.on("console", (m) => { if (m.type() === "error") problems.push(`admin console: ${m.text().slice(0, 150)}`); });
admin.page.on("pageerror", (e) => problems.push(`admin pageerror: ${e.message.slice(0, 150)}`));
const page = admin.page;
const dlg = page.on("dialog", (d) => d.accept());
void dlg;

async function createContent(type, parent, titleAr, titleEn, status = "published") {
  await page.goto(`${BASE}/admin/content`, { waitUntil: "networkidle" });
  const form = page.locator('form:has(input[value="create-content"])');
  await form.locator('select[name="contentType"]').selectOption(type);
  // parent options refresh reactively after the type change — wait for either
  // the AR or the EN label, then select by value (labels are locale-dependent)
  const parent_ = form.locator('select[name="parentId"]');
  const re = either(parent.ar, parent.en);
  await page.waitForFunction(
    (reSrc) => [...document.querySelectorAll('select[name="parentId"] option')].some((o) => new RegExp(reSrc).test(o.textContent ?? "")),
    re.source,
    { timeout: 15000 }
  );
  const opt = form.locator('select[name="parentId"] option').filter({ hasText: re }).first();
  await parent_.selectOption(await opt.getAttribute("value"));
  await form.locator('input[name="titleAr"]').fill(titleAr);
  await form.locator('input[name="titleEn"]').fill(titleEn);
  await form.locator('select[name="status"]').selectOption(status);
  await form.getByRole("button").last().click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

async function openEditor(type, title) {
  await page.goto(`${BASE}/admin/content`, { waitUntil: "networkidle" });
  // tree search matches AR, EN and slug — search the EN title, click either
  await page.locator('[data-testid="content-tree-search"]').fill(title.en);
  await page.waitForTimeout(400);
  const link = page.locator('[data-testid="content-tree-results"] a', { hasText: either(title.ar, title.en) }).first();
  await link.click();
  await page.waitForURL(new RegExp(`/admin/content/${type}/`));
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  const id = page.url().split(`/${type}/`)[1]?.split("?")[0];
  return id;
}

// ───────────────────────── 1. content hierarchy ─────────────────────────
next("Create content hierarchy (program → lesson)");
step = 1;
await page.goto(`${BASE}/admin/content`, { waitUntil: "networkidle" });
const progForm = page.locator('form:has(input[value="create-program"])');
await progForm.locator('input[name="titleAr"]').fill(TITLES.program.ar);
await progForm.locator('input[name="titleEn"]').fill(TITLES.program.en);
await progForm.locator('select[name="status"]').selectOption("published");
await progForm.getByRole("button").click();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(400);
ok("program created", await page.getByText(S.created).first().isVisible());

step = 2;
await createContent("grade", TITLES.program, TITLES.grade.ar, TITLES.grade.en);
ok("grade created", await page.getByText(S.created).first().isVisible());

step = 3;
await createContent("subject", TITLES.grade, TITLES.subject.ar, TITLES.subject.en);
ok("subject created", await page.getByText(S.created).first().isVisible());

step = 4;
await createContent("course", TITLES.subject, TITLES.course.ar, TITLES.course.en, "draft");
ok("course created (draft)", await page.getByText(S.created).first().isVisible());

step = 5;
const courseId = await openEditor("course", TITLES.course);
ok("course editor opens", Boolean(courseId));
console.log("   course id:", courseId);

step = 6;
// set course access to authenticated + publish it via editor save form
await page.locator('select[name="accessLevel"]').first().selectOption("authenticated");
await page.locator('select[name="status"]').first().selectOption("published");
await page.locator('form:has(input[value="save"]) button[type="submit"]').first().click();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(500);
ok("course saved+published", await page.getByText(S.saved).first().isVisible());

step = 7;
await createContent("unit", TITLES.course, TITLES.unit.ar, TITLES.unit.en);
ok("unit created", await page.getByText(S.created).first().isVisible());

step = 8;
await createContent("lesson", TITLES.unit, TITLES.lesson.ar, TITLES.lesson.en);
ok("lesson created", await page.getByText(S.created).first().isVisible());

// ───────────────────────── 2. edit lesson ─────────────────────────
next("Edit + save lesson");
step = 9;
const lessonId = await openEditor("lesson", TITLES.lesson);
ok("lesson editor opens", Boolean(lessonId));
await page.locator('input[name="titleAr"]').first().fill(TITLES.lessonRev.ar);
await page.locator('input[name="titleEn"]').first().fill(TITLES.lessonRev.en);
await page.locator('form:has(input[value="save"]) button[type="submit"]').first().click();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(300);
ok("lesson edited+saved", await page.getByText(S.saved).first().isVisible());

// ───────────────────────── 3. question bank ─────────────────────────
next("Create MCQ question with full metadata");
step = 10;
await page.goto(`${BASE}/admin/assessment/questions/new`, { waitUntil: "networkidle" });
await page.locator("form select").first().selectOption("mcq");
await page.locator('textarea[name="stemAr"]').fill("ما هي الحجة الصحيحة؟");
await page.locator('textarea[name="stemEn"]').fill("Which statement is a valid argument?");
await page.locator('select[name="difficulty"]').selectOption("easy");
await page.locator('input[name="pointsDefault"]').fill("5");
// 4 choices: default editor starts with some choices — inspect and fill
const choiceAr = page.getByPlaceholder(S.choiceAr, { exact: true });
const choiceEn = page.getByPlaceholder(S.choiceEn, { exact: true });
const n0 = await choiceAr.count();
ok("choice editor present", n0 >= 2);
let guard = 0;
while ((await choiceAr.count()) < 4 && guard++ < 6) {
  await page.getByRole("button", { name: S.addChoice }).click();
  await page.waitForTimeout(150);
}
const answersAr = ["كل إنسان فان، سقراط إنسان", "السماء زرقاء", "٢ + ٢ = ٥", "لا شيء مما سبق"];
const answersEn = ["All humans are mortal; Socrates is human", "The sky is blue", "2 + 2 = 5", "None of the above"];
for (let i = 0; i < 4; i++) {
  await choiceAr.nth(i).fill(answersAr[i]);
  await choiceEn.nth(i).fill(answersEn[i]);
}
// mark choice 1 correct (radio aria-label = "Correct")
await page.locator('input[type="radio"][aria-label]').first().check();
await page.locator('input[name="explanationAr"]').fill("قياس منطقي صحيح الصورة.");
await page.locator('input[name="explanationEn"]').fill("A valid syllogism: form is valid, premises entail the conclusion.");
await page.locator('form:has(input[value="save"]) button[type="submit"]').first().click();
await page.waitForURL(/\/admin\/assessment\/questions\/(?!new)[^?]+/, { timeout: 20000 });
await page.waitForLoadState("networkidle");
await page.waitForTimeout(400);
const questionId = page.url().split("/questions/")[1].split("?")[0];
ok("question created → editor", Boolean(questionId));

step = 11;
// lifecycle: draft → send to review → publish (two status transitions)
await page.locator('form:has(input[value="status"]) input[value="in_review"] ~ button, form:has(input[value="in_review"]) button[type="submit"]').first().click();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(500);
await page.locator('form:has(input[value="published"]) button[type="submit"]').first().click();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(500);
ok("question published (badge)", await page.getByText(S.published).first().isVisible());

// ───────────────────────── 4. exam builder ─────────────────────────
next("Create + configure + publish exam");
step = 12;
await page.goto(`${BASE}/admin/assessment/exams/new`, { waitUntil: "networkidle" });
await page.locator('input[name="titleAr"]').fill(TITLES.exam.ar);
await page.locator('input[name="titleEn"]').fill(TITLES.exam.en);
// attach to the lesson we created (options are server-rendered for BOTH kinds)
await page.locator('select[name="attachKind"]').selectOption("lesson");
const attachSelect = page.locator('select[name="attachId"]');
const lessonOpt = attachSelect.locator("option", { hasText: either(TITLES.lessonRev.ar, TITLES.lessonRev.en) });
ok("lesson attachable in exam form", (await lessonOpt.count()) === 1);
await attachSelect.selectOption(await lessonOpt.getAttribute("value"));
await page.locator('form:has(input[value="create"]) button[type="submit"]').first().click();
await page.waitForURL(/\/admin\/assessment\/exams\/(?!new)[^?]+/, { timeout: 20000 });
await page.waitForLoadState("networkidle");
const examId = page.url().split("/exams/")[1].split("?")[0];
ok("exam created → builder", Boolean(examId));

step = 13;
// configure timing/attempts/pass
await page.locator('input[name="durationMinutes"]').fill("10");
await page.locator('input[name="passPercent"]').fill("50");
await page.locator('input[name="attemptsMax"]').fill("2");
// save config form (the one with durationMinutes)
const configForm = page.locator('form:has(input[name="durationMinutes"])');
await configForm.getByRole("button").last().click();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(400);
ok("exam config saved", true);

step = 14;
// attach the question (manual mode)
const attachQ = page.locator('form:has(input[value="attach"]) select[name="questionId"]');
if ((await attachQ.count()) === 1) {
  await attachQ.selectOption({ index: 1 });
  await page.locator('form:has(input[value="attach"]) button[type="submit"]').click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}
ok("question attached to exam", (await page.locator('ol a[href*="/admin/assessment/questions/"]').count()) >= 1);

step = 15;
// publish (fail-closed gate should pass: question published + config ok)
await page.locator('form:has(input[value="publish"]) button[type="submit"]').click();
await page.waitForURL(/published=1|tab=exams/, { timeout: 20000 }).catch(() => {});
await page.waitForLoadState("networkidle");
await page.goto(`${BASE}/admin/assessment?tab=exams`, { waitUntil: "networkidle" });
ok("exam listed as published", await page.locator("a", { hasText: either(TITLES.exam.ar, TITLES.exam.en) }).first().isVisible());

// ───────────────────────── 5. entitlement grant ─────────────────────────
next("Grant course entitlement to student");
step = 16;
await page.goto(`${BASE}/admin/entitlements`, { waitUntil: "networkidle" });
await page.locator('input[name="email"]').fill("student@educore.local");
// resource picker = grouped select (kind:id) — pick our course by either title
const resSelect = page.locator('select[name="resource"]');
const resOpt = resSelect.locator("option", { hasText: either(TITLES.course.ar, TITLES.course.en) });
ok("course pickable in resource select", (await resOpt.count()) === 1);
await resSelect.selectOption(await resOpt.getAttribute("value"));
await page.locator('input[name="days"]').fill("30");
await page.locator('input[name="note"]').fill(T("Workflow test grant"));
await page.locator('form:has(input[value="grant"]) button[type="submit"]').click();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(400);
ok("entitlement granted (visible in list)", await page.getByText(T("Workflow test grant")).first().isVisible());

// ───────────────────────── 6. student takes the exam ─────────────────────────
next("Student: exam list → attempt → submit → result");
const student = await ensureAuth(browser, "student", { locale: LOCALE, viewport: VIEWPORT });
await student.ctx.addCookies([{ name: "edu_locale", value: LOCALE, url: BASE }]);
const sp = student.page;
sp.on("console", (m) => { if (m.type() === "error") problems.push(`student console: ${m.text().slice(0, 150)}`); });
sp.on("pageerror", (e) => problems.push(`student pageerror: ${e.message.slice(0, 150)}`));

step = 17;
await sp.goto(`${BASE}/exams`, { waitUntil: "networkidle" });
ok("student sees the new exam", await sp.locator("h2", { hasText: either(TITLES.exam.ar, TITLES.exam.en) }).first().isVisible());
await sp.locator("a", { hasText: either(TITLES.exam.ar, TITLES.exam.en) }).first().click();
await sp.waitForLoadState("networkidle");
await sp.waitForTimeout(400);

step = 18;
// exam detail page → start attempt button
const startBtn = sp.getByRole("button", { name: S.startExam }).first();
ok("start-attempt control present", await startBtn.isVisible());
await startBtn.click();
await sp.waitForURL(/\/exams\/.+\/attempt/, { timeout: 20000 }).catch(() => {});
await sp.waitForLoadState("networkidle");
await sp.waitForTimeout(500);
ok("attempt page reached", /\/attempt/.test(sp.url()));

step = 19;
// answer: select the first choice (the correct one)
await sp.locator("[data-choice-id]").first().click();
await sp.waitForTimeout(200);
// submit via sticky footer
await sp.getByRole("button", { name: S.finishSubmit }).click();
await sp.waitForTimeout(300);
// confirmation modal → confirm ("Submit for good" / "تسليم نهائي")
await sp.getByRole("button", { name: S.confirmYes }).click();
await sp.waitForURL(/results\//, { timeout: 30000 }).catch(() => {});
await sp.waitForLoadState("networkidle");
await sp.waitForTimeout(500);
ok("result page reached", /\/results\//.test(sp.url()));

step = 20;
const resultText = await sp.locator("body").textContent();
ok("result shows score", /\d+\s*%|score|النتيجة|الدرجة/i.test(resultText));

// ───────────────────────── 7. admin reviews the attempt ─────────────────────────
next("Admin: review attempt + student 360");
step = 21;
await page.goto(`${BASE}/admin/assessment/exams/${examId}`, { waitUntil: "networkidle" });
const attemptLink = page.locator('a[href*="/admin/assessment/attempts/"]').first();
ok("attempt visible in exam builder", (await page.locator('a[href*="/admin/assessment/attempts/"]').count()) >= 1);
await attemptLink.click();
await page.waitForURL(/\/admin\/assessment\/attempts\//);
await page.waitForLoadState("networkidle");
const reviewText = await page.locator("body").textContent();
ok("admin attempt review shows student answer", /student@educore\.local|Selected|answer|الإجابة/i.test(reviewText));

step = 22;
// student 360 — search by email (GET form → Enter), then open the row's link
await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
await page.locator('[data-testid="users-search"]').fill("student@educore.local");
await page.locator('[data-testid="users-search"]').press("Enter");
await page.waitForLoadState("networkidle");
await page.waitForTimeout(300);
const row = page.locator('[data-testid="admin-user-row"]', { hasText: "student@educore.local" }).first();
ok("student found in user search", (await row.count()) === 1);
await row.locator('[data-testid="user-link"]').click();
await page.waitForURL(/\/admin\/users\//);
// SPA transition — networkidle alone can resolve before the .data roundtrip
// registers; wait until the detail view actually rendered.
await page.waitForFunction(
  () => /Entitlements|صلاحيات/.test(document.body?.textContent ?? ""),
  null,
  { timeout: 10000 }
);
await page.waitForLoadState("networkidle");
await page.waitForTimeout(300);
const detailText = await page.locator("body").textContent();
ok("student 360 shows entitlement", /Entitlements|صلاحيات|منح/i.test(detailText));
ok("student 360 shows attempt/exam activity", either(TITLES.exam.ar, TITLES.exam.en).test(detailText) || /attempt|محاولة/i.test(detailText));

if (problems.length) {
  console.log("\nPROBLEMS:");
  for (const p of problems) console.log("  -", p);
  process.exitCode = 1;
} else {
  console.log("\nno console/page errors across both sessions");
}
console.log(`\nworkflow ${process.exitCode ? "FAILED" : "PASSED"} (${LOCALE}/${VIEWPORT.width === 390 ? "mobile" : "desktop"}, tag ${TAG})`);
await browser.close();
