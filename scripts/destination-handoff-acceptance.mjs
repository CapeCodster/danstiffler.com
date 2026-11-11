import assert from "node:assert/strict";
import { destinationPresentation } from "../trip/js/destination-presentation.js";
import itinerarySource from "../trip/data/itinerary.local.js";

const travelDay = {
  date: "2026-11-18",
  city: "Singapore → Hong Kong",
  mediaKey: "singapore",
  timeZone: "Asia/Singapore",
  activities: [
    { id: "sq894", start: "13:10", end: "17:00", venue: "SIN to HKG" },
  ],
};

assert.deepEqual(
  destinationPresentation(travelDay, new Date("2026-11-18T08:59:00Z"), true),
  { city: "Singapore", mediaKey: "singapore", timeZone: "Asia/Singapore" },
  "the Today hero must remain Singapore before the scheduled HKG arrival",
);

assert.deepEqual(
  destinationPresentation(travelDay, new Date("2026-11-18T09:00:00Z"), true),
  { city: "Hong Kong", mediaKey: "hongKong", timeZone: "Asia/Hong_Kong" },
  "the Today hero must switch to Hong Kong at the scheduled 5:00 PM arrival",
);

assert.deepEqual(
  destinationPresentation(travelDay, new Date("2026-11-05T17:00:00Z"), false),
  { city: "Singapore → Hong Kong", mediaKey: "singapore", timeZone: "Asia/Singapore" },
  "browsing a future travel day must preserve that day's configured destination label",
);

const hongKongDay = {
  date: "2026-11-19",
  city: "Hong Kong",
  mediaKey: "hongKong",
  timeZone: "Asia/Hong_Kong",
  activities: [],
};
assert.deepEqual(
  destinationPresentation(hongKongDay, new Date("2026-11-05T17:00:00Z"), false),
  { city: "Hong Kong", mediaKey: "hongKong", timeZone: "Asia/Hong_Kong" },
  "other itinerary days must use their own configured destination",
);

const seoulHeroDates = new Set(["2026-11-13", "2026-11-14", "2026-12-06", "2026-12-07"]);
const configuredSeoulDates = itinerarySource.days
  .filter((day) => day.mediaKey === "seoul")
  .map((day) => day.date);
assert.deepEqual(new Set(configuredSeoulDates), seoulHeroDates, "Seoul hero media must cover both inbound and outbound Seoul flight days");
assert.equal(itinerarySource.trip.media.seoul.day, "/trip/private/images/seoul-day.jpg");
assert.equal(itinerarySource.trip.media.seoul.night, "/trip/private/images/seoul-night.jpg");

const expectedFlightSeats = new Map([
  ["ke92", "Prestige Class · Dan 14H · Ken 14J"],
  ["ke645", "Prestige Class · Dan 12H · Ken 14H"],
  ["sq894", "Dan 32C · Ken 32A"],
  ["ke644", "Prestige Class · Dan 15D · Ken 15G"],
  ["ke91", "Prestige Class · Dan 10B · Ken 10A"],
]);
const flightActivities = itinerarySource.days.flatMap((day) => day.activities);
for (const [id, seats] of expectedFlightSeats) {
  const activity = flightActivities.find((candidate) => candidate.id === id);
  assert.equal(activity?.party, seats, `${id} seat assignments are incomplete`);
}
for (const id of ["ke92", "ke645", "ke644", "ke91"]) {
  const activity = flightActivities.find((candidate) => candidate.id === id);
  assert.equal(activity?.bookingReference, "FHC3AT", `${id} is missing the Korean Air PNR`);
}
for (const [id, bookingReference] of [["sin-airport-pickup", "XTQ927076"], ["sin-transfer", "SPM198606"], ["hkg-transfer", "XYN187509"]]) {
  const activity = flightActivities.find((candidate) => candidate.id === id);
  assert.equal(activity?.bookingReference, bookingReference, `${id} is missing its booking reference`);
}

console.log(JSON.stringify({
  ok: true,
  singaporeBeforeArrival: true,
  hongKongAtScheduledArrival: true,
  itineraryDayBrowsingPreserved: true,
  seoulFlightDays: configuredSeoulDates.length,
  flightSeatRecords: expectedFlightSeats.size,
  bookingReferences: 7,
}));
