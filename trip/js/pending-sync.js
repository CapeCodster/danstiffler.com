export function queuePendingMutation(pendingChanges, incoming) {
  const pending = pendingChanges.map((item) => structuredClone(item));
  const index = pending.findIndex((item) => item.activityId === incoming.activityId);
  if (index < 0) return [...pending, structuredClone(incoming)];

  const existing = pending[index];
  if (existing.kind === "add") {
    if (incoming.kind === "delete") {
      pending.splice(index, 1);
      return pending;
    }
    if (incoming.kind === "update") {
      pending[index] = {
        ...existing,
        activity: { ...existing.activity, ...incoming.changes },
        changedAt: incoming.changedAt,
      };
      return pending;
    }
  }

  if (existing.kind === "update" && incoming.kind === "update") {
    pending[index] = {
      ...existing,
      changes: { ...existing.changes, ...incoming.changes },
      ...(incoming.activity ? { activity: incoming.activity } : {}),
      changedAt: incoming.changedAt,
    };
    return pending;
  }

  pending[index] = {
    ...structuredClone(incoming),
    mutationId: existing.mutationId,
    baseRevision: existing.baseRevision,
  };
  return pending;
}

export function reconcileSyncResult(pendingChanges, response) {
  const appliedIds = new Set((response.applied || []).map((item) => item.mutationId));
  const conflictIds = new Set((response.conflicts || []).map((item) => item.mutationId));
  return {
    pending: pendingChanges.filter((item) => !appliedIds.has(item.mutationId) && !conflictIds.has(item.mutationId)),
    conflicts: (response.conflicts || []).map((conflict) => ({
      ...conflict,
      mutation: pendingChanges.find((item) => item.mutationId === conflict.mutationId) || null,
      detectedAt: new Date().toISOString(),
    })),
  };
}

export function removalPolicy(summary) {
  const unsyncedCount = Number(summary?.pendingCount || 0) + Number(summary?.conflictCount || 0);
  if (!unsyncedCount) return { allowed: true, reason: "synced", unsyncedCount: 0 };
  const changedAt = Date.parse(summary?.pendingChangedAt || "");
  const exportedAt = Date.parse(summary?.pendingExportedAt || "");
  if (Number.isFinite(changedAt) && Number.isFinite(exportedAt) && exportedAt >= changedAt) {
    return { allowed: true, reason: "exported", unsyncedCount };
  }
  return { allowed: false, reason: "unsynced", unsyncedCount };
}
