"use client";

import { useEffect, useRef, useState } from "react";
import { useRouteLoaderData } from "react-router";
import { t, type Locale } from "~/lib/i18n";

/**
 * Single player component (VIDEO-PROVIDERS.md §1/§7) — consumes PlaybackInfo
 * only; knows no vendor names. iOS-first: playsinline, native HLS on Safari.
 * Credentials are fetched per-view from /api/playback/:id (server mints after
 * entitlement check); they are never embedded in SSR HTML.
 *
 * Phase 4: resume + progress beacons. The server is the source of truth —
 * the player reports position via debounced POST /beacons/progress (heartbeat)
 * and an "ended" beacon on pagehide; the server decides completion (threshold)
 * and may auto-complete the lesson (onLessonCompleted → page revalidation).
 */
interface PlaybackResponse {
  /** "embed" = third-party hosted player (YouTube) rendered in a sandboxed iframe. */
  type: "hls" | "mp4" | "embed";
  url: string;
  token?: string | null;
  expiresAt: number;
  posterUrl?: string | null;
  /** Server-stored resume position in seconds (0 = start from beginning). */
  resumeAt?: number;
  error?: string;
}

const HEARTBEAT_INTERVAL_MS = 10_000;

export function VideoPlayer({
  videoId,
  lessonId,
  title,
  showPoster = true,
  allowFullscreen = true,
  allowSpeed = true,
  startAt = 0,
  onLessonCompleted,
}: {
  videoId: string;
  /** Lesson context for progress/entitlement-checked beacons (optional). */
  lessonId?: string;
  title?: string;
  /** Presentation settings (admin-controlled; Phase 3). Structure stays provider-agnostic. */
  showPoster?: boolean;
  allowFullscreen?: boolean;
  allowSpeed?: boolean;
  /** SSR resume hint (seconds); the fresher server value from /api/playback wins. */
  startAt?: number;
  /** Fired when the server reports the lesson auto-completed (page revalidates). */
  onLessonCompleted?: () => void;
}) {
  const root = useRouteLoaderData("root") as { locale: Locale } | undefined;
  const locale = root?.locale ?? "ar";
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [src, setSrc] = useState<string | null>(null);
  const [kind, setKind] = useState<"hls" | "mp4" | "embed">("hls");
  const [poster, setPoster] = useState<string | null>(null);
  const [resumedNotice, setResumedNotice] = useState(false);
  const ref = useRef<HTMLVideoElement | null>(null);
  // progress-tracking refs (never trigger re-renders)
  const resumePos = useRef(startAt);
  const lastSentAt = useRef(0);
  const lastPosition = useRef(0);
  const watchedAcc = useRef(0);
  const completedNotified = useRef(false);

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/api/playback/${videoId}`, { method: "POST", credentials: "same-origin" })
      .then(async (res) => {
        const body = (await res.json()) as PlaybackResponse;
        if (!alive) return;
        if (res.status === 403 || res.status === 401) return setState("denied");
        if (!res.ok || body.error) return setState("error");
        const url = body.token && !body.url.includes("token=") ? `${body.url}?token=${body.token}` : body.url;
        if (typeof body.resumeAt === "number" && body.resumeAt > 5) resumePos.current = body.resumeAt;
        setSrc(url);
        setKind(body.type === "embed" ? "embed" : (body.type ?? "hls"));
        setPoster(body.posterUrl ?? null);
        setState("ready");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [videoId]);

  // enforce the admin playback-speed policy (native UI offers speed; we pin it back)
  useEffect(() => {
    const el = ref.current;
    if (!el || allowSpeed) return;
    const lock = () => { if (el.playbackRate !== 1) el.playbackRate = 1; };
    el.addEventListener("ratechange", lock);
    return () => el.removeEventListener("ratechange", lock);
  }, [allowSpeed, state, src]);

  // resume + beacons (server is the source of truth for progress)
  useEffect(() => {
    const el = ref.current;
    if (!el || state !== "ready") return;

    const sendBeacon = (kind: "heartbeat" | "ended") => {
      const positionSeconds = Math.floor(el.currentTime || 0);
      const durationSeconds = Number.isFinite(el.duration) && el.duration > 0 ? Math.floor(el.duration) : undefined;
      const payload = JSON.stringify({
        videoId,
        lessonId,
        positionSeconds,
        durationSeconds,
        watchedSeconds: Math.floor(watchedAcc.current),
        kind,
      });
      const url = "/beacons/progress";
      if (kind === "ended" && typeof navigator !== "undefined" && "sendBeacon" in navigator) {
        navigator.sendBeacon(url, new Blob([payload], { type: "application/json" }));
        return;
      }
      fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      })
        .then(async (res) => {
          if (!res.ok) return null;
          return (await res.json()) as { completed?: boolean; lessonCompleted?: boolean };
        })
        .then((body) => {
          if (body?.lessonCompleted && !completedNotified.current) {
            completedNotified.current = true;
            onLessonCompleted?.();
          }
        })
        .catch(() => {
          /* beacons never block playback */
        });
    };

    const applyResume = () => {
      const pos = resumePos.current;
      if (pos > 5 && Number.isFinite(el.duration) && pos < el.duration - 5) {
        el.currentTime = pos;
        setResumedNotice(true);
      }
      resumePos.current = 0; // only once per mount
    };

    const onTimeUpdate = () => {
      const pos = el.currentTime || 0;
      const delta = pos - lastPosition.current;
      // accumulate only continuous forward playback (skips/rewinds don't count)
      if (delta > 0 && delta < 10) watchedAcc.current += delta;
      lastPosition.current = pos;
      const nowMs = Date.now();
      if (nowMs - lastSentAt.current >= HEARTBEAT_INTERVAL_MS) {
        lastSentAt.current = nowMs;
        sendBeacon("heartbeat");
      }
    };

    const onPause = () => sendBeacon("heartbeat");
    const onPageHide = () => sendBeacon("ended");
    const onEnded = () => {
      sendBeacon("ended");
    };

    if (el.readyState >= 1) applyResume();
    else el.addEventListener("loadedmetadata", applyResume, { once: true });
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      el.removeEventListener("loadedmetadata", applyResume);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [state, src, videoId, lessonId, onLessonCompleted]);

  return (
    <figure className="overflow-hidden rounded-xl border border-line bg-slate-900">
      {state === "loading" && (
        <div className="flex h-56 items-center justify-center text-sm text-slate-300">{t(locale, "player.loading")}</div>
      )}
      {state === "denied" && (
        <div className="flex h-56 items-center justify-center text-sm text-red-300">{t(locale, "player.denied")}</div>
      )}
      {state === "error" && (
        <div className="flex h-56 items-center justify-center text-sm text-amber-300">{t(locale, "player.error")}</div>
      )}
      {state === "ready" && src && kind === "embed" && (
        /* Third-party hosted player. The src is NOT user input: it is rebuilt
         * server-side from a validated 11-char YouTube id, and CSP frame-src is
         * locked to youtube-nocookie.com, so this frame cannot be pointed
         * anywhere else. allow-same-origin is required for the YouTube player to
         * function and is safe here because the origin is pinned by CSP. */
        <div className="relative w-full" style={{ aspectRatio: "16 / 9" }}>
          <iframe
            src={src}
            title={title ?? "video"}
            className="absolute inset-0 h-full w-full border-0"
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen={allowFullscreen}
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            data-testid="video-embed"
          />
        </div>
      )}
      {state === "ready" && src && kind !== "embed" && (
        <video
          ref={ref}
          className="h-auto w-full"
          controls
          playsInline
          webkit-playsinline="true"
          preload="metadata"
          poster={showPoster ? (poster ?? undefined) : undefined}
          controlsList={allowFullscreen ? undefined : "nofullscreen"}
          src={src}
        >
          {title && <track kind="captions" />}
        </video>
      )}
      {resumedNotice && state === "ready" && (
        <p className="bg-slate-800 px-3 py-1.5 text-xs text-slate-300">{t(locale, "player.resumed")}</p>
      )}
      {title && state === "ready" && (
        <figcaption className="bg-slate-900 px-3 py-2 text-sm text-slate-200">{title}</figcaption>
      )}
    </figure>
  );
}
