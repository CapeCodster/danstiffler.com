import { hashPin, sha256Base64Url, timingSafeTextEqual } from "../../_lib/crypto.js";
import { assertSameOrigin, errorResponse, json, methodNotAllowed, readJson, RequestError } from "../../_lib/http.js";
import { createSession } from "../../_lib/session.js";

const USER_FAILURE_LIMIT = 5;
const USER_LOCK_MS = 15 * 60 * 1000;
const IP_FAILURE_LIMIT = 10;
const IP_WINDOW_MS = 15 * 60 * 1000;

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    if (!assertSameOrigin(request)) throw new RequestError(403, "Origin check failed");
    const body = await readJson(request, 4096);
    const traveller = String(body.traveller || "");
    const code = String(body.code || "").trim();
    if (!new Set(["Dan", "Ken"]).has(traveller) || !/^\d{6}$/.test(code)) {
      throw new RequestError(401, "The traveller or code was not recognized");
    }

    const now = Date.now();
    const ip = request.headers.get("CF-Connecting-IP") || "local-development";
    const attemptKey = await sha256Base64Url(`${ip}:${traveller}:${env.AUTH_PEPPER}`);
    const attempt = await env.DB.prepare(
      "SELECT failures, window_started_at, blocked_until FROM travel_login_attempts WHERE attempt_key = ?1 LIMIT 1",
    ).bind(attemptKey).first();
    if (attempt && Number(attempt.blocked_until) > now) {
      throw new RequestError(429, "Too many attempts. Try again later");
    }

    const user = await env.DB.prepare(
      "SELECT id, display_name, pin_salt, pin_hash, failed_attempts, locked_until FROM travel_users WHERE display_name = ?1 LIMIT 1",
    ).bind(traveller).first();
    if (!user || Number(user.locked_until) > now) {
      throw new RequestError(401, "The traveller or code was not recognized");
    }

    const accepted = await timingSafeTextEqual(
      await hashPin(code, String(user.pin_salt), env.AUTH_PEPPER),
      String(user.pin_hash),
    );

    if (!accepted) {
      const failures = Number(user.failed_attempts || 0) + 1;
      await env.DB.prepare(
        "UPDATE travel_users SET failed_attempts = ?1, locked_until = ?2, updated_at = ?3 WHERE id = ?4",
      ).bind(failures >= USER_FAILURE_LIMIT ? 0 : failures, failures >= USER_FAILURE_LIMIT ? now + USER_LOCK_MS : 0, now, user.id).run();

      const windowStart = attempt && now - Number(attempt.window_started_at) < IP_WINDOW_MS
        ? Number(attempt.window_started_at)
        : now;
      const ipFailures = attempt && windowStart === Number(attempt.window_started_at) ? Number(attempt.failures) + 1 : 1;
      await env.DB.prepare(
        `INSERT INTO travel_login_attempts (attempt_key, failures, window_started_at, blocked_until)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(attempt_key) DO UPDATE SET failures = excluded.failures, window_started_at = excluded.window_started_at, blocked_until = excluded.blocked_until`,
      ).bind(attemptKey, ipFailures, windowStart, ipFailures >= IP_FAILURE_LIMIT ? now + IP_WINDOW_MS : 0).run();
      throw new RequestError(401, "The traveller or code was not recognized");
    }

    await env.DB.prepare(
      "UPDATE travel_users SET failed_attempts = 0, locked_until = 0, updated_at = ?1 WHERE id = ?2",
    ).bind(now, user.id).run();
    await env.DB.prepare("DELETE FROM travel_login_attempts WHERE attempt_key = ?1").bind(attemptKey).run();

    const session = await createSession(request, env, String(user.id), Boolean(body.rememberDevice));
    return json({
      authenticated: true,
      user: { id: String(user.id), displayName: String(user.display_name) },
      expiresAt: session.expiresAt,
      environment: String(env.AUTH_MODE || "production"),
    }, 200, { "Set-Cookie": session.cookie });
  } catch (error) {
    return errorResponse(error, request);
  }
}
