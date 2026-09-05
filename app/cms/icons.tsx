import type { IconId } from "./registry";
import { ICON_IDS } from "./registry";

/**
 * Controlled icon registry (owner brief §ICON SYSTEM).
 * Admin stores safe IDENTIFIERS only ("book-open"); this module resolves them to
 * hand-authored inline SVG. Raw arbitrary SVG/HTML is never stored or rendered.
 * All glyphs: 24×24 viewBox, stroke=currentColor (inherit color from theme role),
 * brand glyphs are simplified filled marks.
 */

const S = ({ children }: { children: React.ReactNode }) => <>{children}</>;

const GLYPHS: Record<IconId, React.ReactNode> = {
  "book-open": <S><path d="M2 4h6a3 3 0 0 1 3 3v13a2.5 2.5 0 0 0-2.5-2.5H2z" /><path d="M22 4h-6a3 3 0 0 0-3 3v13a2.5 2.5 0 0 1 2.5-2.5H22z" /></S>,
  "play-circle": <S><circle cx="12" cy="12" r="9" /><path d="m10 8.5 6 3.5-6 3.5z" /></S>,
  "graduation-cap": <S><path d="m12 4 10 5-10 5L2 9z" /><path d="M6 11.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5" /><path d="M22 9v5" /></S>,
  "file-text": <S><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h8" /></S>,
  check: <path d="m4 12.5 5 5L20 6.5" />,
  "check-circle": <S><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></S>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
  phone: <path d="M21 16.9v2.6a1.5 1.5 0 0 1-1.6 1.5 15.6 15.6 0 0 1-6.8-2.4 15.3 15.3 0 0 1-4.7-4.7A15.6 15.6 0 0 1 5.5 7 1.5 1.5 0 0 1 7 5.4h2.6a1.5 1.5 0 0 1 1.5 1.3c.1.8.3 1.6.6 2.4a1.5 1.5 0 0 1-.4 1.6l-1.1 1.1a12 12 0 0 0 4.6 4.6l1.1-1.1a1.5 1.5 0 0 1 1.6-.4c.8.3 1.6.5 2.4.6a1.5 1.5 0 0 1 1.3 1.5z" />,
  mail: <S><rect x="2.5" y="4.5" width="19" height="15" rx="2" /><path d="m3 6 9 6.5L21 6" /></S>,
  "map-pin": <S><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></S>,
  clock: <S><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></S>,
  calendar: <S><rect x="3.5" y="4.5" width="17" height="16" rx="2" /><path d="M8 2.5v4M16 2.5v4M3.5 9.5h17" /></S>,
  users: <S><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 14.2A6.5 6.5 0 0 1 21.5 20" /></S>,
  user: <S><circle cx="12" cy="8" r="3.8" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></S>,
  award: <S><circle cx="12" cy="9" r="5.5" /><path d="m8.5 13.5-1.5 7 5-2.5 5 2.5-1.5-7" /></S>,
  target: <S><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></S>,
  zap: <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12z" />,
  shield: <S><path d="M12 2.5 20 6v5.5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6z" /><path d="m9 12 2 2 4-4.5" /></S>,
  heart: <path d="M12 20.5S3.5 15 3.5 9.2A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.5 2.8C20.5 15 12 20.5 12 20.5z" />,
  "arrow-right": <S><path d="M4 12h15" /><path d="m13 6 6 6-6 6" /></S>,
  "arrow-left": <S><path d="M20 12H5" /><path d="m11 6-6 6 6 6" /></S>,
  "chevron-down": <path d="m5.5 9 6.5 6.5L18.5 9" />,
  "chevron-up": <path d="m5.5 15 6.5-6.5 6.5 6.5" />,
  menu: <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" />,
  close: <path d="m5.5 5.5 13 13M18.5 5.5l-13 13" />,
  search: <S><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></S>,
  settings: <S><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /></S>,
  image: <S><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m4.5 18 5-4.5 3.5 3 3-2.5 4 4" /></S>,
  video: <S><rect x="2.5" y="5.5" width="14" height="13" rx="2" /><path d="m16.5 11 5-3.5v9l-5-3.5z" /></S>,
  microphone: <S><rect x="9" y="2.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5" /></S>,
  download: <S><path d="M12 3v11" /><path d="m7 10 5 5 5-5" /><path d="M4 20h16" /></S>,
  "external-link": <S><path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" /></S>,
  quote: <S><path d="M9 5.5C6 7 4.5 9.6 4.5 13v5.5h6V12H7.6c0-2 .8-3.5 2.6-4.6zm10.5 0C16.5 7 15 9.6 15 13v5.5h6V12h-2.9c0-2 .8-3.5 2.6-4.6z" /></S>,
  "help-circle": <S><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2-2.5 3.6" /><path d="M12 17.2h.01" /></S>,
  info: <S><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5" /><path d="M12 7.8h.01" /></S>,
  "alert-triangle": <S><path d="M10.6 4.1 2.9 17.4A1.6 1.6 0 0 0 4.3 19.8h15.4a1.6 1.6 0 0 0 1.4-2.4L13.4 4.1a1.6 1.6 0 0 0-2.8 0z" /><path d="M12 9.5v4M12 16.8h.01" /></S>,
  sparkles: <S><path d="m12 3 1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="m18.5 15 .9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" /></S>,
  briefcase: <S><rect x="2.5" y="7.5" width="19" height="12.5" rx="2" /><path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5M2.5 12.5h19" /></S>,
  globe: <S><circle cx="12" cy="12" r="9" /><path d="M3.5 9.5h17M3.5 14.5h17" /><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" /></S>,
  "credit-card": <S><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19" /></S>,
  tag: <S><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1-.6-1.4V4.8A1.8 1.8 0 0 1 4.6 3h7.2a2 2 0 0 1 1.4.6l7.4 7.4a2 2 0 0 1 0 2.4z" /><path d="M7.5 7.5h.01" /></S>,
  layers: <S><path d="m12 2.5 9.5 5-9.5 5-9.5-5z" /><path d="m2.5 12 9.5 5 9.5-5" /><path d="m2.5 16.5 9.5 5 9.5-5" /></S>,
  grid: <S><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></S>,
  list: <S><path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12" /><path d="M4 6.5h.01M4 12h.01M4 17.5h.01" /></S>,
  monitor: <S><rect x="2.5" y="4" width="19" height="12.5" rx="2" /><path d="M8.5 20.5h7M12 16.5v4" /></S>,
  smartphone: <S><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M11 18.5h2" /></S>,
  tablet: <S><rect x="4.5" y="2.5" width="15" height="19" rx="2.5" /><path d="M11 18.5h2" /></S>,
  sun: <S><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" /></S>,
  moon: <path d="M20 14.3A8.5 8.5 0 0 1 9.7 4a8.5 8.5 0 1 0 10.3 10.3z" />,
  palette: <S><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2s-.6-1.6-.6-2.4c0-.8.6-1.6 1.6-1.6H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" /><path d="M7.5 12h.01M9.5 8.5h.01M14 7.5h.01" /></S>,
  "message-circle": <path d="M20.5 11.7a7.7 7.7 0 0 1-8.8 7.6L4.5 21l1.8-6.6A7.7 7.7 0 1 1 20.5 11.7z" />,
  send: <S><path d="M21.5 2.5 10.8 13.2" /><path d="m21.5 2.5-6.8 19-3.9-8.3-8.3-3.9z" /></S>,
  "thumbs-up": <S><path d="M7 10v10H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" /><path d="M7 10 11.5 2a2.5 2.5 0 0 1 2.4 3.1L13 9h5.5a2 2 0 0 1 2 2.4l-1.3 6A2.5 2.5 0 0 1 16.7 19.5H7" /></S>,
  trophy: <S><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 5.5H4.5a3 3 0 0 0 3 3M17 5.5h2.5a3 3 0 0 1-3 3" /><path d="M10 14h4l.5 3.5h-5z" /><path d="M8 20.5h8" /><path d="M12 17.5v3" /></S>,
  medal: <S><circle cx="12" cy="14.5" r="5.5" /><path d="m8.5 9-2.5-6h4L12 6l2-3h4l-2.5 6" /><path d="m12 11.8.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z" /></S>,
  chart: <S><path d="M3.5 20.5h17" /><path d="M6.5 20.5V11M11 20.5V4.5M15.5 20.5v-6M20 20.5V8" /></S>,
  whatsapp: <S><path d="M12 3.5a8.5 8.5 0 0 0-7.3 12.8L3.5 20.5l4.4-1.2A8.5 8.5 0 1 0 12 3.5z" /><path d="M9 9.2c0 3 2.3 5.3 5.3 5.3.5 0 1-.4 1-.9v-.9l-1.7-.7-.8.9a4.4 4.4 0 0 1-2.2-2.2l.9-.8-.7-1.7h-.9c-.5 0-.9.5-.9 1z" /></S>,
  telegram: <path d="M21.3 4.3 2.9 11.2c-.9.3-.9 1.6.1 1.8l4.7 1.4 1.8 5.3c.2.8 1.2 1 1.7.4l2.6-2.6 4.7 3.5c.7.5 1.7.1 1.9-.7l3-14.6c.2-.9-.6-1.7-1.4-1.4zM8.6 13.9l8.4-5.3-6.7 6.6-.2 3.1z" />,
  facebook: <path d="M13.5 21v-7h2.7l.5-3.2h-3.2V8.7c0-.9.3-1.6 1.6-1.6h1.7V4.2A22 22 0 0 0 14.2 4c-2.6 0-4.4 1.6-4.4 4.5v2.3H7V14h2.8v7z" />,
  youtube: <S><path d="M21.6 8.2a2.5 2.5 0 0 0-1.8-1.8C18.2 6 12 6 12 6s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 8.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 3.8 2.5 2.5 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-3.8z" /><path d="m10 15 5.2-3-5.2-3z" /></S>,
  instagram: <S><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><circle cx="12" cy="12" r="3.8" /><path d="M16.9 7.1h.01" /></S>,
  tiktok: <path d="M14 3.5v9.9a3.1 3.1 0 1 1-2.6-3v2.2a.9.9 0 1 0 .9.9V3.5zm0 1.8a4.6 4.6 0 0 0 4.2 3.3v-2a2.7 2.7 0 0 1-2.1-1.6A4 4 0 0 1 14 5.3z" />,
  twitter: <path d="M17.7 3.8h2.9l-6.4 7.3 7.5 9.9h-5.9l-4.6-6-5.3 6H3l6.9-7.9L2.7 3.8h6l4.2 5.5zm-1 15.4h1.6L7.4 5.4H5.7z" />,
  linkedin: <S><path d="M6.2 9H3.4v11.5h2.9zm.2-3.4a1.7 1.7 0 1 0-3.4 0 1.7 1.7 0 0 0 3.4 0zM21 14.1c0-3-1.6-4.4-3.8-4.4a3.3 3.3 0 0 0-3 1.6V9h-2.9v11.5H14v-6.1a2 2 0 0 1 1.9-2.1c1 0 1.7.6 1.7 2.1v6.1h3z" /></S>,
};

/** Brand glyphs render filled; line glyphs render stroked. */
const FILLED: ReadonlySet<string> = new Set(["star", "zap", "heart", "moon", "quote", "send", "thumbs-up", "whatsapp", "telegram", "facebook", "youtube", "instagram", "tiktok", "twitter", "linkedin"]);

export const ICON_SIZE_CLASS: Record<string, string> = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-9 w-9",
  xl: "h-14 w-14",
};

export const ICON_COLOR_CLASS: Record<string, string> = {
  default: "text-slate-700",
  brand: "text-brand-600",
  accent: "text-accent-600",
  success: "text-emerald-600",
  warning: "text-amber-600",
  error: "text-rose-600",
  muted: "text-slate-400",
};

export function Icon({ name, size = "md", colorRole = "default", className = "" }: { name: string; size?: string; colorRole?: string; className?: string }) {
  if (!(ICON_IDS as readonly string[]).includes(name)) return null; // unknown id → render nothing (never crash)
  const glyph = GLYPHS[name as IconId];
  const filled = FILLED.has(name);
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`${ICON_SIZE_CLASS[size] ?? ICON_SIZE_CLASS.md} ${ICON_COLOR_CLASS[colorRole] ?? ICON_COLOR_CLASS.default} shrink-0 ${className}`}
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={filled ? undefined : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyph}
    </svg>
  );
}
