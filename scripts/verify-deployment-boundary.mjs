import fs from "node:fs/promises";
import path from "node:path";

const artifactRoot = path.resolve(process.argv[2] || "dist");
const forbiddenSegments = new Set([
  "outputs",
  "private",
  "source-workbooks",
  "supporting-evidence",
]);
const forbiddenNames = new Set([
  "itinerary.local.js",
  ".dev.vars",
  ".env",
]);
const forbiddenExtensions = new Set([
  ".eml",
  ".msg",
  ".pdf",
  ".xlsx",
  ".xls",
  ".docx",
]);
const allowedFiles = new Set([
  "_headers",
  "_routes.json",
  "404.html",
  "index.html",
  "css/404.css",
  "css/styles.css",
  "images/favicon.png",
  "images/hero.jpg",
  "trip/index.html",
  "trip/css/trip.css",
  "trip/icons/apple-touch-icon.png",
  "trip/icons/icon-192.png",
  "trip/icons/icon-512.png",
  "trip/icons/my-travels-globe.svg",
  "trip/js/trip.js",
  "trip/js/activity-navigation.js",
  "trip/js/activity-model.js",
  "trip/js/activity-form.js",
  "trip/js/activity-spreadsheet.js",
  "trip/js/destination-presentation.js",
  "trip/js/offline-vault.js",
  "trip/js/pending-sync.js",
  "trip/manifest.webmanifest",
  "trip/sw.js",
]);

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const stat = await fs.stat(artifactRoot).catch(() => null);
if (!stat?.isDirectory()) {
  throw new Error(`Deployment artifact does not exist: ${artifactRoot}`);
}

const files = await walk(artifactRoot);
const violations = [];
for (const absolute of files) {
  const relative = path.relative(artifactRoot, absolute);
  const segments = relative.split(path.sep);
  const extension = path.extname(relative).toLowerCase();
  if (segments.some((segment) => forbiddenSegments.has(segment))) {
    violations.push(`${relative}: forbidden private directory`);
  }
  if (forbiddenNames.has(path.basename(relative))) {
    violations.push(`${relative}: forbidden private filename`);
  }
  if (forbiddenExtensions.has(extension)) {
    violations.push(`${relative}: forbidden private-document extension`);
  }
  if (!allowedFiles.has(relative)) {
    violations.push(`${relative}: not present in the deployment allowlist`);
  }
}

for (const relative of allowedFiles) {
  if (!files.includes(path.join(artifactRoot, relative))) {
    violations.push(`${relative}: required public artifact is missing`);
  }
}

const tripShellPath = path.join(artifactRoot, "trip/index.html");
const tripShell = await fs.readFile(tripShellPath, "utf8").catch(() => "");
const homeShell = await fs.readFile(path.join(artifactRoot, "index.html"), "utf8").catch(() => "");
const homeCss = await fs.readFile(path.join(artifactRoot, "css/styles.css"), "utf8").catch(() => "");
const tripCss = await fs.readFile(path.join(artifactRoot, "trip/css/trip.css"), "utf8").catch(() => "");
const tripJs = await fs.readFile(path.join(artifactRoot, "trip/js/trip.js"), "utf8").catch(() => "");
const activityNavigationJs = await fs.readFile(path.join(artifactRoot, "trip/js/activity-navigation.js"), "utf8").catch(() => "");
const activityModelJs = await fs.readFile(path.join(artifactRoot, "trip/js/activity-model.js"), "utf8").catch(() => "");
const activityFormJs = await fs.readFile(path.join(artifactRoot, "trip/js/activity-form.js"), "utf8").catch(() => "");
const activitySpreadsheetJs = await fs.readFile(path.join(artifactRoot, "trip/js/activity-spreadsheet.js"), "utf8").catch(() => "");
const destinationJs = await fs.readFile(path.join(artifactRoot, "trip/js/destination-presentation.js"), "utf8").catch(() => "");
const tripManifest = await fs.readFile(path.join(artifactRoot, "trip/manifest.webmanifest"), "utf8").catch(() => "");
const tripServiceWorker = await fs.readFile(path.join(artifactRoot, "trip/sw.js"), "utf8").catch(() => "");
if (!tripShell.includes("Private Travel Planning")
  || !tripShell.includes("This area contains private travel planning tools and is reserved for invited travelers. Please continue only if you have been invited to use this area.")) {
  violations.push("trip/index.html: dedicated private-travel interstitial copy is missing");
}
if (!tripShell.includes('class="primary-button button-link" id="leavePrivateTravel" href="/">Leave</a>')
  || !tripShell.includes('class="secondary-button" id="beginSignIn" type="button">Continue</button>')
  || tripShell.indexOf('id="leavePrivateTravel"') > tripShell.indexOf('id="beginSignIn"')) {
  violations.push("trip/index.html: Leave-primary and Continue-secondary interstitial controls are missing or out of order");
}
if (!tripShell.includes('aria-describedby="publicEntryDescription"')
  || !tripJs.includes('if (focus) leavePrivateTravel.focus();')
  || !tripCss.includes("button:focus-visible, a:focus-visible")) {
  violations.push("trip entry: keyboard labels, focus return, or visible focus treatment is missing");
}
for (const forbiddenEntryText of ["data-traveller=", "Choose a traveller", "Create a six-digit code", "Set up local access"]) {
  if (tripShell.includes(forbiddenEntryText)) {
    violations.push(`trip/index.html: public entry exposes private setup marker ${forbiddenEntryText}`);
  }
}
if (!homeShell.includes('href="/images/favicon.png"')) {
  violations.push("index.html: personal-site ds favicon reference was not preserved");
}
if (homeShell.includes("fonts.googleapis.com") || homeShell.includes("Libre Bodoni")) {
  violations.push("index.html: retired serif web font is still loaded");
}
if (!homeCss.includes('font-family: "Helvetica Neue"')
  || !homeCss.includes("font-weight: 300;")
  || !homeCss.includes("white-space: nowrap;")) {
  violations.push("css/styles.css: approved light sans-serif homepage typography is missing");
}
for (const iconPath of ["/trip/icons/apple-touch-icon.png", "/trip/icons/icon-192.png", "/trip/icons/my-travels-globe.svg"]) {
  if (!tripShell.includes(iconPath)) violations.push(`trip/index.html: missing travel-only icon reference ${iconPath}`);
}
if (tripShell.includes('href="/images/favicon.png"')) {
  violations.push("trip/index.html: My Travels still references the personal-site ds favicon");
}
if (!tripCss.includes("font-size: 16px") || !tripCss.includes("#mainContent:focus { outline: none; }")) {
  violations.push("trip/css/trip.css: iPhone input-zoom or focus-outline regression guard is missing");
}
if (!tripCss.includes(".modal { position: fixed; inset: 0;")) {
  violations.push("trip/css/trip.css: dialogs are not pinned to the visual viewport");
}
if (!tripJs.includes("dialog.scrollTop = 0;")) {
  violations.push("trip/js/trip.js: dialog open does not reset its internal scroll position");
}
if (tripCss.includes("border-bottom: 2px solid var(--accent)")) {
  violations.push("trip/css/trip.css: decorative hero accent divider returned");
}
for (const iconPath of ["/trip/icons/icon-192.png", "/trip/icons/icon-512.png"]) {
  if (!tripManifest.includes(iconPath)) violations.push(`trip/manifest.webmanifest: missing ${iconPath}`);
}
if (!tripServiceWorker.includes('my-travels-shell-v23')
  || !tripServiceWorker.includes('/trip/icons/my-travels-globe.svg')
  || !tripServiceWorker.includes('/trip/js/activity-navigation.js')
  || !tripServiceWorker.includes('/trip/js/destination-presentation.js')
  || !tripServiceWorker.includes('/trip/js/activity-model.js')
  || !tripServiceWorker.includes('/trip/js/activity-form.js')) {
  violations.push("trip/sw.js: revised shell cache or travel icon precache is missing");
}
if (!tripCss.includes(".edit-back { display: inline-flex; align-items: center; min-height: 42px;")
  || !tripCss.includes("border-radius: 12px; background: var(--surface); color: var(--accent);")) {
  violations.push("trip/css/trip.css: Add and Edit Back buttons are missing the rounded mobile treatment");
}
if (!tripCss.includes('.form-columns { grid-template-columns: minmax(0, 1fr); gap: 0; }')
  || !tripCss.includes('.form-columns input[type="time"] { width: 100%; max-width: 100%; }')) {
  violations.push("trip/css/trip.css: narrow-phone Start and End fields can overflow instead of stacking");
}
if (!tripCss.includes(".edit-form select { height: 48px; min-height: 48px; }")) {
  violations.push("trip/css/trip.css: Add and Edit dropdowns can collapse below the shared field height in Safari");
}
if (!tripShell.includes('id="forgotAccessCode"')
  || !tripJs.includes('fetchJson("/api/trip/recovery-reset"')
  || !tripJs.includes('fetchJson("/api/trip/recovery-codes"')) {
  violations.push("trip recovery: forgotten-code reset or protected recovery-code replacement UI is missing");
}
if (!tripJs.includes('data-document-done>Close document</button>')
  || !tripJs.includes('class="document-frame"')
  || tripJs.includes('window.open(objectUrl, "_blank"')) {
  violations.push("trip documents: private files can still strand the mobile app outside the in-app viewer");
}
if (!tripJs.includes("function listingTitle")
  || !tripJs.includes("listingTitle(activity.title)")
  || tripJs.includes("escapeHtml(activity.title)")
  || !tripJs.includes("Tickets & Confirmations")) {
  violations.push("trip titles: application-wide listing title casing is missing or bypassed");
}
if (!tripJs.includes("function offlineDocumentChoices")
  || !tripJs.includes('name="offlineDocument"')
  || !tripJs.includes("activity.evidenceLabel")
  || !tripJs.includes("selected offline documents")) {
  violations.push("trip/js: encrypted offline selection does not include confirmations and reference documents");
}
if (!tripJs.includes('https://maps.apple.com/directions?')
  || !tripJs.includes('mode: "driving"')
  || !activityFormJs.includes('name="accommodationAddress"')) {
  violations.push("trip directions: Apple Maps driving route or editable destination is missing");
}
if (!tripJs.includes('REFERENCE_ACTIVITY_IDS')
  || !tripJs.includes('function getReferenceActivities()')
  || !tripJs.includes('<h2>Travel Reference</h2>')
  || !tripJs.includes('function offlineDocumentChoices(sourceDays = getAllDays())')) {
  violations.push("trip reference: insurance is not separated from timed activities while remaining available offline");
}
if (!tripCss.includes('grid-template-columns: repeat(2, minmax(0, 1fr))')) {
  violations.push("trip forms: Start and End controls can overlap at phone widths");
}
if (!tripCss.includes('text-transform: capitalize')
  || !tripJs.includes('"Choose Documents And Download"')
  || !tripJs.includes('<summary>Offline Privacy And Storage</summary>')) {
  violations.push("trip controls: buttons and disclosure labels do not consistently use Title Case");
}
if (!tripJs.includes('activity.kind === "ship"')
  || !tripJs.includes('"Asia/Ho_Chi_Minh": { name: "ICT", offset: "+0700" }')
  || !tripCss.includes(".feature-actions--single")) {
  violations.push("trip/js: cruise schedule presentation or UTC+7 calendar support is missing");
}
if (!tripJs.includes('class="detail-back-button"')
  || !tripCss.includes('.detail-topbar .detail-back-button')
  || !tripCss.includes('border-radius: 12px')) {
  violations.push("trip activity detail: rounded Today control is missing");
}
if (!tripJs.includes('data-previous-activity')
  || !tripJs.includes('data-next-activity')
  || !tripCss.includes('.detail-pager')
  || !activityNavigationJs.includes('export function activityNeighbors')) {
  violations.push("trip activity detail: previous and next itinerary navigation is missing");
}
if (!tripJs.includes('destinationPresentation(day, now, isActualToday)')
  || !destinationJs.includes('HKG')
  || !destinationJs.includes('minutesAt(now, day.timeZone) >= minutesFromClock(arrival.activity.end)')) {
  violations.push("trip/js: itinerary-driven Singapore-to-Hong-Kong hero handoff is missing");
}
if (!tripJs.includes('tripTravelers: itinerary.trip.travelers || ["Dan", "Ken"]')) {
  violations.push("trip/js/trip.js: trip-level traveler defaults are missing");
}
if (!activityModelJs.includes('export const ACCOMMODATION_SUBTYPES')
  || !activityFormJs.includes('Choose Activity Type')
  || !activityFormJs.includes('Private Check-In And Access Instructions')
  || !activityFormJs.includes('data-flight-leg')
  || !activityFormJs.includes('name="legCabin"')
  || !activityFormJs.includes('syncFlightSeatVisibility')) {
  violations.push("trip activities: type-aware flight and accommodation editors are missing");
}
if (!activitySpreadsheetJs.includes('ACTIVITY_SPREADSHEET_VERSION')
  || !activitySpreadsheetJs.includes('spreadsheetImportReview')) {
  violations.push("trip activities: reusable workbook data contract or review engine is missing");
}

if (violations.length) {
  console.error(JSON.stringify({ ok: false, artifactRoot, violations }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, artifactRoot, inspectedFiles: files.length }));
}
