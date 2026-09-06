import { describe, expect, it } from "vitest";
import { namedSocialsFromLinks, resolveSocialLinks, socialIconName, socialLinksForEditor, socialsFor, type SocialLink } from "~/cms/social";

const link = (over: Partial<SocialLink> = {}): SocialLink => ({
  id: "s1",
  network: "youtube",
  url: "https://youtube.com/@x",
  labelAr: "يوتيوب",
  labelEn: "YouTube",
  enabled: true,
  sortOrder: 0,
  showHeader: true,
  showFooter: true,
  showHome: false,
  showContact: true,
  ...over,
});

describe("data-driven social links", () => {
  it("hides disabled or empty URLs and unknown placements", () => {
    const links = resolveSocialLinks({
      socialLinks: [
        link(),
        link({ id: "s2", url: "", network: "facebook" }),
        link({ id: "s3", enabled: false, url: "https://instagram.com/x", network: "instagram" }),
        link({ id: "s4", url: "javascript:alert(1)", network: "globe" }),
      ],
    });
    expect(links.map((l) => l.id)).toEqual(["s1"]);
    expect(socialsFor(links, "header")).toHaveLength(1);
    expect(socialsFor(links, "home")).toHaveLength(0);
  });

  it("falls back to named identity URLs when the list is empty", () => {
    const links = resolveSocialLinks({ facebook: "https://facebook.com/x", youtube: "" });
    expect(links).toHaveLength(1);
    expect(links[0].network).toBe("facebook");
    expect(socialsFor(links, "footer")).toHaveLength(1);
  });

  it("syncs named identity fields from the data-driven list", () => {
    const named = namedSocialsFromLinks([
      link({ network: "youtube", url: "https://youtube.com/@ok" }),
      link({ network: "facebook", url: "https://facebook.com/x", enabled: false }),
    ]);
    expect(named.youtube).toBe("https://youtube.com/@ok");
    expect(named.facebook).toBe("");
  });

  it("uses globe when the network is not an icon id", () => {
    expect(socialIconName("youtube")).toBe("youtube");
    expect(socialIconName("not-a-real-network")).toBe("globe");
  });

  it("editor list keeps disabled and empty rows so hide-show survives a save", () => {
    const links = socialLinksForEditor({
      socialLinks: [
        link(),
        link({ id: "s2", url: "", network: "facebook" }),
        link({ id: "s3", enabled: false, url: "https://instagram.com/x", network: "instagram" }),
      ],
    });
    expect(links.map((l) => l.id)).toEqual(["s1", "s2", "s3"]);
  });
});
