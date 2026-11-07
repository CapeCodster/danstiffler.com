import assert from "node:assert/strict";
import { activityNeighbors } from "../trip/js/activity-navigation.js";

const first = { id: "drive-to-logan", title: "Drive To Logan Airport" };
const second = { id: "ke92", title: "Korean Air KE92" };
const third = { id: "ke645", title: "Korean Air KE645" };
const days = [
  { date: "2026-11-13", activities: [first, second] },
  { date: "2026-11-14", activities: [third] },
];

assert.deepEqual(activityNeighbors(days, first.id), { previous: null, next: second });
assert.deepEqual(activityNeighbors(days, second.id), { previous: first, next: third });
assert.deepEqual(activityNeighbors(days, third.id), { previous: second, next: null });
assert.deepEqual(activityNeighbors(days, "missing"), { previous: null, next: null });

console.log(JSON.stringify({
  ok: true,
  firstItemHasNext: true,
  crossesDayBoundaries: true,
  itineraryEndsCleanly: true,
}));
