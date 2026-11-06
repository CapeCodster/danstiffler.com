import { requireBootstrapSecret } from "../../../../_lib/bootstrap.js";
import { assertSameOrigin, errorResponse, json, methodNotAllowed, RequestError } from "../../../../_lib/http.js";

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

function cleanHeader(value, maxLength) {
  return String(value || "").replaceAll(/[\r\n]/g, " ").trim().slice(0, maxLength);
}

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method !== "PUT") return methodNotAllowed(["PUT"]);
  try {
    if (!assertSameOrigin(request)) throw new RequestError(403, "Origin check failed");
    await requireBootstrapSecret(request, env);
    const documentId = String(params.id || "");
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(documentId)) throw new RequestError(400, "Invalid document identifier");
    const size = Number(request.headers.get("Content-Length") || 0);
    if (!size || size > MAX_DOCUMENT_BYTES) throw new RequestError(413, "Invalid document size");
    if (!request.body) throw new RequestError(400, "Document body is required");

    const filename = cleanHeader(request.headers.get("X-Trip-Filename"), 160);
    const contentType = cleanHeader(request.headers.get("Content-Type"), 120) || "application/octet-stream";
    const activityId = cleanHeader(request.headers.get("X-Trip-Activity"), 80) || null;
    if (!filename) throw new RequestError(400, "Document filename is required");
    const creator = await env.DB.prepare(
      "SELECT id FROM travel_users ORDER BY display_name ASC LIMIT 1",
    ).first();
    if (!creator) throw new RequestError(409, "Traveller accounts must be initialized before documents");
    const r2Key = `documents/${documentId}`;
    await env.TRIP_DOCUMENTS.put(r2Key, request.body, {
      httpMetadata: { contentType, contentDisposition: `inline; filename="${filename.replaceAll('"', "_")}"` },
      customMetadata: { documentId, activityId: activityId || "" },
    });
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO travel_documents (id, r2_key, filename, content_type, activity_id, created_at, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(id) DO UPDATE SET r2_key = excluded.r2_key, filename = excluded.filename, content_type = excluded.content_type, activity_id = excluded.activity_id`,
    ).bind(documentId, r2Key, filename, contentType, activityId, now, String(creator.id)).run();
    return json({ id: documentId, stored: true, size }, 201);
  } catch (error) {
    return errorResponse(error, request);
  }
}
