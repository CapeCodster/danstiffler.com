import { requireSession } from "../../_lib/auth.js";
import { assertSameOrigin, errorResponse, json, methodNotAllowed, RequestError } from "../../_lib/http.js";

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "message/rfc822",
  "text/plain",
]);

function cleanHeader(value, maximum) {
  return String(value || "").replaceAll(/[\r\n]/g, " ").trim().slice(0, maximum);
}

function normalizedContentType(value) {
  return cleanHeader(value, 120).split(";", 1)[0].toLowerCase();
}

function safeFilename(value) {
  return cleanHeader(value, 160).replaceAll(/[^A-Za-z0-9._ -]/g, "_") || "trip-document";
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    if (!assertSameOrigin(request)) throw new RequestError(403, "Origin check failed");
    const auth = await requireSession(request, env);
    if (auth.response) return auth.response;
    const declaredSize = Number(request.headers.get("Content-Length") || request.headers.get("X-Trip-Size") || 0);
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 1 || declaredSize > MAX_DOCUMENT_BYTES) {
      throw new RequestError(413, "Document must be between 1 byte and 25 MB");
    }
    if (!request.body) throw new RequestError(400, "Document body is required");
    const contentType = normalizedContentType(request.headers.get("Content-Type"));
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) throw new RequestError(415, "Unsupported document type");
    const filename = safeFilename(request.headers.get("X-Trip-Filename"));
    const label = cleanHeader(request.headers.get("X-Trip-Label"), 160) || filename;
    const activityId = cleanHeader(request.headers.get("X-Trip-Activity"), 80);
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(activityId)) throw new RequestError(400, "Invalid activity identifier");
    const scope = cleanHeader(request.headers.get("X-Trip-Scope"), 20) || "activity";
    if (!new Set(["activity", "journey", "leg"]).has(scope)) throw new RequestError(400, "Invalid document scope");
    const legIndexHeader = cleanHeader(request.headers.get("X-Trip-Leg"), 3);
    const legIndex = legIndexHeader === "" ? null : Number(legIndexHeader);
    if (legIndex !== null && (!Number.isInteger(legIndex) || legIndex < 0 || legIndex > 11)) {
      throw new RequestError(400, "Invalid flight leg document scope");
    }

    const documentId = `doc-${crypto.randomUUID().toLowerCase()}`;
    const r2Key = `documents/${documentId}`;
    await env.TRIP_DOCUMENTS.put(r2Key, request.body, {
      httpMetadata: { contentType, contentDisposition: `inline; filename="${filename.replaceAll('"', "_")}"` },
      customMetadata: { documentId, activityId, scope, legIndex: legIndex === null ? "" : String(legIndex) },
    });
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO travel_documents (id, r2_key, filename, content_type, activity_id, created_at, created_by)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(documentId, r2Key, filename, contentType, activityId, now, auth.session.userId).run();
    return json({
      document: {
        id: documentId,
        url: `/api/trip/document/${documentId}`,
        label,
        filename,
        contentType,
        scope,
        legIndex,
        offlineAvailable: false,
      },
    }, 201);
  } catch (error) {
    return errorResponse(error, request);
  }
}
