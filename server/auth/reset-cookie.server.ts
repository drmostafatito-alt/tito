/** HttpOnly bearer-cookie used only after a reset link has been validated. */
export const RESET_COOKIE_NAME = "__Host-edu_reset";
export const RESET_COOKIE_MAX_AGE_SECONDS = 15 * 60;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isResetTokenShape(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

export function resetTokenFromRequest(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  if (!header || header.length > 16_384) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== RESET_COOKIE_NAME) continue;
    const raw = part.slice(index + 1).trim();
    return isResetTokenShape(raw) ? raw : null;
  }
  return null;
}

export function serializeResetCookie(token: string): string {
  if (!isResetTokenShape(token)) throw new Error("invalid reset token shape");
  return `${RESET_COOKIE_NAME}=${token}; Path=/; Max-Age=${RESET_COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax; Priority=High`;
}

export function clearResetCookie(): string {
  return `${RESET_COOKIE_NAME}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax; Priority=High`;
}
