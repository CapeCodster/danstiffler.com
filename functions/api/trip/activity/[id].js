import { requireSession } from "../../../_lib/auth.js";
import { assertSameOrigin, errorResponse, json, methodNotAllowed, readJson, RequestError } from "../../../_lib/http.js";

const allowedStatuses = new Set(["confirmed", "purchased", "planned", "awaiting", "done", "skipped", "cancelled"]);

function validateChanges(body) {
  const changes = {};
  if ("title" in body) {
    if (typeof body.title !== "string" || body.title.trim().length < 1 || body.title.length > 160) throw new RequestError(400, "Invalid title");
    changes.title = body.title.trim();
  }
  for (const key of ["start", "end"]) {
    if (key in body) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body[key]))) throw new RequestError(400, `Invalid ${key} time`);
      changes[key] = String(body[key]);
    }
  }
  if ("whatToWear" in body) {
    if (typeof body.whatToWear !== "string" || body.whatToWear.length > 1000) throw new RequestError(400, "Invalid clothing note");
    changes.whatToWear = body.whatToWear.trim();
  }
  if ("status" in body) {
    if (!allowedStatuses.has(body.status)) throw new RequestError(400, "Invalid status");
    changes.status = body.status;
  }
  if (!Object.keys(changes).length) throw new RequestError(400, "No supported changes supplied");
  return changes;
}

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

    const changes = validateChanges(await readJson(request, 8192));
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO travel_activity_overrides (activity_id, json_value, updated_at, updated_by)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(activity_id) DO UPDATE SET json_value = excluded.json_value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).bind(activityId, JSON.stringify({ ...changes, updatedAt: new Date(now).toISOString(), updatedBy: auth.session.displayName }), now, auth.session.userId).run();
    return json({ activityId, changes });
  } catch (error) {
    return errorResponse(error, request);
  }
}
