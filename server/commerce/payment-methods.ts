/**
 * Manual payment rails + WhatsApp receipt hand-off — PURE helpers.
 *
 * No `.server` suffix on purpose: the order page renders these on the server and
 * the admin panel needs the same visibility rule, so this module must stay free
 * of DB/env/crypto dependencies (client-bundle safe), like `money.ts`.
 *
 * TWO HARD RULES
 *  1. MANUAL PAYMENT ONLY. There is no gateway here (no Paymob, Fawry, Stripe…)
 *     and none is imported anywhere in this codebase.
 *  2. NO payment destination is ever invented. Every account number / InstaPay
 *     handle is owner data entered in Admin → Appearance → Payments. A method
 *     that is disabled OR has an empty destination is treated as *non-existent*
 *     and is never shown to a student, so a placeholder can never leak.
 */

import type { PaymentMethodKey, PaymentMethodSetting } from "../settings/schema";

/** Fallback labels for the rails (names only — never a destination/number). */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethodKey, { ar: string; en: string }> = {
  instapay: { ar: "إنستاباي", en: "InstaPay" },
  vodafone_cash: { ar: "فودافون كاش", en: "Vodafone Cash" },
  etisalat_cash: { ar: "اتصالات كاش", en: "Etisalat Cash" },
  bank_transfer: { ar: "تحويل بنكي", en: "Bank transfer" },
  other: { ar: "طريقة أخرى", en: "Other" },
};

export interface VisiblePaymentMethod {
  id: string;
  key: PaymentMethodKey;
  labelAr: string;
  labelEn: string;
  destination: string;
  accountNameAr: string;
  accountNameEn: string;
  instructionsAr: string;
  instructionsEn: string;
  sortOrder: number;
}

/**
 * A method is usable only when the owner turned it on AND filled in where the
 * money goes. Anything less is hidden — the student never sees an empty rail.
 */
export function isMethodConfigured(m: PaymentMethodSetting): boolean {
  return m.enabled === true && m.destination.trim().length > 0;
}

/** Public-safe list: enabled + configured, ordered by the admin's sort order. */
export function visiblePaymentMethods(methods: PaymentMethodSetting[]): VisiblePaymentMethod[] {
  return methods
    .filter(isMethodConfigured)
    .map((m) => ({
      id: m.id || m.key,
      key: m.key,
      labelAr: m.labelAr.trim() || PAYMENT_METHOD_LABELS[m.key].ar,
      labelEn: m.labelEn.trim() || PAYMENT_METHOD_LABELS[m.key].en,
      destination: m.destination.trim(),
      accountNameAr: m.accountNameAr.trim(),
      accountNameEn: m.accountNameEn.trim(),
      instructionsAr: m.instructionsAr,
      instructionsEn: m.instructionsEn,
      sortOrder: m.sortOrder,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.labelEn.localeCompare(b.labelEn));
}

/** Look one method up by the id the student submitted (server-side re-validation). */
export function findPaymentMethod(
  methods: PaymentMethodSetting[],
  id: string
): VisiblePaymentMethod | null {
  const wanted = String(id ?? "").trim();
  if (!wanted) return null;
  return visiblePaymentMethods(methods).find((m) => m.id === wanted || m.key === wanted) ?? null;
}

/** Freeze what the student was shown into the payment row (history never rewrites). */
export function methodSnapshot(m: VisiblePaymentMethod, locale: "ar" | "en") {
  return {
    id: m.id,
    key: m.key,
    labelAr: m.labelAr,
    labelEn: m.labelEn,
    destination: m.destination,
    accountNameAr: m.accountNameAr,
    accountNameEn: m.accountNameEn,
    instructionsAr: m.instructionsAr,
    instructionsEn: m.instructionsEn,
    shownLocale: locale,
  };
}

// ---------------------------------------------------------------------------
// WhatsApp receipt hand-off (click-to-chat ONLY — no API, no automation)
// ---------------------------------------------------------------------------

/** wa.me wants an international number with no punctuation. */
export function whatsAppDigits(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/**
 * A plausible WhatsApp number: 8–15 digits (E.164 without the '+'). Anything
 * else yields no link at all, so a half-typed setting can never produce a
 * broken or misleading hand-off.
 */
export function isValidWhatsAppNumber(raw: string): boolean {
  const d = whatsAppDigits(raw);
  return d.length >= 8 && d.length <= 15;
}

export interface ReceiptMessageInput {
  locale: "ar" | "en";
  studentName: string;
  studentEmail: string;
  orderNumber: string;
  amount: string;
  currency: string;
  /** what is being subscribed to, already resolved to real titles by the caller */
  scopeLines: string[];
  planLabel: string | null;
  methodLabel: string;
  /** optional owner note from Admin → Appearance → Payments */
  note?: string;
}

/**
 * Builds the message the student sends with their receipt. It is a *template for
 * a human*: the platform opens WhatsApp and the student attaches the screenshot
 * themselves. Nothing here claims the receipt was received by the system.
 */
export function buildReceiptMessage(input: ReceiptMessageInput): string {
  const ar = input.locale === "ar";
  const lines: string[] = [];
  lines.push(ar ? "طلب اشتراك — منصة د/ مصطفى تيتو" : "Subscription request — Dr Mostafa Tito");
  lines.push(ar ? `الاسم: ${input.studentName}` : `Name: ${input.studentName}`);
  lines.push(ar ? `البريد الإلكتروني: ${input.studentEmail}` : `Email: ${input.studentEmail}`);
  lines.push(ar ? `رقم الطلب: ${input.orderNumber}` : `Order number: ${input.orderNumber}`);
  for (const line of input.scopeLines) {
    if (line.trim()) lines.push(line.trim());
  }
  if (input.planLabel) lines.push(ar ? `نوع الاشتراك: ${input.planLabel}` : `Plan: ${input.planLabel}`);
  lines.push(ar ? `طريقة الدفع: ${input.methodLabel}` : `Payment method: ${input.methodLabel}`);
  lines.push(ar ? `المبلغ: ${input.amount} ${input.currency}` : `Amount: ${input.amount} ${input.currency}`);
  lines.push(ar ? "سأرفق صورة الإيصال في هذه المحادثة." : "I will attach the receipt image in this chat.");
  if (input.note && input.note.trim()) lines.push(input.note.trim());
  return lines.join("\n");
}

/**
 * Click-to-chat URL, or null when no usable WhatsApp number is configured (the
 * UI then hides the button instead of pointing at a dead link).
 */
export function whatsAppReceiptHref(phone: string, message: string): string | null {
  if (!isValidWhatsAppNumber(phone)) return null;
  const text = message.trim();
  const base = `https://wa.me/${whatsAppDigits(phone)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}
