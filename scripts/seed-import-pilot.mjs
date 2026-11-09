import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
  if (process.env.TRIP_DIRECT_D1 === "1") {
    const escaped = JSON.stringify(itinerary).replaceAll("'", "''");
    const now = Date.now();
    const sql = [
      "DELETE FROM travel_activity_overrides;",
      "DELETE FROM travel_documents WHERE source = 'trip-import-v5';",
      `INSERT INTO travel_state (state_key, json_value, version, updated_at, updated_by) VALUES ('itinerary', '${escaped}', 1, ${now}, 'import-pilot') ON CONFLICT(state_key) DO UPDATE SET json_value = excluded.json_value, version = travel_state.version + 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by;`,
    ].join("\n");
    const result = spawnSync("npx", ["wrangler", "d1", "execute", "danstiffler-travel-preview", "--remote", "--env", "preview", "--command", sql], {
      cwd: projectRoot,
      env: { ...process.env, WRANGLER_LOG_PATH: "/private/tmp/danstiffler-import-pilot-direct.log" },
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(`Direct Preview pilot seed failed: ${result.stderr || result.stdout}`);
    console.log(JSON.stringify({ seeded: true, environment, method: "direct-preview-d1", tripId: itinerary.trip.id, days: itinerary.days.length, destinations: [...new Set(itinerary.days.map((day) => `${day.city}:${day.mediaKey}`))] }));
    process.exit(0);
  }
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
