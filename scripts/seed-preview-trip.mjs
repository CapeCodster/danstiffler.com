import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import itinerarySource from "../trip/data/itinerary.local.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = process.env.TRIP_DEPLOYMENT_ENV || "preview";
if (!["preview", "production"].includes(environment)) {
  throw new Error("TRIP_DEPLOYMENT_ENV must be preview or production");
}
const environmentLabel = environment === "production" ? "Production" : "Preview";
const statePath = path.join(projectRoot, "trip", "private", `${environment}-setup-state.json`);
const credentialFilename = `My Travels ${environmentLabel} Credentials - PRIVATE.txt`;
const credentialPath = path.join(projectRoot, "trip", "private", credentialFilename);
const origin = String(process.env.TRIP_DEPLOYMENT_ORIGIN || process.env.TRIP_PREVIEW_ORIGIN || "").replace(/\/$/, "");
const validOrigin = environment === "production"
  ? origin === "https://danstiffler.com"
  : /^https:\/\/[a-z0-9.-]+\.pages\.dev$/i.test(origin);
if (!validOrigin) {
  throw new Error(`TRIP_DEPLOYMENT_ORIGIN must be the confirmed HTTPS ${environmentLabel} origin`);
}

const state = JSON.parse(await fs.readFile(statePath, "utf8"));
if (!state.bootstrapSecret || !state.accessCodes?.Dan || !state.accessCodes?.Ken) {
  throw new Error(`Private ${environmentLabel} setup state is missing`);
}
if (state.accessCodes.Dan === "111111" || state.accessCodes.Ken === "222222") {
  throw new Error(`Localhost test codes are forbidden for ${environmentLabel}`);
}

async function request(relativeUrl, options = {}) {
  return fetch(`${origin}${relativeUrl}`, {
    ...options,
    headers: { Origin: origin, ...(options.headers || {}) },
  });
}

const bootstrapBody = {
  users: [
    { displayName: "Dan", code: state.accessCodes.Dan },
    { displayName: "Ken", code: state.accessCodes.Ken },
  ],
};
const bootstrapResponse = await request("/api/trip/bootstrap", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Trip-Bootstrap": state.bootstrapSecret,
  },
  body: JSON.stringify(bootstrapBody),
});
if (bootstrapResponse.status !== 201) {
  throw new Error(`${environmentLabel} credential bootstrap failed with ${bootstrapResponse.status}: ${await bootstrapResponse.text()}`);
}
const bootstrap = await bootstrapResponse.json();
if (!bootstrap.configured || !bootstrap.recoveryCodes?.Dan?.length || !bootstrap.recoveryCodes?.Ken?.length) {
  throw new Error(`${environmentLabel} credential bootstrap returned incomplete recovery material`);
}

const credentialText = [
  `MY TRAVELS ${environmentLabel.toUpperCase()} CREDENTIALS — PRIVATE`,
  "Do not email, screenshot, or place this file in cloud-shared storage or source control.",
  "",
  `${environmentLabel} address: ${origin}/trip/`,
  `Configured: ${new Date().toISOString()}`,
  "",
  "DAN",
  `Access code: ${state.accessCodes.Dan}`,
  "One-time recovery codes:",
  ...bootstrap.recoveryCodes.Dan.map((code) => `  ${code}`),
  "",
  "KEN",
  `Access code: ${state.accessCodes.Ken}`,
  "One-time recovery codes:",
  ...bootstrap.recoveryCodes.Ken.map((code) => `  ${code}`),
  "",
  "Storage instructions:",
  `1. Save both clearly labeled traveler sections in the shared 1Password secure note for ${environmentLabel}.`,
  `2. Keep this ${environmentLabel} set separate from the other deployment environment.`,
  "3. Each recovery code works once; remove it from the saved list after use.",
  "4. Remember this device stores only a secure server session cookie, never the access code.",
  "5. Offline packages require the six-digit access code after a disconnected reload.",
  "",
].join("\n");
await fs.writeFile(credentialPath, credentialText, { mode: 0o600 });
await fs.chmod(credentialPath, 0o600);

const itinerary = structuredClone(itinerarySource);
const uploads = [];
const usedIds = new Set();

function documentId(activityId, kind) {
  const base = `${activityId}-${kind}`.toLowerCase().replaceAll(/[^a-z0-9-]/g, "-").replaceAll(/-+/g, "-").slice(0, 72);
  let candidate = base;
  let counter = 2;
  while (usedIds.has(candidate)) candidate = `${base}-${counter++}`;
  usedIds.add(candidate);
  return candidate;
}

for (const [mediaKey, variants] of Object.entries(itinerary.trip.media || {})) {
  for (const [mode, sourceUrl] of Object.entries(variants)) {
    const id = documentId(`media-${mediaKey}`, mode);
    uploads.push({ id, activityId: null, sourceUrl });
    variants[mode] = `/api/trip/document/${id}`;
  }
}

for (const day of itinerary.days) {
  for (const activity of day.activities) {
    for (const kind of ["ticket", "evidence"]) {
      if (!activity[kind]) continue;
      const id = documentId(activity.id, kind);
      uploads.push({ id, activityId: activity.id, sourceUrl: activity[kind] });
      activity[kind] = `/api/trip/document/${id}`;
    }
  }
}

function typeFor(filename) {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".eml") return "message/rfc822";
  if (extension === ".txt") return "text/plain; charset=utf-8";
  if (extension === ".png") return "image/png";
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  return "application/octet-stream";
}

for (const upload of uploads) {
  const sourcePath = path.join(projectRoot, upload.sourceUrl.replace(/^\//, ""));
  const body = await fs.readFile(sourcePath);
  const headers = {
    "Content-Type": typeFor(sourcePath),
    "Content-Length": String(body.byteLength),
    "X-Trip-Bootstrap": state.bootstrapSecret,
    "X-Trip-Filename": path.basename(sourcePath),
  };
  if (upload.activityId) headers["X-Trip-Activity"] = upload.activityId;
  const response = await request(`/api/trip/admin/document/${upload.id}`, {
    method: "PUT",
    headers,
    body,
  });
  if (!response.ok) throw new Error(`${environmentLabel} document ${upload.id} failed with ${response.status}: ${await response.text()}`);
}

const itineraryResponse = await request("/api/trip/admin/itinerary", {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    "X-Trip-Bootstrap": state.bootstrapSecret,
  },
  body: JSON.stringify({ itinerary }),
});
if (!itineraryResponse.ok) {
  throw new Error(`${environmentLabel} itinerary seed failed with ${itineraryResponse.status}: ${await itineraryResponse.text()}`);
}

const secondBootstrap = await request("/api/trip/bootstrap", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Trip-Bootstrap": state.bootstrapSecret,
  },
  body: JSON.stringify(bootstrapBody),
});
if (secondBootstrap.status !== 409) {
  throw new Error(`Initialized bootstrap endpoint should return 409, received ${secondBootstrap.status}`);
}

console.log(JSON.stringify({
  seeded: true,
  days: itinerary.days.length,
  documents: uploads.length,
  bootstrapLocked: true,
  environment,
  privateCredentialFile: `trip/private/${credentialFilename}`,
}));
