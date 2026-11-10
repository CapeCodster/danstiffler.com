import { requireSession } from "../../_lib/auth.js";
import { validateTripDay, withTripDay } from "../../_lib/trip-day.js";
import { assertSameOrigin, errorResponse, json, methodNotAllowed, readJson, RequestError } from "../../_lib/http.js";

function changed(result) {
  return Number(result?.meta?.changes || 0) > 0;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    if (!assertSameOrigin(request)) throw new RequestError(403, "Origin check failed");
    const auth = await requireSession(request, env);
    if (auth.response) return auth.response;

    const body = await readJson(request, 16384);
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new RequestError(400, "A valid itinerary version is required");
    }
    const day = validateTripDay(body.day);
    const state = await env.DB.prepare(
      "SELECT json_value, version FROM travel_state WHERE state_key = 'itinerary' LIMIT 1",
    ).first();
    if (!state) throw new RequestError(503, "Trip data is not configured");
    const currentVersion = Number(state.version);
    const result = withTripDay(JSON.parse(String(state.json_value)), day);
    if (!result.created) return json({ day: result.day, created: false, version: currentVersion });
    if (currentVersion !== expectedVersion) throw new RequestError(409, "The itinerary changed; reload it and try again");

    const now = Date.now();
    const update = await env.DB.prepare(
      `UPDATE travel_state
       SET json_value = ?1, version = version + 1, updated_at = ?2, updated_by = ?3
       WHERE state_key = 'itinerary' AND version = ?4`,
    ).bind(JSON.stringify(result.itinerary), now, auth.session.userId, currentVersion).run();
    if (!changed(update)) throw new RequestError(409, "The itinerary changed; reload it and try again");
    return json({ day: result.day, created: true, version: currentVersion + 1 }, 201);
  } catch (error) {
    return errorResponse(error, request);
  }
}
