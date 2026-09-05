"use client";

import { useEffect, useRef, useState } from "react";
import { useRouteLoaderData } from "react-router";
import { t, type Locale } from "~/lib/i18n";

/**
 * Single player component (VIDEO-PROVIDERS.md §1/§7) — consumes PlaybackInfo
 * only; knows no vendor names. iOS-first: playsinline, native HLS on Safari.
 * Credentials are fetched per-view from /api/playback/:id (server mints after
 * entitlement check); they are never embedded in SSR HTML.
 */
interface PlaybackResponse {
  type: "hls" | "mp4";
  url: string;
  token?: string | null;
  expiresAt: number;
  posterUrl?: string | null;
  error?: string;
}

export function VideoPlayer({ videoId, title }: { videoId: string; title?: string }) {
  const root = useRouteLoaderData("root") as { locale: Locale } | undefined;
  const locale = root?.locale ?? "ar";
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [src, setSrc] = useState<string | null>(null);
  const [poster, setPoster] = useState<string | null>(null);
  const ref = useRef<HTMLVideoElement | null>(null);

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
        setSrc(url);
        setPoster(body.posterUrl ?? null);
        setState("ready");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, [videoId]);

  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
      {state === "loading" && (
        <div className="flex h-56 items-center justify-center text-sm text-slate-300">{t(locale, "player.loading")}</div>
      )}
      {state === "denied" && (
        <div className="flex h-56 items-center justify-center text-sm text-red-300">{t(locale, "player.denied")}</div>
      )}
      {state === "error" && (
        <div className="flex h-56 items-center justify-center text-sm text-amber-300">{t(locale, "player.error")}</div>
      )}
      {state === "ready" && src && (
        <video
          ref={ref}
          className="h-auto w-full"
          controls
          playsInline
          webkit-playsinline="true"
          preload="metadata"
          poster={poster ?? undefined}
          src={src}
        >
          {title && <track kind="captions" />}
        </video>
      )}
      {title && state === "ready" && (
        <figcaption className="bg-slate-900 px-3 py-2 text-sm text-slate-200">{title}</figcaption>
      )}
    </figure>
  );
}
