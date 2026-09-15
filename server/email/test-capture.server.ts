import { capturedEmails } from "./provider";

/** Server-only bridge used by the strictly test-gated browser capture route. */
export function testCapturedEmails(to: string) {
  return capturedEmails(to);
}
