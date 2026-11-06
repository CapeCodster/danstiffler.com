import { requireBootstrapSecret } from "../../_lib/bootstrap.js";
import { hashPin, hashRecoveryCode, makeRecoveryCodes, randomToken } from "../../_lib/crypto.js";
import { assertSameOrigin, errorResponse, json, methodNotAllowed, readJson, RequestError } from "../../_lib/http.js";

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    if (!assertSameOrigin(request)) throw new RequestError(403, "Origin check failed");
    await requireBootstrapSecret(request, env);
    const existing = await env.DB.prepare("SELECT COUNT(*) AS count FROM travel_users").first("count");
    if (Number(existing || 0) > 0) throw new RequestError(409, "Travel users are already configured");

    const body = await readJson(request, 8192);
    if (!Array.isArray(body.users) || body.users.length !== 2) {
      throw new RequestError(400, "Exactly two travellers are required");
    }
    const expected = new Set(["Dan", "Ken"]);
    const prepared = [];
    for (const input of body.users) {
      if (!input || !expected.has(input.displayName) || !/^\d{6}$/.test(String(input.code || ""))) {
        throw new RequestError(400, "Dan and Ken each require a six-digit code");
      }
      expected.delete(input.displayName);
      const id = input.displayName.toLowerCase();
      const salt = randomToken(16);
      const recoveryCodes = makeRecoveryCodes(input.displayName);
      const recoveryHashes = await Promise.all(recoveryCodes.map((code) => hashRecoveryCode(code, env.AUTH_PEPPER)));
      prepared.push({
        id,
        displayName: input.displayName,
        salt,
        pinHash: await hashPin(input.code, salt, env.AUTH_PEPPER),
        recoveryHashes,
        recoveryCodes,
      });
    }
    if (expected.size) throw new RequestError(400, "Dan and Ken are both required");

    const now = Date.now();
    await env.DB.batch(prepared.map((user) => env.DB.prepare(
      "INSERT INTO travel_users (id, display_name, pin_salt, pin_hash, recovery_hashes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
    ).bind(user.id, user.displayName, user.salt, user.pinHash, JSON.stringify(user.recoveryHashes), now)));

    return json({
      configured: true,
      recoveryCodes: Object.fromEntries(prepared.map((user) => [user.displayName, user.recoveryCodes])),
    }, 201);
  } catch (error) {
    return errorResponse(error, request);
  }
}
