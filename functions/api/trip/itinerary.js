import { requireSession } from "../../_lib/auth.js";
import { errorResponse, json, methodNotAllowed, RequestError } from "../../_lib/http.js";

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  try {
    const auth = await requireSession(request, env);
    if (auth.response) return auth.response;
    const base = await env.DB.prepare(
      "SELECT json_value, version, updated_at FROM travel_state WHERE state_key = 'itinerary' LIMIT 1",
    ).first();
    if (!base) throw new RequestError(503, "Trip data is not configured");
    const overrides = await env.DB.prepare(
      "SELECT activity_id, json_value, updated_at, updated_by FROM travel_activity_overrides ORDER BY activity_id",
    ).all();
    return json({
      itinerary: JSON.parse(String(base.json_value)),
      version: Number(base.version),
      updatedAt: Number(base.updated_at),
      overrides: Object.fromEntries(overrides.results.map((row) => [String(row.activity_id), JSON.parse(String(row.json_value))])),
      revisions: Object.fromEntries(overrides.results.map((row) => [String(row.activity_id), Number(row.updated_at)])),
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
