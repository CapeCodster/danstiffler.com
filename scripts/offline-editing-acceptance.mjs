import assert from "node:assert/strict";
import { queuePendingMutation, reconcileSyncResult, removalPolicy } from "../trip/js/pending-sync.js";

const firstEdit = {
  mutationId: "mutation-0001",
  activityId: "peak-tram",
  kind: "update",
  baseRevision: 123,
  changedAt: "2026-11-05T14:00:00.000Z",
  changes: { start: "08:15" },
};
const secondEdit = {
  mutationId: "mutation-0002",
  activityId: "peak-tram",
  kind: "update",
  baseRevision: 999,
  changedAt: "2026-11-05T14:01:00.000Z",
  changes: { title: "Peak Tram morning" },
};
const coalesced = queuePendingMutation(queuePendingMutation([], firstEdit), secondEdit);
assert.equal(coalesced.length, 1, "Repeated offline edits should coalesce");
assert.equal(coalesced[0].baseRevision, 123, "Coalesced edits must retain the revision first edited offline");
assert.deepEqual(coalesced[0].changes, { start: "08:15", title: "Peak Tram morning" });

const addition = {
  mutationId: "mutation-0003",
  activityId: "custom-test-activity",
  kind: "add",
  baseRevision: 0,
  changedAt: "2026-11-05T14:02:00.000Z",
  activity: { custom: true, dayDate: "2026-11-20", title: "Added offline", start: "15:00", end: "16:00" },
};
const editedAddition = queuePendingMutation([addition], {
  mutationId: "mutation-0004",
  activityId: addition.activityId,
  kind: "update",
  baseRevision: 0,
  changedAt: "2026-11-05T14:03:00.000Z",
  changes: { venue: "Hotel lobby" },
});
assert.equal(editedAddition[0].kind, "add", "Editing an unsynced addition should remain one add mutation");
assert.equal(editedAddition[0].activity.venue, "Hotel lobby");
const deletedAddition = queuePendingMutation(editedAddition, {
  mutationId: "mutation-0005",
  activityId: addition.activityId,
  kind: "delete",
  baseRevision: 0,
  changedAt: "2026-11-05T14:04:00.000Z",
});
assert.equal(deletedAddition.length, 0, "Deleting an activity added only offline should leave no server mutation");

const sync = reconcileSyncResult([firstEdit, addition], {
  applied: [{ mutationId: firstEdit.mutationId, activityId: firstEdit.activityId, revision: 456 }],
  conflicts: [{
    mutationId: addition.mutationId,
    activityId: addition.activityId,
    serverRevision: 789,
    server: { title: "Other traveller's version" },
  }],
});
assert.equal(sync.pending.length, 0, "Applied and conflicting mutations must leave the retry queue");
assert.equal(sync.conflicts.length, 1, "Conflicting edits must be retained for explicit review");
assert.equal(sync.conflicts[0].mutation.activity.title, "Added offline", "Conflict review must retain the offline version");

assert.deepEqual(removalPolicy({ pendingCount: 0, conflictCount: 0 }), { allowed: true, reason: "synced", unsyncedCount: 0 });
assert.equal(removalPolicy({ pendingCount: 1, conflictCount: 0, pendingChangedAt: "2026-11-05T14:00:00Z" }).allowed, false, "Unsynced changes must block local removal");
assert.equal(removalPolicy({
  pendingCount: 1,
  conflictCount: 1,
  pendingChangedAt: "2026-11-05T14:00:00Z",
  pendingExportedAt: "2026-11-05T14:05:00Z",
}).reason, "exported", "A deliberate export must permit removal");
assert.equal(removalPolicy({ pendingCount: 0, conflictCount: 0 }).allowed, true, "Explicitly discarded changes must permit removal");
assert.equal(removalPolicy({
  pendingCount: 1,
  conflictCount: 0,
  pendingChangedAt: "2026-11-05T14:10:00Z",
  pendingExportedAt: "2026-11-05T14:05:00Z",
}).allowed, false, "A change made after export must protect removal and archiving again");

console.log(JSON.stringify({
  ok: true,
  coalescedOfflineEdits: true,
  offlineAddEditDelete: true,
  conflictsRetainedForReview: true,
  removalBlockedUntilSyncExportOrDiscard: true,
  newerEditInvalidatesPriorExport: true,
}));
