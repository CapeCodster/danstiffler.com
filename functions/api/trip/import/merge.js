import { requireSession } from "../../../_lib/auth.js";
import { assertSameOrigin, errorResponse, json, methodNotAllowed, RequestError } from "../../../_lib/http.js";
import { applyImportPlan, assertImportEnvironment, buildImportPlan, readImportUpload, verifyReviewToken } from "../../../_lib/import-trip.js";

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  try {
    if (!assertSameOrigin(request)) throw new RequestError(403, "Origin check failed");
    assertImportEnvironment(env);
    const auth = await requireSession(request, env);
    if (auth.response) return auth.response;
    const upload = await readImportUpload(request);
    const plan = await buildImportPlan(env, upload);
    await verifyReviewToken(plan, env, auth.session, upload.reviewToken);
    return json(await applyImportPlan(env, auth.session, plan));
  } catch (error) {
    return errorResponse(error, request);
  }
}
