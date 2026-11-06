import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import itinerarySource from "../trip/data/itinerary.local.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = process.env.TRIP_TEST_ORIGIN || "http://127.0.0.1:8788";
const vars = Object.fromEntries((await fs.readFile(path.join(projectRoot, ".dev.vars"), "utf8"))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#") && line.includes("="))
  .map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));

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
    Origin: origin,
    "Content-Type": typeFor(sourcePath),
    "Content-Length": String(body.byteLength),
    "X-Trip-Bootstrap": vars.TRIP_BOOTSTRAP_SECRET,
    "X-Trip-Filename": path.basename(sourcePath),
  };
  if (upload.activityId) headers["X-Trip-Activity"] = upload.activityId;
  const response = await fetch(`${origin}/api/trip/admin/document/${upload.id}`, {
    method: "PUT",
    headers,
    body,
  });
  if (!response.ok) throw new Error(`Document ${upload.id} failed with ${response.status}: ${await response.text()}`);
}

const itineraryResponse = await fetch(`${origin}/api/trip/admin/itinerary`, {
  method: "PUT",
  headers: {
    Origin: origin,
    "Content-Type": "application/json",
    "X-Trip-Bootstrap": vars.TRIP_BOOTSTRAP_SECRET,
  },
  body: JSON.stringify({ itinerary }),
});
if (!itineraryResponse.ok) throw new Error(`Itinerary seed failed with ${itineraryResponse.status}: ${await itineraryResponse.text()}`);

console.log(JSON.stringify({ seeded: true, days: itinerary.days.length, documents: uploads.length }));
