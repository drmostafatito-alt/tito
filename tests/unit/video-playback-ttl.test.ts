import { describe, expect, it } from "vitest";
import { playbackCredentialTtlSeconds } from "~server/video/service.server";

describe("signed playback viewing window", () => {
  it("uses the configured floor for short videos", () => {
    expect(playbackCredentialTtlSeconds(90, 3_600)).toBe(3_600);
  });

  it("covers known duration plus a 30-minute buffer", () => {
    expect(playbackCredentialTtlSeconds(7_200, 3_600)).toBe(9_000);
  });

  it("uses four hours when provider duration is unavailable", () => {
    expect(playbackCredentialTtlSeconds(null, 3_600)).toBe(14_400);
  });

  it("never mints for more than 24 hours", () => {
    expect(playbackCredentialTtlSeconds(100_000, 3_600)).toBe(86_400);
    expect(playbackCredentialTtlSeconds(60, 999_999)).toBe(86_400);
  });
});
