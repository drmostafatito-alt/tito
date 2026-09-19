import { useEffect, useState } from "react";
import { Alert } from "~/components/ui/Alert";
import { t, type Locale } from "~/lib/i18n";

const PROBE_NAME = "__edu_cookie_probe";
const SUBMIT_FLAG = "edu_auth_submitted";

/**
 * Honest diagnostics for embedded previews: some browsers refuse cookies inside
 * cross-site frames, so a SUCCESSFUL login silently bounces back to /login with
 * no error at all ("the button does nothing"). Detect that client-side and tell
 * the user exactly what is happening and how to escape (open a full tab).
 */
export function SessionStorageNotice({ locale }: { locale: Locale }) {
  const [state, setState] = useState<"blocked" | "lost" | "frame" | null>(null);
  const [href, setHref] = useState("/");

  useEffect(() => {
    let cookiesOk = false;
    try {
      document.cookie = `${PROBE_NAME}=1; Path=/; SameSite=Lax`;
      cookiesOk = document.cookie.includes(PROBE_NAME);
      document.cookie = `${PROBE_NAME}=; Path=/; Max-Age=0`;
    } catch {
      cookiesOk = false;
    }
    let submitted = false;
    try {
      submitted = sessionStorage.getItem(SUBMIT_FLAG) === "1";
      if (submitted) sessionStorage.removeItem(SUBMIT_FLAG);
    } catch {
      submitted = false;
    }
    setHref(window.location.href);
    const inFrame = window.top !== window.self;
    if (!cookiesOk) setState(submitted ? "lost" : "blocked");
    else if (inFrame) setState("frame");
  }, []);

  if (!state) return null;
  const key =
    state === "lost" ? "auth.cookiesBlockedAfterLogin" : state === "blocked" ? "auth.cookiesBlocked" : "auth.frameHint";
  return (
    <div className="mb-4">
      <Alert kind={state === "frame" ? "info" : "error"}>
        <span className="block">{t(locale, key)}</span>
        <a className="mt-2 inline-block font-semibold underline" href={href} target="_top" rel="noopener">
          {t(locale, "auth.openFullTab")}
        </a>
      </Alert>
    </div>
  );
}

/** Called from auth forms' onSubmit so a silent bounce-back can be explained. */
export function markAuthSubmitted() {
  try {
    sessionStorage.setItem(SUBMIT_FLAG, "1");
  } catch {
    /* storage unavailable — nothing to mark */
  }
}
