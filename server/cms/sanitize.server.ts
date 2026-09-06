/**
 * Rich-text sanitizer (owner brief §NO ARBITRARY HTML/SCRIPT EXECUTION).
 *
 * Uses HTMLRewriter (native to workerd — no dependencies, streaming, battle-
 * tested parser) with an allowlist: only whitelisted elements survive; ALL
 * attributes except a tiny safe set are stripped; `href` is validated through
 * the same safeHref rules as links (no javascript:/data:). Unlisted elements
 * are removed but their text content is KEPT (comments/scripts/styles are
 * removed wholesale, content discarded).
 *
 * Runs on the server at PUBLISH time (snapshots store sanitized html) and in
 * the admin preview path — public rendering trusts the snapshot but the schema
 * re-validation at render still applies.
 */
import { safeHref } from "../../app/cms/links";
import { filterRtClassAttr } from "../../app/cms/richtext";

const ALLOWED_TAGS = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li",
  "h2", "h3", "h4", "blockquote", "code", "pre", "span", "hr", "small", "sup", "sub",
]);
/** tag → allowed attributes (everything else is stripped). */
const CLASS_OK = new Set(["class", "dir", "lang"]);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target", "rel", "class"]),
  span: CLASS_OK,
  p: CLASS_OK,
  h2: CLASS_OK,
  h3: CLASS_OK,
  h4: CLASS_OK,
  li: CLASS_OK,
  blockquote: CLASS_OK,
  code: new Set(["dir", "lang"]),
  pre: new Set(["dir", "lang"]),
};

class SanitizingHandler implements HTMLRewriterElementContentHandlers {
  dropContent = false;
  element(el: Element) {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "iframe" || tag === "object" || tag === "embed" || tag === "link" || tag === "meta" || tag === "base" || tag === "form" || tag === "input" || tag === "button" || tag === "textarea" || tag === "select") {
      el.remove();
      return;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      // unwrap: keep text, drop the element
      el.removeAndKeepContent();
      return;
    }
    const allowed = ALLOWED_ATTRS[tag] ?? new Set<string>();
    // workerd types: attributes iterate as [name, value] pairs (DOM lib typings disagree — cast)
    const attrs = [...(el.attributes as unknown as Iterable<[string, string]>)];
    for (const [rawName, rawValue] of attrs) {
      const name = rawName.toLowerCase();
      if (name.startsWith("on") || !allowed.has(name)) {
        el.removeAttribute(rawName);
        continue;
      }
      if (name === "class") {
        const filtered = filterRtClassAttr(rawValue);
        if (filtered) el.setAttribute("class", filtered);
        else el.removeAttribute(rawName);
        continue;
      }
      if (name === "href") {
        if (!safeHref(rawValue.trim())) el.removeAttribute(rawName);
      }
      if (name === "target") {
        if (rawValue !== "_blank" && rawValue !== "_self") el.removeAttribute(rawName);
        else if (rawValue === "_blank") el.setAttribute("rel", "noopener noreferrer nofollow");
      }
    }
  }
  comments(c: Comment) {
    c.remove();
  }
}

export async function sanitizeRichText(html: string): Promise<string> {
  if (!html || !html.trim()) return "";
  const rewriter = new HTMLRewriter().on("*", new SanitizingHandler());
  const res = await new Response(rewriter.transform(new Response(html)).body);
  const out = await res.text();
  // hard caps: length after sanitization
  return out.slice(0, 20_000);
}
