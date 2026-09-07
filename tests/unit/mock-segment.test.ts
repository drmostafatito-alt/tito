import { describe, expect, it } from "vitest";
import { getMockSegmentBytes } from "~server/video/mock-segment.server";

describe("mock-segment server", () => {
  it("returns decodable MPEG-TS segment bytes starting with standard 0x47 sync bytes", () => {
    const bytes = getMockSegmentBytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThanOrEqual(188);
    expect(bytes.length % 188).toBe(0); // Multiple of 188-byte TS packets

    // Every packet must begin with sync byte 0x47
    for (let i = 0; i < bytes.length; i += 188) {
      expect(bytes[i]).toBe(0x47);
    }
  });
});
