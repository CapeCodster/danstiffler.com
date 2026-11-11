function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase("en-US");
}

export function destinationReferences(trip) {
  return Array.isArray(trip?.destinationReferences)
    ? trip.destinationReferences.filter((reference) => reference?.document?.url)
    : [];
}

export function destinationReferencesForCity(trip, city) {
  const cityName = normalized(city);
  if (!cityName) return [];
  return destinationReferences(trip).filter((reference) => (
    Array.isArray(reference.destinations)
    && reference.destinations.some((destination) => cityName.includes(normalized(destination)))
  ));
}

export function destinationReferenceDocuments(trip) {
  return destinationReferences(trip).map((reference) => ({
    ...reference.document,
    referenceId: reference.id,
    referenceTitle: reference.title,
    description: reference.description,
    destinations: reference.destinations || [],
    publishedAt: reference.publishedAt || "",
    requiredOffline: Boolean(reference.requiredOffline),
    previewPages: Array.isArray(reference.previewPages) ? reference.previewPages : [],
  }));
}

export function destinationReferenceChoices(trip) {
  return destinationReferenceDocuments(trip).map((document) => ({
    url: document.url,
    label: document.label || document.filename || document.referenceTitle || "Destination reference",
    detail: `${document.destinations.join(" & ")}${document.requiredOffline ? " · always included" : ""}`,
    kind: "reference",
    required: document.requiredOffline,
  }));
}

export function destinationReferenceOfflineState(reference, { offlineMode, offlineAssets, offlineSummary } = {}) {
  const url = reference?.document?.url || reference?.url;
  if (!url) return "unavailable";
  if (offlineMode) return offlineAssets?.has(url) ? "ready" : "missing";
  if (!offlineSummary?.syncedAt) return "not-downloaded";
  const publishedAt = Date.parse(reference.publishedAt || "");
  const syncedAt = Date.parse(offlineSummary.syncedAt || "");
  if (Number.isFinite(publishedAt) && (!Number.isFinite(syncedAt) || syncedAt < publishedAt)) return "update";
  return "ready";
}
