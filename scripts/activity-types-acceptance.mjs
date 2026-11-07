import assert from "node:assert/strict";
import {
  activityTypeFor,
  connectionDetails,
  flightJourneySummary,
  materializeActivityDays,
  typeDetailsFor,
} from "../trip/js/activity-model.js";
import {
  mergeReviewedWorkbook,
  reviewTravelWorkbookImport,
  travelWorkbookContract,
  travelWorkbookRows,
} from "../trip/js/activity-spreadsheet.js";

const days = [
  { date: "2026-11-13", city: "Boston", timeZone: "America/New_York", activities: [] },
  { date: "2026-11-14", city: "Seoul", timeZone: "Asia/Seoul", activities: [] },
  { date: "2026-11-15", city: "Singapore", timeZone: "Asia/Singapore", activities: [] },
];

const flight = {
  id: "flight-overnight-demo",
  activityType: "flight",
  title: "Boston To Singapore",
  status: "confirmed",
  dayDate: "2026-11-13",
  start: "11:10",
  end: "00:15",
  endDate: "2026-11-15",
  timeZone: "America/New_York",
  travelers: ["Dan", "Ken"],
  documents: [{ id: "doc-flight", url: "/api/trip/document/doc-flight", label: "Flight Confirmation", filename: "flight.pdf", scope: "journey" }],
  flight: {
    journeyTitle: "Boston To Singapore",
    bookingReference: "DEMO",
    airlineUrl: "https://www.koreanair.com/",
    legs: [
      {
        legId: "leg-bos-icn",
        airline: "Korean Air",
        flightNumber: "KE92",
        departure: { airport: "BOS", city: "Boston", terminal: "E", date: "2026-11-13", time: "11:10", timeZone: "America/New_York" },
        arrival: { airport: "ICN", city: "Seoul", terminal: "2", date: "2026-11-14", time: "16:05", timeZone: "Asia/Seoul" },
        seats: [{ traveler: "Dan", seat: "14H" }, { traveler: "Ken", seat: "14J" }],
        documents: [],
      },
      {
        legId: "leg-icn-sin",
        airline: "Korean Air",
        flightNumber: "KE645",
        departure: { airport: "ICN", city: "Seoul", terminal: "2", date: "2026-11-14", time: "18:35", timeZone: "Asia/Seoul" },
        arrival: { airport: "SIN", city: "Singapore", terminal: "4", date: "2026-11-15", time: "00:15", timeZone: "Asia/Singapore" },
        seats: [{ traveler: "Dan", seat: "12H" }, { traveler: "Ken", seat: "14H" }],
        documents: [],
      },
    ],
  },
};

const accommodation = {
  id: "singapore-stay-demo",
  activityType: "accommodation",
  title: "Frasers House",
  status: "confirmed",
  dayDate: "2026-11-15",
  start: "00:45",
  end: "09:00",
  endDate: "2026-11-18",
  timeZone: "Asia/Singapore",
  documents: [],
  accommodation: {
    subtype: "rental",
    propertyOrHostName: "Frasers House",
    address: "Singapore",
    reservedFrom: "2026-11-14",
    reservedTo: "2026-11-18",
    expectedArrivalDate: "2026-11-15",
    expectedArrivalTime: "00:45",
    expectedDepartureDate: "2026-11-18",
    expectedDepartureTime: "09:00",
    checkInTime: "",
    checkOutTime: "",
    roomDetails: "",
    listingUrl: "https://example.com/private-listing",
    accessInstructions: "Private access instructions",
    checkoutInstructions: "Lock the door",
    directions: "Meet the host",
    contactDetails: "Private contact",
  },
};

const transfer = {
  id: "prebooked-transfer-demo",
  activityType: "transfer",
  title: "Klook Airport Pickup",
  status: "confirmed",
  dayDate: "2026-11-15",
  start: "00:30",
  end: "01:15",
  timeZone: "Asia/Singapore",
  documents: [],
  transfer: {
    service: "Klook",
    pickup: "Singapore Changi Airport",
    dropoff: "Frasers House",
    pickupDate: "2026-11-15",
    pickupTime: "00:30",
    expectedArrivalTime: "01:15",
    meetingInstructions: "Meet in the arrival hall",
    providerContact: "Private provider contact",
    prebooked: true,
    backupServices: ["Grab", "Taxi"],
  },
};

const connections = connectionDetails(flight.flight.legs);
assert.equal(connections.length, 1);
assert.equal(connections[0].hub, "ICN");
assert.equal(connections[0].durationMinutes, 150);
assert.equal(connections[0].inconsistentChronology, false);
assert.equal(flightJourneySummary(flight).route, "BOS → ICN → SIN");

const materialized = materializeActivityDays(days, {
  [flight.id]: { ...flight, custom: true },
  [accommodation.id]: { ...accommodation, custom: true },
  [transfer.id]: { ...transfer, custom: true },
});
assert.equal(materialized.roots.get(flight.id).flight.legs.length, 2);
assert.ok(materialized.days.find((day) => day.date === "2026-11-13").activities.some((activity) => activity.rootId === flight.id && activity.projectionKind === "flight-departure"));
assert.ok(materialized.days.find((day) => day.date === "2026-11-14").activities.some((activity) => activity.rootId === flight.id && activity.projectionKind === "flight-arrival"));
assert.ok(materialized.days.find((day) => day.date === "2026-11-15").activities.some((activity) => activity.rootId === flight.id && activity.projectionKind === "flight-arrival"));
assert.equal(typeDetailsFor(accommodation, "accommodation").reservedFrom, "2026-11-14");
assert.equal(typeDetailsFor(accommodation, "accommodation").expectedArrivalDate, "2026-11-15");
assert.equal(typeDetailsFor(transfer, "transfer").prebooked, true);
assert.deepEqual(typeDetailsFor(transfer, "transfer").backupServices, ["Grab", "Taxi"]);

assert.equal(activityTypeFor({ id: "legacy", title: "Arrive At Frasers House", venue: "Frasers House" }), "accommodation");
assert.equal(typeDetailsFor({ id: "legacy", title: "Legacy Hotel", venue: "Legacy Hotel", dayDate: "2026-11-14", start: "15:00", end: "11:00" }, "accommodation").subtype, "hotel-resort");
for (const type of ["flight", "accommodation", "transfer", "transit", "tour", "dining", "general"]) assert.equal(activityTypeFor({ activityType: type }), type);

const contract = travelWorkbookContract();
assert.deepEqual(Object.keys(contract.sheets), ["Trip Details", "Activities", "Flight Legs", "Documents"]);
assert.ok(contract.sheets.Activities.dropdowns.activity_subtype.includes("friends-family"));
const workbook = travelWorkbookRows({ trip: { id: "demo", name: "Demo Trip", start: "2026-11-13", end: "2026-11-15", timeZone: "Asia/Singapore" }, activities: [flight, accommodation, transfer], revisions: { [flight.id]: 10, [accommodation.id]: 20, [transfer.id]: 30 } });
assert.equal(workbook["Flight Legs"].length, 2);
assert.equal(workbook.Documents.length, 1);
assert.equal(workbook.Activities.find((row) => row.activity_id === accommodation.id).reserved_from, "2026-11-14");

const changedWorkbook = structuredClone(workbook);
changedWorkbook.Activities.find((row) => row.activity_id === transfer.id).notes = "Updated pickup instructions";
const safeReview = reviewTravelWorkbookImport(changedWorkbook, [flight, accommodation, transfer], { [flight.id]: 10, [accommodation.id]: 20, [transfer.id]: 30 });
assert.equal(safeReview.conflicts.length, 0);
assert.ok(safeReview.changes.some((change) => change.id === transfer.id));
assert.equal(safeReview.changes.find((change) => change.id === flight.id)?.activity.documents?.[0]?.id || flight.documents[0].id, "doc-flight");
const conflictingReview = reviewTravelWorkbookImport(changedWorkbook, [flight, accommodation, transfer], { [flight.id]: 10, [accommodation.id]: 20, [transfer.id]: 31 });
assert.ok(conflictingReview.conflicts.some((conflict) => conflict.id === transfer.id));
assert.equal(mergeReviewedWorkbook(safeReview, [transfer.id]).length, 1);

console.log(JSON.stringify({
  ok: true,
  demonstrations: ["two-leg time-zone journey", "reserved-night accommodation with after-midnight arrival", "prebooked transfer with backups"],
  workbookSheets: Object.keys(contract.sheets),
}));
