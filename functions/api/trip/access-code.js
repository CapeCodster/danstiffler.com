import { hashPin, randomToken, sha256Base64Url, timingSafeTextEqual } from "../../_lib/crypto.js";
import { requireSession } from "../../_lib/auth.js";
import { assertSameOrigin, errorResponse, json, methodNotAllowed, readJson, RequestError } from "../../_lib/http.js";

const FAILURE_LIMIT = 5;
const WINDOW_MS = 15 * 60 * 1000;

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    if (!assertSameOrigin(request)) throw new RequestError(403, "Origin check failed");
    const auth = await requireSession(request, env);
    if (auth.response) return auth.response;
    const body = await readJson(request, 4096);
    const currentCode = String(body.currentCode || "").trim();
    const newCode = String(body.newCode || "").trim();
    if (!/^\d{6}$/.test(currentCode)) throw new RequestError(401, "The current code was not recognized");
    if (!/^\d{6}$/.test(newCode)) throw new RequestError(400, "Choose a new six-digit code");
    if (currentCode === newCode) throw new RequestError(400, "Choose a different six-digit code");

    const now = Date.now();
    const ip = request.headers.get("CF-Connecting-IP") || "local-development";
    const attemptKey = await sha256Base64Url(`access-code:${ip}:${auth.session.userId}:${env.AUTH_PEPPER}`);
    const attempt = await env.DB.prepare(
      "SELECT failures, window_started_at, blocked_until FROM travel_login_attempts WHERE attempt_key = ?1 LIMIT 1",
    ).bind(attemptKey).first();
    if (attempt && Number(attempt.blocked_until) > now) {
      throw new RequestError(429, "Too many attempts. Try again later");
    }

    const user = await env.DB.prepare(
      "SELECT id, pin_salt, pin_hash, locked_until FROM travel_users WHERE id = ?1 LIMIT 1",
    ).bind(auth.session.userId).first();
    if (!user || Number(user.locked_until) > now) throw new RequestError(401, "The current code was not recognized");

    const accepted = await timingSafeTextEqual(
      await hashPin(currentCode, String(user.pin_salt), env.AUTH_PEPPER),
      String(user.pin_hash),
    );
    if (!accepted) {
      const windowStart = attempt && now - Number(attempt.window_started_at) < WINDOW_MS
        ? Number(attempt.window_started_at)
        : now;
      const failures = attempt && windowStart === Number(attempt.window_started_at)
        ? Number(attempt.failures) + 1
        : 1;
      await env.DB.prepare(
        `INSERT INTO travel_login_attempts (attempt_key, failures, window_started_at, blocked_until)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(attempt_key) DO UPDATE SET failures = excluded.failures, window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until`,
      ).bind(attemptKey, failures, windowStart, failures >= FAILURE_LIMIT ? now + WINDOW_MS : 0).run();
      throw new RequestError(401, "The current code was not recognized");
    }

    const salt = randomToken(16);
    const pinHash = await hashPin(newCode, salt, env.AUTH_PEPPER);
    await env.DB.prepare(
      "UPDATE travel_users SET pin_salt = ?1, pin_hash = ?2, failed_attempts = 0, locked_until = 0, updated_at = ?3 WHERE id = ?4",
    ).bind(salt, pinHash, now, auth.session.userId).run();
    await env.DB.prepare("DELETE FROM travel_login_attempts WHERE attempt_key = ?1").bind(attemptKey).run();
    return json({ updated: true });
  } catch (error) {
    return errorResponse(error, request);
  }
}
