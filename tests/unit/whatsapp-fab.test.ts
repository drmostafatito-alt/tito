import { describe, expect, it } from "vitest";
import { whatsAppDigits, whatsAppHref, fabZone, FAB_AVOID_SELECTOR } from "~/components/WhatsAppFab";
import { platformSettingsSchema } from "~server/settings/schema";

/**
 * The floating WhatsApp button's owner-facing contract: the number and message
 * come from Admin settings, the href is always a wa.me link built from digits
 * only, and the collision selector covers the content the button must never
 * cover.
 */

describe("whatsAppDigits", () => {
  it("keeps only digits from the shapes owners actually paste", () => {
    expect(whatsAppDigits("01153719506")).toBe("01153719506");
    expect(whatsAppDigits("+20 115 371 9506")).toBe("201153719506");
    expect(whatsAppDigits("+20-115-371-9506")).toBe("201153719506");
    expect(whatsAppDigits("20 (115) 371-9506")).toBe("201153719506");
  });

  it("strips anything that is not a digit, including markup", () => {
    expect(whatsAppDigits(`<script>alert(1)</script>20115`)).toBe("120115");
    expect(whatsAppDigits("")).toBe("");
  });
});

describe("whatsAppHref", () => {
  it("builds a bare wa.me link when no message is configured", () => {
    expect(whatsAppHref("+20 115 371 9506", "")).toBe("https://wa.me/201153719506");
    expect(whatsAppHref("201153719506", "   ")).toBe("https://wa.me/201153719506");
  });

  it("URL-encodes the owner's message, including Arabic", () => {
    const href = whatsAppHref("201153719506", "مرحبا، أريد الاشتراك");
    expect(href.startsWith("https://wa.me/201153719506?text=")).toBe(true);
    const text = new URL(href).searchParams.get("text");
    expect(text).toBe("مرحبا، أريد الاشتراك");
  });

  it("cannot be turned into a non-wa.me URL by the message", () => {
    const href = whatsAppHref("201153719506", "x&url=https://evil.example.com");
    const url = new URL(href);
    expect(url.hostname).toBe("wa.me");
    expect(url.pathname).toBe("/201153719506");
    // the ampersand is encoded into the text value, not parsed as a new param
    expect(url.searchParams.get("url")).toBeNull();
    expect(url.searchParams.get("text")).toBe("x&url=https://evil.example.com");
  });
});

describe("collision selector covers the content the button must not hide", () => {
  it.each(["video", "iframe", "form", "table"])("includes %s", (tag) => {
    expect(FAB_AVOID_SELECTOR).toContain(tag);
  });
  it("lets any surface opt in via a data attribute", () => {
    expect(FAB_AVOID_SELECTOR).toContain("[data-avoid-fab]");
  });
});

describe("platform settings expose the floating-button controls", () => {
  it("defaults to OFF so nothing appears until the owner opts in", () => {
    const s = platformSettingsSchema.parse({});
    expect(s.whatsappFloating).toBe(false);
    expect(s.whatsappMessage).toBe("");
  });

  it("round-trips what Admin posts", () => {
    const s = platformSettingsSchema.parse({
      whatsapp: "201153719506",
      whatsappFloating: true,
      whatsappMessage: "مرحبا",
    });
    expect(s.whatsappFloating).toBe(true);
    expect(s.whatsappMessage).toBe("مرحبا");
  });

  it("caps the message length", () => {
    const r = platformSettingsSchema.safeParse({ whatsappMessage: "x".repeat(301) });
    expect(r.success).toBe(false);
  });
});

describe("fabZone reserves the corner the button occupies", () => {
  it("sits in the bottom-end corner for LTR", () => {
    const z = fabZone(1440, 900, false);
    expect(z).toEqual({ left: 1440 - 84, right: 1440 - 4, top: 900 - 84, bottom: 900 - 4 });
  });

  it("mirrors to the bottom-start corner for RTL", () => {
    const z = fabZone(1440, 900, true);
    expect(z).toEqual({ left: 4, right: 84, top: 900 - 84, bottom: 900 - 4 });
  });

  it("tracks a phone viewport", () => {
    const z = fabZone(390, 844, false);
    expect(z.left).toBe(390 - 84);
    expect(z.bottom).toBe(844 - 4);
  });

  it("a form filling the content column overlaps the zone, a header does not", () => {
    const z = fabZone(1440, 900, false);
    const overlaps = (r: { left: number; right: number; top: number; bottom: number }) =>
      r.left < z.right && r.right > z.left && r.top < z.bottom && r.bottom > z.top;
    // a wide form parked in the bottom band
    expect(overlaps({ left: 8, right: 1432, top: 850, bottom: 882 })).toBe(true);
    // the same form scrolled well above the corner
    expect(overlaps({ left: 8, right: 1432, top: 100, bottom: 132 })).toBe(false);
    // a sticky header at the top of the page
    expect(overlaps({ left: 0, right: 1440, top: 0, bottom: 64 })).toBe(false);
  });
});
