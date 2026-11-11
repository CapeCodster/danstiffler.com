import {
  getOfflineSummary,
  OfflineVaultError,
  rekeyOfflineVault,
  removeOfflineVault,
  saveOfflineVault,
  unlockOfflineVault,
  updateOfflineVaultState,
} from "./offline-vault.js";
import { queuePendingMutation, reconcileSyncResult, removalPolicy } from "./pending-sync.js";
import { destinationPresentation } from "./destination-presentation.js";
import {
  destinationReferenceChoices,
  destinationReferenceDocuments,
  destinationReferenceOfflineState,
  destinationReferences,
  destinationReferencesForCity,
} from "./destination-references.js";
import { activityNeighbors } from "./activity-navigation.js";
import {
  activityTypeFor,
  bookingReferenceFor,
  cityRideServices,
  durationLabel,
  editableActivityId,
  flightJourneySummary,
  materializeActivityDays,
  transitAppleMapsUrl,
  typeDetailsFor,
} from "./activity-model.js";
import {
  accommodationVisibility,
  activityFromForm,
  defaultActivityDraft,
  flightSummaryMarkup,
  nextFlightLeg,
  renderActivityForm,
  renderTypePicker,
  syncFlightSeatVisibility,
} from "./activity-form.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const STORAGE = {
  lastTraveller: "myTravels.lastTraveller.v1",
  overrides: "myTravels.activityOverrides.v1",
  theme: "myTravels.theme.v1",
  offline: "myTravels.offline.v1",
  archived: "myTravels.archivedTrips.v1",
  offlineFailures: "myTravels.offlineFailures.v1",
};

const SERVER_AUTH = location.protocol !== "file:";
const REFERENCE_ACTIVITY_IDS = new Set(["travel-insurance-reference"]);
const isReferenceActivity = (activity) => Boolean(activity?.reference) || REFERENCE_ACTIVITY_IDS.has(activity?.id);

const fallbackData = {
  privateLocalData: false,
  trip: {
    id: "travel-demo",
    name: "Private trip preview",
    start: "2026-11-15",
    end: "2026-11-16",
  },
  days: [
    {
      date: "2026-11-15",
      city: "Trip preview",
      timeZone: "Asia/Singapore",
      activities: [
        {
          id: "demo-arrival",
          start: "09:00",
          end: "10:00",
          title: "Example arrival",
          venue: "Private destination",
          status: "confirmed",
          fixed: true,
          travelMinutes: 20,
          arrivalBufferMinutes: 15,
          whatToWear: "Comfortable travel layers.",
          note: "Real itinerary data is available only in the private local module.",
        },
      ],
    },
    {
      date: "2026-11-16",
      city: "Trip preview",
      timeZone: "Asia/Singapore",
      activities: [
        {
          id: "demo-tour",
          start: "09:00",
          end: "13:00",
          title: "Example private tour",
          venue: "Hotel lobby",
          status: "confirmed",
          fixed: true,
          travelMinutes: 0,
          arrivalBufferMinutes: 10,
          whatToWear: "Walking shoes and weather-ready layers.",
        },
      ],
    },
  ],
  tasks: [
    {
      id: "demo-task",
      title: "Private data is not loaded",
      detail: "Use the Git-ignored itinerary module for the local working prototype.",
      status: "open",
    },
  ],
};

let itinerary = fallbackData;
if (!SERVER_AUTH) {
  try {
    itinerary = (await import("../data/itinerary.local.js")).default;
  } catch (error) {
    console.info("Using the redacted travel preview because the private local itinerary is unavailable.", error.message);
  }
}

const accessScreen = $("#accessScreen");
const appShell = $("#appShell");
const mainContent = $("#mainContent");
const publicEntry = $("#publicEntry");
const leavePrivateTravel = $("#leavePrivateTravel");
const beginSignIn = $("#beginSignIn");
const signInPanel = $("#signInPanel");
const cancelSignIn = $("#cancelSignIn");
const accessForm = $("#accessForm");
const travellerInput = $("#travellerName");
const accessInput = $("#accessCode");
const accessLabel = $("#accessCodeLabel");
const accessSubmit = $("#accessSubmit");
const accessError = $("#accessError");
const rememberDevice = $("#rememberDevice");
const forgotAccessCode = $("#forgotAccessCode");
const accessEyebrow = $("#accessEyebrow");
const accessIntro = $("#accessIntro");
const accessSecurityNote = $("#accessSecurityNote");
const activityDialog = $("#activityDialog");
const activityDialogContent = $("#activityDialogContent");
const recoveryDialog = $("#recoveryDialog");
const recoveryDialogContent = $("#recoveryDialogContent");
const documentDialog = $("#documentDialog");
const documentDialogContent = $("#documentDialogContent");
const profileButton = $("#profileButton");
const appearanceButton = $("#appearanceButton");
const themeColorMeta = $("#themeColor");
const deviceColorScheme = window.matchMedia("(prefers-color-scheme: dark)");
let documentObjectUrl = null;
let documentPreviewObjectUrls = [];
const dialogViewportState = new WeakMap();

const state = {
  traveller: normalizeTraveller(localStorage.getItem(STORAGE.lastTraveller)) || "",
  currentProfile: null,
  view: "today",
  selectedDate: selectInitialDate(),
  editingActivityId: null,
  editingReturnActivityId: null,
  overrides: SERVER_AUTH ? {} : readJson(localStorage.getItem(STORAGE.overrides), {}),
  theme: localStorage.getItem(STORAGE.theme) || "system",
  serviceWorker: null,
  offlineMode: false,
  networkUnavailable: false,
  offlineSummary: null,
  offlineAssets: new Map(),
  offlineObjectUrls: new Map(),
  offlineKey: null,
  revisions: {},
  pendingChanges: [],
  conflicts: [],
  pendingChangedAt: null,
  pendingExportedAt: null,
  activityDrafts: new Map(),
};

applyTheme(state.theme);
configureAccessMode();
registerServiceWorker();
if (SERVER_AUTH) initializeServerAccess();

window.addEventListener("online", () => { void handleReconnect(); });

async function handleReconnect() {
  if (!SERVER_AUTH || !state.offlineMode) return;
  try {
    await fetchJson("/api/trip/session");
    state.networkUnavailable = false;
    if (state.pendingChanges.length || state.conflicts.length) {
      await beginPendingSync();
      return;
    }
    await loadServerItinerary();
    await refreshOfflineSummary();
    unlockApp();
  } catch (error) {
    if (error.status !== 401) return;
    const traveller = state.currentProfile || state.traveller;
    clearOfflineAssets();
    state.currentProfile = null;
    state.offlineMode = false;
    state.networkUnavailable = false;
    itinerary = fallbackData;
    state.overrides = {};
    state.revisions = {};
    state.pendingChanges = [];
    state.conflicts = [];
    appShell.hidden = true;
    accessScreen.hidden = false;
    travellerInput.value = traveller;
    await showSignIn();
    accessError.textContent = "Your server session is no longer valid. Sign in again with the current six-digit code.";
  }
}

async function initializeServerAccess() {
  await refreshOfflineSummary();
  configureAccessMode();
  await restoreServerSession();
}

function readJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function refreshOfflineSummary() {
  if (!SERVER_AUTH || !state.traveller) {
    state.offlineSummary = null;
    return;
  }
  try {
    state.offlineSummary = await getOfflineSummary(state.traveller);
  } catch (error) {
    console.warn("Offline storage status is unavailable", error);
    state.offlineSummary = null;
  }
}

function formatSyncTime(value, compact = false) {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en-US", compact
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function clearOfflineAssets() {
  for (const url of state.offlineObjectUrls.values()) URL.revokeObjectURL(url);
  state.offlineObjectUrls.clear();
  state.offlineAssets.clear();
  state.offlineKey = null;
}

function resolveAssetUrl(url) {
  if (!state.offlineMode || !state.offlineAssets.has(url)) return url;
  if (!state.offlineObjectUrls.has(url)) {
    state.offlineObjectUrls.set(url, URL.createObjectURL(state.offlineAssets.get(url)));
  }
  return state.offlineObjectUrls.get(url);
}

function offlineFailureState() {
  return readJson(localStorage.getItem(STORAGE.offlineFailures), {});
}

function offlineLockRemaining(traveller) {
  const record = offlineFailureState()[traveller];
  return Math.max(0, Math.ceil((Number(record?.lockedUntil || 0) - Date.now()) / 1000));
}

function recordOfflineFailure(traveller) {
  const records = offlineFailureState();
  const record = records[traveller] || { failures: 0, lockedUntil: 0 };
  record.failures += 1;
  if (record.failures >= 5) {
    record.failures = 0;
    record.lockedUntil = Date.now() + (15 * 60 * 1000);
  }
  records[traveller] = record;
  localStorage.setItem(STORAGE.offlineFailures, JSON.stringify(records));
}

function clearOfflineFailures(traveller) {
  const records = offlineFailureState();
  delete records[traveller];
  localStorage.setItem(STORAGE.offlineFailures, JSON.stringify(records));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function listingTitle(value = "") {
  return String(value).replaceAll(/\p{L}[\p{L}\p{M}\p{N}'’]*/gu, (word) => {
    // Preserve acronyms, flight numbers and intentionally mixed-case brands
    // such as JW, KE92, iPhone and eVisa.
    if (/^[A-Z0-9]+$/.test(word) || /[a-z][A-Z]/.test(word)) return word;
    return `${word.charAt(0).toLocaleUpperCase("en-US")}${word.slice(1).toLocaleLowerCase("en-US")}`;
  });
}

function escapeIcs(value = "") {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function selectInitialDate() {
  const first = itinerary.days[0]?.date;
  const last = itinerary.days.at(-1)?.date;
  const requested = new URLSearchParams(location.search).get("date");
  if (requested && itinerary.days.some((day) => day.date === requested)) return requested;
  const today = localIsoDate(new Date(), itinerary.days[0]?.timeZone || "UTC");
  return today >= first && today <= last ? today : first;
}

function normalizeTraveller(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "dan") return "Dan";
  if (normalized === "ken") return "Ken";
  return "";
}

function showPublicEntry({ focus = false } = {}) {
  publicEntry.hidden = false;
  signInPanel.hidden = true;
  accessScreen.setAttribute("aria-labelledby", "publicEntryTitle");
  accessScreen.setAttribute("aria-describedby", "publicEntryDescription");
  accessError.textContent = "";
  accessInput.value = "";
  if (focus) leavePrivateTravel.focus();
}

async function showSignIn() {
  publicEntry.hidden = true;
  signInPanel.hidden = false;
  accessScreen.setAttribute("aria-labelledby", "accessTitle");
  accessScreen.setAttribute("aria-describedby", "accessIntro accessSecurityNote");
  const rememberedTraveller = normalizeTraveller(localStorage.getItem(STORAGE.lastTraveller));
  if (rememberedTraveller && !normalizeTraveller(travellerInput.value)) travellerInput.value = rememberedTraveller;
  state.traveller = normalizeTraveller(travellerInput.value);
  await refreshOfflineSummary();
  configureAccessMode();
  (state.traveller ? accessInput : travellerInput).focus();
}

function configureAccessMode() {
  accessError.textContent = "";
  if (!SERVER_AUTH) {
    accessEyebrow.textContent = "Protected sign in";
    accessIntro.textContent = "This copy is not connected to the protected authentication service.";
    accessSecurityNote.textContent = "Initial credential setup is not available from this public screen.";
    accessLabel.textContent = "Access code";
    accessInput.disabled = true;
    travellerInput.disabled = true;
    rememberDevice.closest("label").hidden = true;
    forgotAccessCode.hidden = true;
    accessSubmit.disabled = true;
    accessSubmit.textContent = "Protected sign-in unavailable";
    return;
  }

  accessInput.disabled = false;
  travellerInput.disabled = false;
  accessSubmit.disabled = false;
  const offlineAvailable = Boolean(state.traveller && state.offlineSummary);
  accessEyebrow.textContent = state.networkUnavailable ? "Encrypted offline access" : "Invited traveler sign in";
  accessIntro.textContent = state.networkUnavailable
    ? (offlineAvailable
      ? `A protected offline copy synced ${formatSyncTime(state.offlineSummary.syncedAt)} is available for the entered traveler.`
      : "No connection is available. Enter the invited traveler name to check this device for a protected offline copy.")
    : `Enter the private credentials supplied to you.${offlineAvailable ? ` This remembered browser also has an encrypted copy synced ${formatSyncTime(state.offlineSummary.syncedAt)}.` : ""}`;
  accessSecurityNote.textContent = state.networkUnavailable
    ? "Offline access accepts the six-digit code only. Recovery codes require a connection."
    : "Credentials are verified by the protected service. A one-time recovery code can reset a forgotten code; it cannot sign in by itself.";
  accessLabel.textContent = "Six-digit code";
  accessSubmit.textContent = state.networkUnavailable ? "Open downloaded trip" : "Sign in";
  if (state.networkUnavailable) {
    accessInput.pattern = "[0-9]{6}";
    accessInput.inputMode = "numeric";
  } else {
    accessInput.pattern = "[0-9]{6}";
    accessInput.inputMode = "numeric";
  }
  accessInput.maxLength = 6;
  rememberDevice.closest("label").hidden = state.networkUnavailable;
  forgotAccessCode.hidden = state.networkUnavailable;
}

function setAccessBusy(isBusy) {
  accessSubmit.disabled = isBusy;
  accessSubmit.textContent = isBusy
    ? "Checking…"
    : (state.networkUnavailable ? "Open downloaded trip" : "Sign in");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function loadServerItinerary() {
  const data = await fetchJson("/api/trip/itinerary");
  clearOfflineAssets();
  state.offlineMode = false;
  state.networkUnavailable = false;
  itinerary = data.itinerary;
  state.overrides = data.overrides || {};
  state.revisions = data.revisions || {};
  state.selectedDate = selectInitialDate();
}

async function restoreServerSession() {
  try {
    const session = await fetchJson("/api/trip/session");
    state.traveller = session.user.displayName;
    await loadServerItinerary();
    await refreshOfflineSummary();
    unlockApp();
    if (Number(state.offlineSummary?.pendingCount || 0) + Number(state.offlineSummary?.conflictCount || 0) > 0) {
      setTimeout(() => showPendingSyncUnlock(), 0);
    }
  } catch (error) {
    if (error.status !== 401) {
      state.networkUnavailable = true;
      await refreshOfflineSummary();
      configureAccessMode();
      accessError.textContent = state.offlineSummary
        ? "The server is unavailable. The protected downloaded trip can still be opened."
        : "The server is unavailable and no downloaded trip is available for the entered traveler on this device.";
    }
  }
}

async function unlockDownloadedTrip(code) {
  const remaining = offlineLockRemaining(state.traveller);
  if (remaining) throw new OfflineVaultError(`Try again in ${remaining} seconds.`, "LOCKED");
  try {
    const bundle = await unlockOfflineVault(state.traveller, code);
    clearOfflineFailures(state.traveller);
    clearOfflineAssets();
    state.offlineMode = true;
    state.networkUnavailable = true;
    itinerary = bundle.itinerary;
    state.overrides = bundle.overrides || {};
    state.offlineAssets = new Map(bundle.assets.map((asset) => [asset.url, asset.blob]));
    state.offlineKey = bundle.key;
    state.revisions = bundle.revisions || {};
    state.pendingChanges = bundle.pendingChanges || [];
    state.conflicts = bundle.conflicts || [];
    state.pendingChangedAt = bundle.pendingChangedAt || null;
    state.pendingExportedAt = bundle.pendingExportedAt || null;
    state.offlineSummary = {
      traveller: state.traveller,
      syncedAt: bundle.syncedAt,
      documentCount: bundle.assets.filter((asset) => asset.kind !== "media").length,
      ticketCount: bundle.assets.filter((asset) => asset.kind === "ticket").length,
      assetCount: bundle.assets.length,
      pendingCount: state.pendingChanges.length,
      conflictCount: state.conflicts.length,
      pendingChangedAt: state.pendingChangedAt,
      pendingExportedAt: state.pendingExportedAt,
    };
    state.selectedDate = selectInitialDate();
    unlockApp();
  } catch (error) {
    if (error?.code === "BAD_CODE") recordOfflineFailure(state.traveller);
    throw error;
  }
}

function unlockApp() {
  state.currentProfile = state.traveller;
  localStorage.setItem(STORAGE.lastTraveller, state.traveller);
  profileButton.textContent = state.traveller === "Dan" ? "DS" : "KS";
  profileButton.setAttribute("aria-label", `${state.traveller} account and settings`);
  accessScreen.hidden = true;
  appShell.hidden = false;
  render();
  requestAnimationFrame(() => mainContent.focus({ preventScroll: true }));
}

async function signOut() {
  if (SERVER_AUTH && !state.offlineMode) {
    try {
      await fetchJson("/api/trip/logout", { method: "POST" });
    } catch (error) {
      console.warn("Server sign-out request failed; closing the local view", error);
    }
  }
  state.currentProfile = null;
  if (SERVER_AUTH) {
    clearOfflineAssets();
    state.offlineMode = false;
    itinerary = fallbackData;
    state.overrides = {};
    state.revisions = {};
    state.pendingChanges = [];
    state.conflicts = [];
    state.selectedDate = selectInitialDate();
  }
  appShell.hidden = true;
  accessScreen.hidden = false;
  showPublicEntry({ focus: true });
}

accessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  accessError.textContent = "";
  const traveller = normalizeTraveller(travellerInput.value);
  const code = accessInput.value.trim();

  if (!SERVER_AUTH) {
    accessError.textContent = "Protected sign-in is unavailable from this copy.";
    return;
  }
  if (!traveller) {
    accessError.textContent = "That traveler or code was not recognized.";
    return;
  }

  state.traveller = traveller;
  await refreshOfflineSummary();
  setAccessBusy(true);
  try {
    if (state.networkUnavailable) {
      await unlockDownloadedTrip(code);
      return;
    }
    const result = await fetchJson("/api/trip/login", {
      method: "POST",
      body: JSON.stringify({ traveller: state.traveller, code, rememberDevice: rememberDevice.checked }),
    });
    state.traveller = result.user.displayName;
    await loadServerItinerary();
    await refreshOfflineSummary();
    unlockApp();
    if (Number(state.offlineSummary?.pendingCount || 0) + Number(state.offlineSummary?.conflictCount || 0) > 0) {
      setTimeout(() => showPendingSyncUnlock(), 0);
    }
  } catch (error) {
    if (!error.status && !state.networkUnavailable) {
      state.networkUnavailable = true;
      await refreshOfflineSummary();
      configureAccessMode();
      if (state.offlineSummary && /^\d{6}$/.test(code)) {
        try {
          await unlockDownloadedTrip(code);
          return;
        } catch (offlineError) {
          accessError.textContent = offlineError.message;
          return;
        }
      }
    }
    accessError.textContent = error.status === 429 || error.code === "LOCKED"
      ? "Too many attempts. Please wait before trying again."
      : (error.status === 401 ? "That traveler or code was not recognized." : error.message || "Private trip access is temporarily unavailable.");
  } finally {
    setAccessBusy(false);
  }
});

function showRecoveryResetDialog() {
  if (!SERVER_AUTH || state.networkUnavailable) {
    accessError.textContent = "Reconnect before using a recovery code.";
    return;
  }
  const traveller = normalizeTraveller(travellerInput.value);
  if (!traveller) {
    accessError.textContent = "Enter Dan or Ken as the traveler name, then choose Forgot your code.";
    travellerInput.focus();
    return;
  }
  state.traveller = traveller;
  recoveryDialog.dataset.clearOnClose = "true";
  recoveryDialogContent.innerHTML = `
    <div class="modal-inner">
      <p class="detail-kicker">Protected account recovery</p>
      <h2>Reset ${escapeHtml(traveller)}’s Code</h2>
      <p class="detail-time">Enter one unused recovery code and choose a replacement six-digit code. ${escapeHtml(traveller)}’s existing server sessions will be signed out; the other traveler is not affected.</p>
      <form id="recoveryResetForm" class="edit-form">
        <label for="recoveryResetCode">One-time recovery code<input id="recoveryResetCode" name="recoveryCode" type="password" maxlength="13" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required></label>
        <label for="recoveryNewCode">New six-digit code<input id="recoveryNewCode" name="newCode" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" required></label>
        <label for="recoveryConfirmCode">Confirm new code<input id="recoveryConfirmCode" name="confirmCode" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" required></label>
        <p class="form-error" data-recovery-reset-error role="alert"></p>
        <div class="button-row"><button class="primary-button" type="submit">Reset code</button><button class="secondary-button" type="button" data-cancel-recovery-reset>Cancel</button></div>
      </form>
      <details class="help-disclosure"><summary>What happens on other devices?</summary><p>Connected devices lose their server sessions and must sign in with the new code. An offline package stored on a disconnected device cannot receive an immediate revocation; it remains encrypted with its previous offline code until that device reconnects and its saved package is replaced or re-encrypted.</p></details>
    </div>`;
  const form = $("#recoveryResetForm", recoveryDialogContent);
  $('[data-cancel-recovery-reset]', form).addEventListener("click", () => closeDialog(recoveryDialog));
  form.addEventListener("submit", resetForgottenCode);
  openDialog(recoveryDialog);
}

async function resetForgottenCode(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const recoveryCode = values.get("recoveryCode")?.trim() || "";
  const newCode = values.get("newCode")?.trim() || "";
  const confirmCode = values.get("confirmCode")?.trim() || "";
  const errorBox = $('[data-recovery-reset-error]', form);
  const submit = $('button[type="submit"]', form);
  errorBox.textContent = "";
  if (newCode !== confirmCode) {
    errorBox.textContent = "The new codes do not match.";
    return;
  }
  submit.disabled = true;
  submit.textContent = "Resetting…";
  try {
    const result = await fetchJson("/api/trip/recovery-reset", {
      method: "POST",
      body: JSON.stringify({
        traveller: state.traveller,
        recoveryCode,
        newCode,
        rememberDevice: rememberDevice.checked,
      }),
    });
    form.reset();
    delete recoveryDialog.dataset.clearOnClose;
    closeDialog(recoveryDialog);
    state.traveller = result.user.displayName;
    await loadServerItinerary();
    await refreshOfflineSummary();
    unlockApp();
    const offlineMessage = state.offlineSummary
      ? " This device’s existing offline package still uses its previous offline code. Replace the saved package while connected; if it contains unsynced edits, recover or export them before replacing it."
      : "";
    showNotice(
      `The six-digit code was reset. All earlier ${state.currentProfile} server sessions were signed out; other devices must authenticate again when they reconnect.${offlineMessage}`,
      { title: "Access restored" },
    );
  } catch (error) {
    errorBox.textContent = error.status === 401
      ? "That traveler or recovery code was not recognized."
      : (error.status === 429 ? "Too many attempts. Please wait before trying again." : error.message);
    submit.disabled = false;
    submit.textContent = "Reset code";
  }
}

beginSignIn.addEventListener("click", showSignIn);
cancelSignIn.addEventListener("click", () => showPublicEntry({ focus: true }));
forgotAccessCode.addEventListener("click", showRecoveryResetDialog);
travellerInput.addEventListener("change", async () => {
  state.traveller = normalizeTraveller(travellerInput.value);
  await refreshOfflineSummary();
  configureAccessMode();
});

function openDialog(dialog) {
  if (dialog.open) return;
  dialogViewportState.set(dialog, { left: window.scrollX, top: window.scrollY });
  dialog.scrollTop = 0;
  dialog.showModal();
  requestAnimationFrame(() => { dialog.scrollTop = 0; });
}

function blurDialogControl(dialog) {
  const active = document.activeElement;
  if (active instanceof HTMLElement && dialog.contains(active)) active.blur();
}

function settleDialogViewport(dialog, saved = dialogViewportState.get(dialog)) {
  if (!saved) return Promise.resolve();
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo(saved.left, saved.top);
      document.documentElement.scrollLeft = 0;
      document.body.scrollLeft = 0;
      resolve();
    }));
  });
}

function closeDialog(dialog) {
  blurDialogControl(dialog);
  if (dialog.open) dialog.close();
}

async function closeDialogAndSettle(dialog) {
  const saved = dialogViewportState.get(dialog);
  closeDialog(dialog);
  await settleDialogViewport(dialog, saved);
}

function showNotice(message, { title = "My Travels", action = "Done" } = {}) {
  recoveryDialogContent.innerHTML = `
    <div class="modal-inner notice-content">
      <p class="detail-kicker">My Travels</p>
      <h2>${escapeHtml(listingTitle(title))}</h2>
      <p class="detail-time">${escapeHtml(message)}</p>
      <div class="button-row"><button class="primary-button" type="button" data-notice-done>${escapeHtml(action)}</button></div>
    </div>`;
  $('[data-notice-done]', recoveryDialogContent).addEventListener("click", () => closeDialog(recoveryDialog));
  openDialog(recoveryDialog);
}

$$('[data-close-dialog]').forEach((button) => {
  button.addEventListener("click", () => closeDialog(button.closest("dialog")));
});

[activityDialog, recoveryDialog, documentDialog].forEach((dialog) => {
  dialog.addEventListener("cancel", () => blurDialogControl(dialog));
  dialog.addEventListener("close", () => { void settleDialogViewport(dialog); });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
});

recoveryDialog.addEventListener("close", () => {
  if (recoveryDialog.dataset.clearOnClose !== "true") return;
  recoveryDialogContent.replaceChildren();
  delete recoveryDialog.dataset.clearOnClose;
});

function applyTheme(theme) {
  state.theme = theme;
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
  localStorage.setItem(STORAGE.theme, theme);
  updateAppearanceControl();
}

function resolvedTheme() {
  return state.theme === "system" ? (deviceColorScheme.matches ? "dark" : "light") : state.theme;
}

function updateAppearanceControl() {
  const resolved = resolvedTheme();
  const label = state.theme === "system" ? `Follow device, currently ${titleCase(resolved)}` : titleCase(state.theme);
  appearanceButton.textContent = state.theme === "system" ? "◐" : (state.theme === "dark" ? "☾" : "☀︎");
  appearanceButton.title = `Appearance: ${label}`;
  appearanceButton.setAttribute("aria-label", `Appearance: ${label}`);
  themeColorMeta.content = resolved === "dark" ? "#06192d" : "#fbf7f1";
}

function cycleTheme() {
  const themes = ["system", "light", "dark"];
  applyTheme(themes[(themes.indexOf(state.theme) + 1) % themes.length]);
  if (state.view === "more") render();
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

appearanceButton.addEventListener("click", cycleTheme);
deviceColorScheme.addEventListener("change", () => {
  if (state.theme !== "system") return;
  updateAppearanceControl();
  if (state.view === "more") render();
});
profileButton.addEventListener("click", () => {
  state.view = "more";
  render();
});

$$('.nav-item').forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    render();
  });
});

function getAllDays() {
  return materializeActivityDays(itinerary.days, state.overrides).days;
}

function getDays() {
  return getAllDays().map((day) => ({
    ...day,
    activities: day.activities.filter((activity) => !isReferenceActivity(activity)),
  }));
}

function getReferenceActivities() {
  return getAllDays().flatMap((day) => day.activities).filter(isReferenceActivity);
}

function findActivity(id) {
  const materialized = materializeActivityDays(itinerary.days, state.overrides);
  return materialized.projections.find((activity) => activity.id === id)
    || materialized.roots.get(editableActivityId(id));
}

function findEditableActivity(activityOrId) {
  return materializeActivityDays(itinerary.days, state.overrides).roots.get(editableActivityId(activityOrId));
}

function localIsoDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function formatDay(date, options = {}) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: options.short ? "short" : "long",
    month: options.short ? "short" : "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

function timeLabel(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" })
    .format(new Date(2000, 0, 1, hours, minutes));
}

function activityStartLabel(activity) {
  return activity.startLabel || timeLabel(activity.start);
}

function activityEndLabel(activity) {
  return activity.endLabel || timeLabel(activity.end);
}

function activityTimeRange(activity) {
  return activity.displayTime || `${activityStartLabel(activity)}–${activityEndLabel(activity)}`;
}

function tripTimeZoneLabel(timeZone) {
  return {
    "America/New_York": "Eastern Time",
    "Asia/Seoul": "Korea Time",
    "Asia/Singapore": "Singapore Time",
    "Asia/Hong_Kong": "Hong Kong Time",
    "Asia/Ho_Chi_Minh": "Vietnam Time",
    "Asia/Phnom_Penh": "Cambodia Time",
    "Asia/Bangkok": "Thailand Time",
  }[timeZone] || timeZone;
}

function minutesFromTime(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours * 60) + minutes;
}

function timeFromMinutes(total) {
  const normalized = (total + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return timeLabel(`${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`);
}

function leaveBy(activity) {
  const lead = Number(activity.travelMinutes || 0) + Number(activity.arrivalBufferMinutes || 0);
  if (!lead) return null;
  return timeFromMinutes(minutesFromTime(activity.start) - lead);
}

function statusLabel(status) {
  return {
    awaiting: "Awaiting confirmation",
    planned: "Planned",
    purchased: "Purchased",
    confirmed: "Confirmed",
    done: "Done",
    skipped: "Skipped",
    cancelled: "Cancelled",
  }[status] || titleCase(status);
}

function mediaFor(key) {
  return itinerary.trip.media?.[key] || {};
}

function renderPhotoPair(media, className, alt) {
  if (!media.day && !media.night) return "";
  return `<div class="${className}" aria-hidden="true">
    ${media.day ? `<img class="theme-photo theme-photo--day" src="${escapeHtml(resolveAssetUrl(media.day))}" alt="${escapeHtml(alt)}">` : ""}
    ${media.night ? `<img class="theme-photo theme-photo--night" src="${escapeHtml(resolveAssetUrl(media.night))}" alt="${escapeHtml(alt)}">` : ""}
  </div>`;
}

function carIcon() {
  return `<svg class="action-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M6 15.5 9 9h14l3 6.5M4 16h24v8H4zM8 24v3M24 24v3M8.5 19.5h.01M23.5 19.5h.01"></path></svg>`;
}

function isPrebookedJourney(activity) {
  const root = findEditableActivity(activity) || activity;
  return Boolean(root.transfer?.prebooked)
    || new Set(["sin-transfer", "hkg-transfer", "kai-tak"]).has(editableActivityId(activity))
    || /\b(airport pickup|car to|transfer to)\b/i.test(activity.title || "");
}

function destinationFor(activity) {
  const knownJourneyDestinations = {
    "sin-transfer": "Singapore Changi Airport",
    "hkg-transfer": "JW Marriott Hotel Hong Kong, 88 Queensway, Admiralty, Hong Kong",
    "kai-tak": "Kai Tak Cruise Terminal, 33 Shing Fung Road, Kowloon, Hong Kong",
  };
  const root = findEditableActivity(activity) || activity;
  return root.transfer?.dropoff
    || root.transit?.to
    || knownJourneyDestinations[editableActivityId(activity)]
    || activity.address
    || activity.venue
    || activity.title;
}

function transportFor(activity) {
  const root = findEditableActivity(activity) || activity;
  const prebooked = isPrebookedJourney(root);
  const services = cityRideServices(activity.city, itinerary.trip.transportDefaults || {});
  const requestedService = root.transfer?.service;
  const name = prebooked ? (root.transfer?.backupServices?.[0] || services[0]) : (requestedService || services[0]);
  const destination = destinationFor(activity);
  const journeyNicknames = {
    "sin-transfer": "Singapore Changi Airport",
    "hkg-transfer": "JW Marriott Hotel Hong Kong",
    "kai-tak": "Kai Tak Cruise Terminal",
  };
  const nickname = journeyNicknames[editableActivityId(activity)] || root.transfer?.dropoff || activity.venue || activity.title;
  const uberParameters = new URLSearchParams({
    action: "setPickup",
    pickup: "my_location",
    "dropoff[nickname]": nickname,
    "dropoff[formatted_address]": destination,
  });
  const url = name.toLowerCase().includes("grab")
    ? "https://www.grab.com/sg/transport/"
    : `https://m.uber.com/ul/?${uberParameters}`;
  return { name, url, destination, passesDestination: name.toLowerCase().includes("uber"), isBackup: prebooked };
}

function directionsFor(activity) {
  if (activityTypeFor(activity) === "transit") return transitAppleMapsUrl(findEditableActivity(activity) || activity);
  const parameters = new URLSearchParams({
    destination: activity.address || activity.venue || activity.title,
    mode: "driving",
  });
  return `https://maps.apple.com/directions?${parameters}`;
}

function render() {
  $$('.nav-item').forEach((button) => button.classList.toggle("is-active", button.dataset.view === state.view));
  if (state.view === "today") renderToday();
  if (state.view === "itinerary") renderItinerary();
  if (state.view === "tickets") renderTickets();
  if (state.view === "more") renderMore();
  bindRenderedEvents();
}

function renderToday() {
  const days = getDays();
  const day = days.find((item) => item.date === state.selectedDate) || days[0];
  const now = new Date();
  const actualDate = localIsoDate(now, day.timeZone);
  const isActualToday = day.date === actualDate;
  const isFutureDate = day.date > actualDate;
  const destination = destinationPresentation(day, now, isActualToday);
  const dayContext = isActualToday ? "Today" : (isFutureDate ? "Future trip day" : "Past trip day");
  const heroTime = isActualToday
    ? new Intl.DateTimeFormat("en-US", { timeZone: destination.timeZone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(now)
    : `Trip day preview · ${tripTimeZoneLabel(day.timeZone)}`;
  const activities = day.activities;
  const next = isActualToday ? nextActivity(day, now) : activities.find(isActiveActivity);
  const featured = next || (!isActualToday ? activities[0] : null);
  const featuredIndex = featured ? activities.findIndex((activity) => activity.id === featured.id) : -1;
  const later = isActualToday && featuredIndex >= 0
    ? activities.slice(featuredIndex + 1)
    : activities.filter((activity) => activity.id !== featured?.id);
  const featureLabel = isActualToday ? "Up next" : (isFutureDate ? "First activity" : "Trip day");
  const laterHeading = isActualToday ? "Later Today" : "Later that day";
  const heroMedia = mediaFor(destination.mediaKey);
  const unsyncedCount = Number(state.offlineSummary?.pendingCount || 0) + Number(state.offlineSummary?.conflictCount || 0);
  const availabilityLabel = state.offlineMode
    ? `Offline${unsyncedCount ? ` · ${unsyncedCount} pending` : ""} · synced ${formatSyncTime(state.offlineSummary?.syncedAt, true)}`
    : (state.offlineSummary
      ? `Ready offline${unsyncedCount ? ` · ${unsyncedCount} pending` : ""} · synced ${formatSyncTime(state.offlineSummary.syncedAt, true)}`
      : (SERVER_AUTH ? "Protected online · not downloaded" : "Offline download available"));

  mainContent.innerHTML = `
    <section class="hero-panel">
      ${renderPhotoPair(heroMedia, "hero-photo", `${destination.city} skyline`)}
      <div class="hero-content">
        <h1>${escapeHtml(destination.city)}</h1>
        <p class="hero-meta">${escapeHtml(formatDay(day.date))}</p>
        <p class="hero-time">${escapeHtml(heroTime)}</p>
      </div>
    </section>
    <div class="readiness-row">
      <span class="offline-pill ${state.offlineMode || state.offlineSummary ? "is-ready" : ""}">${availabilityLabel}</span>
      <span class="day-context ${isActualToday ? "is-today" : ""}">${escapeHtml(dayContext)}</span>
    </div>
    <div class="view-content today-content">
      ${renderDestinationReferencesForDay(day)}
      ${featured ? renderFeaturedActivity(featured, featureLabel) : '<div class="empty-state">No more activities are scheduled today.</div>'}
      ${later.length ? `<section class="later-section"><h2>${laterHeading}</h2><div class="later-list">${later.map(renderLaterActivity).join("")}</div></section>` : ""}
    </div>`;
}

function isActiveActivity(activity) {
  return !["done", "skipped", "cancelled"].includes(activity.status);
}

function renderFeaturedActivity(activity, label) {
  const leave = leaveBy(activity);
  const transport = transportFor(activity);
  const prebooked = isPrebookedJourney(activity);
  const shipSchedule = activity.kind === "ship";
  return `<article class="featured-activity">
    <div class="feature-card-main">
      <span class="feature-label">${escapeHtml(label)}</span>
      <span class="feature-icon" aria-hidden="true"><svg viewBox="0 0 32 32"><circle cx="16" cy="8" r="4"></circle><path d="M9 27v-7a7 7 0 0 1 14 0v7M24 6l5 3-5 3V6Z"></path></svg></span>
      <div class="feature-copy"><h2>${escapeHtml(listingTitle(activity.title))}</h2><p>${escapeHtml(activityTimeRange(activity))}${activity.party ? ` · ${escapeHtml(activity.party)}` : ""}</p><span>${escapeHtml(activity.venue || activity.city)}</span></div>
    </div>
    ${prebooked ? `<div class="transfer-priority">${carIcon()}<div><strong>${activity.status === "awaiting" ? "Prebooked transfer · confirmation pending" : "Prebooked transfer"}</strong><small>Pickup: ${escapeHtml(activity.meetingPoint || activity.venue || activity.city)}</small></div></div>` : ""}
    ${leave ? `<div class="leave-banner"><span aria-hidden="true">⌁</span><div><strong>Leave by ${escapeHtml(leave)}</strong><small>Reminder at ${escapeHtml(timeFromMinutes(minutesFromTime(activity.start) - Number(activity.travelMinutes || 0) - Number(activity.arrivalBufferMinutes || 0) - 15))}</small></div></div>` : ""}
    <div class="feature-actions ${shipSchedule ? "feature-actions--single" : ""}">
      ${shipSchedule ? "" : `<a class="outline-action" href="${directionsFor(activity)}" target="_blank" rel="noopener">↗ <span>Directions</span></a>
      <button class="outline-action" type="button" data-transport-activity="${escapeHtml(activity.id)}">${carIcon()}<span>${prebooked ? "Backup " : ""}${transport.name}</span></button>`}
      <button class="outline-action" type="button" data-activity-id="${escapeHtml(activity.id)}">ⓘ <span>Details</span></button>
    </div>
  </article>`;
}

function renderLaterActivity(activity) {
  return `<button class="later-row ${["cancelled", "skipped"].includes(activity.status) ? "is-dimmed" : ""}" type="button" data-activity-id="${escapeHtml(activity.id)}">
    <strong>${escapeHtml(activityStartLabel(activity))}</strong><span>${escapeHtml(listingTitle(activity.title))}</span>${activity.ticket ? '<span class="mini-ticket" aria-label="Ticket available">▱</span>' : ""}<span class="chevron" aria-hidden="true">›</span>
  </button>`;
}

function nextActivity(day, now = new Date()) {
  const today = localIsoDate(now, day.timeZone);
  if (day.date !== today) return null;
  const nowParts = new Intl.DateTimeFormat("en-US", {
    timeZone: day.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const map = Object.fromEntries(nowParts.map((part) => [part.type, part.value]));
  const currentMinutes = (Number(map.hour) * 60) + Number(map.minute);
  return day.activities.find((activity) => {
    if (!isActiveActivity(activity)) return false;
    if (activity.endUtc) return new Date(activity.endUtc) >= now;
    return minutesFromTime(activity.end) >= currentMinutes;
  });
}

function renderDayStrip(days, activeDate) {
  return `<div class="day-strip" aria-label="Trip days">${days.map((day) => {
    const date = new Date(`${day.date}T12:00:00Z`);
    const dow = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);
    const dom = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" }).format(date);
    return `<button class="day-button ${day.date === activeDate ? "is-active" : ""}" type="button" data-select-date="${day.date}"><span class="dow">${dow}</span><span class="dom">${dom}</span></button>`;
  }).join("")}</div>`;
}

function renderActivityCard(activity, highlighted = false) {
  const leave = leaveBy(activity);
  const connection = activity.connection;
  return `
    <button class="activity-card ${highlighted ? "is-highlighted" : ""} ${["cancelled", "skipped"].includes(activity.status) ? "is-dimmed" : ""}" type="button" data-activity-id="${escapeHtml(activity.id)}">
      <span class="time-block"><strong>${escapeHtml(activityStartLabel(activity))}</strong><span>${escapeHtml(activityEndLabel(activity))}</span></span>
      <span class="activity-main">
        <h3>${escapeHtml(listingTitle(activity.title))}</h3>
        <p>${escapeHtml(activity.venue || activity.city)}</p>
        <span class="status-badge" data-status="${escapeHtml(activity.status)}">${escapeHtml(statusLabel(activity.status))}</span>
        ${leave ? `<span class="card-leave">Leave by ${escapeHtml(leave)}</span>` : ""}
        ${connection ? `<span class="connection-label${connection.needsReview ? " needs-review" : ""}">${escapeHtml(`${durationLabel(connection.durationMinutes)} at ${connection.hub}${connection.overnight ? " · Overnight" : ""}${connection.airportChange ? " · Airport Change" : ""}`)}</span>` : ""}
      </span>
      <span class="chevron" aria-hidden="true">›</span>
    </button>`;
}

function activityDocuments(activity) {
  const root = findEditableActivity(activity) || activity;
  const documents = [
    ...(root.documents || []),
    ...((root.flight?.legs || []).flatMap((leg) => leg.documents || [])),
  ];
  if (root.ticket) documents.push({ url: root.ticket, label: root.ticketLabel || listingTitle(root.title), scope: "activity" });
  if (root.evidence) documents.push({ url: root.evidence, label: root.evidenceLabel || `${listingTitle(root.title)} Confirmation`, scope: "activity" });
  return [...new Map(documents.filter((document) => document?.url).map((document) => [document.url, document])).values()];
}

function documentMetadataForUrl(url) {
  const reference = destinationReferenceDocuments(itinerary.trip).find((document) => document.url === url);
  if (reference) return { ...reference, kind: "map" };
  const roots = materializeActivityDays(itinerary.days, state.overrides).roots;
  for (const activity of roots.values()) {
    const document = activityDocuments(activity).find((candidate) => candidate.url === url);
    if (document) return document;
  }
  return { url };
}

function destinationReferenceStatus(reference) {
  const status = destinationReferenceOfflineState(reference, state);
  if (status === "ready") return { status, label: "Ready offline" };
  if (status === "update") return { status, label: "Update offline download" };
  if (status === "missing") return { status, label: "Not in this offline copy" };
  return { status, label: "Available online" };
}

function renderDestinationReferenceCard(reference) {
  const document = reference.document;
  const availability = destinationReferenceStatus(reference);
  return `<article class="destination-reference-card">
    <div class="destination-reference-heading">
      <span class="destination-reference-icon" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="m4 7 8-3 8 3 8-3v21l-8 3-8-3-8 3V7Z"></path><path d="M12 4v21M20 7v21"></path><circle cx="20" cy="14" r="2.5"></circle></svg></span>
      <div>
        <p class="detail-kicker">${escapeHtml((reference.destinations || []).join(" & "))} reference</p>
        <h3>${escapeHtml(reference.title || document.label || "Offline Maps")}</h3>
        <p>${escapeHtml(reference.description || "Destination reference PDF.")}</p>
        <span class="destination-reference-status" data-offline-status="${escapeHtml(availability.status)}">${availability.status === "ready" ? "✓ " : "○ "}${escapeHtml(availability.label)}</span>
      </div>
    </div>
    <div class="button-row destination-reference-actions">
      <button class="primary-button" type="button" data-document-url="${escapeHtml(document.url)}">View Maps</button>
      <button class="secondary-button" type="button" data-save-document-url="${escapeHtml(document.url)}">Save PDF To Files</button>
    </div>
  </article>`;
}

function renderDestinationReferencesForDay(day) {
  const references = destinationReferencesForCity(itinerary.trip, day.city);
  if (!references.length) return "";
  return `<section class="destination-reference-list" aria-label="${escapeHtml(day.city)} reference maps">${references.map(renderDestinationReferenceCard).join("")}</section>`;
}

function renderItinerary() {
  const days = getDays();
  mainContent.innerHTML = `
    <div class="view-content">
      <div class="page-intro"><p class="eyebrow">${escapeHtml(itinerary.trip.name)}</p><h1>Itinerary</h1><p>All times are local to the activity.</p><div class="button-row"><button class="primary-button" type="button" data-add-activity>Add activity</button></div></div>
      <div class="itinerary-list">
        ${days.map((day) => `
          <section class="day-group" id="day-${day.date}">
            <div class="day-label"><h2>${escapeHtml(formatDay(day.date))}</h2><span>${escapeHtml(day.city)}</span></div>
            ${renderDestinationReferencesForDay(day)}
            ${day.activities.map((activity) => renderActivityCard(activity)).join("") || '<div class="empty-state">Nothing scheduled.</div>'}
          </section>`).join("")}
      </div>
    </div>`;
}

function renderTickets() {
  const roots = materializeActivityDays(itinerary.days, state.overrides).roots;
  const documents = [...roots.values()].filter((activity) => activityDocuments(activity).length);
  const references = destinationReferences(itinerary.trip);
  mainContent.innerHTML = `
    <div class="view-content">
      <div class="page-intro"><p class="eyebrow">Trip documents</p><h1>Tickets & Confirmations</h1><p>Both travelers may view every document. A traveler label shows who uses a ticket, not who may open it.</p></div>
      <div class="ticket-grid">
        ${references.map(renderDestinationReferenceCard).join("")}
        ${documents.map((activity) => `
          <article class="ticket-card">
            <p class="detail-kicker">${escapeHtml(formatDay(activity.dayDate, { short: true }))}</p>
            <h3>${escapeHtml(listingTitle(activity.title))}</h3>
            <p>${escapeHtml(activity.venue || activity.city)}</p>
            <span class="status-badge" data-status="${escapeHtml(activity.status)}">${escapeHtml(statusLabel(activity.status))}</span>
            <div class="button-row">
              ${activityDocuments(activity).map((document, index) => `<button class="${index === 0 ? "primary-button" : "secondary-button"}" type="button" data-document-url="${escapeHtml(document.url)}">${escapeHtml(document.label || document.filename || "View Document")}</button>`).join("")}
              <button class="secondary-button" type="button" data-activity-id="${escapeHtml(activity.id)}">Details</button>
            </div>
          </article>`).join("") || '<div class="empty-state">No documents are available in this data set.</div>'}
      </div>
    </div>`;
}

function renderMore() {
  const referenceActivities = getReferenceActivities();
  const offlineReady = readJson(localStorage.getItem(STORAGE.offline), {}).ready;
  const archivedTrips = readJson(localStorage.getItem(STORAGE.archived), {});
  const archivedAt = archivedTrips[state.currentProfile];
  const unsyncedCount = Number(state.offlineSummary?.pendingCount || 0) + Number(state.offlineSummary?.conflictCount || 0);
  const offlineSection = SERVER_AUTH
    ? `<section class="settings-section">
        <h2>Download Trip For Offline Use</h2>
        <p>${state.offlineSummary
          ? `<strong>${state.offlineMode ? "Opened offline" : "Ready offline"}</strong> for ${escapeHtml(state.currentProfile)}. Last synced ${escapeHtml(formatSyncTime(state.offlineSummary.syncedAt))}; ${state.offlineSummary.documentCount ?? state.offlineSummary.ticketCount ?? 0} selected document${(state.offlineSummary.documentCount ?? state.offlineSummary.ticketCount ?? 0) === 1 ? "" : "s"}.${unsyncedCount ? ` <strong>${unsyncedCount} unsynced change${unsyncedCount === 1 ? "" : "s"}</strong>${state.offlineSummary.conflictCount ? `, including ${state.offlineSummary.conflictCount} conflict${state.offlineSummary.conflictCount === 1 ? "" : "s"}` : ""}.` : ""}`
          : `${archivedAt ? `Archived on this device ${escapeHtml(formatSyncTime(archivedAt))}. ` : ""}No encrypted offline copy is currently stored for ${escapeHtml(state.currentProfile)}.`}</p>
        <p>Save the itinerary, destination photos, tickets, confirmations, and reference documents on this device.</p>
        <div class="button-row">
          ${unsyncedCount ? `<button class="primary-button" type="button" data-sync-pending>${state.offlineMode ? "Reconnect And Sync" : "Unlock And Sync Changes"}</button>` : ""}
          ${state.offlineMode ? '<button class="primary-button" type="button" disabled>Reconnect To Update Download</button>' : `<button class="primary-button" type="button" data-download-offline>${state.offlineSummary ? "Update Offline Download" : "Choose Documents And Download"}</button>`}
          ${state.offlineSummary && !state.offlineMode ? '<button class="secondary-button" type="button" data-update-offline-code>Update Offline Unlock Code</button>' : ""}
          ${state.offlineSummary ? '<button class="secondary-button" type="button" data-remove-offline>Remove Offline Download</button><button class="danger-button" type="button" data-archive-local>Archive Local Copy</button>' : ""}
        </div>
        <details class="help-disclosure"><summary>Offline Privacy And Storage</summary><p>The saved trip is encrypted for this browser profile and unlocks with this traveler’s six-digit code. If the account code was changed on another device, use <strong>Update Offline Unlock Code</strong> with the previous offline code and current account code. Removing or archiving affects only this device; the private server originals remain unchanged.</p></details>
      </section>`
    : `<section class="settings-section">
        <h2>Offline Trip</h2>
        <p>${offlineReady ? "The current itinerary and selected documents have been downloaded to this browser." : "Download the itinerary, app shell, tickets, and confirmations for use without a network connection."}</p>
        <div class="button-row"><button class="primary-button" type="button" data-download-offline>${offlineReady ? "Refresh offline copy" : "Download trip offline"}</button></div>
        <p class="security-note">Offline copies remain on this device until browser storage is cleared. Use a device passcode and do not share the browser profile.</p>
      </section>`;
  const accountSection = SERVER_AUTH
    ? `<section class="settings-section">
        <h2>Private Account</h2>
        <p><strong>${escapeHtml(state.currentProfile)}</strong> is ${state.offlineMode ? "using a locally unlocked offline copy" : "signed in"}. Dan and Ken have equal editing rights and independent recovery codes.</p>
        <details class="help-disclosure"><summary>How private access works</summary><p>${state.offlineMode ? "Offline additions and edits remain protected on this device as pending sync. Reconnect and sign in to sync them." : "Your itinerary and documents are available only after sign-in and are not stored in the public app cache. An ordinary code change may keep existing server sessions signed in. A recovery reset invalidates every server session for that traveler."}</p></details>
        <details class="help-disclosure"><summary>Other devices and offline packages</summary><p>Each device’s offline package is encrypted locally. After a code change, update that package on the device with its previous offline code and the current account code, or replace the saved package while connected. A disconnected device cannot receive an immediate session revocation or package update; it must reconnect before the server can require authentication again.</p></details>
        <div class="button-row">${state.offlineMode ? '<button class="secondary-button" type="button" disabled>Reconnect to change credentials</button>' : '<button class="secondary-button" type="button" data-change-access-code>Choose or change code</button><button class="secondary-button" type="button" data-replace-recovery-codes>Replace recovery codes</button>'}<button class="danger-button" type="button" data-sign-out>Sign out</button></div>
      </section>`
    : `<section class="settings-section">
        <h2>Local Access</h2>
        <p><strong>${escapeHtml(state.currentProfile)}</strong> is signed in. Dan and Ken have equal editing rights and independent recovery codes.</p>
        <div class="prototype-banner">This local prototype hashes codes in this browser. The Cloudflare simulator uses the separate server authentication path.</div>
        <div class="button-row"><button class="danger-button" type="button" data-sign-out>Sign out</button></div>
      </section>`;
  mainContent.innerHTML = `
    <div class="view-content">
      <div class="page-intro"><p class="eyebrow">${escapeHtml(state.currentProfile || state.traveller)}</p><h1>More</h1><p>${SERVER_AUTH ? "Secure trip tools and account settings." : "Trip tools and local prototype settings."}</p></div>
      <div class="settings-list">
        <section class="settings-section">
          <h2>Before You Go</h2>
          <div class="task-list">
            ${itinerary.tasks.map((task) => `<article class="task-card"><span class="status-badge" data-status="awaiting">Open</span><h3>${escapeHtml(listingTitle(task.title))}</h3><p>${escapeHtml(task.detail)}</p></article>`).join("") || '<p>No open preparation items.</p>'}
          </div>
        </section>
        ${referenceActivities.length ? `<section class="settings-section">
          <h2>Travel Reference</h2>
          <p>Important policies and reference documents that are not timed itinerary activities.</p>
          <div class="reference-list">
            ${referenceActivities.map((activity) => `<article class="reference-card">
              <h3>${escapeHtml(listingTitle(activity.title))}</h3>
              <p>${escapeHtml(activity.venue || activity.city)}</p>
              <div class="button-row">
                ${activity.ticket ? `<button class="primary-button" type="button" data-document-url="${escapeHtml(activity.ticket)}">${escapeHtml(activity.ticketLabel || "View document")}</button>` : ""}
                ${activity.evidence ? `<button class="secondary-button" type="button" data-document-url="${escapeHtml(activity.evidence)}">${escapeHtml(activity.evidenceLabel || "View reference")}</button>` : ""}
                <button class="secondary-button" type="button" data-activity-id="${escapeHtml(activity.id)}">Coverage details</button>
              </div>
            </article>`).join("")}
          </div>
        </section>` : ""}
        ${offlineSection}
        <section class="settings-section">
          <h2>Apple Calendar Fallback</h2>
          <p>Export a calendar file with stable event identifiers and leave-by alerts. This is a manual fallback, not automatic synchronization.</p>
          <div class="button-row"><button class="primary-button" type="button" data-export-calendar>Download Apple Calendar file</button></div>
          <ol class="instruction-list">
            <li>On iPhone, open the downloaded <strong>.ics</strong> file and add the events to a dedicated “My Travels” calendar.</li>
            <li>Keep only one imported trip calendar. Before importing a full replacement, remove the earlier dedicated calendar to prevent duplicate alerts.</li>
            <li>After an itinerary change, edit the matching Calendar event manually or replace the dedicated calendar and re-import.</li>
            <li>Delete cancelled activities manually. Offline alerts are produced by iPhone Calendar after import, subject to iOS notification and Focus settings.</li>
          </ol>
        </section>
        <section class="settings-section">
          <h2>Appearance</h2>
          <p>Current setting: <strong>${state.theme === "system" ? "Follow Device" : titleCase(state.theme)}</strong>. Follow Device changes automatically with the iPhone’s appearance.</p>
          <div class="segmented-control" role="group" aria-label="Appearance">
            ${["system", "light", "dark"].map((theme) => `<button type="button" data-theme-choice="${theme}" class="${state.theme === theme ? "is-selected" : ""}">${theme === "system" ? "Follow Device" : titleCase(theme)}</button>`).join("")}
          </div>
        </section>
        ${accountSection}
      </div>
    </div>`;
}

function bindRenderedEvents() {
  $$('[data-select-date]').forEach((button) => button.addEventListener("click", () => {
    state.selectedDate = button.dataset.selectDate;
    renderToday();
    bindRenderedEvents();
  }));
  $$('[data-activity-id]').forEach((button) => button.addEventListener("click", () => openActivity(button.dataset.activityId)));
  $$('[data-document-url]').forEach((button) => button.addEventListener("click", () => openDocument(button.dataset.documentUrl, button)));
  $$('[data-save-document-url]').forEach((button) => button.addEventListener("click", () => saveDocumentToFiles(button.dataset.saveDocumentUrl, button)));
  $$('[data-transport-activity]').forEach((button) => button.addEventListener("click", () => showTransportOptions(button.dataset.transportActivity)));
  $('[data-add-activity]')?.addEventListener("click", showAddActivity);
  $('[data-download-offline]')?.addEventListener("click", downloadOffline);
  $('[data-update-offline-code]')?.addEventListener("click", showOfflineUnlockCodeDialog);
  $('[data-sync-pending]')?.addEventListener("click", beginPendingSync);
  $('[data-remove-offline]')?.addEventListener("click", () => confirmOfflineRemoval(false));
  $('[data-archive-local]')?.addEventListener("click", () => confirmOfflineRemoval(true));
  $('[data-export-calendar]')?.addEventListener("click", exportCalendar);
  $('[data-sign-out]')?.addEventListener("click", signOut);
  $('[data-change-access-code]')?.addEventListener("click", showAccessCodeDialog);
  $('[data-replace-recovery-codes]')?.addEventListener("click", showRecoveryCodesDialog);
  $$('[data-theme-choice]').forEach((button) => button.addEventListener("click", () => {
    applyTheme(button.dataset.themeChoice);
    render();
  }));
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Copy is unavailable");
}

function showTransportOptions(activityId) {
  const activity = findActivity(activityId);
  if (!activity) return;
  const transport = transportFor(activity);
  recoveryDialogContent.innerHTML = `
    <div class="modal-inner">
      <p class="detail-kicker">Ride to ${escapeHtml(transport.destination)}</p>
      <h2>Open ${escapeHtml(transport.name)}</h2>
      ${transport.isBackup ? `<div class="transfer-priority">${carIcon()}<div><strong>Your arranged transfer comes first</strong><small>Use ${escapeHtml(transport.name)} only as a backup after reviewing the existing pickup and vehicle details.</small></div></div>` : ""}
      <p class="detail-time">${transport.passesDestination
        ? `The link asks Uber to use your current location for pickup and fills in <strong>${escapeHtml(transport.destination)}</strong> as the destination.`
        : `Grab’s supported public web link opens the transport service, but does not reliably pass a destination. Copy <strong>${escapeHtml(transport.destination)}</strong> and paste it into Grab.`}</p>
      <div class="button-row">
        <a class="primary-button button-link" href="${escapeHtml(transport.url)}" target="_blank" rel="noopener external">Open ${escapeHtml(transport.name)}</a>
        <button class="secondary-button" type="button" data-copy-destination>Copy destination</button>
        <button class="secondary-button" type="button" data-transport-done>Done</button>
      </div>
      <p class="security-note">Allow current-location access if requested. Review the pickup, destination, vehicle and fare in ${escapeHtml(transport.name)}, then confirm the ride yourself.</p>
    </div>`;
  $('[data-copy-destination]', recoveryDialogContent).addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      await copyText(transport.destination);
      button.textContent = "Destination copied";
    } catch {
      window.prompt("Copy this destination", transport.destination);
    }
  });
  $('[data-transport-done]', recoveryDialogContent).addEventListener("click", () => recoveryDialog.close());
  openDialog(recoveryDialog);
}

function showAccessCodeDialog() {
  if (state.offlineMode) {
    showNotice("Reconnect and sign in before changing the account code. Offline edits remain protected on this device.");
    return;
  }
  recoveryDialogContent.innerHTML = `
    <div class="modal-inner">
      <p class="detail-kicker">Protected account setting</p>
      <h2>Choose Your Six-Digit Code</h2>
      <p class="detail-time">Only ${escapeHtml(state.currentProfile)}’s code changes. Enter it privately on this device; there is no public registration.</p>
      <form id="accessCodeForm" class="edit-form">
        <label for="currentAccessCode">Current code<input id="currentAccessCode" name="currentCode" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" required></label>
        <label for="newAccessCode">New six-digit code<input id="newAccessCode" name="newCode" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" required></label>
        <label for="confirmAccessCode">Confirm new code<input id="confirmAccessCode" name="confirmCode" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" required></label>
        <p class="form-error" data-access-code-error role="alert"></p>
        <div class="button-row"><button class="primary-button" type="submit">Update code</button><button class="secondary-button" type="button" data-cancel-access-code>Cancel</button></div>
      </form>
      <details class="help-disclosure"><summary>Offline downloads and recovery</summary><p>If this device has a downloaded trip, it will be re-encrypted with the new code without changing its itinerary, tickets, pending edits or conflicts. The existing package remains intact unless that re-encryption finishes successfully. Recovery codes remain separate and cannot unlock an offline package.</p></details>
    </div>`;
  const form = $("#accessCodeForm", recoveryDialogContent);
  $('[data-cancel-access-code]', form).addEventListener("click", () => recoveryDialog.close());
  form.addEventListener("submit", updateAccessCode);
  openDialog(recoveryDialog);
}

async function updateAccessCode(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const currentCode = values.get("currentCode")?.trim() || "";
  const newCode = values.get("newCode")?.trim() || "";
  const confirmCode = values.get("confirmCode")?.trim() || "";
  const submit = $('button[type="submit"]', form);
  const errorBox = $('[data-access-code-error]', form);
  errorBox.textContent = "";
  if (newCode !== confirmCode) {
    errorBox.textContent = "The new codes do not match.";
    return;
  }
  submit.disabled = true;
  submit.textContent = state.offlineSummary ? "Protecting saved trip…" : "Updating…";
  let serverUpdated = false;
  try {
    // Validate the old device key before changing the server credential. This
    // prevents an offline package with pending edits from being stranded.
    if (state.offlineSummary) await unlockOfflineVault(state.currentProfile, currentCode);
    await fetchJson("/api/trip/access-code", {
      method: "POST",
      body: JSON.stringify({ currentCode, newCode }),
    });
    serverUpdated = true;
    if (state.offlineSummary) {
      const rekeyed = await rekeyOfflineVault({ traveller: state.currentProfile, currentCode, newCode });
      state.offlineSummary = rekeyed.summary;
      state.offlineKey = rekeyed.key;
    }
    form.reset();
    recoveryDialog.close();
    render();
    showNotice(
      state.offlineSummary
        ? `Your account and this device’s downloaded trip now use the new code. ${state.offlineSummary.pendingCount + state.offlineSummary.conflictCount} unsynced change${state.offlineSummary.pendingCount + state.offlineSummary.conflictCount === 1 ? " was" : "s were"} preserved.`
        : "Your account now uses the new code. Remembered signed-in devices remain signed in.",
      { title: "Access code updated" },
    );
  } catch (error) {
    errorBox.textContent = serverUpdated
      ? "The online code changed, but this device could not re-encrypt its saved trip. The original offline package and pending edits were preserved and still unlock with the previous code. Change the online code back before retrying on this device."
      : (error.status === 401
        ? "The current code was not recognized."
        : (error.status === 429 ? "Too many attempts. Please wait before trying again." : error.message));
    submit.disabled = false;
    submit.textContent = "Update code";
  }
}

function showRecoveryCodesDialog() {
  if (state.offlineMode) {
    showNotice("Reconnect and sign in before replacing recovery codes.");
    return;
  }
  recoveryDialog.dataset.clearOnClose = "true";
  recoveryDialogContent.innerHTML = `
    <div class="modal-inner">
      <p class="detail-kicker">Protected account setting</p>
      <h2>Replace Recovery Codes</h2>
      <p class="detail-time">Enter ${escapeHtml(state.currentProfile)}’s current six-digit code. The existing recovery-code set will stop working as soon as the replacement is created.</p>
      <form id="replaceRecoveryCodesForm" class="edit-form">
        <label for="recoveryCodesCurrentCode">Current six-digit code<input id="recoveryCodesCurrentCode" name="currentCode" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" required></label>
        <p class="form-error" data-recovery-codes-error role="alert"></p>
        <div class="button-row"><button class="primary-button" type="submit">Create replacement codes</button><button class="secondary-button" type="button" data-cancel-recovery-codes>Cancel</button></div>
      </form>
      <p class="security-note">The replacement codes are shown only once. Store them in ${escapeHtml(state.currentProfile)}’s password manager; do not email, post or screenshot them.</p>
    </div>`;
  const form = $("#replaceRecoveryCodesForm", recoveryDialogContent);
  $('[data-cancel-recovery-codes]', form).addEventListener("click", () => closeDialog(recoveryDialog));
  form.addEventListener("submit", replaceRecoveryCodes);
  openDialog(recoveryDialog);
}

async function replaceRecoveryCodes(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const currentCode = new FormData(form).get("currentCode")?.trim() || "";
  const submit = $('button[type="submit"]', form);
  const errorBox = $('[data-recovery-codes-error]', form);
  errorBox.textContent = "";
  submit.disabled = true;
  submit.textContent = "Creating…";
  try {
    const result = await fetchJson("/api/trip/recovery-codes", {
      method: "POST",
      body: JSON.stringify({ currentCode }),
    });
    form.reset();
    const recoveryCodes = Array.isArray(result.recoveryCodes) ? result.recoveryCodes : [];
    if (!recoveryCodes.length) throw new Error("The replacement codes were not returned");
    recoveryDialogContent.innerHTML = `
      <div class="modal-inner">
        <p class="detail-kicker">Save now</p>
        <h2>New Recovery Codes</h2>
        <p class="detail-time">These are the only valid recovery codes for ${escapeHtml(state.currentProfile)}. The previous set has been invalidated. Each code can reset the six-digit code once.</p>
        <div class="recovery-codes" role="list" aria-label="New recovery codes">${recoveryCodes.map((code) => `<code role="listitem">${escapeHtml(code)}</code>`).join("")}</div>
        <p class="form-error" data-copy-recovery-error role="alert"></p>
        <div class="button-row"><button class="secondary-button" type="button" data-copy-recovery-codes>Copy all codes</button><button class="primary-button" type="button" data-recovery-codes-saved>I saved these codes</button></div>
        <p class="security-note">This list is cleared from the page when you close it. If you lose the list, create another replacement set while signed in.</p>
      </div>`;
    $('[data-copy-recovery-codes]', recoveryDialogContent).addEventListener("click", async (copyEvent) => {
      const copyButton = copyEvent.currentTarget;
      try {
        await copyText(recoveryCodes.join("\n"));
        copyButton.textContent = "Codes copied";
      } catch {
        $('[data-copy-recovery-error]', recoveryDialogContent).textContent = "Copy is unavailable. Save the codes individually in the password manager.";
      }
    });
    $('[data-recovery-codes-saved]', recoveryDialogContent).addEventListener("click", () => closeDialog(recoveryDialog));
  } catch (error) {
    errorBox.textContent = error.status === 401
      ? "The current code was not recognized."
      : (error.status === 429 ? "Too many attempts. Please wait before trying again." : error.message);
    submit.disabled = false;
    submit.textContent = "Create replacement codes";
  }
}

function showOfflineUnlockCodeDialog() {
  if (!state.offlineSummary || state.offlineMode) {
    showNotice("Reconnect and sign in before updating this device’s offline unlock code.");
    return;
  }
  recoveryDialogContent.innerHTML = `
    <div class="modal-inner">
      <p class="detail-kicker">This device only</p>
      <h2>Update Offline Unlock Code</h2>
      <p class="detail-time">Use this after changing the account code on another device. Pending edits, conflicts and downloaded documents stay in this device’s encrypted package.</p>
      <form id="offlineUnlockCodeForm" class="edit-form">
        <label for="previousOfflineCode">Previous offline code<input id="previousOfflineCode" name="previousCode" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required></label>
        <label for="currentOnlineCode">Current account code<input id="currentOnlineCode" name="currentCode" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" required></label>
        <p class="form-error" data-offline-code-error role="alert"></p>
        <div class="button-row"><button class="primary-button" type="submit">Update this device</button><button class="secondary-button" type="button" data-cancel-offline-code>Cancel</button></div>
      </form>
      <p class="security-note">The current account code is verified online. The previous code is used only on this device to decrypt the existing package and is not sent to the server.</p>
    </div>`;
  const form = $("#offlineUnlockCodeForm", recoveryDialogContent);
  $('[data-cancel-offline-code]', form).addEventListener("click", () => recoveryDialog.close());
  form.addEventListener("submit", updateOfflineUnlockCode);
  openDialog(recoveryDialog);
}

async function updateOfflineUnlockCode(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const previousCode = values.get("previousCode")?.trim() || "";
  const currentCode = values.get("currentCode")?.trim() || "";
  const submit = $('button[type="submit"]', form);
  const errorBox = $('[data-offline-code-error]', form);
  submit.disabled = true;
  submit.textContent = "Updating encryption…";
  errorBox.textContent = "";
  try {
    // Local unlock happens before online reauthentication so a wrong previous
    // code cannot consume a server authentication attempt.
    await unlockOfflineVault(state.currentProfile, previousCode);
    await fetchJson("/api/trip/reauth", { method: "POST", body: JSON.stringify({ code: currentCode }) });
    const rekeyed = await rekeyOfflineVault({
      traveller: state.currentProfile,
      currentCode: previousCode,
      newCode: currentCode,
    });
    state.offlineSummary = rekeyed.summary;
    state.offlineKey = rekeyed.key;
    form.reset();
    recoveryDialog.close();
    render();
    const unsynced = state.offlineSummary.pendingCount + state.offlineSummary.conflictCount;
    showNotice(
      `This device’s downloaded trip now unlocks with the current account code. ${unsynced} unsynced change${unsynced === 1 ? " was" : "s were"} preserved.`,
      { title: "Offline unlock code updated" },
    );
  } catch (error) {
    errorBox.textContent = error.status === 401
      ? "The current account code was not recognized."
      : (error.code === "BAD_CODE" ? "The previous code did not unlock this device’s saved trip." : error.message);
    submit.disabled = false;
    submit.textContent = "Update this device";
  }
}

function openActivity(id, editMode = false) {
  let activity = findActivity(id);
  if (!activity) return;
  const root = findEditableActivity(activity) || activity;
  const rootId = editableActivityId(root);
  if (activity.id === rootId && activityTypeFor(root) === "flight") {
    const projections = materializeActivityDays(itinerary.days, state.overrides).projections.filter((candidate) => candidate.rootId === rootId);
    activity = projections.find((candidate) => candidate.dayDate === state.selectedDate) || projections[0] || activity;
  }
  const { previous, next } = activityNeighbors(getDays(), activity.id);
  state.editingActivityId = editMode ? rootId : null;
  if (editMode) state.editingReturnActivityId = activity.id;
  const leave = leaveBy(activity);
  const transport = transportFor(activity);
  const prebooked = isPrebookedJourney(activity);
  const shipSchedule = activity.kind === "ship";
  const referenceMaterial = isReferenceActivity(root);
  const hideTravelActions = shipSchedule || referenceMaterial;
  const detailMedia = mediaFor(activity.mediaKey || (activity.city.includes("Hong Kong") ? "hongKong" : "singapore"));
  const ticketLabel = root.ticketLabel || (["peak-tram", "supertree"].includes(rootId) ? "Show Both Tickets" : "Show Ticket");
  const evidenceLabel = activity.evidenceLabel || "View confirmation";
  const type = activityTypeFor(root);
  const protectedDocuments = activityDocuments(root);
  const flightSummary = type === "flight" ? flightJourneySummary(root) : null;
  const bookingReference = bookingReferenceFor(root, activity.flightLegIndex);
  const bookingReferenceLabel = type === "flight" ? "PNR" : "Booking Reference";
  const reservationSummary = [
    activity.party,
    activity.paid,
    bookingReference ? `${bookingReferenceLabel} ${bookingReference}` : "",
  ].filter(Boolean);

  activityDialogContent.innerHTML = editMode
    ? renderActivityForm(root, activityFormContext("edit", root))
    : `
      <div class="activity-detail">
        <div class="detail-topbar">
          <button class="detail-back-button" type="button" data-close-detail aria-label="Close activity details"><span class="detail-back-chevron" aria-hidden="true">‹</span><span>Today</span></button>
          <div class="detail-topbar-actions">
            <button class="detail-topbar-nav" type="button" data-previous-activity="${escapeHtml(previous?.id || "")}" ${previous ? "" : "disabled"} aria-label="${previous ? `Previous itinerary item: ${escapeHtml(listingTitle(previous.title))}` : "No previous itinerary item"}"><span aria-hidden="true">‹</span></button>
            <button class="detail-topbar-nav" type="button" data-next-activity="${escapeHtml(next?.id || "")}" ${next ? "" : "disabled"} aria-label="${next ? `Next itinerary item: ${escapeHtml(listingTitle(next.title))}` : "No next itinerary item"}"><span aria-hidden="true">›</span></button>
            <button type="button" data-edit-activity="${escapeHtml(rootId)}">Edit${state.offlineMode ? " Offline" : ""}</button>
          </div>
        </div>
        <section class="detail-hero">
          ${renderPhotoPair(detailMedia, "detail-photo", activity.photoLabel || activity.city)}
          <strong>${escapeHtml(activity.photoLabel || activity.city)}</strong>
        </section>
        <div class="detail-content">
          <h2 id="activityDetailTitle" tabindex="-1">${escapeHtml(listingTitle(activity.title))}</h2>
          <p class="detail-date">${escapeHtml(formatDay(activity.dayDate))}</p>
          <span class="status-badge" data-status="${escapeHtml(activity.status)}">${escapeHtml(statusLabel(activity.status))}</span>
          ${referenceMaterial
            ? `<div class="detail-time-block"><span aria-hidden="true">▤</span><div><strong>Reference material</strong><small>${escapeHtml(activity.venue || activity.city)}</small></div></div>`
            : `<div class="detail-time-block"><span aria-hidden="true">◷</span><div><strong>${escapeHtml(activityTimeRange(activity))}</strong><small>${escapeHtml(activity.venue || activity.city)}</small></div></div>`}
          ${prebooked ? `<div class="transfer-plan">${carIcon()}<div><strong>${activity.status === "awaiting" ? "Prebooked transfer · confirmation pending" : "Prebooked transfer details"}</strong><p>${escapeHtml(activity.note || activity.bookingDetails || `Pickup is scheduled at ${activity.meetingPoint || activity.venue || activity.city}. Review the confirmation before departure.`)}</p></div></div>` : ""}
          ${flightSummary ? `<div class="journey-detail-summary"><strong>${escapeHtml(flightSummary.route)}</strong><p>${flightSummary.legCount} Flight Leg${flightSummary.legCount === 1 ? "" : "s"}${flightSummary.connections.length ? ` · ${flightSummary.connections.map((connection) => `${durationLabel(connection.durationMinutes)} at ${connection.hub}${connection.overnight ? " Overnight" : ""}${connection.airportChange ? " Airport Change" : ""}`).join(" · ")}` : ""}</p></div>` : ""}
          ${activity.ticket ? `<button class="ticket-button" type="button" data-document-url="${escapeHtml(activity.ticket)}"><span aria-hidden="true">▱</span>${escapeHtml(ticketLabel)}</button>` : ""}
          ${hideTravelActions ? "" : (type === "transit" ? `<div class="detail-action-grid">
            <a class="outline-action" href="${directionsFor(activity)}" target="_blank" rel="noopener">↗ <span>View Transit Route</span></a>
            <a class="outline-action" href="${directionsFor(activity)}" target="_blank" rel="noopener external">↗ <span>Open In Apple Maps</span></a>
          </div>` : `<div class="detail-action-grid">
            <a class="outline-action" href="${directionsFor(activity)}" target="_blank" rel="noopener">↗ <span>Directions</span></a>
            <button class="outline-action" type="button" data-transport-activity="${escapeHtml(activity.id)}">${carIcon()}<span>${prebooked ? "Backup " : ""}${transport.name}</span></button>
          </div>`)}
          ${type === "flight" && root.flight?.airlineUrl ? `<a class="outline-action standalone-action" href="${escapeHtml(root.flight.airlineUrl)}" target="_blank" rel="noopener external">Open Airline App Or Website</a>` : ""}
          ${type === "transit" ? `<div class="button-row"><button class="secondary-button" type="button" data-copy-value="${escapeHtml(root.transit?.from || "")}">Copy Origin</button><button class="secondary-button" type="button" data-copy-value="${escapeHtml(root.transit?.to || "")}">Copy Destination</button></div>` : ""}
          ${reservationSummary.length ? `<p class="reservation-summary-line">♧ ${escapeHtml(reservationSummary.join(" · "))}</p>` : ""}
          <div class="detail-disclosures">
            <details><summary><span>⌖</span>Meeting point</summary><p>${escapeHtml(activity.meetingPoint || activity.address || activity.venue || activity.city)}</p></details>
            <details><summary><span>▤</span>Visit notes</summary><p>${escapeHtml(activity.note || "No additional visit note recorded.")}</p></details>
            <details><summary><span>□</span>Booking details</summary><p>${escapeHtml(activity.bookingDetails || `${statusLabel(activity.status)} for ${activity.party || "the travellers"}.`)}</p></details>
          </div>
          <div class="travel-note">✎ ${escapeHtml(activity.whatToWear || (leave ? `Leave by ${leave}.` : "Check the activity details before departure."))}</div>
          ${activity.evidence ? `<button class="evidence-link" type="button" data-document-url="${escapeHtml(activity.evidence)}">${escapeHtml(evidenceLabel)}</button>` : ""}
          ${protectedDocuments.filter((document) => document.url !== activity.ticket && document.url !== activity.evidence).length ? `<section class="detail-documents"><h3>Protected Documents</h3><div class="button-row">${protectedDocuments.filter((document) => document.url !== activity.ticket && document.url !== activity.evidence).map((document) => `<button class="secondary-button" type="button" data-document-url="${escapeHtml(document.url)}">${escapeHtml(document.label || document.filename || "View Document")}</button>`).join("")}</div>${state.offlineMode ? '<p class="security-note">Only documents selected for this device’s encrypted offline package can open while disconnected.</p>' : ""}</section>` : ""}
          ${state.offlineMode ? '<p class="security-note">Offline edits are encrypted on this device and marked pending until authenticated sync.</p>' : ""}
          ${referenceMaterial ? "" : `<div class="detail-actions">
          <button class="secondary-button" type="button" data-set-status="done">Done</button>
          <button class="secondary-button" type="button" data-set-status="skipped">Skip</button>
          <button class="danger-button" type="button" data-set-status="cancelled">Cancel</button>
          ${root.custom ? '<button class="danger-button" type="button" data-delete-activity>Delete Added Activity</button>' : (state.overrides[rootId] ? '<button class="secondary-button" type="button" data-restore-activity>Restore Original</button>' : "")}
          </div>`}
          ${(previous || next) ? `<nav class="detail-pager" aria-label="Itinerary item navigation">
            <button class="detail-pager-button detail-pager-button--previous" type="button" data-previous-activity="${escapeHtml(previous?.id || "")}" ${previous ? "" : "disabled"} aria-label="${previous ? `Previous itinerary item: ${escapeHtml(listingTitle(previous.title))}` : "No previous itinerary item"}">
              <span class="detail-pager-arrow" aria-hidden="true">‹</span><span class="detail-pager-copy"><small>Previous</small><strong>${escapeHtml(previous ? listingTitle(previous.title) : "Start Of Trip")}</strong></span>
            </button>
            <button class="detail-pager-button detail-pager-button--next" type="button" data-next-activity="${escapeHtml(next?.id || "")}" ${next ? "" : "disabled"} aria-label="${next ? `Next itinerary item: ${escapeHtml(listingTitle(next.title))}` : "No next itinerary item"}">
              <span class="detail-pager-copy"><small>Next</small><strong>${escapeHtml(next ? listingTitle(next.title) : "End Of Trip")}</strong></span><span class="detail-pager-arrow" aria-hidden="true">›</span>
            </button>
          </nav>` : ""}
        </div>
      </div>`;

  $('[data-close-detail]', activityDialogContent)?.addEventListener("click", () => activityDialog.close());
  $('[data-edit-activity]', activityDialogContent)?.addEventListener("click", () => openActivity(activity.id, true));
  $$('[data-previous-activity]', activityDialogContent).forEach((button) => button.addEventListener("click", () => openAdjacentActivity(previous)));
  $$('[data-next-activity]', activityDialogContent).forEach((button) => button.addEventListener("click", () => openAdjacentActivity(next)));
  $$('[data-set-status]', activityDialogContent).forEach((button) => button.addEventListener("click", async () => {
    if (await saveOverride(rootId, { status: button.dataset.setStatus })) activityDialog.close();
  }));
  $('[data-restore-activity]', activityDialogContent)?.addEventListener("click", async () => {
    if (await restoreOverride(rootId)) activityDialog.close();
  });
  $('[data-delete-activity]', activityDialogContent)?.addEventListener("click", async () => {
    if (await deleteCustomActivity(rootId)) activityDialog.close();
  });
  $$('[data-document-url]', activityDialogContent).forEach((button) => button.addEventListener("click", () => openDocument(button.dataset.documentUrl, button)));
  $('[data-transport-activity]', activityDialogContent)?.addEventListener("click", () => showTransportOptions(activity.id));
  $$('[data-copy-value]', activityDialogContent).forEach((button) => button.addEventListener("click", async () => {
    try { await copyText(button.dataset.copyValue); button.textContent = "Copied"; }
    catch { window.prompt("Copy this value", button.dataset.copyValue); }
  }));
  if (editMode) bindActivityForm(root, "edit");
  openDialog(activityDialog);
}

function openAdjacentActivity(activity) {
  if (!activity) return;
  state.selectedDate = activity.dayDate;
  activityDialog.scrollTop = 0;
  openActivity(activity.id);
  requestAnimationFrame(() => {
    activityDialog.scrollTop = 0;
    $('#activityDetailTitle', activityDialogContent)?.focus({ preventScroll: true });
  });
}

function mutationToken() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${randomString(12)}`;
}

function makeMutation(kind, activityId, payload = {}) {
  return {
    mutationId: mutationToken(),
    activityId,
    kind,
    baseRevision: Number(state.revisions[activityId] || 0),
    changedAt: new Date().toISOString(),
    ...payload,
  };
}

async function persistOfflineWorkingState({ markSynced = false } = {}) {
  state.offlineSummary = await updateOfflineVaultState({
    traveller: state.currentProfile,
    key: state.offlineKey,
    itinerary,
    overrides: state.overrides,
    revisions: state.revisions,
    pendingChanges: state.pendingChanges,
    conflicts: state.conflicts,
    pendingChangedAt: state.pendingChangedAt,
    pendingExportedAt: state.pendingExportedAt,
    markSynced,
  });
}

async function stageOfflineMutation(mutation) {
  state.pendingChanges = queuePendingMutation(state.pendingChanges, mutation);
  state.pendingChangedAt = state.pendingChanges.length || state.conflicts.length ? new Date().toISOString() : null;
  state.pendingExportedAt = null;
  await persistOfflineWorkingState();
}

function applyServerSnapshot(data) {
  itinerary = data.itinerary;
  state.overrides = data.overrides || {};
  state.revisions = data.revisions || {};
  if (!itinerary.days.some((day) => day.date === state.selectedDate)) state.selectedDate = selectInitialDate();
}

async function syncMutationOnline(mutation) {
  const response = await fetchJson("/api/trip/sync", {
    method: "POST",
    body: JSON.stringify({ mutations: [mutation] }),
  });
  const reconciled = reconcileSyncResult([mutation], response);
  const fresh = await fetchJson("/api/trip/itinerary");
  applyServerSnapshot(fresh);
  if (reconciled.conflicts.length) {
    state.conflicts.push(...reconciled.conflicts);
    setTimeout(showConflictReview, 0);
  }
  render();
  return true;
}

async function saveOverride(id, changes) {
  id = editableActivityId(id);
  try {
    const current = findEditableActivity(id);
    const mutation = makeMutation("update", id, {
      changes,
      ...(current?.custom ? { activity: { ...current, ...changes, custom: true } } : {}),
    });
    if (state.offlineMode) {
      state.overrides[id] = {
        ...(state.overrides[id] || {}),
        ...changes,
        updatedAt: new Date().toISOString(),
        updatedBy: state.currentProfile,
      };
      await stageOfflineMutation(mutation);
      render();
      return true;
    }
    if (SERVER_AUTH) {
      return syncMutationOnline(mutation);
    } else {
      state.overrides[id] = {
        ...(state.overrides[id] || {}),
        ...changes,
        updatedAt: new Date().toISOString(),
        updatedBy: state.currentProfile,
      };
      persistOverrides();
    }
    render();
    return true;
  } catch (error) {
    showNotice(error.status === 401 ? "Your session expired. Sign in again." : "The change could not be saved.");
    if (error.status === 401) await signOut();
    return false;
  }
}

async function restoreOverride(id) {
  id = editableActivityId(id);
  try {
    const mutation = makeMutation("restore", id);
    if (state.offlineMode) {
      delete state.overrides[id];
      await stageOfflineMutation(mutation);
      render();
      return true;
    }
    if (SERVER_AUTH) {
      return syncMutationOnline(mutation);
    }
    delete state.overrides[id];
    persistOverrides();
    render();
    return true;
  } catch (error) {
    showNotice(error.status === 401 ? "Your session expired. Sign in again." : "The original activity could not be restored.");
    if (error.status === 401) await signOut();
    return false;
  }
}

async function deleteCustomActivity(id) {
  id = editableActivityId(id);
  try {
    const mutation = makeMutation("delete", id);
    if (state.offlineMode) {
      delete state.overrides[id];
      await stageOfflineMutation(mutation);
      render();
      return true;
    }
    if (SERVER_AUTH) return syncMutationOnline(mutation);
    delete state.overrides[id];
    persistOverrides();
    render();
    return true;
  } catch (error) {
    showNotice(error.status === 401 ? "Your session expired. Sign in again." : "The added activity could not be deleted.");
    if (error.status === 401) await signOut();
    return false;
  }
}

function activityFormContext(mode, activity = {}) {
  const day = itinerary.days.find((candidate) => candidate.date === (activity.dayDate || state.selectedDate)) || itinerary.days[0] || {};
  return {
    mode,
    offline: state.offlineMode,
    days: itinerary.days,
    selectedDate: activity.dayDate || state.selectedDate,
    city: activity.city || day.city || "",
    timeZone: activity.timeZone || day.timeZone || "UTC",
    currentProfile: state.currentProfile,
    tripTravelers: itinerary.trip.travelers || ["Dan", "Ken"],
    transportDefaults: itinerary.trip.transportDefaults || {},
  };
}

function activityDraftKey(mode, activity = {}) {
  return mode === "edit" ? `edit:${editableActivityId(activity)}` : "add";
}

function showAddActivity() {
  const draft = state.activityDrafts.get("add") || null;
  activityDialogContent.innerHTML = renderTypePicker({ offline: state.offlineMode, draft });
  $('[data-close-activity-form]', activityDialogContent)?.addEventListener("click", () => activityDialog.close());
  $('[data-resume-activity-draft]', activityDialogContent)?.addEventListener("click", () => startActivityForm(draft, "add"));
  $('[data-discard-activity-draft]', activityDialogContent)?.addEventListener("click", () => {
    state.activityDrafts.delete("add");
    showAddActivity();
  });
  $$('[data-activity-type]', activityDialogContent).forEach((button) => button.addEventListener("click", () => {
    startActivityForm(defaultActivityDraft(button.dataset.activityType, activityFormContext("add")), "add");
  }));
  openDialog(activityDialog);
}

function startActivityForm(activity, mode) {
  activityDialogContent.innerHTML = renderActivityForm(activity, activityFormContext(mode, activity));
  bindActivityForm(activity, mode);
}

function bindActivityForm(baseActivity, mode) {
  const form = $("#typeAwareActivityForm", activityDialogContent);
  if (!form) return;
  const draftKey = activityDraftKey(mode, baseActivity);
  accommodationVisibility(form);
  syncFlightSeatVisibility(form);

  const rememberDraft = () => {
    try { state.activityDrafts.set(draftKey, activityFromForm(form, baseActivity)); }
    catch { /* Native validation will identify incomplete required fields. */ }
  };
  const returnFromForm = () => {
    rememberDraft();
    if (mode === "edit") openActivity(state.editingReturnActivityId || editableActivityId(baseActivity), false);
    else showAddActivity();
  };
  $('[data-close-activity-form]', activityDialogContent)?.addEventListener("click", returnFromForm);
  $('[data-cancel-activity-form]', activityDialogContent)?.addEventListener("click", () => {
    rememberDraft();
    if (mode === "edit") openActivity(state.editingReturnActivityId || editableActivityId(baseActivity), false);
    else activityDialog.close();
  });
  form.addEventListener("input", () => {
    rememberDraft();
    accommodationVisibility(form);
    const summary = $('[data-flight-summary]', form);
    if (summary) {
      try { summary.innerHTML = flightSummaryMarkup(activityFromForm(form, baseActivity)); }
      catch { /* Keep the previous summary while a field is temporarily incomplete. */ }
    }
  });
  form.addEventListener("change", () => {
    rememberDraft();
    accommodationVisibility(form);
    syncFlightSeatVisibility(form);
  });
  form.elements.activityType?.addEventListener("change", () => {
    const nextType = form.elements.activityType.value;
    const renderedType = form.dataset.renderedType || activityTypeFor(baseActivity);
    form.elements.activityType.value = renderedType;
    let draft = activityFromForm(form, baseActivity);
    form.elements.activityType.value = nextType;
    draft.activityType = nextType;
    if (!draft[nextType]) {
      const defaults = defaultActivityDraft(nextType, activityFormContext(mode, draft));
      draft[nextType] = defaults[nextType];
    }
    state.activityDrafts.set(draftKey, draft);
    startActivityForm(draft, mode);
  });
  $('[data-add-flight-leg]', form)?.addEventListener("click", () => {
    const draft = activityFromForm(form, baseActivity);
    draft.flight.legs.push(nextFlightLeg(draft.flight.legs, activityFormContext(mode, draft)));
    state.activityDrafts.set(draftKey, draft);
    startActivityForm(draft, mode);
  });
  $$('[data-remove-flight-leg]', form).forEach((button) => button.addEventListener("click", () => {
    const draft = activityFromForm(form, baseActivity);
    const index = Number(button.closest("[data-flight-leg]")?.dataset.flightLeg);
    if (draft.flight.legs.length > 1 && Number.isInteger(index)) draft.flight.legs.splice(index, 1);
    state.activityDrafts.set(draftKey, draft);
    startActivityForm(draft, mode);
  }));
  form.addEventListener("submit", (event) => { void saveTypeAwareActivity(event, baseActivity, mode, draftKey); });
}

const ACTIVITY_PAYLOAD_FIELDS = [
  "activityType", "dayDate", "title", "venue", "address", "start", "end", "endDate", "timeZone", "status",
  "fixed", "travelMinutes", "arrivalBufferMinutes", "whatToWear", "note", "party", "bookingDetails", "meetingPoint",
  "paid", "contact", "cancellationTerms", "bookingReference", "directions", "travelers", "cost", "documents",
  "flight", "accommodation", "transfer", "transit", "tour", "dining", "general",
];

function activityPayload(activity, { custom = false } = {}) {
  const payload = {};
  const typedFields = new Set(["flight", "accommodation", "transfer", "transit", "tour", "dining", "general"]);
  for (const field of ACTIVITY_PAYLOAD_FIELDS) {
    if (typedFields.has(field) && field !== activity.activityType) continue;
    if (Object.prototype.hasOwnProperty.call(activity, field)) payload[field] = structuredClone(activity[field]);
  }
  if (custom) payload.custom = true;
  return payload;
}

function uploadSelections(form) {
  const selections = [];
  for (const file of form.elements.activityDocuments?.files || []) selections.push({ file, scope: "activity", legIndex: null });
  $$('[data-flight-leg]', form).forEach((card, legIndex) => {
    for (const file of card.querySelector('[name="legDocuments"]')?.files || []) selections.push({ file, scope: "leg", legIndex });
  });
  return selections;
}

function uploadContentType(file) {
  if (file.type) return file.type;
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  return { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", txt: "text/plain", eml: "message/rfc822" }[extension] || "";
}

async function uploadProtectedDocument(selection, activityId) {
  if (selection.file.size < 1 || selection.file.size > (25 * 1024 * 1024)) throw new Error(`${selection.file.name} must be between 1 byte and 25 MB.`);
  const contentType = uploadContentType(selection.file);
  if (!contentType) throw new Error(`${selection.file.name} is not a supported document type.`);
  const response = await fetch("/api/trip/document", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "X-Trip-Size": String(selection.file.size),
      "X-Trip-Filename": selection.file.name,
      "X-Trip-Label": selection.file.name,
      "X-Trip-Activity": activityId,
      "X-Trip-Scope": selection.scope,
      ...(selection.legIndex === null ? {} : { "X-Trip-Leg": String(selection.legIndex) }),
    },
    body: selection.file,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || "The document could not be uploaded."), { status: response.status });
  return body.document;
}

async function saveTypeAwareActivity(event, baseActivity, mode, draftKey) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = $('[data-activity-form-error]', form);
  const submit = $('button[type="submit"]', form);
  errorBox.textContent = "";
  if (!form.reportValidity()) return;
  let activity;
  try { activity = activityFromForm(form, baseActivity); }
  catch { errorBox.textContent = "Review the required activity details and try again."; return; }
  const selections = uploadSelections(form);
  const id = mode === "add" ? `custom-${mutationToken().toLowerCase()}` : editableActivityId(baseActivity);
  const payload = activityPayload(activity, { custom: mode === "add" });
  submit.disabled = true;
  submit.textContent = "Saving…";
  try {
    if (mode === "add") {
      const mutation = makeMutation("add", id, { activity: payload });
      if (state.offlineMode) { state.overrides[id] = payload; await stageOfflineMutation(mutation); }
      else if (SERVER_AUTH) await syncMutationOnline(mutation);
      else { state.overrides[id] = payload; persistOverrides(); }
    } else if (!await saveOverride(id, payload)) {
      throw new Error("The activity could not be saved.");
    }

    if (selections.length) {
      const uploaded = await Promise.all(selections.map((selection) => uploadProtectedDocument(selection, id)));
      const saved = findEditableActivity(id) || { ...activity, id };
      const documents = [...(saved.documents || [])];
      const flight = saved.flight ? structuredClone(saved.flight) : null;
      for (const document of uploaded) {
        if (document.scope === "leg" && flight?.legs?.[document.legIndex]) flight.legs[document.legIndex].documents = [...(flight.legs[document.legIndex].documents || []), document];
        else documents.push(document);
      }
      if (!await saveOverride(id, { documents, ...(flight ? { flight } : {}) })) throw new Error("The documents uploaded, but their activity links could not be saved.");
    }

    state.activityDrafts.delete(draftKey);
    state.selectedDate = activity.dayDate;
    activityDialog.close();
    render();
  } catch (error) {
    submit.disabled = false;
    submit.textContent = "Save Activity";
    errorBox.textContent = error.status === 401 ? "Your session expired. Sign in again." : error.message || "The activity could not be saved.";
    if (error.status === 401) await signOut();
  }
}

function persistOverrides() {
  if (!SERVER_AUTH) localStorage.setItem(STORAGE.overrides, JSON.stringify(state.overrides));
}

async function openDocument(url, button) {
  const original = button?.textContent;
  if (button) button.textContent = "Opening…";
  try {
    const blob = await loadDocumentBlob(url);
    if (isReadableConfirmation(blob)) await showConfirmationDocument(blob);
    else {
      const metadata = documentMetadataForUrl(url);
      const previewBlobs = metadata.kind === "map" && metadata.previewPages?.length
        ? await Promise.all(metadata.previewPages.map((page) => loadDocumentBlob(page.url)))
        : [];
      openOriginalDocument(blob, url, metadata, previewBlobs);
    }
  } catch (error) {
    showNotice(`${error.message}. ${state.offlineMode ? "Reconnect to update the selected offline documents." : "Download the trip for offline use while connected."}`);
  } finally {
    if (button) button.textContent = original;
  }
}

function safeDocumentFilename(metadata, blob) {
  const supplied = String(metadata?.filename || "").trim();
  if (supplied) return supplied.replaceAll(/[^A-Za-z0-9._ -]/g, "_").slice(0, 160);
  if (String(blob.type || "").toLowerCase().startsWith("application/pdf")) return "trip-document.pdf";
  return "trip-document";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function saveBlobToFiles(blob, metadata = {}) {
  const filename = safeDocumentFilename(metadata, blob);
  const title = metadata.referenceTitle || metadata.label || filename;
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return;
  }
  downloadBlob(blob, filename);
  showNotice(`${filename} was downloaded. On iPhone, choose Save to Files from the download or share menu.`);
}

async function saveDocumentToFiles(url, button) {
  const original = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Preparing PDF…";
  }
  try {
    const blob = await loadDocumentBlob(url);
    await saveBlobToFiles(blob, documentMetadataForUrl(url));
  } catch (error) {
    if (error?.name !== "AbortError") showNotice(error.message || "The document could not be saved.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original;
    }
  }
}

async function loadDocumentBlob(url) {
  if (state.offlineMode) {
    const blob = state.offlineAssets.get(url);
    if (!blob) throw new Error("This document was not selected for offline use");
    return blob;
  }
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(`Document unavailable (${response.status})`);
  return response.blob();
}

function isReadableConfirmation(blob) {
  const type = String(blob.type || "").toLowerCase();
  return type.startsWith("text/") || type.includes("message/rfc822");
}

function openOriginalDocument(blob, sourceUrl, metadata = {}, previewBlobs = []) {
  if (documentObjectUrl) URL.revokeObjectURL(documentObjectUrl);
  for (const url of documentPreviewObjectUrls) URL.revokeObjectURL(url);
  documentPreviewObjectUrls = [];
  documentObjectUrl = URL.createObjectURL(blob);
  const contentType = String(blob.type || "").toLowerCase();
  const downloadName = safeDocumentFilename(metadata, blob);
  const documentTitle = metadata.referenceTitle || metadata.label || "Document Viewer";
  const isMap = metadata.kind === "map";
  if (isMap && previewBlobs.length) documentPreviewObjectUrls = previewBlobs.map((page) => URL.createObjectURL(page));
  const viewer = isMap && documentPreviewObjectUrls.length
    ? `<div class="map-page-viewer" aria-label="Offline map viewer">${documentPreviewObjectUrls.map((url, index) => `<figure><img src="${url}" alt="${escapeHtml(metadata.previewPages[index]?.alt || `${documentTitle}, page ${index + 1}`)}"><figcaption>Page ${index + 1} of ${documentPreviewObjectUrls.length}</figcaption></figure>`).join("")}</div>`
    : contentType.startsWith("application/pdf")
    ? `<iframe class="document-frame" src="${documentObjectUrl}" title="${escapeHtml(documentTitle)}" scrolling="yes"></iframe>`
    : (contentType.startsWith("image/")
      ? `<div class="document-image-wrap"><img src="${documentObjectUrl}" alt="Private travel document"></div>`
      : `<div class="document-download-fallback"><p>This file cannot be shown inside the app. Download it without leaving My Travels.</p><a class="primary-button button-link" href="${documentObjectUrl}" download="${escapeHtml(downloadName)}">Download file</a></div>`);
  documentDialogContent.innerHTML = `
    <div class="private-document-viewer">
      <header class="document-viewer-header">
        <div><p class="detail-kicker">${isMap ? "Offline reference maps" : "Private document"}</p><h2>${escapeHtml(documentTitle)}</h2>${contentType.startsWith("application/pdf") ? '<p class="document-viewer-hint">Pinch to zoom and scroll through all pages.</p>' : ""}</div>
        <button class="primary-button" type="button" data-document-done>Close document</button>
      </header>
      ${viewer}
      <footer class="document-viewer-footer">
        <button class="secondary-button" type="button" data-save-open-document>${contentType.startsWith("application/pdf") ? "Save PDF To Files" : "Save To Files"}</button>
        <button class="primary-button" type="button" data-document-done>Close document</button>
      </footer>
    </div>`;
  $('[data-save-open-document]', documentDialogContent)?.addEventListener("click", async (buttonEvent) => {
    const button = buttonEvent.currentTarget;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Preparing…";
    try {
      await saveBlobToFiles(blob, { ...metadata, filename: downloadName });
    } catch (error) {
      if (error?.name !== "AbortError") showNotice(error.message || "The document could not be saved.");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
  $$('[data-document-done]', documentDialogContent).forEach((button) => {
    button.addEventListener("click", () => closeDialog(documentDialog));
  });
  openDialog(documentDialog);
}

function repairDocumentCharacters(value) {
  return value
    .replaceAll("â€”", "—")
    .replaceAll("â€“", "–")
    .replaceAll("â€œ", "“")
    .replaceAll("â€", "”")
    .replaceAll("â€™", "’")
    .replaceAll("Â", "")
    .replaceAll(/\r\n?/g, "\n");
}

function extractConfirmationSections(text) {
  const lines = text.split("\n");
  const sections = [];
  for (let index = 0; index < lines.length - 1;) {
    if (!lines[index].trim() || !/^-{3,}$/.test(lines[index + 1].trim())) {
      index += 1;
      continue;
    }
    const title = lines[index].trim();
    index += 2;
    const content = [];
    while (index < lines.length && !(lines[index].trim() && /^-{3,}$/.test(lines[index + 1]?.trim() || ""))) {
      content.push(lines[index]);
      index += 1;
    }
    sections.push({ title, content: content.join("\n").trim() });
  }
  return sections;
}

function confirmationSectionMarkup(text) {
  const hiddenSections = new Set(["Source file", "ChatGPT Library source identifier", "Preservation note"]);
  const titles = {
    "Message metadata": "Confirmation details",
    "Verified passage": "What was confirmed",
    "Evidence mapping": "What this confirms",
  };
  const sections = extractConfirmationSections(text)
    .filter((section) => section.content && !hiddenSections.has(section.title))
    .map((section) => ({
      ...section,
      content: section.content
        .split("\n")
        .filter((line) => !/^Author in thread:/i.test(line) && !/^libfile_/i.test(line.trim()))
        .join("\n")
        .trim(),
    }))
    .filter((section) => section.content);
  if (!sections.length) {
    const cleaned = text
      .replaceAll(/^ChatGPT Library source identifier[\s\S]*?(?=\n\S|$)/gmi, "")
      .replaceAll(/^libfile_\S+$/gmi, "")
      .trim();
    return `<section class="confirmation-section"><h3>Message</h3><div class="confirmation-copy">${escapeHtml(cleaned)}</div></section>`;
  }
  return sections.map((section) => `
    <section class="confirmation-section">
      <h3>${escapeHtml(listingTitle(titles[section.title] || section.title))}</h3>
      <div class="confirmation-copy">${escapeHtml(section.content)}</div>
    </section>`).join("");
}

async function showConfirmationDocument(blob) {
  const text = repairDocumentCharacters(new TextDecoder("utf-8").decode(await blob.arrayBuffer()));
  if (documentObjectUrl) URL.revokeObjectURL(documentObjectUrl);
  documentObjectUrl = URL.createObjectURL(blob);
  documentDialogContent.innerHTML = `
    <div class="modal-inner confirmation-viewer">
      <p class="detail-kicker">Private confirmation</p>
      <h2>Confirmation</h2>
      <p class="detail-time">A mobile-friendly reading copy. The original file remains available below.</p>
      <div class="confirmation-sections">${confirmationSectionMarkup(text)}</div>
      <div class="button-row confirmation-actions">
        <a class="secondary-button button-link" href="${documentObjectUrl}" download="trip-confirmation">Download original file</a>
        <button class="primary-button" type="button" data-confirmation-done>Done</button>
      </div>
    </div>`;
  $('[data-confirmation-done]', documentDialogContent).addEventListener("click", () => documentDialog.close());
  openDialog(documentDialog);
}

documentDialog.addEventListener("close", () => {
  if (documentObjectUrl) URL.revokeObjectURL(documentObjectUrl);
  for (const url of documentPreviewObjectUrls) URL.revokeObjectURL(url);
  documentPreviewObjectUrls = [];
  documentObjectUrl = null;
  documentDialogContent.replaceChildren();
});

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    state.serviceWorker = await navigator.serviceWorker.register("/trip/sw.js", { scope: "/trip/" });
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type !== "CACHE_COMPLETE") return;
      const failed = event.data.results.filter((result) => !result.ok);
      localStorage.setItem(STORAGE.offline, JSON.stringify({
        ready: failed.length === 0,
        updatedAt: new Date().toISOString(),
        failed: failed.map((result) => result.url),
      }));
      showNotice(failed.length ? `${failed.length} item(s) could not be saved offline.` : "Trip downloaded for offline use.");
      render();
    });
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

function offlineDocumentChoices(sourceItinerary = itinerary) {
  const choices = new Map();
  for (const reference of destinationReferenceChoices(sourceItinerary.trip)) {
    choices.set(reference.url, reference);
  }
  for (const day of sourceItinerary.days || []) {
    for (const activity of day.activities) {
      for (const document of activityDocuments(activity)) {
        const kind = document.scope === "leg" ? "flight leg" : "document";
        const url = document.url;
        const label = document.label || document.filename || listingTitle(activity.title);
        if (!url || choices.has(url)) continue;
        choices.set(url, { url, label, detail: formatDay(activity.dayDate || day.date, { short: true }), kind, required: false });
      }
    }
  }
  return [...choices.values()];
}

function downloadOffline() {
  if (!SERVER_AUTH) {
    showNotice("Encrypted offline downloads are available through the authenticated Cloudflare local prototype.");
    return;
  }
  if ((state.offlineSummary?.pendingCount || 0) + (state.offlineSummary?.conflictCount || 0) > 0) {
    showUnsyncedRemovalGuard(false, { updateDownload: true });
    return;
  }
  const choices = offlineDocumentChoices();
  recoveryDialogContent.innerHTML = `
    <div class="modal-inner offline-download-dialog">
      <p class="detail-kicker">Save to this device</p>
      <h2>Download Trip For Offline Use</h2>
      <p class="detail-time">The itinerary and destination photos are included. Choose the private documents to save in the encrypted offline copy.</p>
      <form id="offlineDownloadForm" class="offline-download-form">
        <fieldset class="offline-ticket-list">
          <legend>Selected documents</legend>
          ${choices.map((choice) => `<label class="offline-ticket-choice">${choice.required ? `<input type="hidden" name="offlineDocument" value="${escapeHtml(choice.url)}"><input type="checkbox" checked disabled aria-label="Always included">` : `<input type="checkbox" name="offlineDocument" value="${escapeHtml(choice.url)}" checked>`}<span><strong>${escapeHtml(choice.label)}</strong><small>${escapeHtml(choice.detail || "Trip document")}</small></span></label>`).join("") || '<p>No private documents are attached to this itinerary.</p>'}
        </fieldset>
        <label for="offlineCode">Re-enter ${escapeHtml(state.currentProfile)}’s six-digit code
          <input id="offlineCode" name="offlineCode" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required>
        </label>
        <details class="help-disclosure"><summary>Offline security details</summary><p>Recovery codes cannot unlock the saved trip. It is encrypted for this browser profile, but anything you open can be viewed by someone controlling an unlocked device.</p></details>
        <p class="form-error" data-offline-error role="alert"></p>
        <div class="button-row download-actions"><button class="primary-button" type="submit">${state.offlineSummary ? "Update saved trip" : "Save trip offline"}</button><button class="secondary-button" type="button" data-cancel-offline>Cancel</button></div>
      </form>
    </div>`;
  const form = $("#offlineDownloadForm", recoveryDialogContent);
  form.addEventListener("submit", saveOfflineDownload);
  $('[data-cancel-offline]', form).addEventListener("click", () => closeDialog(recoveryDialog));
  openDialog(recoveryDialog);
}

function collectMediaUrls(sourceItinerary) {
  const urls = new Set();
  for (const media of Object.values(sourceItinerary.trip.media || {})) {
    if (media?.day) urls.add(media.day);
    if (media?.night) urls.add(media.night);
  }
  return [...urls];
}

function collectDestinationReferencePreviewUrls(sourceItinerary) {
  return destinationReferences(sourceItinerary.trip).flatMap((reference) => (
    (reference.previewPages || []).map((page, index) => ({
      url: page.url,
      kind: "media",
      name: `${reference.title || "Destination maps"}, page ${index + 1}`,
    }))
  ));
}

async function fetchOfflineAsset(url, kind, name) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(`${name} could not be downloaded (${response.status})`);
  const blob = await response.blob();
  if (blob.size > 40 * 1024 * 1024) throw new Error(`${name} is too large for the device download`);
  return { url, kind, name, blob };
}

async function saveOfflineDownload(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = $('button[type="submit"]', form);
  const errorBox = $('[data-offline-error]', form);
  const code = new FormData(form).get("offlineCode")?.trim() || "";
  const selectedDocuments = new Set(new FormData(form).getAll("offlineDocument"));
  submit.disabled = true;
  submit.textContent = "Encrypting download…";
  errorBox.textContent = "";
  try {
    await fetchJson("/api/trip/reauth", { method: "POST", body: JSON.stringify({ code }) });
    const fresh = await fetchJson("/api/trip/itinerary");
    const documentChoices = new Map(offlineDocumentChoices(fresh.itinerary).map((choice) => [choice.url, choice]));
    for (const choice of documentChoices.values()) if (choice.required) selectedDocuments.add(choice.url);
    const requested = [
      ...collectMediaUrls(fresh.itinerary).map((url, index) => ({ url, kind: "media", name: `Destination image ${index + 1}` })),
      ...collectDestinationReferencePreviewUrls(fresh.itinerary),
      ...[...selectedDocuments].map((url) => {
        const choice = documentChoices.get(url);
        return { url, kind: choice?.kind || "document", name: choice?.label || "Trip document" };
      }),
    ];
    const assets = [];
    let totalBytes = 0;
    for (const request of requested) {
      const asset = await fetchOfflineAsset(request.url, request.kind, request.name);
      totalBytes += asset.blob.size;
      if (totalBytes > 150 * 1024 * 1024) throw new Error("The selected offline package is larger than 150 MB");
      assets.push(asset);
    }
    if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
    state.offlineSummary = await saveOfflineVault({
      traveller: state.currentProfile,
      code,
      itinerary: fresh.itinerary,
      overrides: fresh.overrides || {},
      revisions: fresh.revisions || {},
      assets,
    });
    itinerary = fresh.itinerary;
    state.overrides = fresh.overrides || {};
    state.revisions = fresh.revisions || {};
    state.pendingChanges = [];
    state.conflicts = [];
    state.pendingChangedAt = null;
    state.pendingExportedAt = null;
    const archivedTrips = readJson(localStorage.getItem(STORAGE.archived), {});
    delete archivedTrips[state.currentProfile];
    localStorage.setItem(STORAGE.archived, JSON.stringify(archivedTrips));
    await closeDialogAndSettle(recoveryDialog);
    render();
    showNotice(
      `Itinerary, destination photos, and ${state.offlineSummary.documentCount ?? state.offlineSummary.ticketCount ?? 0} document${(state.offlineSummary.documentCount ?? state.offlineSummary.ticketCount ?? 0) === 1 ? "" : "s"} saved on this device.`,
      { title: "Trip saved for offline use" },
    );
  } catch (error) {
    errorBox.textContent = error.status === 401
      ? "That six-digit code was not recognized. Recovery codes cannot be used for offline encryption."
      : (error.status === 429 ? "Too many attempts. Please wait before trying again." : error.message);
    submit.disabled = false;
    submit.textContent = state.offlineSummary ? "Update saved trip" : "Save trip offline";
  }
}

async function unlockPendingVault(code) {
  await fetchJson("/api/trip/reauth", { method: "POST", body: JSON.stringify({ code }) });
  const bundle = await unlockOfflineVault(state.currentProfile, code);
  state.offlineKey = bundle.key;
  state.pendingChanges = bundle.pendingChanges || [];
  state.conflicts = bundle.conflicts || [];
  state.pendingChangedAt = bundle.pendingChangedAt || null;
  state.pendingExportedAt = bundle.pendingExportedAt || null;
  state.offlineAssets = new Map(bundle.assets.map((asset) => [asset.url, asset.blob]));
  return bundle;
}

function showPendingSyncUnlock({ action = "sync", archive = false, updateDownload = false } = {}) {
  recoveryDialogContent.innerHTML = `
    <div class="modal-inner">
      <p class="detail-kicker">Protected local changes</p>
      <h2>Unlock Pending Changes</h2>
      <p class="detail-time">Re-enter ${escapeHtml(state.currentProfile)}’s six-digit code to decrypt this device’s pending changes${action === "sync" ? " and sync them after server authentication" : ""}.</p>
      <form id="pendingUnlockForm">
        <label for="pendingUnlockCode">Six-digit code<input id="pendingUnlockCode" name="code" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required></label>
        <p class="form-error" data-pending-unlock-error role="alert"></p>
        <div class="button-row"><button class="primary-button" type="submit">Unlock</button><button class="secondary-button" type="button" data-cancel-pending-unlock>Cancel</button></div>
      </form>
    </div>`;
  const form = $("#pendingUnlockForm", recoveryDialogContent);
  $('[data-cancel-pending-unlock]', form).addEventListener("click", () => recoveryDialog.close());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = $('button[type="submit"]', form);
    const errorBox = $('[data-pending-unlock-error]', form);
    submit.disabled = true;
    submit.textContent = "Unlocking…";
    errorBox.textContent = "";
    try {
      await unlockPendingVault(new FormData(form).get("code")?.trim() || "");
      recoveryDialog.close();
      if (action === "sync") await syncPendingChanges();
      else if (updateDownload) showUnsyncedRemovalGuard(false, { updateDownload: true });
      else confirmOfflineRemoval(archive);
    } catch (error) {
      errorBox.textContent = error.status === 401 ? "That six-digit code was not recognized." : error.message;
      submit.disabled = false;
      submit.textContent = "Unlock";
    }
  });
  openDialog(recoveryDialog);
}

async function beginPendingSync() {
  if (!state.offlineSummary || Number(state.offlineSummary.pendingCount || 0) + Number(state.offlineSummary.conflictCount || 0) === 0) {
    showNotice("There are no pending local changes to sync.");
    return;
  }
  if (!state.offlineKey) {
    showPendingSyncUnlock();
    return;
  }
  try {
    await fetchJson("/api/trip/session");
    await syncPendingChanges();
  } catch (error) {
    if (error.status === 401) {
      state.networkUnavailable = false;
      await signOut();
      accessError.textContent = "Sign in to sync the protected local changes on this device.";
      return;
    }
    showNotice("The connection is not ready. Your pending changes remain encrypted on this device.");
  }
}

async function syncPendingChanges() {
  if (!state.pendingChanges.length) {
    if (state.conflicts.length) showConflictReview();
    return;
  }
  try {
    const response = await fetchJson("/api/trip/sync", {
      method: "POST",
      body: JSON.stringify({ mutations: state.pendingChanges }),
    });
    const reconciled = reconcileSyncResult(state.pendingChanges, response);
    state.pendingChanges = reconciled.pending;
    state.conflicts = [...state.conflicts, ...reconciled.conflicts];
    const fresh = await fetchJson("/api/trip/itinerary");
    applyServerSnapshot(fresh);
    state.offlineMode = false;
    state.networkUnavailable = false;
    if (!state.pendingChanges.length && !state.conflicts.length) {
      state.pendingChangedAt = null;
      state.pendingExportedAt = null;
    }
    await persistOfflineWorkingState({ markSynced: true });
    render();
    if (state.conflicts.length) showConflictReview();
    else showNotice("All pending offline changes synced successfully.");
  } catch (error) {
    showNotice(error.status === 401
      ? "Sign in again before syncing. Your local changes remain protected."
      : "Sync could not finish. Your local changes remain encrypted and pending.");
  }
}

function mutationDisplay(mutation) {
  if (!mutation) return "No local mutation details are available.";
  if (["restore", "delete"].includes(mutation.kind)) return mutation.kind === "restore" ? "Restore the original itinerary activity." : "Delete the added activity.";
  return JSON.stringify(mutation.kind === "add" ? mutation.activity : mutation.changes || {}, null, 2);
}

function serverDisplay(conflict) {
  if (!conflict.server) return "Original itinerary value or deleted added activity.";
  return JSON.stringify(conflict.server, null, 2);
}

async function saveConflictState() {
  if (!state.offlineKey) {
    render();
    return;
  }
  if (!state.pendingChanges.length && !state.conflicts.length) {
    state.pendingChangedAt = null;
    state.pendingExportedAt = null;
  }
  await persistOfflineWorkingState({ markSynced: true });
  render();
}

function showConflictReview() {
  const conflict = state.conflicts[0];
  if (!conflict) {
    showNotice("All conflicts have been reviewed.");
    return;
  }
  recoveryDialogContent.innerHTML = `
    <div class="modal-inner conflict-review">
      <p class="detail-kicker">Sync conflict</p>
      <h2>Review ${escapeHtml(conflict.activityId)}</h2>
      <p class="detail-time">Another authenticated edit changed this activity after the offline copy was downloaded. Neither version has been overwritten.</p>
      <h3>Current Server Version</h3><pre>${escapeHtml(serverDisplay(conflict))}</pre>
      <h3>${escapeHtml(state.currentProfile)}’s Offline Change</h3><pre>${escapeHtml(mutationDisplay(conflict.mutation))}</pre>
      <div class="button-row"><button class="primary-button" type="button" data-use-local>Use my offline change</button><button class="secondary-button" type="button" data-use-server>Keep server version</button><button class="secondary-button" type="button" data-export-conflicts>Export pending changes</button><button class="secondary-button" type="button" data-review-later>Review later</button></div>
      <p class="security-note">Choosing a version is explicit. “Use my offline change” retries against the server revision shown above; “Keep server version” discards only this local mutation.</p>
    </div>`;
  $('[data-review-later]', recoveryDialogContent).addEventListener("click", () => recoveryDialog.close());
  $('[data-export-conflicts]', recoveryDialogContent).addEventListener("click", exportUnsyncedChanges);
  $('[data-use-server]', recoveryDialogContent).addEventListener("click", async () => {
    state.conflicts.shift();
    await saveConflictState();
    recoveryDialog.close();
    if (state.conflicts.length) showConflictReview();
    else showNotice("Server version kept. The local conflicting change was discarded.");
  });
  $('[data-use-local]', recoveryDialogContent).addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Applying…";
    let mutation = { ...conflict.mutation, mutationId: mutationToken(), baseRevision: conflict.serverRevision };
    if (mutation.kind === "update" && conflict.serverRevision === 0 && mutation.activity?.custom) {
      mutation = { ...mutation, kind: "add", activity: mutation.activity, changes: undefined };
    }
    try {
      const response = await fetchJson("/api/trip/sync", { method: "POST", body: JSON.stringify({ mutations: [mutation] }) });
      state.conflicts.shift();
      if (response.conflicts?.length) state.conflicts.unshift({ ...response.conflicts[0], mutation, detectedAt: new Date().toISOString() });
      applyServerSnapshot(await fetchJson("/api/trip/itinerary"));
      await saveConflictState();
      recoveryDialog.close();
      if (state.conflicts.length) showConflictReview();
      else showNotice("The offline change was applied after your explicit review.");
    } catch {
      button.disabled = false;
      button.textContent = "Use my offline change";
    }
  });
  openDialog(recoveryDialog);
}

async function exportUnsyncedChanges() {
  const exportedAt = new Date().toISOString();
  downloadText(
    `my-travels-${state.currentProfile.toLowerCase()}-pending-${exportedAt.slice(0, 10)}.json`,
    `${JSON.stringify({ tripId: itinerary.trip.id, traveller: state.currentProfile, exportedAt, pendingChanges: state.pendingChanges, conflicts: state.conflicts }, null, 2)}\n`,
    "application/json",
  );
  state.pendingExportedAt = exportedAt;
  if (state.offlineKey) await persistOfflineWorkingState();
  render();
}

function showUnsyncedRemovalGuard(archive, { updateDownload = false } = {}) {
  if (!state.offlineKey) {
    showPendingSyncUnlock({ action: "manage", archive, updateDownload });
    return;
  }
  const count = state.pendingChanges.length + state.conflicts.length;
  recoveryDialogContent.innerHTML = `
    <div class="modal-inner">
      <p class="detail-kicker">Unsynced changes protected</p>
      <h2>${count} Local Change${count === 1 ? "" : "s"} Must Be Handled</h2>
      <p class="detail-time">The offline package cannot be ${updateDownload ? "replaced" : (archive ? "archived" : "removed")} until these changes sync, are exported, or you explicitly discard them.</p>
      <div class="button-row"><button class="primary-button" type="button" data-guard-sync>Sync now</button><button class="secondary-button" type="button" data-guard-export>Export changes</button>${state.conflicts.length ? '<button class="secondary-button" type="button" data-guard-review>Review conflicts</button>' : ""}<button class="danger-button" type="button" data-guard-discard>Discard unsynced changes${updateDownload ? " and replace" : ""}</button><button class="secondary-button" type="button" data-guard-cancel>Cancel</button></div>
    </div>`;
  $('[data-guard-cancel]', recoveryDialogContent).addEventListener("click", () => recoveryDialog.close());
  $('[data-guard-sync]', recoveryDialogContent).addEventListener("click", async () => { recoveryDialog.close(); await beginPendingSync(); });
  $('[data-guard-review]', recoveryDialogContent)?.addEventListener("click", () => { recoveryDialog.close(); showConflictReview(); });
  $('[data-guard-export]', recoveryDialogContent).addEventListener("click", async () => {
    await exportUnsyncedChanges();
    recoveryDialog.close();
    confirmOfflineRemoval(archive, { afterRemove: updateDownload ? downloadOffline : null });
  });
  $('[data-guard-discard]', recoveryDialogContent).addEventListener("click", async () => {
    state.pendingChanges = [];
    state.conflicts = [];
    state.pendingChangedAt = null;
    state.pendingExportedAt = null;
    recoveryDialog.close();
    await performOfflineRemoval(archive, { afterRemove: updateDownload ? downloadOffline : null });
  });
  openDialog(recoveryDialog);
}

function confirmOfflineRemoval(archive, { afterRemove = null } = {}) {
  const policy = removalPolicy(state.offlineSummary);
  if (!policy.allowed) {
    showUnsyncedRemovalGuard(archive, { updateDownload: Boolean(afterRemove) });
    return;
  }
  recoveryDialogContent.innerHTML = `
    <div class="modal-inner">
      <p class="detail-kicker">This device only</p>
      <h2>${archive ? "Archive Local Trip Copy?" : "Remove Offline Download?"}</h2>
      <p class="detail-time">The encrypted itinerary, images and selected documents will be removed from this browser profile. Private server originals will remain unchanged.${policy.reason === "exported" ? " Unsynced changes were explicitly exported." : ""}</p>
      <div class="button-row"><button class="danger-button" type="button" data-confirm-remove>${archive ? "Archive and remove" : "Remove from device"}</button><button class="secondary-button" type="button" data-cancel-remove>Keep offline copy</button></div>
    </div>`;
  $('[data-cancel-remove]', recoveryDialogContent).addEventListener("click", () => recoveryDialog.close());
  $('[data-confirm-remove]', recoveryDialogContent).addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Removing…";
    recoveryDialog.close();
    await performOfflineRemoval(archive, { afterRemove });
  });
  openDialog(recoveryDialog);
}

async function performOfflineRemoval(archive, { afterRemove = null } = {}) {
  await removeOfflineVault(state.currentProfile);
  state.offlineSummary = null;
  state.pendingChanges = [];
  state.conflicts = [];
  state.pendingChangedAt = null;
  state.pendingExportedAt = null;
  state.offlineKey = null;
  if (archive) {
    const archivedTrips = readJson(localStorage.getItem(STORAGE.archived), {});
    archivedTrips[state.currentProfile] = new Date().toISOString();
    localStorage.setItem(STORAGE.archived, JSON.stringify(archivedTrips));
  }
  if (afterRemove) {
    afterRemove();
    return;
  }
  if (state.offlineMode) {
    await signOut();
    accessError.textContent = archive
      ? "The local trip was archived and its encrypted offline package was removed."
      : "The encrypted offline package was removed from this device.";
  } else {
    render();
    showNotice(archive ? "Local trip copy archived and removed. Server originals were preserved." : "Offline download removed from this device. Server originals were preserved.");
  }
}

function exportCalendar() {
  const activeActivities = getDays().flatMap((day) => day.activities).filter((activity) => activity.status !== "cancelled" && activity.projectionKind !== "flight-arrival");
  const timeZones = [...new Set(activeActivities.filter((activity) => !activity.startUtc).map((activity) => activity.timeZone))];
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//danstiffler.com//My Travels//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(`My Travels — ${itinerary.trip.name}`)}`,
    ...timeZones.flatMap(vTimeZone),
  ];

  activeActivities.forEach((activity) => {
    const alertMinutes = Math.max(15, Number(activity.travelMinutes || 0) + Number(activity.arrivalBufferMinutes || 0));
    const rootId = editableActivityId(activity);
    const root = findEditableActivity(rootId);
    const legId = activity.projectionKind === "flight-departure" ? (root?.flight?.legs?.[activity.flightLegIndex]?.legId || `leg-${activity.flightLegIndex + 1}`) : "";
    const calendarId = legId ? `${rootId}-${legId}` : rootId;
    const sequence = state.overrides[rootId] ? 1 : 0;
    const startLine = activity.startUtc
      ? `DTSTART:${utcStamp(new Date(activity.startUtc))}`
      : `DTSTART;TZID=${activity.timeZone}:${icsLocal(activity.dayDate, activity.start)}`;
    const endLine = activity.endUtc
      ? `DTEND:${utcStamp(new Date(activity.endUtc))}`
      : `DTEND;TZID=${activity.timeZone}:${icsLocal(activity.endDate || activity.dayDate, activity.end)}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcs(`${itinerary.trip.id}-${calendarId}@danstiffler.com`)}`,
      `DTSTAMP:${utcStamp(new Date())}`,
      `SEQUENCE:${sequence}`,
      startLine,
      endLine,
      `SUMMARY:${escapeIcs(listingTitle(activity.title))}`,
      `LOCATION:${escapeIcs(activity.address || activity.venue || activity.city)}`,
      `DESCRIPTION:${escapeIcs([activity.note, activity.whatToWear ? `What to wear: ${activity.whatToWear}` : ""].filter(Boolean).join("\n\n"))}`,
      "BEGIN:VALARM",
      `TRIGGER:-PT${alertMinutes}M`,
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcs(`Leave for ${listingTitle(activity.title)}`)}`,
      "END:VALARM",
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  downloadText("my-travels-itinerary.ics", `${lines.join("\r\n")}\r\n`, "text/calendar;charset=utf-8");
}

function vTimeZone(timeZone) {
  const fixedZones = {
    "Asia/Hong_Kong": { name: "HKT", offset: "+0800" },
    "Asia/Singapore": { name: "SGT", offset: "+0800" },
    "Asia/Ho_Chi_Minh": { name: "ICT", offset: "+0700" },
    "Asia/Phnom_Penh": { name: "ICT", offset: "+0700" },
    "Asia/Bangkok": { name: "ICT", offset: "+0700" },
  };
  const zone = fixedZones[timeZone] || { name: timeZone, offset: "+0000" };
  return [
    "BEGIN:VTIMEZONE",
    `TZID:${timeZone}`,
    `X-LIC-LOCATION:${timeZone}`,
    "BEGIN:STANDARD",
    `TZOFFSETFROM:${zone.offset}`,
    `TZOFFSETTO:${zone.offset}`,
    `TZNAME:${zone.name}`,
    "DTSTART:19700101T000000",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];
}

function icsLocal(date, time) {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function utcStamp(date) {
  return date.toISOString().replaceAll(/[-:]/g, "").replace(".000", "");
}

function downloadText(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
