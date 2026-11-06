import { assertSameOrigin, errorResponse, json, methodNotAllowed, RequestError } from "../../_lib/http.js";
import { clearSessionCookie, deleteSession } from "../../_lib/session.js";

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    if (!assertSameOrigin(request)) throw new RequestError(403, "Origin check failed");
    await deleteSession(request, env);
    return json({ authenticated: false }, 200, { "Set-Cookie": clearSessionCookie() });
  } catch (error) {
    return errorResponse(error, request);
  }
}
