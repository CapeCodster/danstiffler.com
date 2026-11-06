import { timingSafeTextEqual } from "./crypto.js";
import { RequestError } from "./http.js";

export async function requireBootstrapSecret(request, env) {
  const supplied = request.headers.get("X-Trip-Bootstrap") || "";
  if (!env.TRIP_BOOTSTRAP_SECRET || !await timingSafeTextEqual(supplied, env.TRIP_BOOTSTRAP_SECRET)) {
    throw new RequestError(404, "Not found");
  }
}
