import { describe, expect, it } from "vitest";
import { resolveQuestionPlatformUrl } from "~/lib/question-platform";

/**
 * The external Questions Platform entry renders ONLY when admin-enabled AND
 * configured with a safe absolute https URL. Everything else resolves to null
 * (entry hidden) — javascript:/data:/vbscript:, protocol-relative links, bare
 * domains and malformed values must never reach an <a href>.
 */
describe("resolveQuestionPlatformUrl", () => {
  it("returns the https URL when enabled", () => {
    expect(resolveQuestionPlatformUrl({ questionPlatformEnabled: true, questionPlatformUrl: "https://q.example.com/" })).toBe("https://q.example.com/");
  });

  it("trims surrounding whitespace and normalizes the URL", () => {
    expect(resolveQuestionPlatformUrl({ questionPlatformEnabled: true, questionPlatformUrl: "  https://q.example.com/exams  " })).toBe("https://q.example.com/exams");
  });

  it("hides when disabled, even if a URL is set", () => {
    expect(resolveQuestionPlatformUrl({ questionPlatformEnabled: false, questionPlatformUrl: "https://q.example.com" })).toBeNull();
  });

  it("hides when the URL is empty/missing", () => {
    expect(resolveQuestionPlatformUrl({ questionPlatformEnabled: true, questionPlatformUrl: "" })).toBeNull();
    expect(resolveQuestionPlatformUrl({ questionPlatformEnabled: true, questionPlatformUrl: null })).toBeNull();
    expect(resolveQuestionPlatformUrl({ questionPlatformEnabled: true })).toBeNull();
    expect(resolveQuestionPlatformUrl(null)).toBeNull();
    expect(resolveQuestionPlatformUrl(undefined)).toBeNull();
  });

  it("rejects dangerous / non-https schemes", () => {
    for (const bad of [
      "javascript:alert(1)",
      "  javascript:alert(1)",
      "JAVAscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "http://q.example.com",
      "//q.example.com",
      "/relative/path",
      "q.example.com",
      "https://",
      "not a url",
      "https://q.example.com/".padEnd(600, "x"),
    ]) {
      expect(resolveQuestionPlatformUrl({ questionPlatformEnabled: true, questionPlatformUrl: bad }), bad).toBeNull();
    }
  });
});
