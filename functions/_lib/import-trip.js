import { validateCustomActivity } from "./activity-validation.js";
import { bytesToBase64Url, timingSafeTextEqual } from "./crypto.js";
import { RequestError } from "./http.js";
import { parseTripWorkbook } from "./xlsx-reader.js";

export const IMPORT_SCHEMA_VERSION = "5";
export const CLEAR_TOKEN = "__CLEAR__";

const MAX_IMPORT_BYTES = 30 * 1024 * 1024;
const MAX_WORKBOOK_BYTES = 3 * 1024 * 1024;
const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const REQUIRED_SHEETS = ["Trip Details", "Activities", "Flight Legs", "Documents"];
const ALLOWED_TYPES = new Set(["flight", "accommodation", "transfer", "transit", "tour", "dining", "general"]);
const ALLOWED_STATUSES = new Set(["planned", "confirmed", "awaiting", "purchased", "done", "skipped", "cancelled"]);
const ALLOWED_CABINS = new Set(["", "First Class", "Business", "Premium Economy", "Main Cabin"]);
const ALLOWED_CONTENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "message/rfc822", "text/plain"]);

const SHEET_COLUMNS = {
  "Trip Details": ["schema_version", "trip_id", "trip_name", "start_date", "end_date", "default_time_zone", "travelers", "notes"],
  Activities: [
    "schema_version", "activity_id", "base_revision", "activity_type", "activity_subtype", "title", "status", "day_date",
    "start_time", "end_date", "end_time", "time_zone", "location_or_pickup", "destination_or_dropoff", "address",
    "provider_or_service", "booking_reference", "travelers", "cost", "currency", "property_or_host_name", "reserved_from",
    "reserved_to", "expected_arrival_date", "expected_arrival_time", "expected_departure_date", "expected_departure_time",
    "listing_url", "access_instructions_private", "checkout_instructions_private", "directions", "contact_details",
    "cancellation_terms", "notes", "what_to_wear", "airline_url", "booking_details", "check_in_time", "check_out_time",
    "room_details", "transfer_prebooked", "backup_services", "ticket_details", "party_size",
  ],
  "Flight Legs": [
    "schema_version", "activity_id", "leg_id", "leg_number", "airline", "flight_number", "cabin", "departure_airport",
    "departure_city", "departure_terminal", "departure_date", "departure_time", "departure_time_zone", "arrival_airport",
    "arrival_city", "arrival_terminal", "arrival_date", "arrival_time", "arrival_time_zone", "dan_seat", "ken_seat",
    "leg_booking_reference", "leg_status",
  ],
  Documents: ["schema_version", "document_id", "activity_id", "leg_id", "label", "filename", "private", "include_offline", "notes"],
};

const REQUIRED_COLUMNS = {
  "Trip Details": ["schema_version", "trip_id", "trip_name", "start_date", "end_date", "default_time_zone", "travelers"],
  Activities: ["schema_version", "activity_id", "activity_type", "title", "status"],
  "Flight Legs": ["schema_version", "activity_id", "leg_id", "leg_number", "airline", "flight_number", "departure_airport", "departure_date", "departure_time", "departure_time_zone", "arrival_airport", "arrival_date", "arrival_time", "arrival_time_zone"],
  Documents: ["schema_version", "activity_id", "label", "filename", "private"],
};

function clone(value) {
  return structuredClone(value ?? {});
}

function text(value) {
  return String(value ?? "").trim();
}

function splitList(value) {
  return text(value).split("|").map((item) => item.trim()).filter(Boolean);
}

function safeId(value, label = "identifier") {
  const id = text(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(id)) throw new RequestError(400, `Invalid ${label}`);
  return id;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text(value));
}

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text(value));
}

function validTimeZone(value) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: text(value) }).format(new Date()); return Boolean(text(value)); }
  catch { return false; }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]).filter(([key]) => !["updatedAt", "updatedBy", "original", "rootId", "id", "city"].includes(key)));
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function flattenDiff(before, after, prefix = "") {
  const output = [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of [...keys].sort()) {
    if (["updatedAt", "updatedBy", "original", "rootId", "id", "city"].includes(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const left = before?.[key];
    const right = after?.[key];
    if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) output.push(...flattenDiff(left, right, path));
    else if (JSON.stringify(stable(left)) !== JSON.stringify(stable(right))) output.push({ field: path, before: left ?? "", after: right ?? "" });
  }
  return output;
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function filenameContentType(filename, supplied) {
  const normalized = text(supplied).split(";", 1)[0].toLowerCase();
  if (ALLOWED_CONTENT_TYPES.has(normalized)) return normalized;
  const extension = text(filename).toLowerCase().split(".").at(-1);
  return { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", eml: "message/rfc822", txt: "text/plain" }[extension] || "";
}

function isFile(value) {
  return value && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.name === "string";
}

export function assertImportEnvironment(env) {
  if (!new Set(["preview", "local"]).has(String(env.AUTH_MODE || ""))) throw new RequestError(403, "Import Trip is available only in Preview");
}

export async function readImportUpload(request) {
  const declared = Number(request.headers.get("Content-Length") || request.headers.get("X-Trip-Size") || 0);
  if (!Number.isSafeInteger(declared) || declared < 1 || declared > MAX_IMPORT_BYTES) throw new RequestError(413, "Import upload must be between 1 byte and 30 MB");
  const type = request.headers.get("Content-Type") || "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) throw new RequestError(415, "Expected a multipart workbook upload");
  const form = await request.formData();
  const workbook = form.get("workbook");
  if (!isFile(workbook) || !workbook.name.toLowerCase().endsWith(".xlsx") || workbook.size < 1 || workbook.size > MAX_WORKBOOK_BYTES) {
    throw new RequestError(400, "Choose one .xlsx workbook no larger than 3 MB");
  }
  const attachments = form.getAll("attachments").filter(isFile);
  if (attachments.length > MAX_ATTACHMENTS) throw new RequestError(400, `Select no more than ${MAX_ATTACHMENTS} attachments`);
  const names = new Set();
  const files = [];
  for (const file of attachments) {
    if (file.size < 1 || file.size > MAX_ATTACHMENT_BYTES) throw new RequestError(413, `${file.name} must be between 1 byte and 25 MB`);
    if (names.has(file.name)) throw new RequestError(400, `Attachment filenames must be unique: ${file.name}`);
    names.add(file.name);
    const contentType = filenameContentType(file.name, file.type);
    if (!contentType) throw new RequestError(415, `${file.name} is not a supported protected document type`);
    const bytes = await file.arrayBuffer();
    files.push({ name: file.name, size: file.size, contentType, bytes, sha256: await sha256Hex(bytes) });
  }
  const workbookBytes = await workbook.arrayBuffer();
  return {
    workbook: { name: workbook.name, size: workbook.size, bytes: workbookBytes, sha256: await sha256Hex(workbookBytes) },
    attachments: files,
    reviewToken: text(form.get("review_token")),
  };
}

function issue(plan, sheet, row, column, message, severity = "error") {
  plan[severity === "warning" ? "warnings" : "errors"].push({ sheet, row, column, message });
}

function schemaAndColumns(plan, workbook) {
  for (const name of REQUIRED_SHEETS) {
    const sheet = workbook[name];
    if (!sheet) { issue(plan, name, 0, "", "Required sheet is missing or renamed"); continue; }
    const supported = new Set(SHEET_COLUMNS[name]);
    for (const required of REQUIRED_COLUMNS[name]) if (!sheet.headers.includes(required)) issue(plan, name, sheet.headerRow || 0, required, "Required column is missing");
    const unknown = sheet.headers.filter((header) => !supported.has(header));
    for (const header of unknown) {
      const used = sheet.rows.find((row) => text(row.values[header]));
      if (used) issue(plan, name, used.rowNumber, header, "This populated column cannot be saved by schema v5");
    }
    for (const row of sheet.rows) {
      const version = text(row.values.schema_version);
      if (version !== IMPORT_SCHEMA_VERSION) issue(plan, name, row.rowNumber, "schema_version", `Expected text 5 (numeric 5 is normalized); found ${version || "blank"}`);
    }
  }
}

function effectiveActivities(itinerary, overrideRows) {
  const overrides = new Map(overrideRows.map((row) => [String(row.activity_id), { value: JSON.parse(String(row.json_value)), revision: Number(row.updated_at) }]));
  const activities = new Map();
  const baseIds = new Set();
  for (const day of itinerary.days || []) {
    for (const original of day.activities || []) {
      const id = String(original.id);
      if (baseIds.has(id)) continue;
      baseIds.add(id);
      const override = overrides.get(id);
      activities.set(id, {
        value: { ...clone(original), ...(override?.value || {}), dayDate: override?.value?.dayDate || original.dayDate || day.date, timeZone: override?.value?.timeZone || original.timeZone || day.timeZone },
        revision: override?.revision || 0,
        base: true,
      });
    }
  }
  for (const [id, override] of overrides) {
    if (baseIds.has(id) || !override.value?.custom) continue;
    const day = (itinerary.days || []).find((candidate) => candidate.date === override.value.dayDate) || itinerary.days?.[0] || {};
    activities.set(id, { value: { ...clone(override.value), dayDate: override.value.dayDate || day.date, timeZone: override.value.timeZone || day.timeZone }, revision: override.revision, base: false });
  }
  return { activities, baseIds };
}

function mapValue(context, target, key, row, column, options = {}) {
  const value = text(row.values[column]);
  const before = target[key];
  if (!value) {
    if (context.existing && before !== "" && before != null && (!Array.isArray(before) || before.length)) context.kept.push({ field: options.path || key, value: before, reason: "Blank cell keeps the current value" });
    return;
  }
  if (value === CLEAR_TOKEN) {
    if (!options.clearable) { issue(context.plan, context.sheet, row.rowNumber, column, "__CLEAR__ is not allowed for this required field"); return; }
    target[key] = options.list ? [] : options.boolean ? false : "";
    context.cleared.add(options.path || key);
    return;
  }
  let mapped = value;
  if (options.list) mapped = splitList(value);
  if (options.upper) mapped = value.toUpperCase();
  if (options.boolean) {
    if (!new Set(["yes", "no"]).has(value.toLowerCase())) { issue(context.plan, context.sheet, row.rowNumber, column, "Use Yes or No"); return; }
    mapped = value.toLowerCase() === "yes";
  }
  target[key] = mapped;
}

function defaults(type) {
  const common = { activityType: type, title: "", status: "planned", dayDate: "", start: "", end: "", endDate: "", timeZone: "", travelers: [], bookingReference: "", cost: { amount: "", currency: "" }, cancellationTerms: "", contact: "", bookingDetails: "", note: "", whatToWear: "", documents: [], fixed: false, travelMinutes: 0, arrivalBufferMinutes: 0 };
  if (type === "flight") common.flight = { journeyTitle: "", bookingReference: "", airlineUrl: "", legs: [] };
  if (type === "accommodation") common.accommodation = { subtype: "hotel-resort", propertyOrHostName: "", address: "", reservedFrom: "", reservedTo: "", checkInTime: "", checkOutTime: "", expectedArrivalDate: "", expectedArrivalTime: "", expectedDepartureDate: "", expectedDepartureTime: "", roomDetails: "", listingUrl: "", accessInstructions: "", checkoutInstructions: "", directions: "", contactDetails: "" };
  if (type === "transfer") common.transfer = { service: "", pickup: "", dropoff: "", pickupDate: "", pickupTime: "", expectedArrivalTime: "", meetingInstructions: "", providerContact: "", prebooked: false, backupServices: [] };
  if (type === "transit") common.transit = { mode: "Public Transit", from: "", to: "", lineOrService: "", departureDate: "", departureTime: "", arrivalDate: "", arrivalTime: "", ticketDetails: "" };
  if (type === "tour") common.tour = { experience: "", provider: "", meetingPoint: "", date: "", start: "", end: "" };
  if (type === "dining") common.dining = { restaurant: "", reservationDate: "", reservationTime: "", endTime: "", partySize: "", address: "", dressCode: "" };
  if (type === "general") common.general = { title: "", location: "", date: "", start: "", end: "" };
  return common;
}

function legCandidate(plan, row, existing, activityId, kept, cleared) {
  const leg = clone(existing || { legId: "", airline: "", flightNumber: "", cabin: "", departure: { airport: "", city: "", terminal: "", date: "", time: "", timeZone: "" }, arrival: { airport: "", city: "", terminal: "", date: "", time: "", timeZone: "" }, seats: [], bookingReference: "", status: "", documents: [] });
  const context = { plan, sheet: "Flight Legs", existing: Boolean(existing), kept, cleared };
  mapValue(context, leg, "legId", row, "leg_id", { path: "flight.legs.legId" });
  mapValue(context, leg, "airline", row, "airline", { path: `${leg.legId}.airline` });
  mapValue(context, leg, "flightNumber", row, "flight_number", { upper: true, path: `${leg.legId}.flightNumber` });
  mapValue(context, leg, "cabin", row, "cabin", { clearable: true, path: `${leg.legId}.cabin` });
  mapValue(context, leg.departure, "airport", row, "departure_airport", { upper: true, path: `${leg.legId}.departure.airport` });
  mapValue(context, leg.departure, "city", row, "departure_city", { clearable: true, path: `${leg.legId}.departure.city` });
  mapValue(context, leg.departure, "terminal", row, "departure_terminal", { clearable: true, path: `${leg.legId}.departure.terminal` });
  mapValue(context, leg.departure, "date", row, "departure_date", { path: `${leg.legId}.departure.date` });
  mapValue(context, leg.departure, "time", row, "departure_time", { path: `${leg.legId}.departure.time` });
  mapValue(context, leg.departure, "timeZone", row, "departure_time_zone", { path: `${leg.legId}.departure.timeZone` });
  mapValue(context, leg.arrival, "airport", row, "arrival_airport", { upper: true, path: `${leg.legId}.arrival.airport` });
  mapValue(context, leg.arrival, "city", row, "arrival_city", { clearable: true, path: `${leg.legId}.arrival.city` });
  mapValue(context, leg.arrival, "terminal", row, "arrival_terminal", { clearable: true, path: `${leg.legId}.arrival.terminal` });
  mapValue(context, leg.arrival, "date", row, "arrival_date", { path: `${leg.legId}.arrival.date` });
  mapValue(context, leg.arrival, "time", row, "arrival_time", { path: `${leg.legId}.arrival.time` });
  mapValue(context, leg.arrival, "timeZone", row, "arrival_time_zone", { path: `${leg.legId}.arrival.timeZone` });
  mapValue(context, leg, "bookingReference", row, "leg_booking_reference", { clearable: true, path: `${leg.legId}.bookingReference` });
  mapValue(context, leg, "status", row, "leg_status", { clearable: true, path: `${leg.legId}.status` });
  const seats = new Map((leg.seats || []).map((seat) => [seat.traveler, seat.seat]));
  for (const traveler of ["Dan", "Ken"]) {
    const column = `${traveler.toLowerCase()}_seat`;
    const value = text(row.values[column]);
    if (!value) {
      if (existing && seats.get(traveler)) kept.push({ field: `${leg.legId}.seats.${traveler}`, value: seats.get(traveler), reason: "Blank cell keeps the current value" });
    } else if (value === CLEAR_TOKEN) { seats.delete(traveler); cleared.add(`${leg.legId}.seats.${traveler}`); }
    else seats.set(traveler, value.toUpperCase());
  }
  leg.seats = [...seats].map(([traveler, seat]) => ({ traveler, seat }));
  leg.documents ||= [];
  if (!leg.departure.airport) issue(plan, "Flight Legs", row.rowNumber, "departure_airport", "Departure airport is required by schema v5; city is optional");
  if (!leg.arrival.airport) issue(plan, "Flight Legs", row.rowNumber, "arrival_airport", "Arrival airport is required by schema v5; city is optional");
  if (!ALLOWED_CABINS.has(leg.cabin || "")) issue(plan, "Flight Legs", row.rowNumber, "cabin", "Use one of the listed cabin values");
  if (leg.status && !ALLOWED_STATUSES.has(leg.status)) issue(plan, "Flight Legs", row.rowNumber, "leg_status", "Invalid status");
  for (const [key, value, validator] of [["departure_date", leg.departure.date, validDate], ["arrival_date", leg.arrival.date, validDate], ["departure_time", leg.departure.time, validTime], ["arrival_time", leg.arrival.time, validTime], ["departure_time_zone", leg.departure.timeZone, validTimeZone], ["arrival_time_zone", leg.arrival.timeZone, validTimeZone]]) {
    if (!validator(value)) issue(plan, "Flight Legs", row.rowNumber, key, `Invalid ${key.replaceAll("_", " ")}`);
  }
  return leg;
}

function applyTypedFields(plan, candidate, row, existing, legRows, kept, cleared) {
  const type = candidate.activityType;
  const context = { plan, sheet: "Activities", existing: Boolean(existing), kept, cleared };
  const typeSpecific = new Map([
    ["airline_url", "flight"], ["property_or_host_name", "accommodation"], ["reserved_from", "accommodation"], ["reserved_to", "accommodation"],
    ["expected_arrival_date", "accommodation"], ["expected_arrival_time", "accommodation"], ["expected_departure_date", "accommodation"], ["expected_departure_time", "accommodation"],
    ["listing_url", "accommodation"], ["access_instructions_private", "accommodation"], ["checkout_instructions_private", "accommodation"], ["check_in_time", "accommodation"],
    ["check_out_time", "accommodation"], ["room_details", "accommodation"], ["transfer_prebooked", "transfer"], ["backup_services", "transfer"], ["ticket_details", "transit"], ["party_size", "dining"],
  ]);
  for (const [column, applies] of typeSpecific) if (type !== applies && text(row.values[column])) issue(plan, "Activities", row.rowNumber, column, `This field applies only to ${applies} and cannot be saved on ${type}`);

  if (type === "flight") {
    const flight = candidate.flight ||= defaults("flight").flight;
    mapValue(context, flight, "journeyTitle", row, "title", { path: "flight.journeyTitle" });
    mapValue(context, flight, "bookingReference", row, "booking_reference", { clearable: true, path: "flight.bookingReference" });
    mapValue(context, flight, "airlineUrl", row, "airline_url", { clearable: true, path: "flight.airlineUrl" });
    candidate.airlineUrl = flight.airlineUrl;
    if (cleared.has("flight.airlineUrl")) cleared.add("airlineUrl");
    const existingById = new Map((flight.legs || []).map((leg) => [String(leg.legId || leg.id), leg]));
    const output = [...(flight.legs || [])];
    const seen = new Set();
    for (const legRow of legRows) {
      const rawLegId = text(legRow.values.leg_id);
      const legId = rawLegId.toLowerCase();
      if (!legId) { issue(plan, "Flight Legs", legRow.rowNumber, "leg_id", "Leg ID is required"); continue; }
      if (rawLegId !== legId) issue(plan, "Flight Legs", legRow.rowNumber, "leg_id", "Leg IDs must use lower-case kebab-case");
      try { safeId(legId, "flight leg identifier"); }
      catch (error) { issue(plan, "Flight Legs", legRow.rowNumber, "leg_id", error.message); continue; }
      if (seen.has(legId)) { issue(plan, "Flight Legs", legRow.rowNumber, "leg_id", "Duplicate leg ID for this activity"); continue; }
      seen.add(legId);
      const prior = existingById.get(legId);
      const built = legCandidate(plan, legRow, prior, text(row.values.activity_id), kept, cleared);
      const index = output.findIndex((leg) => String(leg.legId || leg.id) === legId);
      if (index >= 0) output[index] = built;
      else output.splice(Math.max(0, Math.min(output.length, Number(legRow.values.leg_number || output.length + 1) - 1)), 0, built);
    }
    flight.legs = output;
    if (!flight.legs.length) issue(plan, "Activities", row.rowNumber, "activity_id", "A Flight activity requires at least one Flight Legs row");
    const first = flight.legs[0] || {};
    const last = flight.legs.at(-1) || first;
    candidate.title = flight.journeyTitle || text(row.values.title);
    candidate.venue = `${first.departure?.airport || first.departure?.city || "Departure"} to ${last.arrival?.airport || last.arrival?.city || "Arrival"}`;
    candidate.address = last.arrival?.city || last.arrival?.airport || "";
    candidate.dayDate = first.departure?.date || "";
    candidate.start = first.departure?.time || "";
    candidate.endDate = last.arrival?.date || first.departure?.date || "";
    candidate.end = last.arrival?.time || first.departure?.time || "";
    candidate.timeZone = first.departure?.timeZone || "";
    candidate.flight = flight;
    const derived = { day_date: candidate.dayDate, start_time: candidate.start, end_date: candidate.endDate, end_time: candidate.end, time_zone: candidate.timeZone };
    for (const [column, value] of Object.entries(derived)) {
      const supplied = text(row.values[column]);
      if (!supplied || supplied === CLEAR_TOKEN) continue;
      if (supplied !== value) issue(plan, "Activities", row.rowNumber, column, `Flight timing is derived from Flight Legs (${value}); correct or clear this Activities value`);
      else issue(plan, "Activities", row.rowNumber, column, "Value matches the derived Flight Legs timing and is not saved separately", "warning");
    }
    return;
  }

  mapValue(context, candidate, "title", row, "title", { path: "title" });
  mapValue(context, candidate, "dayDate", row, "day_date", { path: "dayDate" });
  mapValue(context, candidate, "start", row, "start_time", { path: "start" });
  mapValue(context, candidate, "endDate", row, "end_date", { clearable: true, path: "endDate" });
  mapValue(context, candidate, "end", row, "end_time", { clearable: true, path: "end" });
  mapValue(context, candidate, "timeZone", row, "time_zone", { path: "timeZone" });

  if (type === "accommodation") {
    const item = candidate.accommodation ||= defaults(type).accommodation;
    for (const [target, column, options] of [["subtype", "activity_subtype", {}], ["propertyOrHostName", "property_or_host_name", {}], ["address", "address", {}], ["reservedFrom", "reserved_from", {}], ["reservedTo", "reserved_to", {}], ["checkInTime", "check_in_time", { clearable: true }], ["checkOutTime", "check_out_time", { clearable: true }], ["expectedArrivalDate", "expected_arrival_date", {}], ["expectedArrivalTime", "expected_arrival_time", {}], ["expectedDepartureDate", "expected_departure_date", {}], ["expectedDepartureTime", "expected_departure_time", { clearable: true }], ["roomDetails", "room_details", { clearable: true }], ["listingUrl", "listing_url", { clearable: true }], ["accessInstructions", "access_instructions_private", { clearable: true }], ["checkoutInstructions", "checkout_instructions_private", { clearable: true }], ["directions", "directions", { clearable: true }], ["contactDetails", "contact_details", { clearable: true }]]) mapValue(context, item, target, row, column, { ...options, path: `accommodation.${target}` });
    candidate.title = item.propertyOrHostName; candidate.venue = item.propertyOrHostName; candidate.address = item.address; candidate.dayDate = item.expectedArrivalDate; candidate.start = item.expectedArrivalTime; candidate.endDate = item.expectedDepartureDate || item.reservedTo; candidate.end = item.expectedDepartureTime || item.expectedArrivalTime; candidate.directions = item.directions; candidate.contact = item.contactDetails || candidate.contact;
  } else if (type === "transfer") {
    const item = candidate.transfer ||= defaults(type).transfer;
    for (const [target, column, options] of [["service", "provider_or_service", {}], ["pickup", "location_or_pickup", {}], ["dropoff", "destination_or_dropoff", {}], ["pickupDate", "day_date", {}], ["pickupTime", "start_time", {}], ["expectedArrivalTime", "end_time", { clearable: true }], ["meetingInstructions", "notes", { clearable: true }], ["providerContact", "contact_details", { clearable: true }], ["prebooked", "transfer_prebooked", { clearable: true, boolean: true }], ["backupServices", "backup_services", { clearable: true, list: true }]]) mapValue(context, item, target, row, column, { ...options, path: `transfer.${target}` });
    candidate.title = item.service || `Transfer To ${item.dropoff}`; candidate.venue = item.pickup; candidate.address = item.dropoff; candidate.dayDate = item.pickupDate; candidate.start = item.pickupTime; candidate.end = item.expectedArrivalTime || item.pickupTime; candidate.meetingPoint = item.pickup; candidate.note = item.meetingInstructions || candidate.note; candidate.contact = item.providerContact || candidate.contact; candidate.fixed = item.prebooked;
  } else if (type === "transit") {
    const item = candidate.transit ||= defaults(type).transit;
    for (const [target, column, options] of [["mode", "provider_or_service", {}], ["from", "location_or_pickup", {}], ["to", "destination_or_dropoff", {}], ["lineOrService", "title", { clearable: true }], ["departureDate", "day_date", {}], ["departureTime", "start_time", {}], ["arrivalDate", "end_date", { clearable: true }], ["arrivalTime", "end_time", { clearable: true }], ["ticketDetails", "ticket_details", { clearable: true }]]) mapValue(context, item, target, row, column, { ...options, path: `transit.${target}` });
    const booking = text(row.values.booking_details); const ticket = text(row.values.ticket_details);
    if (booking && ticket && booking !== CLEAR_TOKEN && ticket !== CLEAR_TOKEN && booking !== ticket) issue(plan, "Activities", row.rowNumber, "booking_details", "booking_details and ticket_details cannot be preserved as different values for Transit");
    if (booking && booking !== CLEAR_TOKEN) item.ticketDetails = booking;
    candidate.bookingDetails = item.ticketDetails; candidate.title = item.lineOrService || item.mode; candidate.venue = item.from; candidate.address = item.to; candidate.dayDate = item.departureDate; candidate.start = item.departureTime; candidate.endDate = item.arrivalDate; candidate.end = item.arrivalTime || item.departureTime;
  } else if (type === "tour") {
    const item = candidate.tour ||= defaults(type).tour;
    for (const [target, column, options] of [["experience", "title", {}], ["provider", "provider_or_service", { clearable: true }], ["meetingPoint", "location_or_pickup", {}], ["date", "day_date", {}], ["start", "start_time", {}], ["end", "end_time", { clearable: true }]]) mapValue(context, item, target, row, column, { ...options, path: `tour.${target}` });
    candidate.title = item.experience; candidate.venue = item.meetingPoint; candidate.dayDate = item.date; candidate.start = item.start; candidate.end = item.end || item.start; candidate.meetingPoint = item.meetingPoint;
  } else if (type === "dining") {
    const item = candidate.dining ||= defaults(type).dining;
    for (const [target, column, options] of [["restaurant", "title", {}], ["reservationDate", "day_date", {}], ["reservationTime", "start_time", {}], ["endTime", "end_time", { clearable: true }], ["partySize", "party_size", { clearable: true }], ["address", "address", { clearable: true }], ["dressCode", "what_to_wear", { clearable: true }]]) mapValue(context, item, target, row, column, { ...options, path: `dining.${target}` });
    candidate.title = item.restaurant; candidate.venue = item.restaurant; candidate.address = item.address; candidate.dayDate = item.reservationDate; candidate.start = item.reservationTime; candidate.end = item.endTime || item.reservationTime; candidate.party = item.partySize; candidate.whatToWear = item.dressCode || candidate.whatToWear;
  } else {
    const item = candidate.general ||= defaults(type).general;
    for (const [target, column, options] of [["title", "title", {}], ["location", "location_or_pickup", { clearable: true }], ["date", "day_date", {}], ["start", "start_time", {}], ["end", "end_time", { clearable: true }]]) mapValue(context, item, target, row, column, { ...options, path: `general.${target}` });
    candidate.title = item.title; candidate.venue = item.location; candidate.address = item.location; candidate.dayDate = item.date; candidate.start = item.start; candidate.end = item.end || item.start;
  }
}

function buildActivity(plan, row, existingRecord, legRows) {
  const requestedType = text(row.values.activity_type).toLowerCase();
  const type = requestedType || existingRecord?.value?.activityType || "";
  if (!ALLOWED_TYPES.has(type)) issue(plan, "Activities", row.rowNumber, "activity_type", "Use one of the listed activity types");
  const applicable = {
    activity_subtype: new Set(["accommodation"]),
    location_or_pickup: new Set(["transfer", "transit", "tour", "dining", "general"]),
    destination_or_dropoff: new Set(["transfer", "transit"]),
    address: new Set(["accommodation", "dining"]),
    provider_or_service: new Set(["transfer", "transit", "tour"]),
    directions: new Set(["accommodation"]),
  };
  for (const [column, allowed] of Object.entries(applicable)) {
    if (text(row.values[column]) && !allowed.has(type)) issue(plan, "Activities", row.rowNumber, column, `This field cannot be saved on ${type}`);
  }
  if (type === "dining" && text(row.values.location_or_pickup) && text(row.values.location_or_pickup) !== text(row.values.title)) issue(plan, "Activities", row.rowNumber, "location_or_pickup", "Dining location cannot differ from the restaurant title in the app model");
  const candidate = existingRecord ? clone(existingRecord.value) : defaults(type || "general");
  if (candidate.activityType && requestedType && candidate.activityType !== requestedType) {
    for (const oldType of ALLOWED_TYPES) if (oldType !== requestedType) delete candidate[oldType];
  }
  candidate.activityType = type;
  const kept = [];
  const cleared = new Set();
  const context = { plan, sheet: "Activities", existing: Boolean(existingRecord), kept, cleared };
  mapValue(context, candidate, "status", row, "status", { path: "status" });
  mapValue(context, candidate, "bookingReference", row, "booking_reference", { clearable: true, path: "bookingReference" });
  mapValue(context, candidate, "travelers", row, "travelers", { clearable: true, list: true, path: "travelers" });
  candidate.cost ||= { amount: "", currency: "" };
  mapValue(context, candidate.cost, "amount", row, "cost", { clearable: true, path: "cost.amount" });
  mapValue(context, candidate.cost, "currency", row, "currency", { clearable: true, upper: true, path: "cost.currency" });
  if (candidate.cost.amount && !/^-?\d+(?:\.\d{1,2})?$/.test(candidate.cost.amount)) issue(plan, "Activities", row.rowNumber, "cost", "Use a number with no currency symbol and at most two decimals");
  if (candidate.cost.currency && !/^[A-Z]{3}$/.test(candidate.cost.currency)) issue(plan, "Activities", row.rowNumber, "currency", "Use a three-letter currency code");
  mapValue(context, candidate, "cancellationTerms", row, "cancellation_terms", { clearable: true, path: "cancellationTerms" });
  mapValue(context, candidate, "contact", row, "contact_details", { clearable: true, path: "contact" });
  mapValue(context, candidate, "bookingDetails", row, "booking_details", { clearable: true, path: "bookingDetails" });
  mapValue(context, candidate, "note", row, "notes", { clearable: true, path: "note" });
  mapValue(context, candidate, "whatToWear", row, "what_to_wear", { clearable: true, path: "whatToWear" });
  candidate.documents ||= [];
  applyTypedFields(plan, candidate, row, existingRecord?.value, legRows, kept, cleared);
  if (!ALLOWED_STATUSES.has(candidate.status)) issue(plan, "Activities", row.rowNumber, "status", "Invalid status");
  const revisionText = text(row.values.base_revision);
  const baseRevision = revisionText ? Number(revisionText) : 0;
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) issue(plan, "Activities", row.rowNumber, "base_revision", "Use a non-negative whole-number revision");
  return { candidate, kept, cleared: [...cleared], baseRevision, rowNumber: row.rowNumber };
}

function documentObject(documentId, row, contentType, legIndex) {
  return { id: documentId, url: `/api/trip/document/${documentId}`, label: text(row.values.label), filename: text(row.values.filename), contentType, scope: text(row.values.leg_id) ? "leg" : "activity", legIndex, offlineAvailable: text(row.values.include_offline).toLowerCase() === "yes" };
}

function attachDocument(candidate, document, legId, plan, row) {
  if (!legId) {
    candidate.documents ||= [];
    const index = candidate.documents.findIndex((item) => item.id === document.id);
    if (index >= 0) candidate.documents[index] = document; else candidate.documents.push(document);
    return;
  }
  const legs = candidate.flight?.legs || [];
  const legIndex = legs.findIndex((leg) => String(leg.legId || leg.id) === legId);
  if (legIndex < 0) { issue(plan, "Documents", row.rowNumber, "leg_id", "Leg ID does not match this Flight activity"); return; }
  legs[legIndex].documents ||= [];
  const index = legs[legIndex].documents.findIndex((item) => item.id === document.id);
  document.legIndex = legIndex;
  if (index >= 0) legs[legIndex].documents[index] = document; else legs[legIndex].documents.push(document);
}

function tripCandidate(plan, row, current) {
  const candidate = clone(current);
  const kept = [];
  const cleared = new Set();
  const context = { plan, sheet: "Trip Details", existing: true, kept, cleared };
  if (text(row.values.trip_id) !== text(current.id)) issue(plan, "Trip Details", row.rowNumber, "trip_id", `Workbook trip_id must match the active Preview itinerary (${current.id})`);
  mapValue(context, candidate, "name", row, "trip_name", { path: "name" });
  mapValue(context, candidate, "start", row, "start_date", { path: "start" });
  mapValue(context, candidate, "end", row, "end_date", { path: "end" });
  mapValue(context, candidate, "timeZone", row, "default_time_zone", { path: "timeZone" });
  mapValue(context, candidate, "travelers", row, "travelers", { list: true, path: "travelers" });
  mapValue(context, candidate, "notes", row, "notes", { clearable: true, path: "notes" });
  return { candidate, kept, cleared: [...cleared] };
}

export async function buildImportPlan(env, upload) {
  assertImportEnvironment(env);
  const workbook = parseTripWorkbook(upload.workbook.bytes);
  const plan = { errors: [], warnings: [], workbook: upload.workbook, attachments: upload.attachments, records: [], documents: [], activityPlans: new Map(), tripPlan: null, stateVersion: 0, itinerary: null, baseIds: new Set() };
  schemaAndColumns(plan, workbook);
  const stateRow = await env.DB.prepare("SELECT json_value, version FROM travel_state WHERE state_key = 'itinerary' LIMIT 1").first();
  if (!stateRow) throw new RequestError(503, "Trip data is not configured");
  const itinerary = JSON.parse(String(stateRow.json_value));
  plan.itinerary = itinerary;
  plan.stateVersion = Number(stateRow.version);
  const overrides = await env.DB.prepare("SELECT activity_id, json_value, updated_at FROM travel_activity_overrides ORDER BY activity_id").all();
  const effective = effectiveActivities(itinerary, overrides.results);
  plan.baseIds = effective.baseIds;
  const documentRows = await env.DB.prepare("SELECT id, r2_key, filename, content_type, activity_id, leg_id, sha256, label, offline_available FROM travel_documents ORDER BY id").all();
  const documentsById = new Map(documentRows.results.map((row) => [String(row.id), row]));
  const documentsByIdentity = new Map(documentRows.results.filter((row) => row.sha256).map((row) => [`${row.activity_id}\n${row.leg_id || ""}\n${row.filename}\n${row.sha256}`, row]));

  const tripRows = workbook["Trip Details"]?.rows || [];
  if (tripRows.length !== 1) issue(plan, "Trip Details", 0, "", "Trip Details must contain exactly one data row");
  if (tripRows[0]) {
    const result = tripCandidate(plan, tripRows[0], itinerary.trip || {});
    plan.tripPlan = { before: clone(itinerary.trip || {}), after: result.candidate, rowNumber: tripRows[0].rowNumber, kept: result.kept, cleared: result.cleared };
    const dayDates = (itinerary.days || []).map((day) => String(day.date)).sort();
    if (dayDates.length && (result.candidate.start !== dayDates[0] || result.candidate.end !== dayDates.at(-1))) issue(plan, "Trip Details", tripRows[0].rowNumber, "start_date", "Pilot trip dates must match the first and last pre-created Preview trip days");
    if (!validTimeZone(result.candidate.timeZone)) issue(plan, "Trip Details", tripRows[0].rowNumber, "default_time_zone", "Invalid IANA time zone");
  }

  const activityRows = workbook.Activities?.rows || [];
  const rowsById = new Map();
  for (const row of activityRows) {
    const rawId = text(row.values.activity_id);
    const id = rawId.toLowerCase();
    if (!id) { issue(plan, "Activities", row.rowNumber, "activity_id", "Activity ID is required"); continue; }
    if (rawId !== id) issue(plan, "Activities", row.rowNumber, "activity_id", "Activity IDs must use lower-case kebab-case");
    if (rowsById.has(id)) { issue(plan, "Activities", row.rowNumber, "activity_id", "Activity ID appears more than once"); continue; }
    rowsById.set(id, row);
  }
  const legRowsByActivity = new Map();
  for (const row of workbook["Flight Legs"]?.rows || []) {
    const id = text(row.values.activity_id).toLowerCase();
    if (!legRowsByActivity.has(id)) legRowsByActivity.set(id, []);
    legRowsByActivity.get(id).push(row);
  }
  for (const [id, rows] of legRowsByActivity) if (!rowsById.has(id)) for (const row of rows) issue(plan, "Flight Legs", row.rowNumber, "activity_id", "Flight leg references an activity not present on Activities");
  for (const [id, row] of rowsById) {
    try { safeId(id, "activity identifier"); }
    catch (error) { issue(plan, "Activities", row.rowNumber, "activity_id", error.message); continue; }
    const existing = effective.activities.get(id);
    if (!existing && !id.startsWith("custom-")) issue(plan, "Activities", row.rowNumber, "activity_id", "New activities must use a stable ID beginning custom-");
    const built = buildActivity(plan, row, existing, legRowsByActivity.get(id) || []);
    plan.activityPlans.set(id, { id, before: existing?.value || null, after: built.candidate, currentRevision: existing?.revision || 0, baseRevision: built.baseRevision, base: existing?.base || false, rowNumber: row.rowNumber, kept: built.kept, cleared: built.cleared, sourceRows: { activity: row.rowNumber, legs: (legRowsByActivity.get(id) || []).map((item) => item.rowNumber) } });
  }

  const attachmentByName = new Map(upload.attachments.map((file) => [file.name, file]));
  for (const row of workbook.Documents?.rows || []) {
    const activityId = text(row.values.activity_id).toLowerCase();
    const activityPlan = plan.activityPlans.get(activityId);
    if (!activityPlan) { issue(plan, "Documents", row.rowNumber, "activity_id", "Document must reference an activity present on Activities"); continue; }
    const legId = text(row.values.leg_id).toLowerCase();
    if (text(row.values.leg_id) !== legId) issue(plan, "Documents", row.rowNumber, "leg_id", "Leg IDs must use lower-case kebab-case");
    if (text(row.values.private).toLowerCase() !== "yes") issue(plan, "Documents", row.rowNumber, "private", "Protected traveler documents must use Yes");
    const offline = text(row.values.include_offline).toLowerCase();
    if (offline && !new Set(["yes", "no"]).has(offline)) issue(plan, "Documents", row.rowNumber, "include_offline", "Use Yes or No");
    const filename = text(row.values.filename);
    if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,159}$/.test(filename) || filename.includes("..")) issue(plan, "Documents", row.rowNumber, "filename", "Use a simple filename with no folders or control characters");
    if (!text(row.values.label) || text(row.values.label).length > 160) issue(plan, "Documents", row.rowNumber, "label", "Document label must be 1-160 characters");
    const suppliedId = text(row.values.document_id).toLowerCase();
    const file = attachmentByName.get(filename);
    let existingDocument = suppliedId ? documentsById.get(suppliedId) : null;
    if (suppliedId && !existingDocument) issue(plan, "Documents", row.rowNumber, "document_id", "Document ID does not exist in Preview");
    if (existingDocument && String(existingDocument.activity_id || "") !== activityId) issue(plan, "Documents", row.rowNumber, "activity_id", "Existing document_id belongs to a different activity");
    if (existingDocument && String(existingDocument.leg_id || "") !== legId) issue(plan, "Documents", row.rowNumber, "leg_id", "Existing document_id belongs to a different flight leg");
    if (existingDocument && String(existingDocument.filename || "") !== filename) issue(plan, "Documents", row.rowNumber, "filename", "Existing document_id has a different filename");
    if (!suppliedId && !file) { issue(plan, "Documents", row.rowNumber, "filename", "Select the matching protected file or supply an existing document_id"); continue; }
    if (file) existingDocument ||= documentsByIdentity.get(`${activityId}\n${legId}\n${filename}\n${file.sha256}`);
    const identityHash = file?.sha256 || text(existingDocument?.sha256);
    const documentId = suppliedId || text(existingDocument?.id) || `doc-${(await sha256Hex(new TextEncoder().encode(`${activityId}\n${legId}\n${filename}\n${identityHash}`))).slice(0, 40)}`;
    const contentType = file?.contentType || text(existingDocument?.content_type) || filenameContentType(filename, "");
    const legIndex = legId ? (activityPlan.after.flight?.legs || []).findIndex((leg) => String(leg.legId || leg.id) === legId) : null;
    const document = documentObject(documentId, row, contentType, legIndex);
    attachDocument(activityPlan.after, document, legId, plan, row);
    const beforeDocument = existingDocument ? { id: existingDocument.id, label: existingDocument.label || existingDocument.filename, filename: existingDocument.filename, activityId: existingDocument.activity_id, legId: existingDocument.leg_id || "", sha256: existingDocument.sha256 || "", offlineAvailable: Boolean(existingDocument.offline_available), contentType: existingDocument.content_type } : null;
    const afterDocument = { id: documentId, label: document.label, filename, activityId, legId, sha256: identityHash, offlineAvailable: document.offlineAvailable, contentType };
    const action = !existingDocument ? "add" : (same(beforeDocument, afterDocument) ? "unchanged" : "update");
    plan.documents.push({ key: `document:${documentId}`, sheet: "Documents", row: row.rowNumber, action, before: beforeDocument, after: afterDocument, file: action === "add" ? file : null, r2Key: `documents/${documentId}` });
  }

  const dayDates = new Set((itinerary.days || []).map((day) => String(day.date)));
  for (const activityPlan of plan.activityPlans.values()) {
    try {
      const sanitized = validateCustomActivity(activityPlan.after, dayDates);
      if (activityPlan.base) delete sanitized.custom;
      activityPlan.after = sanitized;
    } catch (error) {
      issue(plan, "Activities", activityPlan.rowNumber, "", error instanceof Error ? error.message : "Activity validation failed");
    }
    const unchanged = activityPlan.before && same(activityPlan.before, activityPlan.after);
    activityPlan.action = !activityPlan.before ? "add" : unchanged ? "unchanged" : activityPlan.baseRevision !== activityPlan.currentRevision ? "conflict" : "update";
    if (activityPlan.action === "conflict") issue(plan, "Activities", activityPlan.rowNumber, "base_revision", `Revision conflict: workbook ${activityPlan.baseRevision}, Preview ${activityPlan.currentRevision}`);
    const diffs = flattenDiff(activityPlan.before || {}, activityPlan.after || {});
    for (const diff of diffs) if (activityPlan.cleared.includes(diff.field) || activityPlan.cleared.some((path) => diff.field.includes(path))) diff.mode = "clear";
    plan.records.push({ key: `activity:${activityPlan.id}`, sheet: "Activities", row: activityPlan.rowNumber, recordType: "Activity", stableId: activityPlan.id, action: activityPlan.action, currentRevision: activityPlan.currentRevision, workbookRevision: activityPlan.baseRevision, timingSource: activityPlan.after.activityType === "flight" ? "Flight Legs" : "Activities", changes: diffs, preservedBlanks: activityPlan.kept, sourceRows: activityPlan.sourceRows });
  }
  for (const documentPlan of plan.documents) plan.records.push({ key: documentPlan.key, sheet: documentPlan.sheet, row: documentPlan.row, recordType: "Protected document", stableId: documentPlan.after.id, action: documentPlan.action, changes: flattenDiff(documentPlan.before || {}, documentPlan.after || {}), attachment: { filename: documentPlan.after.filename, sha256: documentPlan.after.sha256, legId: documentPlan.after.legId } });
  if (plan.tripPlan) plan.records.unshift({ key: `trip:${plan.tripPlan.after.id}`, sheet: "Trip Details", row: plan.tripPlan.rowNumber, recordType: "Trip", stableId: plan.tripPlan.after.id, action: same(plan.tripPlan.before, plan.tripPlan.after) ? "unchanged" : "update", changes: flattenDiff(plan.tripPlan.before, plan.tripPlan.after), preservedBlanks: plan.tripPlan.kept });
  return plan;
}

function summary(records) {
  const counts = { add: 0, update: 0, unchanged: 0, conflict: 0, invalid: 0 };
  for (const record of records) counts[record.action] = (counts[record.action] || 0) + 1;
  return counts;
}

function fingerprint(plan, session, expiresAt) {
  return JSON.stringify(stable({
    expiresAt,
    session: session.tokenHash,
    user: session.userId,
    workbook: { sha256: plan.workbook.sha256, size: plan.workbook.size },
    attachments: plan.attachments.map((file) => ({ name: file.name, size: file.size, sha256: file.sha256 })),
    stateVersion: plan.stateVersion,
    activities: [...plan.activityPlans.values()].map((item) => ({ id: item.id, currentRevision: item.currentRevision, action: item.action, after: item.after })),
    documents: plan.documents.map((item) => ({ id: item.after.id, action: item.action, after: item.after })),
    trip: plan.tripPlan?.after || null,
  }));
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))));
}

export async function reviewResponse(plan, env, session) {
  const expiresAt = Date.now() + (15 * 60 * 1000);
  const signature = await hmac(String(env.AUTH_PEPPER), fingerprint(plan, session, expiresAt));
  return {
    environment: String(env.AUTH_MODE),
    schemaVersion: IMPORT_SCHEMA_VERSION,
    workbook: { name: plan.workbook.name, sha256: plan.workbook.sha256, size: plan.workbook.size },
    activeTrip: { id: plan.itinerary.trip?.id, name: plan.itinerary.trip?.name, dayCount: plan.itinerary.days?.length || 0 },
    errors: plan.errors,
    warnings: plan.warnings,
    records: plan.records,
    summary: summary(plan.records),
    canMerge: plan.errors.length === 0 && !plan.records.some((record) => record.action === "conflict"),
    reviewToken: `${expiresAt}.${signature}`,
    mergeRules: { blank: "leave current value", clearToken: CLEAR_TOKEN, omittedRows: "leave existing records", matching: "stable IDs plus revision checks; protected files also use filename and SHA-256" },
  };
}

export async function verifyReviewToken(plan, env, session, token) {
  const [expiresText, supplied] = text(token).split(".", 2);
  const expiresAt = Number(expiresText);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Date.now() || !supplied) throw new RequestError(409, "The import review expired; review the workbook again");
  const expected = await hmac(String(env.AUTH_PEPPER), fingerprint(plan, session, expiresAt));
  if (!await timingSafeTextEqual(supplied, expected)) throw new RequestError(409, "Preview data or uploaded files changed; review the import again");
}

export async function applyImportPlan(env, session, plan) {
  if (plan.errors.length || plan.records.some((record) => record.action === "conflict")) throw new RequestError(409, "Resolve import errors and review the workbook again");
  for (const documentPlan of plan.documents.filter((item) => item.action === "add")) {
    if (!documentPlan.file) throw new RequestError(409, `Select ${documentPlan.after.filename} again before merging`);
    await env.TRIP_DOCUMENTS.put(documentPlan.r2Key, documentPlan.file.bytes, {
      httpMetadata: { contentType: documentPlan.after.contentType, contentDisposition: `inline; filename="${documentPlan.after.filename.replaceAll('"', "_")}"` },
      customMetadata: { documentId: documentPlan.after.id, activityId: documentPlan.after.activityId, legId: documentPlan.after.legId, sha256: documentPlan.after.sha256, source: "trip-import-v5" },
    });
  }
  const now = Date.now();
  const statements = [];
  for (const documentPlan of plan.documents) {
    if (documentPlan.action === "add") statements.push(env.DB.prepare(
      `INSERT INTO travel_documents (id, r2_key, filename, content_type, activity_id, created_at, created_by, leg_id, sha256, label, offline_available, source)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'trip-import-v5')
       ON CONFLICT(id) DO NOTHING`,
    ).bind(documentPlan.after.id, documentPlan.r2Key, documentPlan.after.filename, documentPlan.after.contentType, documentPlan.after.activityId, now, session.userId, documentPlan.after.legId, documentPlan.after.sha256, documentPlan.after.label, documentPlan.after.offlineAvailable ? 1 : 0));
    if (documentPlan.action === "update") statements.push(env.DB.prepare(
      "UPDATE travel_documents SET label = ?1, offline_available = ?2 WHERE id = ?3",
    ).bind(documentPlan.after.label, documentPlan.after.offlineAvailable ? 1 : 0, documentPlan.after.id));
  }
  if (plan.tripPlan && !same(plan.tripPlan.before, plan.tripPlan.after)) {
    const updatedItinerary = clone(plan.itinerary);
    updatedItinerary.trip = plan.tripPlan.after;
    statements.push(env.DB.prepare(
      "UPDATE travel_state SET json_value = ?1, version = version + 1, updated_at = ?2, updated_by = ?3 WHERE state_key = 'itinerary' AND version = ?4",
    ).bind(JSON.stringify(updatedItinerary), now, session.userId, plan.stateVersion));
  }
  for (const activityPlan of plan.activityPlans.values()) {
    if (!new Set(["add", "update"]).has(activityPlan.action)) continue;
    const revision = Math.max(now, activityPlan.currentRevision + 1);
    const value = { ...activityPlan.after, updatedAt: new Date(revision).toISOString(), updatedBy: session.displayName };
    statements.push(env.DB.prepare(
      `INSERT INTO travel_activity_overrides (activity_id, json_value, updated_at, updated_by)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(activity_id) DO UPDATE SET json_value = excluded.json_value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    ).bind(activityPlan.id, JSON.stringify(value), revision, session.userId));
  }
  if (statements.length) await env.DB.batch(statements);
  return {
    mergedAt: new Date(now).toISOString(),
    summary: summary(plan.records),
    documents: plan.documents.map((item) => ({ id: item.after.id, url: `/api/trip/document/${item.after.id}`, filename: item.after.filename, activityId: item.after.activityId, legId: item.after.legId, action: item.action })),
  };
}
