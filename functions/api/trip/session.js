import { errorResponse, json, methodNotAllowed } from "../../_lib/http.js";
import { readSession } from "../../_lib/session.js";

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  try {
    const session = await readSession(request, env);
    if (!session) return json({ authenticated: false }, 401);
    return json({
      authenticated: true,
      user: { id: session.userId, displayName: session.displayName },
      expiresAt: session.expiresAt,
      environment: String(env.AUTH_MODE || "production"),
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
