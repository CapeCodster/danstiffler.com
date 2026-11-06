const origin = process.env.TRIP_TEST_ORIGIN || "http://127.0.0.1:8788";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Origin", options.requestOrigin || origin);
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${origin}${path}`, { ...options, headers });
}

function sessionCookie(response) {
  return (response.headers.get("set-cookie") || "").split(";")[0];
}

async function login(traveller, code, rememberDevice) {
  const response = await request("/api/trip/login", {
    method: "POST",
    body: JSON.stringify({ traveller, code, rememberDevice }),
  });
  assert(response.status === 200, `${traveller} login returned ${response.status}`);
  const setCookie = response.headers.get("set-cookie") || "";
  assert(setCookie.includes("HttpOnly"), `${traveller} cookie is not HttpOnly`);
  assert(setCookie.includes("Secure"), `${traveller} cookie is not Secure`);
  assert(setCookie.includes("SameSite=Strict"), `${traveller} cookie is not SameSite=Strict`);
  assert(rememberDevice === setCookie.includes("Max-Age="), `${traveller} persistence did not match Remember this device`);
  return sessionCookie(response);
}

const publicShell = await request("/trip/");
assert(publicShell.status === 200, "Public application shell was not available");
assert((publicShell.headers.get("content-security-policy") || "").includes("frame-ancestors 'none'"), "Trip shell security headers are missing");
const shellHtml = await publicShell.text();
assert(!shellHtml.includes("Singapore to Hong Kong"), "Private itinerary content leaked into the application shell");
assert(shellHtml.includes("Private Travel Planning"), "Private-travel interstitial title is missing");
assert(shellHtml.includes("This area contains private travel planning tools and is reserved for invited travelers. Please continue only if you have been invited to use this area."), "Private-travel interstitial message is missing");
assert(shellHtml.includes('class="primary-button button-link" id="leavePrivateTravel" href="/">Leave</a>'), "Primary Leave action is missing");
assert(shellHtml.includes('class="secondary-button" id="beginSignIn" type="button">Continue</button>'), "Secondary Continue action is missing");
assert(shellHtml.indexOf('id="leavePrivateTravel"') < shellHtml.indexOf('id="beginSignIn"'), "Keyboard order does not present Leave before Continue");
assert(!shellHtml.includes("data-traveller=") && !shellHtml.includes("Choose a traveller") && !shellHtml.includes("Create a six-digit code") && !shellHtml.includes("Set up local access"), "Public entry exposes traveller configuration or registration");

const privateModule = await request("/trip/data/itinerary.local.js");
assert(privateModule.status === 404, "Git-ignored itinerary module was reachable from the deployment artifact");

const privateOutput = await request("/outputs/singapore-hong-kong-doc-prep-2026-11-04/");
assert(privateOutput.status === 404, "Private document-preparation output was reachable from the deployment artifact");

const unauthenticatedItinerary = await request("/api/trip/itinerary");
assert(unauthenticatedItinerary.status === 401, "Itinerary did not fail closed");

const unauthenticatedDocument = await request("/api/trip/document/sin-arrival-evidence");
assert(unauthenticatedDocument.status === 401, "Document did not fail closed");

const unauthenticatedMedia = await request("/api/trip/document/media-singapore-day");
assert(unauthenticatedMedia.status === 401, "Destination photography did not fail closed");

const unauthenticatedReauth = await request("/api/trip/reauth", {
  method: "POST",
  body: JSON.stringify({ code: "111111" }),
});
assert(unauthenticatedReauth.status === 401, "Offline-download reauthentication did not require a session");

const unauthenticatedCodeChange = await request("/api/trip/access-code", {
  method: "POST",
  body: JSON.stringify({ currentCode: "111111", newCode: "333333" }),
});
assert(unauthenticatedCodeChange.status === 401, "Access-code change did not require a session");

const unauthenticatedSync = await request("/api/trip/sync", {
  method: "POST",
  body: JSON.stringify({ mutations: [] }),
});
assert(unauthenticatedSync.status === 401, "Offline mutation sync did not require a session");

const hiddenAdmin = await request("/api/trip/admin/itinerary", {
  method: "PUT",
  headers: { "X-Trip-Bootstrap": "not-the-secret" },
  body: JSON.stringify({ itinerary: {} }),
});
assert(hiddenAdmin.status === 404, "Administrative endpoint exposed secret validation details");

const hiddenBootstrap = await request("/api/trip/bootstrap", {
  method: "POST",
  body: JSON.stringify({ users: [] }),
});
assert(hiddenBootstrap.status === 404, "Credential bootstrap was reachable without its separate setup secret");

const danCookie = await login("Dan", "111111", false);
const kenCookie = await login("Ken", "222222", true);

const crossOriginReauth = await request("/api/trip/reauth", {
  method: "POST",
  cookie: danCookie,
  requestOrigin: "https://example.invalid",
  body: JSON.stringify({ code: "111111" }),
});
assert(crossOriginReauth.status === 403, "Cross-origin offline-download reauthentication was accepted");

const wrongReauth = await request("/api/trip/reauth", {
  method: "POST",
  cookie: danCookie,
  body: JSON.stringify({ code: "999999" }),
});
assert(wrongReauth.status === 401, "Wrong code was accepted for offline-download reauthentication");

const correctReauth = await request("/api/trip/reauth", {
  method: "POST",
  cookie: danCookie,
  body: JSON.stringify({ code: "111111" }),
});
assert(correctReauth.status === 200, "Correct code was rejected for offline-download reauthentication");
assert(!correctReauth.headers.get("set-cookie"), "Offline-download reauthentication unexpectedly issued a session cookie");

const crossOriginCodeChange = await request("/api/trip/access-code", {
  method: "POST",
  cookie: kenCookie,
  requestOrigin: "https://example.invalid",
  body: JSON.stringify({ currentCode: "222222", newCode: "333333" }),
});
assert(crossOriginCodeChange.status === 403, "Cross-origin access-code change was accepted");

const wrongCurrentCode = await request("/api/trip/access-code", {
  method: "POST",
  cookie: kenCookie,
  body: JSON.stringify({ currentCode: "999999", newCode: "333333" }),
});
assert(wrongCurrentCode.status === 401, "Wrong current access code was accepted");

const invalidNewCode = await request("/api/trip/access-code", {
  method: "POST",
  cookie: kenCookie,
  body: JSON.stringify({ currentCode: "222222", newCode: "12345" }),
});
assert(invalidNewCode.status === 400, "Invalid new access code was accepted");

const codeChange = await request("/api/trip/access-code", {
  method: "POST",
  cookie: kenCookie,
  body: JSON.stringify({ currentCode: "222222", newCode: "333333" }),
});
assert(codeChange.status === 200, "Authenticated access-code change failed");
const existingSessionAfterCodeChange = await request("/api/trip/session", { cookie: kenCookie });
assert(existingSessionAfterCodeChange.status === 200, "Existing session was unexpectedly invalidated by access-code change");
const oldCodeLogin = await request("/api/trip/login", {
  method: "POST",
  body: JSON.stringify({ traveller: "Ken", code: "222222", rememberDevice: false }),
});
assert(oldCodeLogin.status === 401, "Previous access code remained valid after change");
const changedCodeCookie = await login("Ken", "333333", false);
const restoreCode = await request("/api/trip/access-code", {
  method: "POST",
  cookie: changedCodeCookie,
  body: JSON.stringify({ currentCode: "333333", newCode: "222222" }),
});
assert(restoreCode.status === 200, "Acceptance test could not restore Ken’s access code");
const restoredCodeCookie = await login("Ken", "222222", false);

const danItineraryResponse = await request("/api/trip/itinerary", { cookie: danCookie });
assert(danItineraryResponse.status === 200, "Dan could not retrieve the itinerary");
assert((danItineraryResponse.headers.get("cache-control") || "").includes("no-store"), "Itinerary response is cacheable");
const danItinerary = await danItineraryResponse.json();
assert(danItinerary.itinerary.days.length === 25, "Expected 25 itinerary days");

const conflictActivityId = "custom-acceptance-offline-conflict";
if (danItinerary.revisions[conflictActivityId]) {
  const cleanup = await request("/api/trip/sync", {
    method: "POST",
    cookie: danCookie,
    body: JSON.stringify({ mutations: [{
      mutationId: "acceptance-pretest-cleanup",
      activityId: conflictActivityId,
      kind: "delete",
      baseRevision: Number(danItinerary.revisions[conflictActivityId]),
    }] }),
  });
  assert(cleanup.status === 200, "Stale acceptance activity could not be cleaned up");
}
const conflictSetup = await request("/api/trip/sync", {
  method: "POST",
  cookie: danCookie,
  body: JSON.stringify({ mutations: [{
    mutationId: "acceptance-custom-add",
    activityId: conflictActivityId,
    kind: "add",
    baseRevision: 0,
    activity: { dayDate: "2026-11-20", title: "Offline-added acceptance activity", start: "15:00", end: "16:00", venue: "Hotel lobby", status: "planned" },
  }] }),
});
const conflictSetupBody = await conflictSetup.json();
assert(conflictSetup.status === 200 && conflictSetupBody.applied.length === 1, "Offline-added activity did not sync");
const conflictBaseRevision = conflictSetupBody.applied[0].revision;
const danOfflineEdit = {
  mutationId: "acceptance-dan-offline-edit",
  activityId: conflictActivityId,
  kind: "update",
  baseRevision: conflictBaseRevision,
  changes: { title: "Added activity — Dan acceptance edit" },
};
const rejectedSyncOrigin = await request("/api/trip/sync", {
  method: "POST",
  cookie: danCookie,
  requestOrigin: "https://example.invalid",
  body: JSON.stringify({ mutations: [danOfflineEdit] }),
});
assert(rejectedSyncOrigin.status === 403, "Cross-origin offline sync was accepted");

const danSync = await request("/api/trip/sync", {
  method: "POST",
  cookie: danCookie,
  body: JSON.stringify({ mutations: [danOfflineEdit] }),
});
assert(danSync.status === 200, "Dan offline mutation did not sync");
const danSyncBody = await danSync.json();
assert(danSyncBody.applied.length === 1 && danSyncBody.conflicts.length === 0, "Dan mutation was not applied cleanly");

const kenStaleSync = await request("/api/trip/sync", {
  method: "POST",
  cookie: kenCookie,
  body: JSON.stringify({ mutations: [{
    mutationId: "acceptance-ken-stale-edit",
    activityId: conflictActivityId,
    kind: "update",
    baseRevision: conflictBaseRevision,
    changes: { title: "Added activity — Ken stale edit" },
  }] }),
});
assert(kenStaleSync.status === 200, "Ken stale mutation request failed");
const kenStaleBody = await kenStaleSync.json();
assert(kenStaleBody.applied.length === 0 && kenStaleBody.conflicts.length === 1, "Stale mutation did not surface as a conflict");
assert(kenStaleBody.conflicts[0].server.title === "Added activity — Dan acceptance edit", "Conflict did not retain Dan's server version");

const kenResolution = await request("/api/trip/sync", {
  method: "POST",
  cookie: kenCookie,
  body: JSON.stringify({ mutations: [{
    mutationId: "acceptance-ken-explicit-resolution",
    activityId: conflictActivityId,
    kind: "update",
    baseRevision: kenStaleBody.conflicts[0].serverRevision,
    changes: { title: "Added activity — Ken explicit resolution" },
  }] }),
});
const kenResolutionBody = await kenResolution.json();
assert(kenResolution.status === 200 && kenResolutionBody.applied.length === 1, "Explicit conflict resolution did not apply");

const deleteConflictActivity = await request("/api/trip/sync", {
  method: "POST",
  cookie: danCookie,
  body: JSON.stringify({ mutations: [{
    mutationId: "acceptance-delete-conflict-activity",
    activityId: conflictActivityId,
    kind: "delete",
    baseRevision: kenResolutionBody.applied[0].revision,
  }] }),
});
const deleteConflictBody = await deleteConflictActivity.json();
assert(deleteConflictActivity.status === 200 && deleteConflictBody.applied.length === 1, "Conflict acceptance activity could not be deleted");

const protectedDocumentPath = danItinerary.itinerary.days
  .flatMap((day) => day.activities)
  .flatMap((activity) => [activity.ticket, activity.evidence])
  .find((value) => String(value || "").startsWith("/api/trip/document/"));
assert(protectedDocumentPath, "No protected document URL was found");

const protectedDocument = await request(protectedDocumentPath, { cookie: danCookie });
assert(protectedDocument.status === 200, `Protected document returned ${protectedDocument.status}`);
assert((protectedDocument.headers.get("cache-control") || "").includes("no-store"), "Protected document is cacheable");
assert((await protectedDocument.arrayBuffer()).byteLength > 0, "Protected document was empty");

const protectedMedia = await request(danItinerary.itinerary.trip.media.singapore.day, { cookie: danCookie });
assert(protectedMedia.status === 200, `Protected destination photography returned ${protectedMedia.status}`);
assert((protectedMedia.headers.get("content-type") || "").startsWith("image/jpeg"), "Destination photography returned the wrong content type");
assert((protectedMedia.headers.get("cache-control") || "").includes("no-store"), "Destination photography is cacheable");
assert((await protectedMedia.arrayBuffer()).byteLength > 100000, "Destination photography was empty or unexpectedly small");

const activityId = danItinerary.itinerary.days[0].activities[0].id;
const originalOverride = danItinerary.overrides[activityId] || null;
const rejectedOrigin = await request(`/api/trip/activity/${activityId}`, {
  method: "PUT",
  cookie: danCookie,
  requestOrigin: "https://example.invalid",
  body: JSON.stringify({ status: "done" }),
});
assert(rejectedOrigin.status === 403, "Cross-origin edit was not rejected");

const danEdit = await request(`/api/trip/activity/${activityId}`, {
  method: "PUT",
  cookie: danCookie,
  body: JSON.stringify({ status: "done" }),
});
assert(danEdit.status === 200, "Dan could not edit the shared itinerary");

const kenItineraryResponse = await request("/api/trip/itinerary", { cookie: kenCookie });
assert(kenItineraryResponse.status === 200, "Ken could not retrieve the itinerary");
const kenItinerary = await kenItineraryResponse.json();
assert(kenItinerary.overrides[activityId]?.status === "done", "Ken could not see Dan's shared edit");

const kenRestore = await request(`/api/trip/activity/${activityId}`, {
  method: "DELETE",
  cookie: kenCookie,
});
assert(kenRestore.status === 200, "Ken could not restore the shared activity");

if (originalOverride) {
  const allowed = Object.fromEntries(["title", "start", "end", "whatToWear", "status"]
    .filter((key) => key in originalOverride)
    .map((key) => [key, originalOverride[key]]));
  const restoreOriginal = await request(`/api/trip/activity/${activityId}`, {
    method: "PUT",
    cookie: danCookie,
    body: JSON.stringify(allowed),
  });
  assert(restoreOriginal.status === 200, "Original local override could not be restored");
}

const danLogout = await request("/api/trip/logout", { method: "POST", cookie: danCookie });
const kenLogout = await request("/api/trip/logout", { method: "POST", cookie: kenCookie });
const changedCodeLogout = await request("/api/trip/logout", { method: "POST", cookie: changedCodeCookie });
const restoredCodeLogout = await request("/api/trip/logout", { method: "POST", cookie: restoredCodeCookie });
assert(danLogout.status === 200 && kenLogout.status === 200 && changedCodeLogout.status === 200 && restoredCodeLogout.status === 200, "Logout failed");
const retiredSession = await request("/api/trip/session", { cookie: danCookie });
assert(retiredSession.status === 401, "Logged-out session remained active");

console.log(JSON.stringify({
  ok: true,
  staticShell: publicShell.status,
  privateModule: privateModule.status,
  privateOutput: privateOutput.status,
  unauthenticatedItinerary: unauthenticatedItinerary.status,
  unauthenticatedDocument: unauthenticatedDocument.status,
  unauthenticatedMedia: unauthenticatedMedia.status,
  unauthenticatedReauth: unauthenticatedReauth.status,
  unauthenticatedCodeChange: unauthenticatedCodeChange.status,
  unauthenticatedSync: unauthenticatedSync.status,
  adminWithWrongSecret: hiddenAdmin.status,
  credentialBootstrapWithoutSecret: hiddenBootstrap.status,
  authenticatedItinerary: danItineraryResponse.status,
  authenticatedDocument: protectedDocument.status,
  authenticatedMedia: protectedMedia.status,
  offlineReauth: correctReauth.status,
  credentialChangePreservedSession: existingSessionAfterCodeChange.status,
  crossOriginOfflineReauth: crossOriginReauth.status,
  crossOriginCodeChange: crossOriginCodeChange.status,
  accessCodeChangedAndRestored: true,
  crossOriginOfflineSync: rejectedSyncOrigin.status,
  staleOfflineEditConflict: kenStaleBody.conflicts.length,
  explicitConflictResolution: kenResolutionBody.applied.length,
  offlineAddedActivity: conflictSetupBody.applied.length,
  sharedEditVisibleToKen: true,
  crossOriginEdit: rejectedOrigin.status,
  loggedOutSession: retiredSession.status,
}));
