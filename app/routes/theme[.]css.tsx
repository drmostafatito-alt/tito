import type { Route } from "./+types/theme[.]css";
import { getEnv } from "~server/cf.server";
import { getDb } from "~server/db/client.server";
import { getSettings } from "~server/settings/service.server";

/**
 * Design-token stylesheet (owner brief §THEME SYSTEM) — LAYER B: CONSOLE.
 * Admin-controlled, VALIDATED tokens only (hex colors, bounded radii, enum
 * presets — see themeSettingsSchema). NO arbitrary CSS injection is possible:
 * every value re-serialized here is regex/enum-checked by zod on write AND
 * re-validated on output. Same-origin stylesheet → allowed by CSP style-src 'self'.
 *
 * WHY THERE IS NO `body` RULE ANYMORE (owner brief §6)
 * ---------------------------------------------------
 * This stylesheet used to emit
 *     body{background-color:var(--color-page-bg);color:var(--color-ink);}
 * unlayered — and unlayered CSS beats `@layer` rules, so the owner's Appearance
 * background/ink were applied to EVERY page, public site included. Combined with
 * `--color-brand-*` (violet by default) that is how "half the site turns violet /
 * unrelated to the rest" happened: the public identity was themeable by accident.
 *
 * The split is now explicit:
 *   • Palette + shape of the PUBLIC platform  → frozen `--*-pub-*` tokens in
 *     app/app.css (LAYER A). Nothing here writes them; nothing here can recolor
 *     the public site.
 *   • Owner typography (fonts, font-size scale)  → still global: it is a
 *     legibility preference, not brand identity, and the public fluid type
 *     clamps keep it inside the approved scale.
 *   • Owner colors/radius/density/shadow        → still emitted for the ADMIN and
 *     STUDENT consoles, whose layout roots paint their own surface
 *     (`bg-slate-100` / `bg-slate-50`), so removing the body rule changes
 *     nothing there.
 */

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function toHex(rgb: [number, number, number]): string {
  return "#" + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}

function mix(base: [number, number, number], target: [number, number, number], t: number): [number, number, number] {
  return [
    base[0] + (target[0] - base[0]) * t,
    base[1] + (target[1] - base[1]) * t,
    base[2] + (target[2] - base[2]) * t,
  ];
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLACK: [number, number, number] = [0, 0, 0];

/** 50..950 ramp anchored at the admin-picked base (500). */
type RampStop = [number, number, [number, number, number]];
function ramp(baseHex: string): Record<number, string> {
  const base = hexToRgb(baseHex);
  const stops: RampStop[] = [
    [50, 0.9, WHITE], [100, 0.8, WHITE], [200, 0.6, WHITE], [300, 0.4, WHITE], [400, 0.2, WHITE],
    [500, 0, WHITE],
    [600, 0.12, BLACK], [700, 0.24, BLACK], [800, 0.38, BLACK], [900, 0.5, BLACK], [950, 0.68, BLACK],
  ];
  const out: Record<number, string> = {};
  for (const [step, t, target] of stops) out[step] = toHex(mix(base, target, t));
  return out;
}

const SHADOWS: Record<string, string> = {
  none: "none",
  sm: "0 1px 2px 0 rgb(15 23 42 / 0.06)",
  md: "0 4px 10px -2px rgb(15 23 42 / 0.10)",
  lg: "0 10px 24px -6px rgb(15 23 42 / 0.16)",
};
const DENSITY: Record<string, string> = { compact: "0.875", normal: "1", relaxed: "1.125" };
const FONT_SCALE: Record<string, string> = { compact: "94%", normal: "100%", large: "106%" };

export async function loader({ context }: Route.LoaderArgs) {
  const env = getEnv(context);
  const db = getDb(env);
  const settings = await getSettings(db);
  const t = settings.theme;
  const brand = ramp(t.primary);
  const accent = ramp(t.accent);
  const secondary = hexToRgb(t.secondary);

  const lines = [
    ":root{",
    ...Object.entries(brand).map(([step, hex]) => `--color-brand-${step}:${step === "700" || step === "800" ? toHex(mix(secondary, BLACK, step === "700" ? 0 : 0.25)) : hex};`),
    ...Object.entries(accent).map(([step, hex]) => `--color-accent-${step}:${hex};`),
    `--color-page-bg:${t.background};`,
    `--color-surface:${t.surface};`,
    `--color-ink:${t.text};`,
    `--color-ink-muted:${t.mutedText};`,
    `--color-line:${t.border};`,
    `--color-success:${t.success};`,
    `--color-success-soft:${toHex(mix(hexToRgb(t.success), WHITE, 0.88))};`,
    `--color-warning:${t.warning};`,
    `--color-warning-soft:${toHex(mix(hexToRgb(t.warning), WHITE, 0.88))};`,
    `--color-error:${t.error};`,
    `--color-error-soft:${toHex(mix(hexToRgb(t.error), WHITE, 0.88))};`,
    "}",
    // Shape / density are CONSOLE-scoped: they are emitted on `.console` (the
    // admin + student layout roots) instead of `:root`, so even a shared
    // primitive that reads `var(--radius-card)` resolves to the frozen public
    // default on the public site. The public palette never reads these at all.
    `:where(.console){--radius-base:${t.radiusBase}px;--radius-btn:${t.radiusButton}px;--radius-card:${t.radiusCard}px;--shadow-card:${SHADOWS[t.shadow] ?? SHADOWS.sm};--density:${DENSITY[t.density] ?? "1"};}`,
    // Global legibility controls (owner choice, not brand identity): the public
    // type scale is fluid and clamped, so these stay effective everywhere.
    `html{font-size:${FONT_SCALE[t.fontScale] ?? "100%"};}`,
  ];
  const FONT_STACK: Record<string, string> = {
    cairo: '"Cairo", "IBM Plex Sans Arabic", ui-sans-serif, system-ui, sans-serif',
    ibm: '"IBM Plex Sans Arabic", "Cairo", ui-sans-serif, system-ui, sans-serif',
  };
  lines.push(`:root{--font-heading:${FONT_STACK[t.headingFont] ?? FONT_STACK.cairo};--font-body:${FONT_STACK[t.bodyFont] ?? FONT_STACK.cairo};}`);
  lines.push("body,button,input,select,textarea{font-family:var(--font-body);}");
  lines.push("h1,h2,h3,h4{font-family:var(--font-heading);}");
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "no-store", // admin theme changes must apply on reload
    },
  });
}
