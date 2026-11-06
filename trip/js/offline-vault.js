const DB_NAME = "my-travels-private-offline-v1";
const DB_VERSION = 1;
const VAULT_STORE = "vaults";
const SECRET_STORE = "device-secrets";
const DEVICE_KEY_ID = "offline-hmac-key";
const VAULT_VERSION = 1;
const KEY_ITERATIONS = 500000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class OfflineVaultError extends Error {
  constructor(message, code = "OFFLINE_VAULT_ERROR") {
    super(message);
    this.name = "OfflineVaultError";
    this.code = code;
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
}

async function openDatabase() {
  if (!("indexedDB" in globalThis) || !globalThis.crypto?.subtle) {
    throw new OfflineVaultError("This browser cannot create an encrypted offline trip.", "UNSUPPORTED");
  }
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.addEventListener("upgradeneeded", () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(VAULT_STORE)) database.createObjectStore(VAULT_STORE, { keyPath: "traveller" });
    if (!database.objectStoreNames.contains(SECRET_STORE)) database.createObjectStore(SECRET_STORE, { keyPath: "id" });
  });
  return requestResult(request);
}

async function getDeviceKey(database) {
  const read = database.transaction(SECRET_STORE, "readonly");
  const existing = await requestResult(read.objectStore(SECRET_STORE).get(DEVICE_KEY_ID));
  await transactionDone(read);
  if (existing?.key) return existing.key;

  const key = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
  const write = database.transaction(SECRET_STORE, "readwrite");
  write.objectStore(SECRET_STORE).put({ id: DEVICE_KEY_ID, key, createdAt: new Date().toISOString() });
  await transactionDone(write);
  return key;
}

async function deriveVaultKey(deviceKey, code, salt) {
  if (!/^\d{6}$/.test(String(code))) {
    throw new OfflineVaultError("Enter the traveller’s six-digit code.", "INVALID_CODE_FORMAT");
  }
  const deviceBoundMaterial = await crypto.subtle.sign("HMAC", deviceKey, encoder.encode(String(code)));
  const baseKey = await crypto.subtle.importKey("raw", deviceBoundMaterial, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: KEY_ITERATIONS,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function associatedData(traveller, item) {
  return encoder.encode(`my-travels:${VAULT_VERSION}:${traveller}:${item}`);
}

async function encrypt(key, bytes, traveller, item) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: associatedData(traveller, item), tagLength: 128 },
    key,
    bytes,
  );
  return { iv, ciphertext };
}

async function decrypt(key, encrypted, traveller, item) {
  return crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: encrypted.iv,
      additionalData: associatedData(traveller, item),
      tagLength: 128,
    },
    key,
    encrypted.ciphertext,
  );
}

function opaqueId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getOfflineSummary(traveller) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(VAULT_STORE, "readonly");
    const record = await requestResult(transaction.objectStore(VAULT_STORE).get(String(traveller)));
    await transactionDone(transaction);
    if (!record) return null;
    return {
      traveller: record.traveller,
      syncedAt: record.syncedAt,
      documentCount: Number(record.documentCount ?? record.ticketCount ?? 0),
      ticketCount: Number(record.ticketCount || 0),
      assetCount: Number(record.assets?.length || 0),
      pendingCount: Number(record.pendingCount || 0),
      conflictCount: Number(record.conflictCount || 0),
      pendingChangedAt: record.pendingChangedAt || null,
      pendingExportedAt: record.pendingExportedAt || null,
      version: record.version,
    };
  } finally {
    database.close();
  }
}

export async function saveOfflineVault({ traveller, code, itinerary, overrides, revisions = {}, assets }) {
  const normalizedTraveller = String(traveller);
  const database = await openDatabase();
  try {
    const deviceKey = await getDeviceKey(database);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveVaultKey(deviceKey, code, salt);
    const syncedAt = new Date().toISOString();
    const assetMetadata = [];
    const encryptedAssets = [];

    for (const asset of assets) {
      const id = opaqueId();
      const bytes = await asset.blob.arrayBuffer();
      const encrypted = await encrypt(key, bytes, normalizedTraveller, `asset:${id}`);
      assetMetadata.push({
        id,
        url: asset.url,
        name: asset.name,
        type: asset.blob.type || asset.type || "application/octet-stream",
        kind: asset.kind,
      });
      encryptedAssets.push({ id, ...encrypted });
    }

    const payload = encoder.encode(JSON.stringify({
      itinerary,
      overrides,
      revisions,
      pendingChanges: [],
      conflicts: [],
      pendingChangedAt: null,
      pendingExportedAt: null,
      assets: assetMetadata,
      syncedAt,
    }));
    const encryptedPayload = await encrypt(key, payload, normalizedTraveller, "payload");
    const record = {
      traveller: normalizedTraveller,
      version: VAULT_VERSION,
      syncedAt,
      documentCount: assetMetadata.filter((asset) => asset.kind !== "media").length,
      ticketCount: assetMetadata.filter((asset) => asset.kind === "ticket").length,
      pendingCount: 0,
      conflictCount: 0,
      pendingChangedAt: null,
      pendingExportedAt: null,
      salt,
      payload: encryptedPayload,
      assets: encryptedAssets,
    };

    const transaction = database.transaction(VAULT_STORE, "readwrite");
    transaction.objectStore(VAULT_STORE).put(record);
    await transactionDone(transaction);
    return getOfflineSummary(normalizedTraveller);
  } catch (error) {
    if (error?.name === "QuotaExceededError") {
      throw new OfflineVaultError("This device does not have enough browser storage for the selected documents.", "QUOTA");
    }
    if (error instanceof OfflineVaultError) throw error;
    throw new OfflineVaultError("The encrypted offline trip could not be saved on this device.", "SAVE_FAILED");
  } finally {
    database.close();
  }
}

export async function unlockOfflineVault(traveller, code) {
  const normalizedTraveller = String(traveller);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(VAULT_STORE, "readonly");
    const record = await requestResult(transaction.objectStore(VAULT_STORE).get(normalizedTraveller));
    await transactionDone(transaction);
    if (!record) throw new OfflineVaultError("No offline trip has been downloaded for this traveller.", "NOT_FOUND");
    if (record.version !== VAULT_VERSION) {
      throw new OfflineVaultError("This offline copy is out of date. Reconnect and download it again.", "VERSION");
    }

    const deviceKey = await getDeviceKey(database);
    const key = await deriveVaultKey(deviceKey, code, record.salt);
    let payload;
    try {
      const plaintext = await decrypt(key, record.payload, normalizedTraveller, "payload");
      payload = JSON.parse(decoder.decode(plaintext));
    } catch {
      throw new OfflineVaultError("That six-digit code did not unlock this device’s offline trip.", "BAD_CODE");
    }

    const encryptedById = new Map(record.assets.map((asset) => [asset.id, asset]));
    const assets = [];
    for (const metadata of payload.assets || []) {
      const encrypted = encryptedById.get(metadata.id);
      if (!encrypted) throw new OfflineVaultError("The offline trip is incomplete. Reconnect and download it again.", "INCOMPLETE");
      let bytes;
      try {
        bytes = await decrypt(key, encrypted, normalizedTraveller, `asset:${metadata.id}`);
      } catch {
        throw new OfflineVaultError("The offline trip is damaged. Reconnect and download it again.", "INCOMPLETE");
      }
      assets.push({ ...metadata, blob: new Blob([bytes], { type: metadata.type }) });
    }
    return {
      itinerary: payload.itinerary,
      overrides: payload.overrides || {},
      revisions: payload.revisions || {},
      pendingChanges: payload.pendingChanges || [],
      conflicts: payload.conflicts || [],
      pendingChangedAt: payload.pendingChangedAt || null,
      pendingExportedAt: payload.pendingExportedAt || null,
      assets,
      syncedAt: payload.syncedAt || record.syncedAt,
      key,
    };
  } finally {
    database.close();
  }
}

export async function rekeyOfflineVault({ traveller, currentCode, newCode }) {
  const normalizedTraveller = String(traveller);
  const database = await openDatabase();
  try {
    const read = database.transaction(VAULT_STORE, "readonly");
    const record = await requestResult(read.objectStore(VAULT_STORE).get(normalizedTraveller));
    await transactionDone(read);
    if (!record) throw new OfflineVaultError("No offline trip has been downloaded for this traveller.", "NOT_FOUND");
    if (record.version !== VAULT_VERSION) {
      throw new OfflineVaultError("This offline copy is out of date. Reconnect and download it again.", "VERSION");
    }

    const deviceKey = await getDeviceKey(database);
    const currentKey = await deriveVaultKey(deviceKey, currentCode, record.salt);
    let payloadBytes;
    const assetBytes = [];
    try {
      payloadBytes = await decrypt(currentKey, record.payload, normalizedTraveller, "payload");
      for (const asset of record.assets || []) {
        assetBytes.push({
          id: asset.id,
          bytes: await decrypt(currentKey, asset, normalizedTraveller, `asset:${asset.id}`),
        });
      }
    } catch {
      throw new OfflineVaultError("The current code did not unlock this device’s offline trip.", "BAD_CODE");
    }

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveVaultKey(deviceKey, newCode, salt);
    const payload = await encrypt(key, payloadBytes, normalizedTraveller, "payload");
    const assets = [];
    for (const asset of assetBytes) {
      assets.push({ id: asset.id, ...await encrypt(key, asset.bytes, normalizedTraveller, `asset:${asset.id}`) });
    }

    // The original record remains untouched until every item has been decrypted
    // and re-encrypted. IndexedDB then replaces it in one atomic transaction.
    const nextRecord = { ...record, salt, payload, assets };
    const write = database.transaction(VAULT_STORE, "readwrite");
    write.objectStore(VAULT_STORE).put(nextRecord);
    await transactionDone(write);
    return {
      summary: {
        traveller: nextRecord.traveller,
        syncedAt: nextRecord.syncedAt,
        documentCount: Number(nextRecord.documentCount ?? nextRecord.ticketCount ?? 0),
        ticketCount: Number(nextRecord.ticketCount || 0),
        assetCount: Number(nextRecord.assets?.length || 0),
        pendingCount: Number(nextRecord.pendingCount || 0),
        conflictCount: Number(nextRecord.conflictCount || 0),
        pendingChangedAt: nextRecord.pendingChangedAt || null,
        pendingExportedAt: nextRecord.pendingExportedAt || null,
        version: nextRecord.version,
      },
      key,
    };
  } catch (error) {
    if (error?.name === "QuotaExceededError") {
      throw new OfflineVaultError("This device does not have enough storage to update the offline unlock code.", "QUOTA");
    }
    if (error instanceof OfflineVaultError) throw error;
    throw new OfflineVaultError("The offline unlock code could not be updated. The existing package was preserved.", "REKEY_FAILED");
  } finally {
    database.close();
  }
}

export async function updateOfflineVaultState({
  traveller,
  key,
  itinerary,
  overrides,
  revisions,
  pendingChanges,
  conflicts,
  pendingChangedAt,
  pendingExportedAt,
  markSynced = false,
}) {
  const normalizedTraveller = String(traveller);
  const database = await openDatabase();
  try {
    const read = database.transaction(VAULT_STORE, "readonly");
    const record = await requestResult(read.objectStore(VAULT_STORE).get(normalizedTraveller));
    await transactionDone(read);
    if (!record) throw new OfflineVaultError("No offline trip has been downloaded for this traveller.", "NOT_FOUND");
    if (!key) throw new OfflineVaultError("Unlock the offline trip before saving local changes.", "LOCKED");

    let existing;
    try {
      const plaintext = await decrypt(key, record.payload, normalizedTraveller, "payload");
      existing = JSON.parse(decoder.decode(plaintext));
    } catch {
      throw new OfflineVaultError("The offline trip must be unlocked again before changes can be saved.", "LOCKED");
    }
    const syncedAt = markSynced ? new Date().toISOString() : (existing.syncedAt || record.syncedAt);
    const nextPayload = {
      ...existing,
      itinerary: itinerary ?? existing.itinerary,
      overrides: overrides ?? existing.overrides ?? {},
      revisions: revisions ?? existing.revisions ?? {},
      pendingChanges: pendingChanges ?? existing.pendingChanges ?? [],
      conflicts: conflicts ?? existing.conflicts ?? [],
      pendingChangedAt: pendingChangedAt ?? null,
      pendingExportedAt: pendingExportedAt ?? null,
      syncedAt,
    };
    const encryptedPayload = await encrypt(
      key,
      encoder.encode(JSON.stringify(nextPayload)),
      normalizedTraveller,
      "payload",
    );
    const nextRecord = {
      ...record,
      syncedAt,
      pendingCount: nextPayload.pendingChanges.length,
      conflictCount: nextPayload.conflicts.length,
      pendingChangedAt: nextPayload.pendingChangedAt,
      pendingExportedAt: nextPayload.pendingExportedAt,
      payload: encryptedPayload,
    };
    const write = database.transaction(VAULT_STORE, "readwrite");
    write.objectStore(VAULT_STORE).put(nextRecord);
    await transactionDone(write);
    return {
      traveller: nextRecord.traveller,
      syncedAt: nextRecord.syncedAt,
      documentCount: Number(nextRecord.documentCount ?? nextRecord.ticketCount ?? 0),
      ticketCount: Number(nextRecord.ticketCount || 0),
      assetCount: Number(nextRecord.assets?.length || 0),
      pendingCount: nextRecord.pendingCount,
      conflictCount: nextRecord.conflictCount,
      pendingChangedAt: nextRecord.pendingChangedAt,
      pendingExportedAt: nextRecord.pendingExportedAt,
      version: nextRecord.version,
    };
  } finally {
    database.close();
  }
}

export async function removeOfflineVault(traveller) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(VAULT_STORE, "readwrite");
    transaction.objectStore(VAULT_STORE).delete(String(traveller));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
