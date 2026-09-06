import { describe, expect, it } from "vitest";
import { cloneSectionsIndependent } from "~server/cms/templates.server";
import { STARTER_TEMPLATES } from "~server/cms/starter-templates";
import type { PageSnapshot } from "~/cms/registry";

describe("template snapshots are independent copies", () => {
  it("cloneSectionsIndependent assigns new ids and deep-copies props", () => {
    const sections: PageSnapshot["sections"] = [
      {
        id: "sec-1",
        type: "section",
        visible: true,
        props: { heading: { ar: "أ", en: "A" } },
        children: [{ id: "blk-1", type: "text", visible: true, props: { content: { ar: "ن", en: "n" } } }],
      },
    ];
    const clone = cloneSectionsIndependent(sections);
    expect(clone[0].id).not.toBe("sec-1");
    expect(clone[0].children[0].id).not.toBe("blk-1");
    expect(clone[0].props).toEqual(sections[0].props);
    (clone[0].props as { heading: { ar: string } }).heading.ar = "mutated";
    expect((sections[0].props as { heading: { ar: string } }).heading.ar).toBe("أ");
  });

  it("built-in starters use token roles, not hardcoded hex colors", () => {
    const blob = JSON.stringify(STARTER_TEMPLATES);
    expect(blob).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(STARTER_TEMPLATES.length).toBeGreaterThan(0);
    for (const t of STARTER_TEMPLATES) {
      expect(t.builtin).toBe(true);
      expect(t.snapshot.sections.length).toBeGreaterThan(0);
    }
  });
});
