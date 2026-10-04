import { ICON_IDS } from "./icon-ids";
import { safeHref } from "./links";

export type SocialPlacement = "header" | "footer" | "home" | "contact";

export interface SocialLink {
  id: string;
  /** Icon registry id (data-driven — not a closed social-network list). */
  network: string;
  url: string;
  labelAr: string;
  labelEn: string;
  enabled: boolean;
  sortOrder: number;
  showHeader: boolean;
  showFooter: boolean;
  showHome: boolean;
  showContact: boolean;
}

const NAMED = ["facebook", "youtube", "instagram", "tiktok", "twitter", "linkedin", "telegram"] as const;

/**
 * Human names for the networks the platform knows about. Icon-only social
 * links need an accessible name, and the fallback used to be the raw network
 * id — screen readers announced the English slug "facebook" inside an Arabic
 * page, and `aria-label="globe"` for anything unknown. The owner can still
 * override both labels per link in Settings → Identity.
 */
const NETWORK_LABELS: Record<string, { ar: string; en: string }> = {
  facebook: { ar: "فيسبوك", en: "Facebook" },
  youtube: { ar: "يوتيوب", en: "YouTube" },
  instagram: { ar: "إنستجرام", en: "Instagram" },
  tiktok: { ar: "تيك توك", en: "TikTok" },
  twitter: { ar: "إكس (تويتر)", en: "X (Twitter)" },
  linkedin: { ar: "لينكدإن", en: "LinkedIn" },
  telegram: { ar: "تليجرام", en: "Telegram" },
  whatsapp: { ar: "واتساب", en: "WhatsApp" },
};

/** Display label for a social link: owner override first, then the known name. */
export function socialLabel(link: Pick<SocialLink, "network" | "labelAr" | "labelEn">, locale: "ar" | "en"): string {
  const own = locale === "ar" ? link.labelAr || link.labelEn : link.labelEn || link.labelAr;
  const known = NETWORK_LABELS[link.network.toLowerCase()];
  if (own && (!known || (own !== link.network))) return own;
  if (known) return locale === "ar" ? known.ar : known.en;
  return own || link.network;
}

export interface SocialIdentitySource {
  socialLinks?: SocialLink[] | null;
  facebook?: string;
  youtube?: string;
  instagram?: string;
  tiktok?: string;
  twitter?: string;
  linkedin?: string;
  telegram?: string;
}

/** Keep named identity URLs in sync with the data-driven list (backward compatible). */
export function namedSocialsFromLinks(links: SocialLink[]): Record<(typeof NAMED)[number], string> {
  const out: Record<string, string> = {
    facebook: "", youtube: "", instagram: "", tiktok: "", twitter: "", linkedin: "", telegram: "",
  };
  for (const item of links) {
    if (!item.enabled || !item.url) continue;
    if ((NAMED as readonly string[]).includes(item.network)) out[item.network] = item.url;
  }
  return out as Record<(typeof NAMED)[number], string>;
}

function hydrateFromNamed(src: SocialIdentitySource, whatsappUrl = ""): SocialLink[] {
  const out: SocialLink[] = [];
  let order = 0;
  if (whatsappUrl) {
    out.push({
      id: "legacy-whatsapp", network: "whatsapp", url: whatsappUrl,
      labelAr: "واتساب", labelEn: "WhatsApp", enabled: true, sortOrder: order++,
      showHeader: false, showFooter: true, showHome: true, showContact: true,
    });
  }
  for (const network of NAMED) {
    const url = src[network] ?? "";
    if (!url) continue;
    out.push({
      id: `legacy-${network}`, network, url,
      labelAr: NETWORK_LABELS[network]?.ar ?? network,
      labelEn: NETWORK_LABELS[network]?.en ?? network,
      enabled: true, sortOrder: order++,
      showHeader: false, showFooter: true, showHome: true, showContact: true,
    });
  }
  return out;
}

function normalizeLink(s: SocialLink, i: number): SocialLink {
  return {
    id: String(s.id || `s${i}`).slice(0, 40),
    network: String(s.network || "globe").slice(0, 40),
    url: String(s.url || "").trim(),
    labelAr: String(s.labelAr || "").slice(0, 80),
    labelEn: String(s.labelEn || "").slice(0, 80),
    enabled: s.enabled !== false,
    sortOrder: typeof s.sortOrder === "number" ? s.sortOrder : i,
    showHeader: s.showHeader === true,
    showFooter: s.showFooter !== false,
    showHome: s.showHome !== false,
    showContact: s.showContact !== false,
  };
}

/** Public list: drop disabled / empty / unsafe URLs. */
export function resolveSocialLinks(src: SocialIdentitySource, whatsappUrl = ""): SocialLink[] {
  const raw = Array.isArray(src.socialLinks) ? src.socialLinks : [];
  const cleaned = raw
    .filter((s) => s && typeof s === "object")
    .map((s, i) => normalizeLink(s, i))
    .filter((s) => s.url && s.enabled && safeHref(s.url) && s.url !== "");
  if (cleaned.length) return cleaned.sort((a, b) => a.sortOrder - b.sortOrder);
  return hydrateFromNamed(src, whatsappUrl);
}

/** Admin editor: keep disabled/empty rows so hide-show and URL edits survive a save. */
export function socialLinksForEditor(src: SocialIdentitySource, whatsappUrl = ""): SocialLink[] {
  const raw = Array.isArray(src.socialLinks) ? src.socialLinks : [];
  const mapped = raw.filter((s) => s && typeof s === "object").map((s, i) => normalizeLink(s, i));
  if (mapped.length) return mapped.sort((a, b) => a.sortOrder - b.sortOrder);
  return hydrateFromNamed(src, whatsappUrl);
}

export function socialsFor(links: SocialLink[], placement: SocialPlacement): SocialLink[] {
  return links.filter((s) => {
    if (!s.enabled || !s.url) return false;
    if (placement === "header") return s.showHeader;
    if (placement === "footer") return s.showFooter;
    if (placement === "home") return s.showHome;
    return s.showContact;
  });
}

export function socialIconName(network: string): string {
  if ((ICON_IDS as readonly string[]).includes(network)) return network;
  return "globe";
}
