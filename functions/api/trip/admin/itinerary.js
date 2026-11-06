import { requireBootstrapSecret } from "../../../_lib/bootstrap.js";
import { assertSameOrigin, errorResponse, json, methodNotAllowed, readJson, RequestError } from "../../../_lib/http.js";

function validateItinerary(value) {
  if (!value || typeof value !== "object" || !value.trip || !Array.isArray(value.days) || !Array.isArray(value.tasks)) {
    throw new RequestError(400, "Invalid itinerary structure");
  }
  if (value.days.length < 1 || value.days.length > 60) throw new RequestError(400, "Invalid itinerary day count");
  for (const day of value.days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day.date || "")) || !Array.isArray(day.activities)) {
      throw new RequestError(400, "Invalid itinerary day");
    }
    if (day.activities.length > 100) throw new RequestError(400, "Too many activities in one day");
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "PUT") return methodNotAllowed(["PUT"]);
  try {
    if (!assertSameOrigin(request)) throw new RequestError(403, "Origin check failed");
    await requireBootstrapSecret(request, env);
    const body = await readJson(request, 524288);
    validateItinerary(body.itinerary);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO travel_state (state_key, json_value, version, updated_at, updated_by)
       VALUES ('itinerary', ?1, 1, ?2, 'bootstrap')
       ON CONFLICT(state_key) DO UPDATE SET json_value = excluded.json_value, version = travel_state.version + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).bind(JSON.stringify(body.itinerary), now).run();
    return json({ configured: true, updatedAt: now });
  } catch (error) {
    return errorResponse(error, request);
  }
}
