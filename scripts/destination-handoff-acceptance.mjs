import assert from "node:assert/strict";
import { destinationPresentation } from "../trip/js/destination-presentation.js";

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

console.log(JSON.stringify({
  ok: true,
  singaporeBeforeArrival: true,
  hongKongAtScheduledArrival: true,
  itineraryDayBrowsingPreserved: true,
}));
