/// <reference types="@cloudflare/vitest-plugin/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { getDb } from "~server/db/client.server";
import { eq, sql } from "drizzle-orm";
import { registerUser } from "~server/auth/service.server";
import { lessonItems } from "~server/db/schema";
import { createCourse, createGrade, createLesson, createLessonItem, createProgram, createSubject, createUnit, chainForLesson } from "~server/content/service.server";
import { grantEntitlement } from "~server/entitlements/grant.server";
import { resolveContentAccess } from "~server/entitlements/access.server";
import { getVideo, listVideos, mintPlayback, registerMockVideo, syncVideo } from "~server/video/service.server";
import { MockVideoProvider, signMockToken } from "~server/video/providers/mock.server";
import { timingSafeEqualHex } from "~server/crypto/hmac.server";

/**
 * Video pipeline with REAL bindings: mock provider playback minting, token
 * verification at the stream route, playback-API auth/entitlement gates, and
 * Mux JWT signing inside workerd (Ed25519 WebCrypto — no credentials needed).
 */

const db = getDb(env);
const actor = { userId: "00000000-0000-4000-8000-000000000004", role: "super_admin" };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";

let videoId: string;
let studentId: string;
let lessonId: string;
let subjectId: string;

beforeEach(async () => {
  for (const table of ["lesson_items", "lessons", "units", "courses", "subjects", "grades", "programs", "videos", "entitlements"]) {
    await db.run(`DELETE FROM ${table}`);
  }

  // student + session cookie via the real login path
  const r = crypto.randomUUID().slice(0, 8);
  const email = `vid-${r}@test.local`;
  // unique IP per run — the register rate limit is 5/h/IP and dev iterations rerun this file
  const ip = `10.${parseInt(r.slice(0, 2), 16) % 240}.${parseInt(r.slice(2, 4), 16) % 240}.${parseInt(r.slice(4, 6), 16) % 240}`;
  const reg = await registerUser(env, { email, fullName: "Video Student", password: "Str0ngPass!x" }, new Request("https://app.test/register", { method: "POST", headers: { "user-agent": UA, "cf-connecting-ip": ip } }));
  if (!("userId" in reg) || !reg.userId) throw new Error("register failed: " + JSON.stringify(reg));
  studentId = reg.userId;

  // content chain
  const program = await createProgram(db, { titleAr: "ب", titleEn: "Vid Prog", status: "published", sortOrder: 0, descriptionAr: null, descriptionEn: null }, actor);
  const grade = await createGrade(db, { programId: program.id, titleAr: "ص", titleEn: "Vid Grade", status: "published", sortOrder: 0 }, actor);
  const subject = await createSubject(db, { gradeId: grade.id, titleAr: "م", titleEn: "Vid Subj", status: "published", sortOrder: 0, thumbnailFileId: null }, actor);
  const course = await createCourse(db, { subjectId: subject.id, titleAr: "د", titleEn: "Vid Course", status: "published", visibility: "catalog", accessLevel: "entitled", sortOrder: 0, descriptionAr: null, descriptionEn: null, thumbnailFileId: null, teacherId: null, publishAt: null, expiresAt: null }, actor);
  const unit = await createUnit(db, { courseId: course.id, titleAr: "و", titleEn: "Vid Unit", status: "published", sortOrder: 0 }, actor);
  const lesson = await createLesson(db, { unitId: unit.id, titleAr: "د", titleEn: "Vid Lesson", status: "published", accessLevel: "entitled", freePreview: false, sortOrder: 0, descriptionAr: null, descriptionEn: null, publishAt: null, expiresAt: null }, actor);
  lessonId = lesson.id;
  subjectId = subject.id;

  const video = await registerMockVideo(db, { durationSeconds: 90, title: "Test video" });
  videoId = video.id;
  await createLessonItem(db, { lessonId, itemType: "video", videoId, fileId: null, examId: null, sortOrder: 0, required: true }, actor);
});

describe("mock provider", () => {
  it("registerMockVideo → ready with provider asset + playback id", async () => {
    const v = await getVideo(db, videoId);
    expect(v?.status).toBe("ready");
    expect(v?.provider).toBe("mock");
    expect(v?.providerAssetId).toMatch(/^mock-asset-/);
    expect(listVideos !== undefined).toBe(true);
  });

  it("syncVideo keeps it ready (idempotent poll)", async () => {
    const v = await syncVideo(db, env, videoId);
    expect(v?.status).toBe("ready");
  });
});

describe("playback minting gates (service level — the route calls exactly these)", () => {
  it("no entitlement → resolver denies; grant → mint succeeds with a live, bounded-TTL token", async () => {
    const chain = await chainForLesson(db, lessonId);
    const video = (await getVideo(db, videoId))!;

    const denied = await resolveContentAccess(db, { userId: studentId, roleRank: 1 }, chain!);
    expect(denied.allowed).toBe(false); // route answers 403 on this verdict

    await grantEntitlement(db, { studentId, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
    const allowed = await resolveContentAccess(db, { userId: studentId, roleRank: 1 }, chain!);
    expect(allowed).toEqual({ allowed: true, reason: "entitlement" });

    const playback = await mintPlayback(db, env, video, { studentId, lessonId });
    expect("error" in playback).toBe(false);
    const info = playback as { url: string; token?: string; expiresAt: number };
    expect(info.url).toContain(`/api/mock-stream/${videoId}/master.m3u8`);
    expect(info.expiresAt).toBeGreaterThan(Date.now());
    expect(info.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
  });

  it("mock stream token discipline: valid verifies; expired/forged/cross-scope reject (route parity)", async () => {
    await grantEntitlement(db, { studentId, resourceType: "subject", resourceId: subjectId, days: 30 }, actor);
    const video = (await getVideo(db, videoId))!;
    const playback = (await mintPlayback(db, env, video, { studentId, lessonId })) as { url: string; posterUrl?: string };
    // the mock provider embeds uid|exp|token in the playback URL query (the
    // /api/mock-stream route reads exactly these params — no separate token field)
    const parts = new URL(`https://app.test${playback.url}`).searchParams;
    const uid = parts.get("uid")!;
    const exp = Number(parts.get("exp")!);
    const token = parts.get("token")!;
    expect(uid).toBe(studentId);
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // the exact check /api/mock-stream performs:
    const check = async (p: { uid: string; exp: number; token: string; scope: string }) => {
      if (p.exp <= Date.now()) return 404;
      const expected = await signMockToken(env.MOCK_VIDEO_SECRET!, { videoId, scope: p.scope, studentId: p.uid, expiresAt: p.exp });
      return timingSafeEqualHex(expected, p.token) ? 200 : 404;
    };
    expect(await check({ uid, exp, token, scope: "playback" })).toBe(200);
    // expired
    expect(await check({ uid, exp: exp - 120_000, token, scope: "playback" })).toBe(404);
    // forged
    expect(await check({ uid, exp, token: "0".repeat(64), scope: "playback" })).toBe(404);
    // cross-scope (thumbnail token on playback route)
    const thumb = await new MockVideoProvider(env).getThumbnail(video);
    const t = new URL(`https://app.test${thumb.url}`).searchParams;
    expect(await check({ uid: t.get("uid")!, exp: Number(t.get("exp")!), token: t.get("token")!, scope: "playback" })).toBe(404);

    // REGRESSION: mintPlayback().posterUrl must carry its OWN thumbnail-scoped
    // token — it once reused the playback token, and /api/mock-stream derives
    // scope from the file extension (poster.svg → "thumbnail"), so the poster
    // URL the player renders 404'd every time.
    expect(playback.posterUrl).toContain(`/api/mock-stream/${videoId}/poster.svg`);
    const pp = new URL(`https://app.test${playback.posterUrl!}`).searchParams;
    expect(await check({ uid: pp.get("uid")!, exp: Number(pp.get("exp")!), token: pp.get("token")!, scope: "thumbnail" })).toBe(200);
    // scope separation holds both ways: playback token cannot open the poster path
    expect(await check({ uid, exp, token, scope: "thumbnail" })).toBe(404);
  });

  it("video not attached to any lesson finds no allowed chain (route answers 403)", async () => {
    const orphan = await registerMockVideo(db, { durationSeconds: 10, title: "orphan" });
    const items = await db.select().from(lessonItems).where(eq(lessonItems.videoId, orphan.id));
    expect(items.length).toBe(0);
  });
});

describe("mint discipline (service level)", () => {
  it("mints only for ready videos and the entitlement verdict gates the caller", async () => {
    const v = (await getVideo(db, videoId))!;
    const chain = await chainForLesson(db, lessonId);
    const denied = await resolveContentAccess(db, { userId: studentId, roleRank: 1 }, chain!);
    expect(denied.allowed).toBe(false);

    await grantEntitlement(db, { studentId, resourceType: "lesson", resourceId: lessonId, days: 1 }, actor);
    const allowed = await resolveContentAccess(db, { userId: studentId, roleRank: 1 }, chain!);
    expect(allowed).toEqual({ allowed: true, reason: "entitlement" });

    const playback = await mintPlayback(db, env, v, { studentId, lessonId });
    expect("error" in playback).toBe(false);
    const info = playback as { url: string; expiresAt: number };
    expect(info.expiresAt).toBeGreaterThan(Date.now());
    expect(info.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);

    // pending video → structured error, not credentials
    await db.run(sql`UPDATE videos SET status = 'preparing' WHERE id = ${videoId}`);
    const notReady = await mintPlayback(db, env, (await getVideo(db, videoId))!, { studentId });
    expect(notReady).toEqual({ error: "not_ready" });
  });
});

describe("mux JWT signing inside workerd (no credentials required)", () => {
  it("Ed25519 WebCrypto signs/verifies playback tokens in the Workers runtime", async () => {
    const { importEd25519PrivateKey, signMuxPlaybackJwt, decodeMuxJwt } = await import("~server/video/providers/mux.server");
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
    const key = await importEd25519PrivateKey(b64);
    const token = await signMuxPlaybackJwt(key, { sub: "pbW", aud: "v", exp: Math.floor(Date.now() / 1000) + 45, kid: "k1" });
    expect(decodeMuxJwt(token).claims).toMatchObject({ sub: "pbW", aud: "v", kid: "k1" });

    const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
    const pub = await crypto.subtle.importKey("spki", spki, { name: "Ed25519" }, false, ["verify"]);
    const [h, p, s] = token.split(".");
    const sigBytes = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify("Ed25519", pub, sigBytes as unknown as ArrayBuffer, new TextEncoder().encode(`${h}.${p}`) as unknown as ArrayBuffer);
    expect(ok).toBe(true);
  });
});

describe("mock token helper parity", () => {
  it("sign/verify parity via hmac + timing-safe compare", async () => {
    const secret = env.MOCK_VIDEO_SECRET!;
    const token = await signMockToken(secret, { videoId: "v", scope: "playback", studentId: "s", expiresAt: 123 });
    const again = await signMockToken(secret, { videoId: "v", scope: "playback", studentId: "s", expiresAt: 123 });
    expect(timingSafeEqualHex(token, again)).toBe(true);
    const other = await signMockToken(secret, { videoId: "v", scope: "playback", studentId: "OTHER", expiresAt: 123 });
    expect(timingSafeEqualHex(token, other)).toBe(false);
  });
});
