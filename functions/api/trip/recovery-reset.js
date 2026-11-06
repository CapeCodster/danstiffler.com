import {
  hashPin,
  hashRecoveryCode,
  randomToken,
  sha256Base64Url,
  timingSafeTextEqual,
} from "../../_lib/crypto.js";
import { assertSameOrigin, errorResponse, json, methodNotAllowed, readJson, RequestError } from "../../_lib/http.js";
import { createSession } from "../../_lib/session.js";

const FAILURE_LIMIT = 10;
const WINDOW_MS = 15 * 60 * 1000;
const TRAVELLERS = new Set(["Dan", "Ken"]);

async function recordFailure(env, attemptKey, attempt, now) {
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
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    if (!assertSameOrigin(request)) throw new RequestError(403, "Origin check failed");
    const body = await readJson(request, 4096);
    const traveller = String(body.traveller || "").trim();
    const recoveryCode = String(body.recoveryCode || "").trim();
    const newCode = String(body.newCode || "").trim();
    if (!TRAVELLERS.has(traveller)
      || !/^[A-Z]{3}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(recoveryCode)) {
      throw new RequestError(401, "The traveler or recovery code was not recognized");
    }
    if (!/^\d{6}$/.test(newCode)) throw new RequestError(400, "Choose a new six-digit code");

    const now = Date.now();
    const ip = request.headers.get("CF-Connecting-IP") || "local-development";
    const attemptKey = await sha256Base64Url(`recovery-reset:${ip}:${traveller}:${env.AUTH_PEPPER}`);
    const attempt = await env.DB.prepare(
      "SELECT failures, window_started_at, blocked_until FROM travel_login_attempts WHERE attempt_key = ?1 LIMIT 1",
    ).bind(attemptKey).first();
    if (attempt && Number(attempt.blocked_until) > now) {
      throw new RequestError(429, "Too many attempts. Try again later");
    }

    const user = await env.DB.prepare(
      "SELECT id, display_name, pin_salt, pin_hash, recovery_hashes, auth_version FROM travel_users WHERE display_name = ?1 LIMIT 1",
    ).bind(traveller).first();
    const storedRecoveryHashes = user ? String(user.recovery_hashes) : "[]";
    const recoveryHashes = JSON.parse(storedRecoveryHashes);
    const suppliedHash = await hashRecoveryCode(recoveryCode, env.AUTH_PEPPER);
    let recoveryIndex = -1;
    for (let index = 0; index < recoveryHashes.length; index += 1) {
      if (await timingSafeTextEqual(suppliedHash, String(recoveryHashes[index]))) {
        recoveryIndex = index;
        break;
      }
    }
    if (!user || recoveryIndex < 0) {
      await recordFailure(env, attemptKey, attempt, now);
      throw new RequestError(401, "The traveler or recovery code was not recognized");
    }

    const repeatsCurrentCode = await timingSafeTextEqual(
      await hashPin(newCode, String(user.pin_salt), env.AUTH_PEPPER),
      String(user.pin_hash),
    );
    if (repeatsCurrentCode) throw new RequestError(400, "Choose a different six-digit code");

    recoveryHashes.splice(recoveryIndex, 1);
    const salt = randomToken(16);
    const pinHash = await hashPin(newCode, salt, env.AUTH_PEPPER);
    const update = await env.DB.prepare(
      `UPDATE travel_users
       SET pin_salt = ?1, pin_hash = ?2, recovery_hashes = ?3,
           failed_attempts = 0, locked_until = 0, auth_version = auth_version + 1, updated_at = ?4
       WHERE id = ?5 AND recovery_hashes = ?6`,
    ).bind(salt, pinHash, JSON.stringify(recoveryHashes), now, user.id, storedRecoveryHashes).run();
    if (Number(update.meta?.changes || 0) !== 1) {
      throw new RequestError(409, "Recovery state changed. Start the reset again");
    }

    // auth_version invalidates every previously issued session immediately.
    // Deleting the rows is cleanup and does not carry the security guarantee.
    await env.DB.prepare("DELETE FROM travel_sessions WHERE user_id = ?1").bind(user.id).run();
    await env.DB.prepare("DELETE FROM travel_login_attempts WHERE attempt_key = ?1").bind(attemptKey).run();

    const session = await createSession(
      request,
      env,
      String(user.id),
      Boolean(body.rememberDevice),
      Number(user.auth_version) + 1,
    );
    return json({
      authenticated: true,
      reset: true,
      user: { id: String(user.id), displayName: String(user.display_name) },
      expiresAt: session.expiresAt,
    }, 200, { "Set-Cookie": session.cookie });
  } catch (error) {
    return errorResponse(error, request);
  }
}
