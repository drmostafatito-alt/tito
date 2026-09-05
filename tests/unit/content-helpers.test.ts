import { describe, expect, it } from "vitest";
import { slugify } from "~server/content/service.server";
import { buildR2Key, detectKind, sizeCapFor } from "~server/files/storage.server";

describe("slugify", () => {
  it("keeps latin letters, digits and dashes", () => {
    expect(slugify("Hello World 101")).toBe("hello-world-101");
    expect(slugify("  --Multiple   Spaces--  ")).toBe("multiple-spaces");
  });

  it("keeps Arabic letters (SEO-friendly Arabic slugs)", () => {
    expect(slugify("الفيزياء للصف الثالث")).toBe("الفيزياء-للصف-الثالث");
  });

  it("strips unsafe characters", () => {
    expect(slugify("Course: <Physics> & More!")).toBe("course-physics-more");
  });

  it("collapses repeated dashes and trims length", () => {
    expect(slugify("a---b")).toBe("a-b");
    expect(slugify("x".repeat(300)).length).toBeLessThanOrEqual(100);
  });
});

describe("file kind detection + caps", () => {
  it("maps mimes to kinds (with charset noise)", () => {
    expect(detectKind("application/pdf")).toBe("pdf");
    expect(detectKind("image/png; charset=binary")).toBe("image");
    expect(detectKind("video/mp4")).toBe("video");
    expect(detectKind("application/zip")).toBe("archive");
    expect(detectKind("application/x-executable")).toBeNull();
  });

  it("caps sizes per kind", () => {
    expect(sizeCapFor("pdf")).toBe(100 * 1024 * 1024);
    expect(sizeCapFor("image")).toBe(10 * 1024 * 1024);
  });

  it("builds neutral, random, prefix-scoped R2 keys", () => {
    const a = buildR2Key("pdf", "شهادة.pdf", "private");
    const b = buildR2Key("pdf", "شهارة.pdf", "private");
    expect(a).toMatch(/^private\/pdf\/[0-9a-f-]{36}\/.*$/);
    expect(a).not.toBe(b);
    expect(buildR2Key("image", "x.png", "public")).toMatch(/^public\/image\//);
  });
});
