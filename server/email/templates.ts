/**
 * Pure, localized, branded transactional email templates (Dr Mostafa Tito).
 * No server runtime imports — trivially unit-testable. Escape all interpolated
 * user content before it reaches `html`. Production-facing copy never references
 * EduCore / SmokePlatform.
 */

export type EmailLocale = "ar" | "en";

export interface EmailBrand {
  /** Platform display name in each language (settings.platform.nameAr/nameEn). */
  nameAr: string;
  nameEn: string;
  /** Contact email to show as the "questions/reply" address (optional). */
  supportEmail?: string | null;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function brandName(brand: EmailBrand, locale: EmailLocale): string {
  const name = locale === "ar" ? brand.nameAr || brand.nameEn : brand.nameEn || brand.nameAr;
  return name || "Dr Mostafa Tito";
}

/** Shared minimal, RTL-safe HTML shell for one text block + optional button/link. */
export function mailShell(opts: {
  locale: EmailLocale;
  brand: EmailBrand;
  heading: string;
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
  footerNote?: string;
}): string {
  const dir = opts.locale === "ar" ? "rtl" : "ltr";
  const cta =
    opts.ctaText && opts.ctaUrl
      ? `<p style="margin:24px 0 0;"><a href="${esc(opts.ctaUrl)}" style="background:#6d28d9;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600;display:inline-block;">${esc(opts.ctaText)}</a></p>`
      : "";
  const footerNote = opts.footerNote
    ? `<p style="margin:26px 0 0;color:#64748b;font-size:12px;line-height:1.5;">${opts.footerNote}</p>`
    : "";
  const support = opts.brand.supportEmail
    ? `<p style="margin:8px 0 0;color:#64748b;font-size:12px;">${esc(brandName(opts.brand, opts.locale))} · ${esc(opts.brand.supportEmail)}</p>`
    : "";
  return `<!doctype html><html lang="${opts.locale}" dir="${dir}"><body style="margin:0;background:#f1f5f9;font-family:-apple-system,'Segoe UI',Roboto,'IBM Plex Sans Arabic',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px;"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
      <tr><td style="padding:22px 28px;background:#6d28d9;color:#ffffff;">
        <div style="font-size:18px;font-weight:700;">${esc(brandName(opts.brand, opts.locale))}</div>
        ${opts.locale === "ar" ? "<div style=\"font-size:13px;opacity:.85;margin-top:2px;\">منصة الفلسفة وعلم النفس</div>" : "<div style=\"font-size:13px;opacity:.85;margin-top:2px;\">Philosophy & Psychology</div>"}
      </td></tr>
      <tr><td style="padding:28px;">
        <h1 style="margin:0 0 12px;font-size:20px;color:#0f172a;">${esc(opts.heading)}</h1>
        ${opts.bodyHtml}
        ${cta}
        <p style="margin:22px 0 0;color:#475569;font-size:13px;line-height:1.6;">${opts.locale === "ar" ? "إذا لم تطلب هذا الإجراء، يمكنك تجاهل هذه الرسالة بأمان." : "If you did not request this action, you can safely ignore this message."}</p>
        ${footerNote}${support}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export function resetPasswordEmail(opts: {
  locale: EmailLocale;
  brand: EmailBrand;
  name: string;
  resetUrl: string;
  expiresMinutes: number;
}): { subject: string; html: string; text: string } {
  const name = esc(opts.name || (opts.locale === "ar" ? "عزيزي المستخدم" : "there"));
  const brand = brandName(opts.brand, opts.locale);
  if (opts.locale === "ar") {
    const heading = "استعادة كلمة المرور";
    const body =
      `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.7;">مرحبًا ${name}،</p>` +
      `<p style="margin:0;color:#334155;font-size:14px;line-height:1.7;">استلمنا طلبًا لاستعادة كلمة مرور حسابك على ${esc(brand)}. اضغط على الزر بالأسفل لإدخال كلمة مرور جديدة:</p>`;
    const text = `مرحبًا ${name}،\nاستلمنا طلبًا لاستعادة كلمة مرور حسابك على ${brand}. افتح الرابط التالي لإدخال كلمة مرور جديدة (صالح لمدة ${opts.expiresMinutes} دقيقة):\n${opts.resetUrl}`;
    return {
      subject: "استعادة كلمة المرور",
      html: mailShell({ locale: "ar", brand: opts.brand, heading, bodyHtml: body, ctaText: "استعادة كلمة المرور", ctaUrl: opts.resetUrl }),
      text,
    };
  }
  const heading = "Reset your password";
  const body =
    `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.7;">Hello ${name},</p>` +
    `<p style="margin:0;color:#334155;font-size:14px;line-height:1.7;">We received a request to reset the password for your ${esc(brand)} account. Use the button below to choose a new password:</p>`;
  const text = `Hello ${name},\nWe received a request to reset the password for your ${brand} account. Open this link to choose a new password (valid for ${opts.expiresMinutes} minutes):\n${opts.resetUrl}`;
  return {
    subject: "Reset your password",
    html: mailShell({ locale: "en", brand: opts.brand, heading, bodyHtml: body, ctaText: "Reset password", ctaUrl: opts.resetUrl }),
    text,
  };
}

export function welcomeEmail(opts: {
  locale: EmailLocale;
  brand: EmailBrand;
  name: string;
}): { subject: string; html: string; text: string } {
  const name = esc(opts.name || (opts.locale === "ar" ? "صديقنا الجديد" : "friend"));
  const brand = brandName(opts.brand, opts.locale);
  if (opts.locale === "ar") {
    const heading = "أهلًا بك في المنصة";
    const body =
      `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.7;">مرحبًا ${name}،</p>` +
      `<p style="margin:0;color:#334155;font-size:14px;line-height:1.7;">نرحّب بك في ${esc(brand)} لاستكشاف محتوى الفلسفة وعلم النفس. يمكنك الآن تصفح الدورات والبدء في التعلّم.</p>`;
    const text = `مرحبًا ${name}،\nنرحّب بك في ${brand} لاستكشاف محتوى الفلسفة وعلم النفس.\nيمكنك الآن تصفح الدورات والبدء في التعلّم.`;
    return { subject: "أهلًا بك في المنصة", html: mailShell({ locale: "ar", brand: opts.brand, heading, bodyHtml: body }), text };
  }
  const heading = "Welcome to the platform";
  const body =
    `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.7;">Hello ${name},</p>` +
    `<p style="margin:0;color:#334155;font-size:14px;line-height:1.7;">Welcome to ${esc(brand)}. Start exploring our Philosophy & Psychology courses and begin learning today.</p>`;
  const text = `Hello ${name},\nWelcome to ${brand}. Start exploring our Philosophy & Psychology courses and begin learning today.`;
  return { subject: "Welcome to the platform", html: mailShell({ locale: "en", brand: opts.brand, heading, bodyHtml: body }), text };
}

export function emailChangeVerificationEmail(opts: {
  locale: EmailLocale;
  brand: EmailBrand;
  name: string;
  verifyUrl: string;
  expiresMinutes: number;
}): { subject: string; html: string; text: string } {
  const name = esc(opts.name || (opts.locale === "ar" ? "عزيزي المستخدم" : "there"));
  const brand = brandName(opts.brand, opts.locale);
  if (opts.locale === "ar") {
    const heading = "تأكيد تغيير البريد الإلكتروني";
    const body =
      `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.7;">مرحبًا ${name}،</p>` +
      `<p style="margin:0;color:#334155;font-size:14px;line-height:1.7;">طلبنا تأكيدًا قبل تحديث بريدك الإلكتروني إلى عنوان جديد على ${esc(brand)}. اضغط الزر بالأسفل لإتمام التغيير (صالح لمدة ${opts.expiresMinutes} دقيقة):</p>`;
    const text = `مرحبًا ${name}،\nاضغط على الرابط التالي لتأكيد تحديث بريدك الإلكتروني على ${brand} (صالح لمدة ${opts.expiresMinutes} دقيقة):\n${opts.verifyUrl}`;
    return { subject: "تأكيد تغيير البريد الإلكتروني", html: mailShell({ locale: "ar", brand: opts.brand, heading, bodyHtml: body, ctaText: "تأكيد التغيير", ctaUrl: opts.verifyUrl }), text };
  }
  const heading = "Confirm your new email address";
  const body =
    `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.7;">Hello ${name},</p>` +
    `<p style="margin:0;color:#334155;font-size:14px;line-height:1.7;">You asked to change the email on your ${esc(brand)} account. Confirm the new address by clicking below (valid for ${opts.expiresMinutes} minutes):</p>`;
  const text = `Hello ${name},\nConfirm your new email on ${brand} by opening this link (valid for ${opts.expiresMinutes} minutes):\n${opts.verifyUrl}`;
  return { subject: "Confirm your new email address", html: mailShell({ locale: "en", brand: opts.brand, heading, bodyHtml: body, ctaText: "Confirm change", ctaUrl: opts.verifyUrl }), text };
}
