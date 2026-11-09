import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import itinerary from "./fixtures/import-trip-pilot-itinerary.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environment = process.env.TRIP_DEPLOYMENT_ENV || "local";
if (!new Set(["local", "preview"]).has(environment)) throw new Error("The Import Trip pilot can be seeded only in local development or Preview");

let origin = process.env.TRIP_DEPLOYMENT_ORIGIN || process.env.TRIP_PREVIEW_ORIGIN || "http://127.0.0.1:8788";
origin = origin.replace(/\/$/, "");
let bootstrapSecret = "";
if (environment === "preview") {
  if (!/^https:\/\/[a-z0-9.-]+\.pages\.dev$/i.test(origin)) throw new Error("TRIP_DEPLOYMENT_ORIGIN must be the confirmed Preview pages.dev origin");
  const state = JSON.parse(await fs.readFile(path.join(projectRoot, "trip/private/preview-setup-state.json"), "utf8"));
  bootstrapSecret = state.bootstrapSecret;
} else {
  const vars = Object.fromEntries((await fs.readFile(path.join(projectRoot, ".dev.vars"), "utf8"))
    .split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
  bootstrapSecret = vars.TRIP_BOOTSTRAP_SECRET;
}
if (!bootstrapSecret) throw new Error("Import Trip pilot bootstrap secret is unavailable");

const response = await fetch(`${origin}/api/trip/admin/itinerary`, {
  method: "PUT",
  headers: { Origin: origin, "Content-Type": "application/json", "X-Trip-Bootstrap": bootstrapSecret },
  body: JSON.stringify({ itinerary, resetImportPilot: true }),
});
if (!response.ok) throw new Error(`Import Trip pilot seed failed with ${response.status}: ${await response.text()}`);

console.log(JSON.stringify({ seeded: true, environment, tripId: itinerary.trip.id, days: itinerary.days.length, destinations: [...new Set(itinerary.days.map((day) => `${day.city}:${day.mediaKey}`))] }));
