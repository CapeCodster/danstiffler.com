import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { parseTripWorkbook } from "../functions/_lib/xlsx-reader.js";

const origin = process.env.TRIP_TEST_ORIGIN || "http://127.0.0.1:8788";
const workbookPath = new URL("../tmp/My-Travels-Worked-Flight-Pilot.xlsx", import.meta.url);
const documentPath = new URL("../tmp/pdfs/flight-confirmation.pdf", import.meta.url);
const workbookBytes = await fs.readFile(workbookPath);
const documentBytes = await fs.readFile(documentPath);
const accessCode = origin.includes("127.0.0.1") || origin.includes("localhost")
  ? "111111"
  : (await fs.readFile(new URL("../trip/private/My Travels Preview Credentials - PRIVATE.txt", import.meta.url), "utf8")).match(/DAN\s+Access code:\s*(\d{6})/i)?.[1];
assert.match(accessCode || "", /^\d{6}$/, "Dan Preview access code is unavailable");

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";", 1)[0] || "";
}

async function login() {
  const response = await fetch(`${origin}/api/trip/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ traveller: "Dan", code: accessCode, rememberDevice: false }),
  });
  assert.equal(response.status, 200, `Local login failed: ${await response.text()}`);
  return cookieFrom(response);
}

function uploadForm(bytes, token = "") {
  const form = new FormData();
  form.append("workbook", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "My-Travels-Worked-Flight-Pilot.xlsx");
  form.append("attachments", new Blob([documentBytes], { type: "application/pdf" }), "flight-confirmation.pdf");
  if (token) form.append("review_token", token);
  return form;
}

async function postImport(path, cookie, bytes, token = "") {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { Origin: origin, Cookie: cookie, "X-Trip-Size": String(bytes.byteLength + documentBytes.byteLength) },
    body: uploadForm(bytes, token),
  });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, `${path} failed: ${JSON.stringify(body)}`);
  return body;
}

function columnName(number) {
  let output = "";
  for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) output = String.fromCharCode(((value - 1) % 26) + 65) + output;
  return output;
}

function replaceCell(xml, address, value) {
  const encoded = String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const selfClosing = new RegExp(`<x:c\\b([^>]*r="${address}"[^>]*)\\s*/>`);
  if (selfClosing.test(xml)) return xml.replace(selfClosing, (_, attrs) => `<x:c${attrs.replace(/\s*\/$/, "")}><x:v>${encoded}</x:v></x:c>`);
  const pattern = new RegExp(`(<x:c\\b[^>]*r="${address}"[^>]*>)([\\s\\S]*?)(</x:c>)`);
  assert.match(xml, pattern, `Cell ${address} is unavailable`);
  return xml.replace(pattern, (_, open, _content, close) => `${open}<x:v>${encoded}</x:v>${close}`);
}

function updateWorkbook(bytes, revision) {
  const workbook = parseTripWorkbook(bytes);
  const headers = workbook.Activities.headers;
  const files = unzipSync(bytes);
  const key = "xl/worksheets/sheet3.xml";
  let xml = strFromU8(files[key]);
  xml = replaceCell(xml, `${columnName(headers.indexOf("base_revision") + 1)}5`, revision);
  xml = replaceCell(xml, `${columnName(headers.indexOf("airline_url") + 1)}5`, "__CLEAR__");
  xml = replaceCell(xml, `${columnName(headers.indexOf("booking_details") + 1)}5`, "");
  files[key] = strToU8(xml);
  const updated = zipSync(files);
  assert.equal(parseTripWorkbook(updated).Activities.rows[0].values.base_revision, String(revision), "Updated workbook revision was not written");
  return updated;
}

const cookie = await login();
const review = await postImport("/api/trip/import/review", cookie, workbookBytes);
assert.equal(review.errors.length, 0);
assert.equal(review.canMerge, true);
assert.equal(review.records.find((record) => record.stableId === "custom-flight-bos-icn")?.action, "add");
assert.equal(review.records.find((record) => record.stableId === "custom-flight-bos-icn")?.timingSource, "Flight Legs");
assert.equal(review.records.find((record) => record.recordType === "Protected document")?.attachment.legId, "leg-jfk-icn");

const firstMerge = await postImport("/api/trip/import/merge", cookie, workbookBytes, review.reviewToken);
assert.equal(firstMerge.summary.add >= 2, true);
const document = firstMerge.documents.find((item) => item.filename === "flight-confirmation.pdf");
assert(document);
assert.equal(document.legId, "leg-jfk-icn");

const itineraryResponse = await fetch(`${origin}/api/trip/itinerary`, { headers: { Cookie: cookie } });
assert.equal(itineraryResponse.status, 200);
const itinerary = await itineraryResponse.json();
const activity = itinerary.overrides["custom-flight-bos-icn"];
assert(activity);
assert.equal(activity.dayDate, "2027-04-10");
assert.equal(activity.start, "07:00");
assert.equal(activity.endDate, "2027-04-11");
assert.equal(activity.end, "17:30");
assert.equal(activity.timeZone, "America/New_York");
assert.equal(activity.flight.legs[1].documents[0].id, document.id);

const protectedResponse = await fetch(`${origin}${document.url}`, { headers: { Cookie: cookie } });
assert.equal(protectedResponse.status, 200);
assert.equal(protectedResponse.headers.get("content-type"), "application/pdf");
assert.deepEqual(Buffer.from(await protectedResponse.arrayBuffer()), documentBytes);

const repeatedReview = await postImport("/api/trip/import/review", cookie, workbookBytes);
assert.equal(repeatedReview.errors.length, 0);
assert.equal(repeatedReview.records.every((record) => record.action === "unchanged"), true);
const repeatedMerge = await postImport("/api/trip/import/merge", cookie, workbookBytes, repeatedReview.reviewToken);
assert.equal(repeatedMerge.summary.add, 0);
assert.equal(repeatedMerge.summary.update, 0);

const revision = Number((await (await fetch(`${origin}/api/trip/itinerary`, { headers: { Cookie: cookie } })).json()).revisions["custom-flight-bos-icn"]);
const updateBytes = updateWorkbook(workbookBytes, revision);
await fs.writeFile(new URL("../tmp/My-Travels-Worked-Flight-Update.xlsx", import.meta.url), updateBytes);
const updateReview = await postImport("/api/trip/import/review", cookie, updateBytes);
assert.equal(updateReview.errors.length, 0, JSON.stringify(updateReview.errors));
const activityUpdate = updateReview.records.find((record) => record.stableId === "custom-flight-bos-icn");
assert.equal(activityUpdate.action, "update");
assert(activityUpdate.changes.some((change) => change.field === "airlineUrl" && change.mode === "clear"));
assert(activityUpdate.preservedBlanks.some((item) => item.field === "bookingDetails"));

console.log(JSON.stringify({
  ok: true,
  flightTimingFromLegs: true,
  protectedDocumentLeg: document.legId,
  repeatImportAdds: repeatedMerge.summary.add,
  repeatImportUpdates: repeatedMerge.summary.update,
  blankKeepsBookingDetails: true,
  explicitClearPreviewed: true,
}));
