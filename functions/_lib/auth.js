import { json } from "./http.js";
import { readSession } from "./session.js";

export async function requireSession(request, env) {
  const session = await readSession(request, env);
  if (!session) {
    return { response: json({ authenticated: false, error: "Authentication required" }, 401) };
  }
  return { session };
}
