import { hashPin, sha256Base64Url, timingSafeTextEqual } from "../../_lib/crypto.js";
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
    const code = String(body.code || "").trim();
    if (!/^\d{6}$/.test(code)) throw new RequestError(401, "The code was not recognized");

    const now = Date.now();
    const ip = request.headers.get("CF-Connecting-IP") || "local-development";
    const attemptKey = await sha256Base64Url(`offline:${ip}:${auth.session.userId}:${env.AUTH_PEPPER}`);
    const attempt = await env.DB.prepare(
      "SELECT failures, window_started_at, blocked_until FROM travel_login_attempts WHERE attempt_key = ?1 LIMIT 1",
    ).bind(attemptKey).first();
    if (attempt && Number(attempt.blocked_until) > now) {
      throw new RequestError(429, "Too many attempts. Try again later");
    }

    const user = await env.DB.prepare(
      "SELECT id, display_name, pin_salt, pin_hash, locked_until FROM travel_users WHERE id = ?1 LIMIT 1",
    ).bind(auth.session.userId).first();
    if (!user || Number(user.locked_until) > now) throw new RequestError(401, "The code was not recognized");

    const accepted = await timingSafeTextEqual(
      await hashPin(code, String(user.pin_salt), env.AUTH_PEPPER),
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
      throw new RequestError(401, "The code was not recognized");
    }

    await env.DB.prepare("DELETE FROM travel_login_attempts WHERE attempt_key = ?1").bind(attemptKey).run();
    return json({
      verified: true,
      user: { id: String(user.id), displayName: String(user.display_name) },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
