import { requireSession } from "../../_lib/auth.js";
import { assertSameOrigin, errorResponse, json, methodNotAllowed, readJson, RequestError } from "../../_lib/http.js";

const allowedStatuses = new Set(["confirmed", "purchased", "planned", "awaiting", "done", "skipped", "cancelled"]);
const allowedKinds = new Set(["add", "update", "restore", "delete"]);

function boundedText(value, name, maximum, { required = false } = {}) {
  if (value == null && !required) return undefined;
  if (typeof value !== "string") throw new RequestError(400, `Invalid ${name}`);
  const text = value.trim();
  if ((required && !text) || text.length > maximum) throw new RequestError(400, `Invalid ${name}`);
  return text;
}

function validateTime(value, name) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) throw new RequestError(400, `Invalid ${name} time`);
  return String(value);
}

function validateChanges(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError(400, "Invalid activity changes");
  const changes = {};
  if ("title" in body) changes.title = boundedText(body.title, "title", 160, { required: true });
  if ("start" in body) changes.start = validateTime(body.start, "start");
  if ("end" in body) changes.end = validateTime(body.end, "end");
  for (const [key, maximum] of [["venue", 200], ["address", 300], ["whatToWear", 1000], ["note", 2000], ["party", 120]]) {
    if (key in body) changes[key] = boundedText(body[key], key, maximum) || "";
  }
  if ("status" in body) {
    if (!allowedStatuses.has(body.status)) throw new RequestError(400, "Invalid status");
    changes.status = body.status;
  }
  for (const key of ["travelMinutes", "arrivalBufferMinutes"]) {
    if (key in body) {
      const value = Number(body[key]);
      if (!Number.isInteger(value) || value < 0 || value > 1440) throw new RequestError(400, `Invalid ${key}`);
      changes[key] = value;
    }
  }
  if ("fixed" in body) changes.fixed = Boolean(body.fixed);
  if (!Object.keys(changes).length) throw new RequestError(400, "No supported changes supplied");
  return changes;
}

function validateCustomActivity(body, dayDates) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError(400, "Invalid custom activity");
  const dayDate = String(body.dayDate || "");
  if (!dayDates.has(dayDate)) throw new RequestError(400, "Invalid activity date");
  return {
    custom: true,
    dayDate,
    title: boundedText(body.title, "title", 160, { required: true }),
    start: validateTime(body.start, "start"),
    end: validateTime(body.end, "end"),
    venue: boundedText(body.venue || "", "venue", 200) || "",
    address: boundedText(body.address || "", "address", 300) || "",
    status: allowedStatuses.has(body.status) ? body.status : "planned",
    fixed: Boolean(body.fixed),
    travelMinutes: Number.isInteger(Number(body.travelMinutes)) ? Math.max(0, Math.min(1440, Number(body.travelMinutes))) : 0,
    arrivalBufferMinutes: Number.isInteger(Number(body.arrivalBufferMinutes)) ? Math.max(0, Math.min(1440, Number(body.arrivalBufferMinutes))) : 0,
    whatToWear: boundedText(body.whatToWear || "", "whatToWear", 1000) || "",
    note: boundedText(body.note || "", "note", 2000) || "",
    party: boundedText(body.party || "", "party", 120) || "",
  };
}

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
    const changes = validateChanges(mutation.changes);
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
    const body = await readJson(request, 65536);
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
