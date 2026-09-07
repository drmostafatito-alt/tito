/**
 * Synthetic, real decodable MPEG-TS placeholder segment (3 seconds of black frame,
 * H.264 baseline 160x90).
 *
 * Used by the mock video provider (/api/mock-stream/:videoId/segment.ts) to allow
 * hls.js / MSE players to demux, decode, and emit progress/timeupdate events offline
 * in development, smoke, and testing environments without external dependencies.
 */

// 5 MPEG-TS packets (188 bytes each = 940 bytes):
// 1. PAT (PID 0)
// 2. PMT (PID 0x100 -> H.264 stream PID 0x101)
// 3. PES Packet 1 (PTS = 0s): AUD + SPS (160x90 baseline) + PPS + IDR Slice
// 4. PES Packet 2 (PTS = 1s): AUD + SPS + PPS + IDR Slice
// 5. PES Packet 3 (PTS = 2s): AUD + SPS + PPS + IDR Slice
const MOCK_SEGMENT_BASE64 =
  "R0AAMKYA////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AACwDQABwQAAAAHhAOj5Xn1HQQAwoQD/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAKwEgABwQAA4QHwABvhAfAAT8Q9G0dBATBgEAAAAAB+AP//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAB4ABRgIAFIQABAAEAAAABCfAAAAABZ0LACtkBQfl4QAAAAAFozjiAAAAAAWWIhCQhCEIQhCEIQhCEIQhCEIQhCEIQhCEIQhCEIQhCEIQhCEIQhCEJR0EBMWAQAACvyH4A//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8AAAHgAFGAgAUhAAW/IQAAAAEJ8AAAAAFnQsAK2QFB+XhAAAAAAWjOOIAAAAABZYiEJCEIQhCEIQhCEIQhCEIQhCEIQhCEIQhCEIQhCEIQhCEIQhCEIQlHQQEyYBAAAV+QfgD//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////wAAAeAAUYCABSEAC35BAAAAAQnwAAAAAWdCwArZAUH5eEAAAAABaM44gAAAAAFliIQkIQhCEIQhCEIQhCEIQhCEIQhCEIQhCEIQhCEIQhCEIQhCEIQhCQ==";

let cachedBytes: Uint8Array | null = null;

export function getMockSegmentBytes(): Uint8Array {
  if (!cachedBytes) {
    cachedBytes = Uint8Array.from(atob(MOCK_SEGMENT_BASE64), (c) => c.charCodeAt(0));
  }
  return cachedBytes;
}
