import { useRef } from "react";
import { RT_COLOR_CLASSES } from "~/cms/richtext";
import { safeHref } from "~/cms/links";

/**
 * Sanitized rich-text toolbar. Emits HTML into a hidden input; the server
 * re-sanitizes on save/publish. Token color classes only — no style="" / JS.
 */
const btn =
  "inline-flex h-9 min-w-9 items-center justify-center rounded border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50";

export function RichTextEditor({
  name,
  defaultValue,
  dir,
  rows = 6,
}: {
  name: string;
  defaultValue: string;
  dir: "rtl" | "ltr";
  rows?: number;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLTextAreaElement>(null);

  const sync = () => {
    if (hiddenRef.current && editorRef.current) hiddenRef.current.value = editorRef.current.innerHTML;
  };

  const run = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    try {
      document.execCommand(cmd, false, value);
    } catch {
      /* execCommand unsupported — textarea fallback still submits */
    }
    sync();
  };

  const wrapClass = (cls: string) => {
    const sel = window.getSelection();
    const text = sel && sel.rangeCount ? sel.toString() : "";
    if (!text) return;
    const safe = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    run("insertHTML", `<span class="${cls}">${safe}</span>`);
  };

  const setAlign = (cls: string) => {
    const sel = window.getSelection();
    const text = sel && sel.rangeCount ? sel.toString() : "";
    if (!text) {
      run("formatBlock", "p");
      const node = editorRef.current?.querySelector("p:last-child");
      if (node) node.className = cls;
      sync();
      return;
    }
    const safe = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    run("insertHTML", `<p class="${cls}">${safe}</p>`);
  };

  const addLink = () => {
    const raw = window.prompt(dir === "rtl" ? "الرابط (https:// أو /…)" : "Link (https:// or /…)", "https://") ?? "";
    const href = raw.trim();
    if (!href || !safeHref(href) || href === "") return;
    run("createLink", href);
  };

  return (
    <div className="flex flex-col gap-1">
      <div role="toolbar" className="flex flex-wrap gap-1" aria-label={dir === "rtl" ? "تنسيق النص" : "Text formatting"}>
        <button type="button" className={btn} onClick={() => run("bold")} aria-label="Bold"><b>B</b></button>
        <button type="button" className={btn} onClick={() => run("italic")} aria-label="Italic"><i>I</i></button>
        <button type="button" className={btn} onClick={() => run("underline")} aria-label="Underline"><u>U</u></button>
        <button type="button" className={btn} onClick={() => run("formatBlock", "h2")}>H2</button>
        <button type="button" className={btn} onClick={() => run("formatBlock", "h3")}>H3</button>
        <button type="button" className={btn} onClick={() => run("insertUnorderedList")} aria-label="List">•</button>
        <button type="button" className={btn} onClick={addLink} aria-label="Link">🔗</button>
        <button type="button" className={btn} onClick={() => setAlign("rt-align-start")}>⇤</button>
        <button type="button" className={btn} onClick={() => setAlign("rt-align-center")}>↔</button>
        <button type="button" className={btn} onClick={() => setAlign("rt-align-end")}>⇥</button>
        {RT_COLOR_CLASSES.map((c) => (
          <button
            key={c}
            type="button"
            className={`${btn} ${c}`}
            onClick={() => wrapClass(c)}
            aria-label={c.replace("rt-c-", "color ")}
            title={c.replace("rt-c-", "")}
          >
            A
          </button>
        ))}
      </div>
      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline="true"
        dir={dir}
        className="cms-richtext min-h-[8rem] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
        style={{ minHeight: `${rows * 1.4}rem` }}
        dangerouslySetInnerHTML={{ __html: defaultValue }}
        onInput={sync}
        onBlur={sync}
      />
      <textarea ref={hiddenRef} name={name} defaultValue={defaultValue} className="hidden" hidden readOnly />
    </div>
  );
}
