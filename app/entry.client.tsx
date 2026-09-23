import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

/** Must match server/auth/cookies.server.ts. Duplicated so this file stays client-safe. */
const SESSION_HEADER = "X-Edu-Session";
const DEVICE_HEADER = "X-Edu-Device";
const CLEAR_HEADER = "X-Edu-Clear-Session";
const SESSION_KEY = "edu_session";
const DEVICE_KEY = "edu_dk";

/**
 * Cross-site preview iframes drop Set-Cookie even with SameSite=None; Partitioned.
 * Login still succeeds; the next navigation then looks anonymous. Replay the
 * opaque tokens from sessionStorage on same-origin fetches (React Router .data
 * requests). Production never emits these headers, so this is a no-op there.
 */
function isSameOrigin(input: RequestInfo | URL): boolean {
  try {
    const href = input instanceof Request ? input.url : String(input);
    return new URL(href, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

function installEmbedSessionFetch(): void {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isSameOrigin(input)) return originalFetch(input, init);
    const headers = new Headers(init?.headers);
    if (input instanceof Request) {
      input.headers.forEach((value, key) => {
        if (!headers.has(key)) headers.set(key, value);
      });
    }
    try {
      const session = sessionStorage.getItem(SESSION_KEY);
      if (session && !headers.has(SESSION_HEADER)) headers.set(SESSION_HEADER, session);
      const device = sessionStorage.getItem(DEVICE_KEY);
      if (device && !headers.has(DEVICE_HEADER)) headers.set(DEVICE_HEADER, device);
    } catch {
      /* private mode / blocked storage */
    }
    return originalFetch(input, { ...init, headers }).then((response) => {
      try {
        const session = response.headers.get(SESSION_HEADER);
        if (session) sessionStorage.setItem(SESSION_KEY, session);
        const device = response.headers.get(DEVICE_HEADER);
        if (device) sessionStorage.setItem(DEVICE_KEY, device);
        if (response.headers.get(CLEAR_HEADER) === "1") {
          sessionStorage.removeItem(SESSION_KEY);
          sessionStorage.removeItem(DEVICE_KEY);
        }
      } catch {
        /* ignore */
      }
      return response;
    });
  };
}

installEmbedSessionFetch();

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});
