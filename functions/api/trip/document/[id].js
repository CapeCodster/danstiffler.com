import { requireSession } from "../../../_lib/auth.js";
import { errorResponse, json, methodNotAllowed, RequestError } from "../../../_lib/http.js";

function safeFilename(filename) {
  return filename.replaceAll(/[^A-Za-z0-9._ -]/g, "_").slice(0, 160) || "trip-document";
}

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  try {
    const auth = await requireSession(request, env);
    if (auth.response) return auth.response;
    const documentId = String(params.id || "");
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(documentId)) throw new RequestError(400, "Invalid document identifier");
    const metadata = await env.DB.prepare(
      "SELECT r2_key, filename, content_type FROM travel_documents WHERE id = ?1 LIMIT 1",
    ).bind(documentId).first();
    if (!metadata) throw new RequestError(404, "Document not found");

    const getOptions = {};
    if (["If-Match", "If-None-Match", "If-Modified-Since", "If-Unmodified-Since"]
      .some((name) => request.headers.has(name))) {
      getOptions.onlyIf = request.headers;
    }
    if (request.headers.has("Range")) getOptions.range = request.headers;
    const object = await env.TRIP_DOCUMENTS.get(String(metadata.r2_key), getOptions);
    if (!object) throw new RequestError(404, "Document not found");
    if (!("body" in object)) return new Response(null, { status: 412 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.set("Content-Disposition", `inline; filename="${safeFilename(String(metadata.filename))}"`);
    headers.set("Content-Type", String(metadata.content_type || "application/octet-stream"));
    headers.set("ETag", object.httpEtag);
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    return new Response(object.body, { status: request.headers.has("Range") ? 206 : 200, headers });
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    return errorResponse(error, request);
  }
}
