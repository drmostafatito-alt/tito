import { useState, type ReactNode } from "react";
import { t, type Locale } from "~/lib/i18n";

/**
 * Structured, bilingual editor for an exam's "question pool" selection mode.
 *
 * Replaces hand-writing the FEATURE-SPEC §6 pools JSON with a set of filter
 * cards (subject / unit / lesson / difficulty / tags + requested count). The
 * JSON is still produced and submitted under the same hidden field name the
 * backend already expects (`name`), so the server contract is untouched — the
 * admin simply never has to type JSON.
 */

export interface RefItem {
  id: string;
  labelAr: string;
  labelEn: string;
}

interface PoolBuilderProps {
  /** hidden input field name the serialized JSON is posted under. */
  name: string;
  /** current serialized pools JSON (from exam config). */
  poolsJson: string;
  disabled?: boolean;
  subjects: RefItem[];
  courses: RefItem[];
  units: RefItem[];
  lessons: RefItem[];
  tags: RefItem[];
  locale: Locale;
}

interface PoolDraft {
  count: string;
  subject: string;
  course: string;
  unit: string;
  lesson: string;
  difficulty: string;
  types: string[];
  tags: string[];
}

const ALL_TYPES = ["mcq", "true_false", "multi_select", "essay"] as const;

function parsePools(raw: string): PoolDraft[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((p) => {
      const f = (p && typeof p === "object" ? p.filters : {}) || {};
      return {
        count: String(p?.count ?? ""),
        subject: f.subject ?? "",
        course: f.course ?? "",
        unit: f.unit ?? "",
        lesson: f.lesson ?? "",
        difficulty: f.difficulty ?? "",
        types: Array.isArray(f.types) ? f.types.map(String) : [],
        tags: Array.isArray(f.tags) ? f.tags.map(String) : [],
      };
    });
  } catch {
    return [];
  }
}

function serializePools(pools: PoolDraft[]): string {
  return JSON.stringify(
    pools.map((p) => {
      const filters: Record<string, unknown> = {};
      if (p.subject) filters.subject = p.subject;
      if (p.course) filters.course = p.course;
      if (p.unit) filters.unit = p.unit;
      if (p.lesson) filters.lesson = p.lesson;
      if (p.difficulty) filters.difficulty = p.difficulty;
      // an explicit non-empty types selection is stored; an empty selection means
      // "objective types only" (the engine default — backward compatible)
      if (p.types.length) filters.types = p.types;
      if (p.tags.length) filters.tags = p.tags;
      const count = Math.max(1, Math.min(100, Number(p.count) || 1));
      return { filters, count };
    })
  );
}

const selectCls =
  "h-[42px] w-full rounded-lg border border-line bg-white px-3 text-sm disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-ink-muted";
const inputCls =
  "h-[42px] w-full rounded-lg border border-line bg-white px-3 text-sm disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-ink-muted";

const DIFF_OPTIONS = ["easy", "medium", "hard"] as const;

export function PoolBuilder({ name, poolsJson, disabled, subjects, courses, units, lessons, tags, locale }: PoolBuilderProps) {
  const [pools, setPools] = useState<PoolDraft[]>(() => {
    const init = parsePools(poolsJson);
    return init.length
      ? init
      : [{ count: "5", subject: "", course: "", unit: "", lesson: "", difficulty: "", types: [], tags: [] }];
  });

  function patch(i: number, part: Partial<PoolDraft>) {
    setPools((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...part } : p)));
  }
  function setTags(i: number, id: string, on: boolean) {
    setPools((prev) =>
      prev.map((p, idx) => {
        if (idx !== i) return p;
        const next = on ? [...p.tags, id] : p.tags.filter((x) => x !== id);
        return { ...p, tags: next };
      })
    );
  }
  function setTypes(i: number, type: string, on: boolean) {
    setPools((prev) =>
      prev.map((p, idx) => {
        if (idx !== i) return p;
        const next = on ? [...new Set([...p.types, type])] : p.types.filter((x) => x !== type);
        return { ...p, types: next };
      })
    );
  }

  const filterRow = (labelKey: string, children: ReactNode) => (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-ink-muted">{labelKey}</span>
      {children}
    </div>
  );
  const any = t(locale, "assessment.anyFilter");

  return (
    <div className="mt-2 space-y-3">
      <input type="hidden" name={name} value={serializePools(pools)} />
      <p className="text-xs text-ink-muted">{t(locale, "assessment.poolsHint")}</p>
      <p className="text-xs text-amber-700">{t(locale, "assessment.objectiveNote")}</p>

      {pools.map((p, i) => (
        <fieldset key={i} className="rounded-lg border border-line bg-slate-50/50 p-3">
          <legend className="px-1 text-xs font-semibold text-ink-muted">{t(locale, "assessment.poolN", { n: i + 1 })}</legend>
          <div className="grid gap-3 md:grid-cols-2">
            {filterRow(
              t(locale, "assessment.filterSubject"),
              <select className={selectCls} disabled={disabled} value={p.subject} onChange={(e) => patch(i, { subject: e.target.value, course: "", unit: "", lesson: "" })}>
                <option value="">{any}</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {locale === "ar" ? s.labelAr : s.labelEn}
                  </option>
                ))}
              </select>
            )}
            {filterRow(
              t(locale, "assessment.filterCourse"),
              <select className={selectCls} disabled={disabled} value={p.course} onChange={(e) => patch(i, { course: e.target.value, unit: "", lesson: "" })}>
                <option value="">{any}</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {locale === "ar" ? c.labelAr : c.labelEn}
                  </option>
                ))}
              </select>
            )}
            {filterRow(
              t(locale, "assessment.filterUnit"),
              <select className={selectCls} disabled={disabled} value={p.unit} onChange={(e) => patch(i, { unit: e.target.value, lesson: "" })}>
                <option value="">{any}</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {locale === "ar" ? u.labelAr : u.labelEn}
                  </option>
                ))}
              </select>
            )}
            {filterRow(
              t(locale, "assessment.filterLesson"),
              <select className={selectCls} disabled={disabled} value={p.lesson} onChange={(e) => patch(i, { lesson: e.target.value })}>
                <option value="">{any}</option>
                {lessons.map((l) => (
                  <option key={l.id} value={l.id}>
                    {locale === "ar" ? l.labelAr : l.labelEn}
                  </option>
                ))}
              </select>
            )}
            {filterRow(
              t(locale, "assessment.filterDifficulty"),
              <select className={selectCls} disabled={disabled} value={p.difficulty} onChange={(e) => patch(i, { difficulty: e.target.value })}>
                <option value="">{any}</option>
                {DIFF_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {t(locale, `assessment.diff_${d}`)}
                  </option>
                ))}
              </select>
            )}
            <div className="grid gap-1">
              <span className="text-xs font-medium text-ink-muted">{t(locale, "assessment.type")}</span>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-white px-3 py-2 text-sm">
                {ALL_TYPES.map((ty) => {
                  const on = p.types.includes(ty);
                  return (
                    <label key={ty} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={disabled}
                        onChange={(e) => setTypes(i, ty, e.target.checked)}
                        className="h-4 w-4"
                      />
                      {t(locale, `assessment.type_${ty}`)}
                    </label>
                  );
                })}
              </div>
              <span className="text-xs text-ink-muted">{t(locale, "assessment.poolTypeHint")}</span>
            </div>
            <div className="grid gap-1 md:col-span-2">
              <span className="text-xs font-medium text-ink-muted">{t(locale, "assessment.filterTags")}</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-line bg-white px-3 py-2 text-sm">
                {tags.length === 0 ? (
                  <span className="text-xs text-ink-muted">{t(locale, "assessment.anyFilter")}</span>
                ) : (
                  tags.map((tg) => {
                    const on = p.tags.includes(tg.id);
                    return (
                      <label key={tg.id} className="flex items-center gap-1.5">
                        <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => setTags(i, tg.id, e.target.checked)} className="h-4 w-4" />
                        {locale === "ar" ? tg.labelAr : tg.labelEn}
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-2 border-t border-line pt-3">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-ink-muted">{t(locale, "assessment.poolQty")}</span>
              <input type="number" min={1} max={100} className={`${inputCls} w-[110px]`} disabled={disabled} value={p.count} onChange={(e) => patch(i, { count: e.target.value })} />
            </label>
            <button type="button" onClick={() => setPools((prev) => prev.filter((_, idx) => idx !== i))} disabled={disabled || pools.length <= 1} className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">
              {t(locale, "assessment.removePool")}
            </button>
          </div>
        </fieldset>
      ))}

      {pools.length === 0 && <p className="text-sm text-ink-muted">{t(locale, "assessment.poolNoPools")}</p>}

      {!disabled && pools.length < 10 && (
        <button type="button" onClick={() => setPools((prev) => [...prev, { count: "5", subject: "", course: "", unit: "", lesson: "", difficulty: "", types: [], tags: [] }])} className="min-h-11 rounded-lg border border-dashed border-ink px-4 text-sm font-medium text-ink hover:bg-slate-100">
          + {t(locale, "assessment.addPool")}
        </button>
      )}

      <p className="text-xs text-ink-muted">{t(locale, "assessment.filtersHint")}</p>
    </div>
  );
}
