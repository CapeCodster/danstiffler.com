const origin = process.env.TRIP_TEST_ORIGIN || "http://127.0.0.1:8788";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Origin", options.requestOrigin || origin);
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (options.body && typeof options.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${origin}${path}`, { ...options, headers });
}

const login = await request("/api/trip/login", { method: "POST", body: JSON.stringify({ traveller: "Dan", code: "111111", rememberDevice: false }) });
assert(login.status === 200, `Dan login returned ${login.status}`);
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];

const unauthenticatedUpload = await request("/api/trip/document", {
  method: "POST",
  headers: { "Content-Type": "text/plain", "X-Trip-Size": "4", "X-Trip-Filename": "test.txt", "X-Trip-Activity": "custom-api-acceptance" },
  body: "test",
});
assert(unauthenticatedUpload.status === 401, "Document upload did not fail closed");

const crossOriginUpload = await request("/api/trip/document", {
  method: "POST",
  cookie,
  requestOrigin: "https://example.invalid",
  headers: { "Content-Type": "text/plain", "X-Trip-Size": "4", "X-Trip-Filename": "test.txt", "X-Trip-Activity": "custom-api-acceptance" },
  body: "test",
});
assert(crossOriginUpload.status === 403, "Cross-origin document upload was accepted");

const invalidUpload = await request("/api/trip/document", {
  method: "POST",
  cookie,
  headers: { "Content-Type": "application/octet-stream", "X-Trip-Size": "4", "X-Trip-Filename": "test.bin", "X-Trip-Activity": "custom-api-acceptance" },
  body: "test",
});
assert(invalidUpload.status === 415, "Unsupported document content type was accepted");

const upload = await request("/api/trip/document", {
  method: "POST",
  cookie,
  headers: { "Content-Type": "text/plain", "X-Trip-Size": "27", "X-Trip-Filename": "acceptance-note.txt", "X-Trip-Label": "Acceptance Note", "X-Trip-Activity": "custom-api-acceptance", "X-Trip-Scope": "activity" },
  body: "Disposable acceptance note.",
});
const uploadText = await upload.text();
assert(upload.status === 201, `Protected document upload returned ${upload.status}: ${uploadText}`);
const uploadBody = JSON.parse(uploadText);
assert(/^\/api\/trip\/document\/doc-/.test(uploadBody.document.url), "Uploaded document did not receive a protected URL");
const retrieved = await request(uploadBody.document.url, { cookie });
assert(retrieved.status === 200 && await retrieved.text() === "Disposable acceptance note.", "Uploaded protected document could not be retrieved");

const itineraryResponse = await request("/api/trip/itinerary", { cookie });
assert(itineraryResponse.status === 200, "Itinerary could not be loaded for activity API acceptance");
const itinerary = await itineraryResponse.json();
const dayDates = new Set(itinerary.itinerary.days.map((day) => day.date));
assert(dayDates.has("2026-11-13") && dayDates.has("2026-11-15"), "Disposable activity dates are absent from the trip");

const activityId = "custom-api-acceptance";
const existingRevision = Number(itinerary.revisions[activityId] || 0);
if (existingRevision) {
  const cleanup = await request("/api/trip/sync", { method: "POST", cookie, body: JSON.stringify({ mutations: [{ mutationId: `cleanup-${Date.now()}`, activityId, kind: "delete", baseRevision: existingRevision }] }) });
  assert(cleanup.status === 200, "Existing disposable activity could not be cleaned up");
}

const add = await request("/api/trip/sync", {
  method: "POST",
  cookie,
  body: JSON.stringify({ mutations: [{
    mutationId: `activity-api-${Date.now()}`,
    activityId,
    kind: "add",
    baseRevision: 0,
    activity: {
      custom: true,
      activityType: "flight",
      title: "Disposable Multi-Leg Flight",
      dayDate: "2026-11-13",
      start: "11:10",
      end: "00:15",
      endDate: "2026-11-15",
      timeZone: "America/New_York",
      status: "confirmed",
      fixed: true,
      travelers: ["Dan", "Ken"],
      documents: [uploadBody.document],
      flight: {
        journeyTitle: "Disposable Multi-Leg Flight",
        bookingReference: "TEST",
        airlineUrl: "https://www.koreanair.com/",
        legs: [
          { legId: "leg-bos-icn", airline: "Korean Air", flightNumber: "KE92", cabin: "Prestige Class", departure: { airport: "BOS", city: "Boston", terminal: "E", date: "2026-11-13", time: "11:10", timeZone: "America/New_York" }, arrival: { airport: "ICN", city: "Seoul", terminal: "2", date: "2026-11-14", time: "16:05", timeZone: "Asia/Seoul" }, seats: [{ traveler: "Dan", seat: "14H" }, { traveler: "Ken", seat: "14J" }], documents: [] },
          { legId: "leg-icn-sin", airline: "Korean Air", flightNumber: "KE645", cabin: "Prestige Class", departure: { airport: "ICN", city: "Seoul", terminal: "2", date: "2026-11-14", time: "18:35", timeZone: "Asia/Seoul" }, arrival: { airport: "SIN", city: "Singapore", terminal: "4", date: "2026-11-15", time: "00:15", timeZone: "Asia/Singapore" }, seats: [{ traveler: "Dan", seat: "12H" }, { traveler: "Ken", seat: "14H" }], documents: [] },
        ],
      },
    },
  }] }),
});
const addBody = await add.json();
assert(add.status === 200 && addBody.applied?.length === 1, `Type-aware activity add failed: ${JSON.stringify(addBody)}`);

const stored = await request("/api/trip/itinerary", { cookie });
const storedBody = await stored.json();
assert(storedBody.overrides[activityId]?.flight?.legs?.length === 2, "Multi-leg flight was not stored as one underlying journey");
assert(storedBody.overrides[activityId]?.flight?.legs?.[0]?.cabin === "Prestige Class", "Flight cabin was not stored");
assert(storedBody.overrides[activityId]?.documents?.[0]?.id === uploadBody.document.id, "Protected document metadata was not linked to the activity");

const remove = await request("/api/trip/sync", { method: "POST", cookie, body: JSON.stringify({ mutations: [{ mutationId: `activity-api-delete-${Date.now()}`, activityId, kind: "delete", baseRevision: addBody.applied[0].revision }] }) });
const removeBody = await remove.json();
assert(remove.status === 200 && removeBody.applied?.length === 1, "Disposable activity cleanup failed");

console.log(JSON.stringify({ ok: true, protectedUpload: true, crossOriginRejected: true, multiLegJourneyStored: true, stableLegIds: true }));
