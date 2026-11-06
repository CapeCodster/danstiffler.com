import { randomToken, sha256Base64Url } from "./crypto.js";

export const SESSION_COOKIE = "__Host-my_travels_session";

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  return Object.fromEntries(header.split(";").map((part) => {
    const index = part.indexOf("=");
    if (index < 0) return [part.trim(), ""];
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }).filter(([name]) => name));
}

function sessionTtl(env) {
  const parsed = Number(env.SESSION_TTL_SECONDS || 604800);
  return Number.isFinite(parsed) && parsed >= 900 ? Math.min(parsed, 2592000) : 604800;
}

export async function createSession(request, env, userId, persistent = false, knownAuthVersion = null) {
  const token = randomToken(32);
  const tokenHash = await sha256Base64Url(`${token}:${env.AUTH_PEPPER}`);
  const now = Date.now();
  const expiresAt = now + (sessionTtl(env) * 1000);
  const userAgentHash = await sha256Base64Url(request.headers.get("User-Agent") || "unknown");
  const authVersion = knownAuthVersion ?? await env.DB.prepare(
    "SELECT auth_version FROM travel_users WHERE id = ?1 LIMIT 1",
  ).bind(userId).first("auth_version");
  if (!Number.isInteger(Number(authVersion))) throw new Error("Session user is unavailable");
  await env.DB.prepare(
    "INSERT INTO travel_sessions (token_hash, user_id, expires_at, created_at, last_seen_at, user_agent_hash, auth_version) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6)",
  ).bind(tokenHash, userId, expiresAt, now, userAgentHash, Number(authVersion)).run();
  return {
    cookie: `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict${persistent ? `; Max-Age=${sessionTtl(env)}` : ""}`,
    expiresAt,
  };
}

export async function readSession(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256Base64Url(`${token}:${env.AUTH_PEPPER}`);
  const row = await env.DB.prepare(
    `SELECT s.token_hash, s.user_id, s.expires_at, s.auth_version AS session_auth_version,
            u.auth_version AS user_auth_version, u.display_name
     FROM travel_sessions s
     JOIN travel_users u ON u.id = s.user_id
     WHERE s.token_hash = ?1
     LIMIT 1`,
  ).bind(tokenHash).first();
  if (!row
    || Number(row.expires_at) <= Date.now()
    || Number(row.session_auth_version) !== Number(row.user_auth_version)) {
    if (row) await env.DB.prepare("DELETE FROM travel_sessions WHERE token_hash = ?1").bind(tokenHash).run();
    return null;
  }
  return {
    tokenHash,
    userId: String(row.user_id),
    displayName: String(row.display_name),
    expiresAt: Number(row.expires_at),
  };
}

export async function deleteSession(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return;
  const tokenHash = await sha256Base64Url(`${token}:${env.AUTH_PEPPER}`);
  await env.DB.prepare("DELETE FROM travel_sessions WHERE token_hash = ?1").bind(tokenHash).run();
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
