import { validateTripDay, withTripDay } from "../functions/_lib/trip-day.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const initial = {
  trip: { id: "test-trip", start: "2026-11-13", end: "2026-12-07" },
  days: [{ date: "2026-11-13", city: "Boston → Seoul", timeZone: "America/New_York", mediaKey: "seoul", activities: [] }],
};
const day = validateTripDay({ date: "2026-11-12", city: "Hyannis", timeZone: "America/New_York", mediaKey: "hyannis" });
const added = withTripDay(initial, day);

assert(added.created, "The new trip day was not added");
assert(added.itinerary.days[0].date === "2026-11-12", "Trip days were not sorted");
assert(added.itinerary.trip.start === "2026-11-12", "The trip start was not updated");
assert(withTripDay(added.itinerary, day).created === false, "Adding the same trip day was not idempotent");

let rejected = false;
try { validateTripDay({ date: "2026-11-12", city: "Hyannis", timeZone: "America/New_York", mediaKey: "Hyannis_CapeCod" }); }
catch (error) { rejected = error.status === 400; }
assert(rejected, "A non-kebab-case destination key was accepted");

console.log(JSON.stringify({ ok: true, sorted: true, idempotent: true, destinationKeyValidated: true }));
