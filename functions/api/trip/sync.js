import { requireSession } from "../../_lib/auth.js";
import { validateActivityChanges, validateCustomActivity } from "../../_lib/activity-validation.js";
import { assertSameOrigin, errorResponse, json, methodNotAllowed, readJson, RequestError } from "../../_lib/http.js";

const allowedKinds = new Set(["add", "update", "restore", "delete"]);

function activityIndex(itinerary) {
  return new Set(itinerary.days.flatMap((day) => day.activities.map((activity) => String(activity.id))));
}

function mutationId(value) {
  const id = String(value || "");
  if (!/^[A-Za-z0-9-]{8,100}$/.test(id)) throw new RequestError(400, "Invalid mutation identifier");
  return id;
}

function activityId(value) {
  const id = String(value || "");
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(id)) throw new RequestError(400, "Invalid activity identifier");
  return id;
}

function changed(result) {
  return Number(result?.meta?.changes || 0) > 0;
}

async function currentActivity(env, id) {
  const row = await env.DB.prepare(
    "SELECT json_value, updated_at, updated_by FROM travel_activity_overrides WHERE activity_id = ?1 LIMIT 1",
  ).bind(id).first();
  return row ? {
    value: JSON.parse(String(row.json_value)),
    revision: Number(row.updated_at),
    updatedBy: String(row.updated_by),
  } : { value: null, revision: 0, updatedBy: null };
}

function conflict(mutation, current) {
  return {
    mutationId: mutation.mutationId,
    activityId: mutation.activityId,
    kind: mutation.kind,
    baseRevision: mutation.baseRevision,
    serverRevision: current.revision,
    server: current.value,
    attempted: mutation.kind === "add" ? mutation.activity : mutation.changes || null,
  };
}

async function insertIfAbsent(env, id, value, revision, userId) {
  return env.DB.prepare(
    `INSERT INTO travel_activity_overrides (activity_id, json_value, updated_at, updated_by)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(activity_id) DO NOTHING`,
  ).bind(id, JSON.stringify(value), revision, userId).run();
}

async function applyMutation(env, session, mutation, baseIds, dayDates) {
  const current = await currentActivity(env, mutation.activityId);
  if (current.revision !== mutation.baseRevision) return { conflict: conflict(mutation, current) };
  const isBase = baseIds.has(mutation.activityId);
  const isCustom = Boolean(current.value?.custom);
  const revision = Math.max(Date.now(), current.revision + 1);
  const stamp = { updatedAt: new Date(revision).toISOString(), updatedBy: session.displayName };

  if (mutation.kind === "add") {
    if (isBase || current.value || !mutation.activityId.startsWith("custom-")) throw new RequestError(400, "Invalid custom activity addition");
    const value = { ...validateCustomActivity(mutation.activity, dayDates), ...stamp };
    const result = await insertIfAbsent(env, mutation.activityId, value, revision, session.userId);
    if (!changed(result)) return { conflict: conflict(mutation, await currentActivity(env, mutation.activityId)) };
    return { applied: { mutationId: mutation.mutationId, activityId: mutation.activityId, kind: mutation.kind, revision } };
  }

  if (mutation.kind === "update") {
    if (!isBase && !isCustom) throw new RequestError(400, "Unknown activity");
    const changes = validateActivityChanges(mutation.changes, dayDates);
    const value = { ...(current.value || {}), ...changes, ...stamp };
    let result;
    if (current.revision) {
      result = await env.DB.prepare(
        "UPDATE travel_activity_overrides SET json_value = ?1, updated_at = ?2, updated_by = ?3 WHERE activity_id = ?4 AND updated_at = ?5",
      ).bind(JSON.stringify(value), revision, session.userId, mutation.activityId, current.revision).run();
    } else {
      result = await insertIfAbsent(env, mutation.activityId, value, revision, session.userId);
    }
    if (!changed(result)) return { conflict: conflict(mutation, await currentActivity(env, mutation.activityId)) };
    return { applied: { mutationId: mutation.mutationId, activityId: mutation.activityId, kind: mutation.kind, revision, changes } };
  }

  if (mutation.kind === "restore") {
    if (!isBase) throw new RequestError(400, "Only itinerary activities can be restored");
    if (!current.revision) return { applied: { mutationId: mutation.mutationId, activityId: mutation.activityId, kind: mutation.kind, revision: 0 } };
    const result = await env.DB.prepare(
      "DELETE FROM travel_activity_overrides WHERE activity_id = ?1 AND updated_at = ?2",
    ).bind(mutation.activityId, current.revision).run();
    if (!changed(result)) return { conflict: conflict(mutation, await currentActivity(env, mutation.activityId)) };
    return { applied: { mutationId: mutation.mutationId, activityId: mutation.activityId, kind: mutation.kind, revision: 0 } };
  }

  if (mutation.kind === "delete") {
    if (!isCustom) throw new RequestError(400, "Only added activities can be deleted");
    const result = await env.DB.prepare(
      "DELETE FROM travel_activity_overrides WHERE activity_id = ?1 AND updated_at = ?2",
    ).bind(mutation.activityId, current.revision).run();
    if (!changed(result)) return { conflict: conflict(mutation, await currentActivity(env, mutation.activityId)) };
    return { applied: { mutationId: mutation.mutationId, activityId: mutation.activityId, kind: mutation.kind, revision: 0 } };
  }

  throw new RequestError(400, "Unsupported mutation");
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    if (!assertSameOrigin(request)) throw new RequestError(403, "Origin check failed");
    const auth = await requireSession(request, env);
    if (auth.response) return auth.response;
    const body = await readJson(request, 262144);
    if (!Array.isArray(body.mutations) || body.mutations.length < 1 || body.mutations.length > 50) {
      throw new RequestError(400, "Supply between 1 and 50 mutations");
    }
    const base = await env.DB.prepare(
      "SELECT json_value FROM travel_state WHERE state_key = 'itinerary' LIMIT 1",
    ).first();
    if (!base) throw new RequestError(503, "Trip data is not configured");
    const itinerary = JSON.parse(String(base.json_value));
    const baseIds = activityIndex(itinerary);
    const dayDates = new Set(itinerary.days.map((day) => String(day.date)));
    const mutations = body.mutations.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new RequestError(400, "Invalid mutation");
      const kind = String(item.kind || "");
      if (!allowedKinds.has(kind)) throw new RequestError(400, "Invalid mutation kind");
      const baseRevision = Number(item.baseRevision || 0);
      if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new RequestError(400, "Invalid base revision");
      return {
        mutationId: mutationId(item.mutationId),
        activityId: activityId(item.activityId),
        kind,
        baseRevision,
        changes: item.changes,
        activity: item.activity,
      };
    });

    const applied = [];
    const conflicts = [];
    for (const mutation of mutations) {
      const result = await applyMutation(env, auth.session, mutation, baseIds, dayDates);
      if (result.applied) applied.push(result.applied);
      if (result.conflict) conflicts.push(result.conflict);
    }
    return json({ applied, conflicts });
  } catch (error) {
    return errorResponse(error, request);
  }
}
