import { requireSession } from "../../../_lib/auth.js";
import { validateActivityChanges } from "../../../_lib/activity-validation.js";
import { assertSameOrigin, errorResponse, json, methodNotAllowed, readJson, RequestError } from "../../../_lib/http.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!["PUT", "DELETE"].includes(request.method)) return methodNotAllowed(["PUT", "DELETE"]);
  try {
    if (!assertSameOrigin(request)) throw new RequestError(403, "Origin check failed");
    const auth = await requireSession(request, env);
    if (auth.response) return auth.response;
    const activityId = String(params.id || "");
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(activityId)) throw new RequestError(400, "Invalid activity identifier");

    if (request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM travel_activity_overrides WHERE activity_id = ?1").bind(activityId).run();
      return json({ activityId, restored: true });
    }

    const base = await env.DB.prepare("SELECT json_value FROM travel_state WHERE state_key = 'itinerary' LIMIT 1").first();
    if (!base) throw new RequestError(503, "Trip data is not configured");
    const itinerary = JSON.parse(String(base.json_value));
    const changes = validateActivityChanges(await readJson(request, 262144), new Set(itinerary.days.map((day) => String(day.date))));
    const current = await env.DB.prepare(
      "SELECT json_value FROM travel_activity_overrides WHERE activity_id = ?1 LIMIT 1",
    ).bind(activityId).first();
    const now = Date.now();
    const value = {
      ...(current ? JSON.parse(String(current.json_value)) : {}),
      ...changes,
      updatedAt: new Date(now).toISOString(),
      updatedBy: auth.session.displayName,
    };
    await env.DB.prepare(
      `INSERT INTO travel_activity_overrides (activity_id, json_value, updated_at, updated_by)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(activity_id) DO UPDATE SET json_value = excluded.json_value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).bind(activityId, JSON.stringify(value), now, auth.session.userId).run();
    return json({ activityId, changes });
  } catch (error) {
    return errorResponse(error, request);
  }
}
