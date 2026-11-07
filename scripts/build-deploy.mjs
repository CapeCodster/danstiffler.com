import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "dist");

const publicFiles = [
  "_headers",
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
  "trip/js/destination-presentation.js",
  "trip/js/offline-vault.js",
  "trip/js/pending-sync.js",
  "trip/manifest.webmanifest",
  "trip/sw.js",
];

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });

for (const relativePath of publicFiles) {
  const source = path.join(projectRoot, relativePath);
  const destination = path.join(outputRoot, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

await fs.writeFile(
  path.join(outputRoot, "_routes.json"),
  `${JSON.stringify({ version: 1, include: ["/api/trip/*"], exclude: [] }, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({ outputRoot, fileCount: publicFiles.length + 1 }));
