/**
 * Art registry — the single manifest of the engraved line-art the platform uses.
 *
 * Every file lives in `/public/art/*.webp` and is drawn with the SAME pipeline
 * (see docs/reports/student-content-experience-visual-report.md):
 *   · antique engraved line art, monochrome ink, plain white background;
 *   · the ink is recoloured to the site's navy-900 (#0f2342) and the paper is
 *     turned into real alpha, so one file tints correctly over white cards AND
 *     over the soft blue sections, and can be inverted for the navy footer.
 *
 * Rules baked into the manifest (visual brief §4/§15):
 *   · the art is DECORATION: it is always rendered `aria-hidden`, `alt=""`,
 *     `pointer-events-none`, and a low opacity, so it never competes with copy
 *     or a control;
 *   · no art is a content image — nothing here is a claim, a stat or a photo;
 *   · the teacher photo is NOT part of this registry (it stays on its own
 *     settings binding and is never substituted).
 *
 * `w`/`h` are the intrinsic pixel sizes of the trimmed file: passing them to
 * <img> keeps the layout from shifting while the art loads.
 */
export interface ArtAsset {
  src: string;
  w: number;
  h: number;
}

export const ART = {
  /* ── philosopher line-art (portraits, engraved) ───────────────────────── */
  socrates: { src: "/art/philosopher-socrates.webp", w: 600, h: 717 },
  plato: { src: "/art/philosopher-plato.webp", w: 600, h: 706 },
  aristotle: { src: "/art/philosopher-aristotle.webp", w: 600, h: 679 },
  descartes: { src: "/art/philosopher-descartes.webp", w: 600, h: 753 },
  kant: { src: "/art/philosopher-kant.webp", w: 600, h: 750 },
  freud: { src: "/art/philosopher-freud.webp", w: 600, h: 716 },
  marx: { src: "/art/philosopher-marx.webp", w: 600, h: 671 },

  /* ── emblems and ornaments ────────────────────────────────────────────── */
  book: { src: "/art/emblem-book.webp", w: 640, h: 574 },
  scroll: { src: "/art/emblem-scroll.webp", w: 600, h: 492 },

  /* ── wide bands ───────────────────────────────────────────────────────── */
  columns: { src: "/art/frieze-columns.webp", w: 1000, h: 413 },
} as const satisfies Record<string, ArtAsset>;

export type ArtName = keyof typeof ART;
