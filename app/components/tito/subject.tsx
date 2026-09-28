/**
 * SUBJECT SIGNATURES
 *
 * The two families the teacher actually teaches need to feel like different
 * disciplines without becoming two brands. The difference is carried by FORM,
 * not by a second palette:
 *
 *   logic  (فلسفة ومنطق) — orthogonal. Right angles, square nodes, brackets,
 *          ordered steps. The shape of an argument being laid out.
 *   psych  (علم النفس)   — connected. Round nodes, curved junctions, a network
 *          that settles. The shape of perception and memory.
 *
 * One thin stroke colour per family (`--subject-ink`, set by the
 * `[data-subject]` attribute in app.css) and one geometry. Everything else —
 * type, rhythm, controls — is identical, so the product still reads as one
 * product.
 *
 * All marks are decorative: `aria-hidden`, no text, no meaning. They are pure
 * SVG (no image bytes) and fully deterministic (no randomness → SSR-safe).
 */

export type SubjectKind = "logic" | "psych" | "none";

const LOGIC_HINTS = ["philosophy", "logic", "فلسف", "منطق"];
const PSYCH_HINTS = ["psycholog", "psych", "نفس"];

/**
 * Classify a subject for PRESENTATION only. Slug first (stable, owner-set),
 * then the Arabic/English title. Anything unrecognised gets the neutral
 * signature rather than a wrong one — new subjects stay on-brand for free.
 */
export function subjectKindOf(...hints: Array<string | null | undefined>): SubjectKind {
  const hay = hints.filter(Boolean).join(" ").toLowerCase();
  if (!hay) return "none";
  if (PSYCH_HINTS.some((h) => hay.includes(h))) return "psych";
  if (LOGIC_HINTS.some((h) => hay.includes(h))) return "logic";
  return "none";
}

/**
 * The compact signature: a 40×40 mark that stands in for the subject in rows,
 * headers and nav. Logic = nested right angles around a square node.
 * Psychology = three orbiting nodes around a filled centre.
 */
export function SubjectSignature({ kind, className = "", size = 40 }: { kind: SubjectKind; className?: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 40 40",
    "aria-hidden": true as const,
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: `shrink-0 ${className}`,
  };
  if (kind === "logic") {
    return (
      <svg {...common}>
        <path d="M11 4H4v7M29 4h7v7M11 36H4v-7M29 36h7v-7" />
        <rect x="13.5" y="13.5" width="13" height="13" />
        <path d="M20 13.5V7M20 26.5V33M13.5 20H7M26.5 20H33" strokeDasharray="2.5 3" />
      </svg>
    );
  }
  if (kind === "psych") {
    return (
      <svg {...common}>
        <circle cx="20" cy="20" r="4.5" fill="currentColor" stroke="none" />
        <circle cx="8" cy="11" r="3.5" />
        <circle cx="32" cy="14" r="3.5" />
        <circle cx="21" cy="33" r="3.5" />
        <path d="M10.6 13.4C13 17 15 18.5 16 19.2M29.6 16.3c-2 1.5-4 2.4-5.2 3M20.7 28.5c.1-1.6.1-2.8 0-4" />
        <path d="M9.5 14.4c-1.4 6 1.6 12.4 8 16.3" strokeDasharray="2.5 3" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="6" y="6" width="28" height="28" rx="2" />
      <path d="M13 15h14M13 20h14M13 25h9" />
    </svg>
  );
}

/**
 * THE PLATE — the large-scale decorative diagram that gives a surface its
 * discipline. Draws a small reasoning structure at hairline weight; one node is
 * filled with the highlighter so the accent appears exactly once.
 *
 * Sized by its container (100% width/height, `preserveAspectRatio` slice), so a
 * caller positions it absolutely and clips it.
 */
export function SubjectPlate({ kind, className = "" }: { kind: SubjectKind; className?: string }) {
  if (kind === "psych") {
    return (
      <svg
        className={`tito-diagram ${className}`}
        viewBox="0 0 320 240"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      >
        {/* a settling network: curved junctions between round nodes */}
        <path d="M40 180c40-10 52-46 40-78M80 102c30-26 74-22 96 6M176 108c26 28 20 62-8 82M168 190c-34 14-66 6-88-10M96 92c-8-30 12-54 44-58M140 34c44-2 74 26 76 66M216 100c22 20 28 52 12 76" />
        <path strokeDasharray="3 5" d="M56 60c52 36 118 46 190 28M28 128c60 40 138 46 226 18M84 206c62-2 124-24 178-62" />
        {[
          [40, 180, 5],
          [80, 102, 4],
          [176, 108, 6],
          [168, 190, 4],
          [96, 92, 3.5],
          [140, 34, 5],
          [216, 100, 4],
          [228, 176, 5],
          [272, 62, 3.5],
        ].map(([cx, cy, r], i) => (
          <circle key={i} cx={cx} cy={cy} r={r} fill="var(--color-pub-bg)" />
        ))}
        <circle cx="176" cy="108" r="9" fill="var(--color-pub-accent)" stroke="none" />
        <circle cx="176" cy="108" r="9" />
      </svg>
    );
  }
  if (kind === "logic") {
    return (
      <svg
        className={`tito-diagram ${className}`}
        viewBox="0 0 320 240"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      >
        {/* an argument map: premises stepping into a conclusion, right angles only */}
        <path d="M36 44h72v40h84V44h72M108 84v56h104V84M160 140v60M60 44v92h48M264 44v112h-52" />
        <path strokeDasharray="3 5" d="M36 200h248M36 20h248M20 44v156" />
        {[
          [28, 36, 16, 16],
          [100, 36, 16, 16],
          [184, 36, 16, 16],
          [256, 36, 16, 16],
          [100, 76, 16, 16],
          [204, 76, 16, 16],
          [52, 128, 16, 16],
          [256, 148, 16, 16],
        ].map(([x, y, w, h], i) => (
          <rect key={i} x={x} y={y} width={w} height={h} fill="var(--color-pub-bg)" />
        ))}
        <rect x="146" y="192" width="28" height="28" fill="var(--color-pub-accent)" stroke="none" />
        <rect x="146" y="192" width="28" height="28" />
      </svg>
    );
  }
  return null;
}

/**
 * A thin ruled band that reads as the spine of a subject: the signature, the
 * label, and a rule that runs to the edge. Used above subject sections.
 */
export function SubjectRule({
  kind,
  label,
  className = "",
}: {
  kind: SubjectKind;
  label: string;
  className?: string;
}) {
  return (
    <div data-subject={kind} className={`flex items-center gap-3 ${className}`}>
      <span className="text-[color:var(--subject-ink)]">
        <SubjectSignature kind={kind} size={22} />
      </span>
      <span className="tito-label text-[color:var(--subject-ink)]">{label}</span>
      <span className="h-px flex-1 bg-pub-line" aria-hidden="true" />
    </div>
  );
}

/**
 * THE SUBJECT PANEL — the most important surface on the public site.
 *
 * One panel per published subject, carrying its own discipline: the signature
 * mark and a coloured spine, the journey line (year · stage · grade) as ruled
 * data, the title at display size, and the counts as figures. Shared by the CMS
 * `study_subjects` block and the /study hub so the two can never drift apart.
 *
 * The caller supplies the link element (`as`), because one call site links with
 * the router and the other resolves a CMS href.
 */
export function SubjectPanelBody({
  kind,
  meta,
  title,
  desc,
  facts,
  cta,
}: {
  kind: SubjectKind;
  meta?: string;
  title: string;
  desc?: string;
  facts?: string[];
  cta: string;
}) {
  return (
    <>
      <span aria-hidden="true" className="pointer-events-none absolute -top-6 opacity-[0.16] ltr:-right-6 rtl:-left-6">
        <SubjectPlate kind={kind === "none" ? "logic" : kind} className="h-44 w-72 text-[color:var(--subject-ink)]" />
      </span>

      <span className="relative flex items-center gap-3 text-[color:var(--subject-ink)]">
        <SubjectSignature kind={kind} size={26} />
        {meta ? <span className="tito-label min-w-0 truncate text-[color:var(--subject-ink)]">{meta}</span> : null}
      </span>

      <span className="relative mt-5 block font-display text-[length:var(--text-pub-lg)] font-extrabold leading-pub-tight tracking-[-0.035em] text-pub-ink [overflow-wrap:anywhere]">
        {title}
      </span>
      {desc ? <span className="relative mt-3 line-clamp-3 block max-w-[44ch] text-pub-sm leading-pub-normal text-pub-muted">{desc}</span> : null}

      {facts && facts.length > 0 ? (
        <span className="relative mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-pub-line pt-4">
          {facts.map((f) => (
            <span key={f} data-numeral className="text-pub-sm font-bold text-pub-ink-soft">
              {f}
            </span>
          ))}
        </span>
      ) : null}

      <span className="relative mt-auto inline-flex min-h-11 items-center gap-2 pt-5 text-pub-sm font-bold text-pub-ink">
        {cta}
        <svg viewBox="0 0 24 24" aria-hidden="true" className="tito-arrow h-4 w-4 shrink-0 rtl:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12h15" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      </span>
    </>
  );
}

/** The shared panel shell: border, spine, padding, hover. */
export const SUBJECT_PANEL_CLASS =
  "tito-spine group relative flex h-full min-w-0 flex-col overflow-hidden border border-pub-line bg-pub-sheet p-6 ps-7 transition-colors hover:border-pub-ink sm:p-8 sm:ps-9";
