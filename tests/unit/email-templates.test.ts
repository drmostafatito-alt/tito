import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetPasswordEmail,
  welcomeEmail,
  emailChangeVerificationEmail,
  type EmailBrand,
} from "~server/email/templates";
import { emailProvider, clearEmailCaptures, capturedEmails, ResendEmailProvider } from "~server/email/provider";

afterEach(() => vi.unstubAllGlobals());

const brand: EmailBrand = {
  nameAr: "د/ مصطفى تيتو",
  nameEn: "Dr Mostafa Tito",
  supportEmail: "support@example.com",
};

describe("transactional email templates", () => {
  it("brands as Dr Mostafa Tito and never leaks scaffold branding", () => {
    for (const locale of ["ar", "en"] as const) {
      const mail = resetPasswordEmail({ locale, brand, name: "Amina", resetUrl: "https://x.test/reset#token=abc", expiresMinutes: 30 });
      const welcome = welcomeEmail({ locale, brand, name: "Amina" });
      const change = emailChangeVerificationEmail({ locale, brand, name: "Amina", verifyUrl: "https://x.test/verify?token=abc", expiresMinutes: 30 });
      for (const doc of [mail.html, mail.text, welcome.html, change.html]) {
        expect(doc.toLowerCase()).not.toContain("educore");
        expect(doc.toLowerCase()).not.toContain("smokeplatform");
      }
      expect(mail.html.toLowerCase()).toContain((locale === "ar" ? brand.nameAr : brand.nameEn).toLowerCase());
    }
  });

  it("embeds the reset/verify url and escapes user content", () => {
    const reset = resetPasswordEmail({ locale: "en", brand, name: "<img src=x>", resetUrl: "https://x.test/reset#token=SECRETTOKEN", expiresMinutes: 30 });
    expect(reset.html).toContain("https://x.test/reset#token=SECRETTOKEN");
    expect(reset.html).not.toContain("<img");
    expect(reset.html).toContain("&lt;img");
    const ar = resetPasswordEmail({ locale: "ar", brand, name: "عمر", resetUrl: "https://x.test/r", expiresMinutes: 60 });
    expect(ar.html).toContain("dir=\"rtl\"");
    expect(ar.text).toContain("https://x.test/r");
  });

  it("welcome and email-change copy are localized", () => {
    const welcomeAr = welcomeEmail({ locale: "ar", brand, name: "عمر" });
    expect(welcomeAr.subject).toContain("أهلًا");
    const changeEn = emailChangeVerificationEmail({ locale: "en", brand, name: "Amina", verifyUrl: "https://x.test/v", expiresMinutes: 15 });
    expect(changeEn.subject.toLowerCase()).toContain("confirm");
  });
});

describe("email provider selection (fail-closed)", () => {
  it("unset/unknown provider is the noop fail-closed channel", async () => {
    const res = await emailProvider({}).send({ to: "a@b.test", subject: "s", html: "<p>hi</p>" });
    expect(res.ok).toBe(false);
    expect("reason" in res && res.reason).toBe("not_configured");
    expect(emailProvider({ EMAIL_PROVIDER: "" }).id).toBe("noop");
    expect(emailProvider({ EMAIL_PROVIDER: "garbage" }).id).toBe("noop");
  });

  it("log channel is refused in a production environment", () => {
    expect(emailProvider({ EMAIL_PROVIDER: "log", ENVIRONMENT: "production" }).id).toBe("noop");
    expect(emailProvider({ EMAIL_PROVIDER: "log", ENVIRONMENT: "development" }).id).toBe("log");
  });

  it("capture channel records messages hermetically", async () => {
    clearEmailCaptures();
    const provider = emailProvider({ EMAIL_PROVIDER: "capture", ENVIRONMENT: "test" });
    expect(provider.id).toBe("capture");
    const res = await provider.send({ to: "x@y.test", subject: "Hello", html: "<p>Hi</p>", text: "Hi" });
    expect(res.ok).toBe(true);
    expect(capturedEmails("x@y.test").length).toBe(1);
    expect(capturedEmails("x@y.test")[0].subject).toBe("Hello");
    clearEmailCaptures();
    expect(capturedEmails("x@y.test").length).toBe(0);
  });

  it("capture is impossible outside exact test and Resend requires complete server configuration", () => {
    expect(emailProvider({ EMAIL_PROVIDER: "capture", ENVIRONMENT: "production" }).id).toBe("noop");
    expect(emailProvider({ EMAIL_PROVIDER: "capture", ENVIRONMENT: "preview" }).id).toBe("noop");
    expect(emailProvider({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test_key" }).id).toBe("noop");
    expect(
      emailProvider({
        EMAIL_PROVIDER: "resend",
        ENVIRONMENT: "production",
        RESEND_API_KEY: "re_replace_with_real_resend_key",
        EMAIL_FROM: "Dr Tito <noreply@example.com>",
      }).id
    ).toBe("noop");
    expect(
      emailProvider({
        EMAIL_PROVIDER: "resend",
        ENVIRONMENT: "production",
        RESEND_API_KEY: `re_${"x".repeat(32)}`,
        EMAIL_FROM: "Dr Tito <noreply@example.com>",
      }).id
    ).toBe("resend");
  });

  it("sends through the fixed Resend HTTPS API and sanitizes all upstream failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"message":"api key re_secret"}', { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new ResendEmailProvider("re_fake_not_real", "Dr Tito <noreply@example.com>");
    const result = await provider.send({
      to: "student@example.com",
      subject: "Reset",
      html: "<p>Reset</p>",
      text: "Reset",
    });
    expect(result).toEqual({ ok: false, reason: "send_failed" });
    expect(JSON.stringify(result)).not.toContain("re_secret");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_fake_not_real");
    expect(String(init.body)).not.toContain("re_fake_not_real");
  });

  it("does not throw or leak details on a network exception", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Bearer re_do_not_leak")));
    const result = await new ResendEmailProvider("re_fake_not_real", "noreply@example.com").send({
      to: "student@example.com",
      subject: "Reset",
      html: "<p>Reset</p>",
    });
    expect(result).toEqual({ ok: false, reason: "send_failed" });
    expect(JSON.stringify(result)).not.toContain("do_not_leak");
  });
});
