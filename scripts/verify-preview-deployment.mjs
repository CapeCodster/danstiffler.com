import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = process.env.TRIP_DEPLOYMENT_ENV || "preview";
if (!["preview", "production"].includes(environment)) {
  throw new Error("TRIP_DEPLOYMENT_ENV must be preview or production");
}
const environmentLabel = environment === "production" ? "Production" : "Preview";
const credentialFilename = `My Travels ${environmentLabel} Credentials - PRIVATE.txt`;
const credentialPath = path.join(projectRoot, "trip", "private", credentialFilename);
const origin = String(process.env.TRIP_DEPLOYMENT_ORIGIN || process.env.TRIP_PREVIEW_ORIGIN || "").replace(/\/$/, "");
const validOrigin = environment === "production"
  ? origin === "https://danstiffler.com"
  : /^https:\/\/[a-z0-9.-]+\.pages\.dev$/i.test(origin);
if (!validOrigin) {
  throw new Error(`TRIP_DEPLOYMENT_ORIGIN must be the confirmed HTTPS ${environmentLabel} origin`);
}
const existingCredentialText = await fs.readFile(credentialPath, "utf8");
function accessCodeFor(traveller) {
  const section = existingCredentialText.match(new RegExp(`${traveller}\\nAccess code: (\\d{6})`, "i"));
  if (!section) throw new Error(`The protected ${environmentLabel} credential file is missing ${traveller}’s access code`);
  return section[1];
}
const state = { accessCodes: { Dan: accessCodeFor("Dan"), Ken: accessCodeFor("Ken") } };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchText(pathname, options) {
  const response = await fetch(`${origin}${pathname}`, options);
  return { response, text: await response.text() };
}

const shell = await fetchText("/trip/");
assert(shell.response.status === 200, `Public shell returned ${shell.response.status}`);
assert(shell.text.includes("Private Travel Planning"), "Private-travel interstitial title is missing");
assert(shell.text.includes("This area contains private travel planning tools and is reserved for invited travelers. Please continue only if you have been invited to use this area."), "Private-travel interstitial description is missing");
assert(shell.text.includes('class="primary-button button-link" id="leavePrivateTravel" href="/">Leave</a>'), "Primary Leave action is missing");
assert(shell.text.includes('class="secondary-button" id="beginSignIn" type="button">Continue</button>'), "Secondary Continue action is missing");
for (const forbidden of ["data-traveller=", "Choose a traveller", "Create a six-digit code", "Set up local access"]) {
  assert(!shell.text.includes(forbidden), `Public shell exposes forbidden setup marker: ${forbidden}`);
}

const serviceWorker = await fetchText("/trip/sw.js", { cache: "no-store" });
assert(serviceWorker.response.status === 200, `Service worker returned ${serviceWorker.response.status}`);
assert(serviceWorker.text.includes("my-travels-shell-v20"), `${environmentLabel} service worker cache version is incorrect`);
assert(serviceWorker.text.includes("/trip/js/activity-navigation.js"), `${environmentLabel} service worker does not cache activity navigation`);
const activityNavigation = await fetchText("/trip/js/activity-navigation.js", { cache: "no-store" });
assert(activityNavigation.response.status === 200, `Activity navigation module returned ${activityNavigation.response.status}`);
assert(activityNavigation.text.includes("export function activityNeighbors"), "Activity navigation module is incomplete");
const tripJavascript = await fetchText("/trip/js/trip.js", { cache: "no-store" });
const tripStyles = await fetchText("/trip/css/trip.css", { cache: "no-store" });
assert(tripJavascript.text.includes("data-previous-activity") && tripJavascript.text.includes("data-next-activity"), "Activity detail navigation controls are missing");
assert(tripStyles.text.includes(".detail-topbar .detail-back-button") && tripStyles.text.includes(".detail-pager"), "Activity detail navigation styling is missing");
assert(tripStyles.text.includes(".edit-back { display: inline-flex; align-items: center; min-height: 42px;") && tripStyles.text.includes("border-radius: 12px; background: var(--surface); color: var(--accent);"), "Add and Edit Back buttons are missing the rounded mobile treatment");
assert(tripStyles.text.includes('.form-columns { grid-template-columns: minmax(0, 1fr); gap: 0; }') && tripStyles.text.includes('.form-columns input[type="time"] { width: 100%; max-width: 100%; }'), "Narrow-phone Start and End fields are not safely stacked");
assert(tripStyles.text.includes(".edit-form select { height: 48px; min-height: 48px; }"), "Add and Edit dropdowns can collapse below the shared field height in Safari");
const manifest = await fetchText("/trip/manifest.webmanifest", { cache: "no-store" });
assert(manifest.response.status === 200, `Web manifest returned ${manifest.response.status}`);
assert(manifest.text.includes("/trip/icons/icon-192.png"), "Offline manifest icon is missing");

const anonymousItinerary = await fetch(`${origin}/api/trip/itinerary`, { cache: "no-store" });
assert(anonymousItinerary.status === 401, `Anonymous itinerary returned ${anonymousItinerary.status}`);
const anonymousDocument = await fetch(`${origin}/api/trip/document/peak-tram-ticket`, { cache: "no-store" });
assert(anonymousDocument.status === 401, `Anonymous document returned ${anonymousDocument.status}`);
const anonymousBootstrap = await fetch(`${origin}/api/trip/bootstrap`, {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({ users: [] }),
});
assert(anonymousBootstrap.status === 404, `Bootstrap without secret returned ${anonymousBootstrap.status}`);

async function login(traveller, code) {
  const response = await fetch(`${origin}/api/trip/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ traveller, code, rememberDevice: true }),
  });
  assert(response.status === 200, `${traveller} login returned ${response.status}`);
  const setCookie = response.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";", 1)[0];
  assert(cookie.startsWith("__Host-my_travels_session="), `${traveller} session cookie is missing`);
  assert(/;\s*HttpOnly/i.test(setCookie) && /;\s*Secure/i.test(setCookie) && /;\s*SameSite=Strict/i.test(setCookie), `${traveller} cookie security flags are incomplete`);
  return cookie;
}

const danCookie = await login("Dan", state.accessCodes.Dan);
const itineraryResponse = await fetch(`${origin}/api/trip/itinerary`, {
  headers: { Cookie: danCookie },
  cache: "no-store",
});
assert(itineraryResponse.status === 200, `Authenticated itinerary returned ${itineraryResponse.status}`);
assert((itineraryResponse.headers.get("cache-control") || "").includes("no-store"), "Authenticated itinerary is missing no-store");
const itinerary = await itineraryResponse.json();
assert(Array.isArray(itinerary.itinerary?.days) && itinerary.itinerary.days.length >= 8, `${environmentLabel} itinerary is incomplete`);
const flightActivities = itinerary.itinerary.days.flatMap((day) => day.activities);
const expectedFlightSeats = new Map([
  ["ke92", "Prestige Class · Dan 14H · Ken 14J"],
  ["ke645", "Prestige Class · Dan 12H · Ken 14H"],
  ["sq894", "Dan 32C · Ken 32A"],
  ["ke644", "Prestige Class · Dan 15D · Ken 15G"],
  ["ke91", "Prestige Class · Dan 10B · Ken 10A"],
]);
for (const [id, seats] of expectedFlightSeats) {
  const activity = flightActivities.find((candidate) => candidate.id === id);
  assert(activity?.party === seats, `${id} seat assignments are incomplete`);
}
const loganDrive = itinerary.overrides?.["custom-drive-to-logan-airport"];
assert(loganDrive?.custom === true, "Drive to Logan Airport activity is missing");
assert(loganDrive.dayDate === "2026-11-13" && loganDrive.start === "07:00" && loganDrive.end === "08:10", "Drive to Logan Airport schedule is incorrect");
assert(loganDrive.address === "Boston Logan International Airport Rental Car Center", "Drive to Logan Airport destination is incorrect");
const seoulMedia = itinerary.itinerary.trip?.media?.seoul;
assert(seoulMedia?.day === "/api/trip/document/media-seoul-day", "Daytime Seoul hero is missing");
assert(seoulMedia?.night === "/api/trip/document/media-seoul-night", "Nighttime Seoul hero is missing");
const seoulDates = new Set(["2026-11-13", "2026-11-14", "2026-12-06", "2026-12-07"]);
for (const day of itinerary.itinerary.days.filter((candidate) => seoulDates.has(candidate.date))) {
  assert(day.mediaKey === "seoul", "A Seoul flight day is not using the Seoul hero");
}
const seoulImages = await Promise.all([
  fetch(new URL(seoulMedia.day, origin), { headers: { Cookie: danCookie }, cache: "no-store" }),
  fetch(new URL(seoulMedia.night, origin), { headers: { Cookie: danCookie }, cache: "no-store" }),
]);
for (const response of seoulImages) {
  assert(response.status === 200, "Protected Seoul hero returned a non-200 response");
  assert((response.headers.get("content-type") || "").startsWith("image/jpeg"), "Protected Seoul hero is not a JPEG");
  assert((await response.arrayBuffer()).byteLength > 100000, "Protected Seoul hero is unexpectedly small");
}
const serialized = JSON.stringify(itinerary);
assert(!serialized.includes("/trip/private/") && !serialized.includes("/outputs/"), `${environmentLabel} itinerary exposes local private paths`);

const ticket = await fetch(`${origin}/api/trip/document/peak-tram-ticket`, {
  headers: { Cookie: danCookie },
  cache: "no-store",
});
assert(ticket.status === 200, `Authenticated ticket returned ${ticket.status}`);
assert((ticket.headers.get("cache-control") || "").includes("private") && (ticket.headers.get("cache-control") || "").includes("no-store"), "Ticket cache header is not private/no-store");
assert((ticket.headers.get("content-type") || "").startsWith("application/pdf"), "Peak Tram ticket is not a PDF");
assert((await ticket.arrayBuffer()).byteLength > 1000, "Peak Tram ticket payload is unexpectedly small");

const kenCookie = await login("Ken", state.accessCodes.Ken);
const kenSession = await fetch(`${origin}/api/trip/session`, { headers: { Cookie: kenCookie }, cache: "no-store" });
assert(kenSession.status === 200, `Ken session returned ${kenSession.status}`);

const crossOrigin = await fetch(`${origin}/api/trip/sync`, {
  method: "POST",
  headers: { Cookie: danCookie, Origin: "https://example.com", "Content-Type": "application/json" },
  body: JSON.stringify({ changes: [] }),
});
assert(crossOrigin.status === 403, `Cross-origin sync returned ${crossOrigin.status}`);

async function replaceRecoveryCodes(cookie, currentCode) {
  const response = await fetch(`${origin}/api/trip/recovery-codes`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ currentCode }),
  });
  assert(response.status === 200, `Recovery-code replacement returned ${response.status}`);
  const body = await response.json();
  assert(body.replaced === true && Array.isArray(body.recoveryCodes) && body.recoveryCodes.length === 8, "Recovery-code replacement returned an incomplete set");
  assert(new Set(body.recoveryCodes).size === body.recoveryCodes.length, "Recovery-code replacement returned duplicate codes");
  return body.recoveryCodes;
}

async function recoveryReset(traveller, recoveryCode, newCode) {
  return fetch(`${origin}/api/trip/recovery-reset`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ traveller, recoveryCode, newCode, rememberDevice: true }),
  });
}

async function changeCode(cookie, currentCode, newCode) {
  return fetch(`${origin}/api/trip/access-code`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ currentCode, newCode }),
  });
}

const danSecondCookie = await login("Dan", state.accessCodes.Dan);
const kenSecondCookie = await login("Ken", state.accessCodes.Ken);
const danTestCode = state.accessCodes.Dan === "818181" ? "818182" : "818181";
const kenTestCode = state.accessCodes.Ken === "828282" ? "828283" : "828282";

const danTestRecoveryCodes = await replaceRecoveryCodes(danCookie, state.accessCodes.Dan);
const crossTravellerReset = await recoveryReset("Ken", danTestRecoveryCodes[1], state.accessCodes.Ken);
assert(crossTravellerReset.status === 401, "Dan’s recovery code was accepted for Ken");
const danReset = await recoveryReset("Dan", danTestRecoveryCodes[0], danTestCode);
assert(danReset.status === 200, `Dan recovery reset returned ${danReset.status}`);
const activeDanCookie = (danReset.headers.get("set-cookie") || "").split(";", 1)[0];
assert((await fetch(`${origin}/api/trip/session`, { headers: { Cookie: danCookie }, cache: "no-store" })).status === 401, "Dan’s first earlier session survived recovery reset");
assert((await fetch(`${origin}/api/trip/session`, { headers: { Cookie: danSecondCookie }, cache: "no-store" })).status === 401, "Dan’s second earlier session survived recovery reset");
assert((await fetch(`${origin}/api/trip/session`, { headers: { Cookie: kenCookie }, cache: "no-store" })).status === 200, "Dan’s reset invalidated Ken’s session");
assert((await recoveryReset("Dan", danTestRecoveryCodes[0], state.accessCodes.Dan)).status === 401, "A consumed Dan recovery code was accepted twice");
assert((await changeCode(activeDanCookie, danTestCode, state.accessCodes.Dan)).status === 200, `Dan’s ${environmentLabel} access code was not restored`);
assert((await fetch(`${origin}/api/trip/session`, { headers: { Cookie: activeDanCookie }, cache: "no-store" })).status === 200, "Ordinary Dan code change invalidated the reset session");

const kenTestRecoveryCodes = await replaceRecoveryCodes(kenCookie, state.accessCodes.Ken);
const kenReset = await recoveryReset("Ken", kenTestRecoveryCodes[0], kenTestCode);
assert(kenReset.status === 200, `Ken recovery reset returned ${kenReset.status}`);
const activeKenCookie = (kenReset.headers.get("set-cookie") || "").split(";", 1)[0];
assert((await fetch(`${origin}/api/trip/session`, { headers: { Cookie: kenCookie }, cache: "no-store" })).status === 401, "Ken’s first earlier session survived recovery reset");
assert((await fetch(`${origin}/api/trip/session`, { headers: { Cookie: kenSecondCookie }, cache: "no-store" })).status === 401, "Ken’s second earlier session survived recovery reset");
assert((await fetch(`${origin}/api/trip/session`, { headers: { Cookie: activeDanCookie }, cache: "no-store" })).status === 200, "Ken’s reset invalidated Dan’s session");
assert((await recoveryReset("Ken", kenTestRecoveryCodes[0], state.accessCodes.Ken)).status === 401, "A consumed Ken recovery code was accepted twice");
assert((await changeCode(activeKenCookie, kenTestCode, state.accessCodes.Ken)).status === 200, `Ken’s ${environmentLabel} access code was not restored`);
assert((await fetch(`${origin}/api/trip/session`, { headers: { Cookie: activeKenCookie }, cache: "no-store" })).status === 200, "Ordinary Ken code change invalidated the reset session");

const finalDanRecoveryCodes = await replaceRecoveryCodes(activeDanCookie, state.accessCodes.Dan);
const finalKenRecoveryCodes = await replaceRecoveryCodes(activeKenCookie, state.accessCodes.Ken);
const credentialText = [
  `MY TRAVELS ${environmentLabel.toUpperCase()} CREDENTIALS — PRIVATE`,
  "Do not email, screenshot, or place this file in cloud-shared storage or source control.",
  "",
  `${environmentLabel} address: ${origin}/trip/`,
  `Recovery sets replaced after security verification: ${new Date().toISOString()}`,
  "",
  "DAN",
  `Access code: ${state.accessCodes.Dan}`,
  "One-time recovery reset codes:",
  ...finalDanRecoveryCodes.map((code) => `  ${code}`),
  "",
  "KEN",
  `Access code: ${state.accessCodes.Ken}`,
  "One-time recovery reset codes:",
  ...finalKenRecoveryCodes.map((code) => `  ${code}`),
  "",
  "Storage instructions:",
  `1. Save both clearly labeled traveler sections in the shared 1Password secure note for ${environmentLabel}.`,
  `2. Keep this ${environmentLabel} set separate from the other deployment environment.`,
  "3. A recovery code resets a forgotten six-digit code once; it is not an alternate login code.",
  "4. Replacing recovery codes invalidates the traveler’s previous set.",
  "5. A recovery reset invalidates that traveler’s server sessions. A disconnected offline package cannot be revoked until its device reconnects.",
  "",
].join("\n");
const credentialTempPath = `${credentialPath}.tmp`;
await fs.writeFile(credentialTempPath, credentialText, { mode: 0o600 });
await fs.chmod(credentialTempPath, 0o600);
await fs.rename(credentialTempPath, credentialPath);

assert((await recoveryReset("Dan", danTestRecoveryCodes[1], state.accessCodes.Dan)).status === 401, "Dan’s replaced recovery-code set remained valid");
assert((await recoveryReset("Ken", kenTestRecoveryCodes[1], state.accessCodes.Ken)).status === 401, "Ken’s replaced recovery-code set remained valid");

console.log(JSON.stringify({
  ok: true,
  publicEntry: true,
  offlineShell: true,
  anonymousItinerary: anonymousItinerary.status,
  anonymousDocument: anonymousDocument.status,
  bootstrapWithoutSecret: anonymousBootstrap.status,
  danLogin: 200,
  kenLogin: 200,
  itineraryDays: itinerary.itinerary.days.length,
  protectedTicket: 200,
  crossOriginSync: crossOrigin.status,
  recoveryResetBothTravellers: true,
  recoveryResetInvalidatedEarlierSessions: true,
  travelerRecoveryIsolation: true,
  replacementRecoverySetsInvalidated: true,
  privateCredentialFileUpdated: true,
  loganDrive: true,
  seoulHero: true,
  flightSeats: true,
  environment,
  privateCredentialFile: `trip/private/${credentialFilename}`,
}));
