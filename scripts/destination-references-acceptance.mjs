import assert from "node:assert/strict";
import {
  destinationReferenceChoices,
  destinationReferenceOfflineState,
  destinationReferencesForCity,
} from "../trip/js/destination-references.js";

const singaporeReference = {
  id: "singapore-offline-maps",
  title: "Singapore Offline Maps",
  destinations: ["Singapore"],
  publishedAt: "2026-11-11T23:30:00.000Z",
  requiredOffline: true,
  document: {
    url: "/api/trip/document/doc-singapore-offline-maps",
    label: "Open Singapore Maps",
    filename: "Singapore_Offline_Maps.pdf",
  },
};
const hongKongReference = {
  id: "hong-kong-offline-maps",
  title: "Hong Kong Offline Maps",
  destinations: ["Hong Kong"],
  publishedAt: singaporeReference.publishedAt,
  requiredOffline: true,
  document: {
    url: "/api/trip/document/doc-hong-kong-offline-maps",
    label: "Open Hong Kong Maps",
    filename: "Hong_Kong_Offline_Maps.pdf",
  },
};
const trip = { destinationReferences: [singaporeReference, hongKongReference] };

assert.equal(destinationReferencesForCity(trip, "Singapore").length, 1);
assert.equal(destinationReferencesForCity(trip, "Seoul → Singapore").length, 1);
assert.equal(destinationReferencesForCity(trip, "Hong Kong").length, 1);
assert.equal(destinationReferencesForCity(trip, "Singapore → Hong Kong").length, 2);
assert.equal(destinationReferencesForCity(trip, "At sea aboard Westerdam").length, 0);

const choices = destinationReferenceChoices(trip);
assert.equal(choices.length, 2);
assert.equal(choices[0].required, true, "Reference maps must always be included in a saved offline trip");
assert.match(choices[0].detail, /always included/);

assert.equal(destinationReferenceOfflineState(singaporeReference), "not-downloaded");
assert.equal(destinationReferenceOfflineState(singaporeReference, {
  offlineSummary: { syncedAt: "2026-11-11T22:00:00.000Z" },
}), "update", "A saved trip from before the map was published must request an update");
assert.equal(destinationReferenceOfflineState(singaporeReference, {
  offlineSummary: { syncedAt: "2026-11-12T00:00:00.000Z" },
}), "ready");
assert.equal(destinationReferenceOfflineState(singaporeReference, {
  offlineMode: true,
  offlineAssets: new Map([[singaporeReference.document.url, new Blob(["pdf"], { type: "application/pdf" })]]),
}), "ready", "The reopened offline package must contain the actual PDF blob");
assert.equal(destinationReferenceOfflineState(singaporeReference, {
  offlineMode: true,
  offlineAssets: new Map(),
}), "missing");

console.log(JSON.stringify({
  ok: true,
  cityMatching: true,
  transitionDayMatching: true,
  requiredOfflineReference: true,
  stalePackageDetection: true,
  reopenedBlobVerification: true,
}));
