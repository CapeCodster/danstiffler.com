const $ = (selector) => document.querySelector(selector);
const accessStatus = $("#accessStatus");
const importForm = $("#importForm");
const workbookFile = $("#workbookFile");
const attachmentFiles = $("#attachmentFiles");
const selectedFiles = $("#selectedFiles");
const reviewButton = $("#reviewButton");
const uploadError = $("#uploadError");
const reviewStep = $("#reviewStep");
const reviewContent = $("#reviewContent");
const mergeButton = $("#mergeButton");
const mergeError = $("#mergeError");
const resultStep = $("#resultStep");
const resultContent = $("#resultContent");

let reviewed = null;

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function display(value) {
  if (value === "" || value == null) return '<span class="muted">blank</span>';
  if (typeof value === "object") return escapeHtml(JSON.stringify(value));
  return escapeHtml(value);
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || `Request failed (${response.status})`), { status: response.status });
  return body;
}

function selectedUpload(token = "") {
  const workbook = workbookFile.files[0];
  if (!workbook) throw new Error("Choose the schema v5 workbook.");
  const attachments = [...attachmentFiles.files];
  const form = new FormData();
  form.append("workbook", workbook, workbook.name);
  attachments.forEach((file) => form.append("attachments", file, file.name));
  if (token) form.append("review_token", token);
  return { form, size: workbook.size + attachments.reduce((total, file) => total + file.size, 0) };
}

function updateFiles() {
  const workbook = workbookFile.files[0];
  const attachments = [...attachmentFiles.files];
  selectedFiles.innerHTML = [workbook ? `<div><strong>Workbook:</strong> ${escapeHtml(workbook.name)}</div>` : "", ...attachments.map((file) => `<div><strong>Protected file:</strong> ${escapeHtml(file.name)}</div>`)].join("");
}

function issueMarkup(items, className) {
  if (!items.length) return "";
  return `<ul class="issue-list ${className}">${items.map((item) => `<li><div class="issue-location">${escapeHtml(item.sheet)}${item.row ? ` · row ${item.row}` : ""}${item.column ? ` · ${escapeHtml(item.column)}` : ""}</div><div>${escapeHtml(item.message)}</div></li>`).join("")}</ul>`;
}

function recordMarkup(record) {
  const changes = record.changes || [];
  return `<li class="record-card">
    <header><div><h3>${escapeHtml(record.recordType)} · ${escapeHtml(record.stableId)}</h3><p class="record-meta">${escapeHtml(record.sheet)} row ${record.row}${record.timingSource ? ` · timing from ${escapeHtml(record.timingSource)}` : ""}${record.attachment?.legId ? ` · leg ${escapeHtml(record.attachment.legId)}` : ""}</p></div><span class="action-pill" data-action="${escapeHtml(record.action)}">${escapeHtml(record.action)}</span></header>
    ${changes.length ? `<table class="change-table"><thead><tr><th>Field</th><th>Current</th><th>After merge</th></tr></thead><tbody>${changes.map((change) => `<tr><td>${escapeHtml(change.field)}</td><td>${display(change.before)}</td><td class="${change.mode === "clear" ? "clear-value" : ""}">${change.mode === "clear" ? "Explicitly cleared" : display(change.after)}</td></tr>`).join("")}</tbody></table>` : '<p class="kept-note">No stored value changes; stable-ID matching makes this row idempotent.</p>'}
    ${record.preservedBlanks?.length ? `<details class="help-disclosure"><summary>${record.preservedBlanks.length} blank cell${record.preservedBlanks.length === 1 ? "" : "s"} leave current values in place</summary><p>${record.preservedBlanks.slice(0, 20).map((item) => `<strong>${escapeHtml(item.field)}</strong>: ${display(item.value)}`).join("<br>")}</p></details>` : ""}
  </li>`;
}

function renderReview(review) {
  const counts = review.summary;
  reviewContent.innerHTML = `
    <div class="review-banner"><strong>${escapeHtml(review.activeTrip.name)}</strong> · ${escapeHtml(review.activeTrip.id)} · ${review.activeTrip.dayCount} pre-created days<br><small>Workbook SHA-256 ${escapeHtml(review.workbook.sha256.slice(0, 16))}… · schema ${escapeHtml(review.schemaVersion)}</small></div>
    <div class="review-summary">${[["Add", counts.add], ["Update", counts.update], ["Unchanged", counts.unchanged], ["Conflicts", counts.conflict], ["Errors", review.errors.length]].map(([label, value]) => `<div class="review-stat"><strong>${value}</strong><span>${label}</span></div>`).join("")}</div>
    ${review.errors.length ? `<div class="review-banner review-banner--error"><strong>Merge blocked.</strong> Correct the workbook at the sheet and row shown, then review again.</div>${issueMarkup(review.errors, "")}` : '<div class="review-banner"><strong>Validation passed.</strong> No write has occurred yet.</div>'}
    ${review.warnings.length ? `<div class="review-banner review-banner--warning"><strong>${review.warnings.length} review note${review.warnings.length === 1 ? "" : "s"}</strong></div>${issueMarkup(review.warnings, "")}` : ""}
    <div class="review-banner"><strong>Matching:</strong> stable activity and leg IDs, workbook revisions for changed activities, and filename + SHA-256 for protected files.<br><strong>Blank:</strong> keep current value. <strong>__CLEAR__:</strong> explicitly clear an eligible optional field. Omitted rows leave existing records in place.</div>
    <ul class="record-list">${review.records.map(recordMarkup).join("")}</ul>`;
  mergeButton.disabled = !review.canMerge;
  mergeButton.textContent = review.canMerge ? "Confirm Merge" : "Resolve Errors First";
}

async function initialize() {
  try {
    const session = await jsonRequest("/api/trip/session");
    if (!new Set(["preview", "local"]).has(session.environment)) throw new Error("Import Trip is disabled here. Open the Preview deployment for this pilot.");
    accessStatus.innerHTML = `<h2>Preview access confirmed</h2><p>Signed in as <strong>${escapeHtml(session.user.displayName)}</strong>. Production remains outside this workflow.</p>`;
    importForm.hidden = false;
  } catch (error) {
    accessStatus.innerHTML = `<h2>Preview sign-in required</h2><p>${escapeHtml(error.message)}</p><a class="primary-button button-link" href="/trip/">Open My Travels Sign In</a>`;
  }
}

workbookFile.addEventListener("change", updateFiles);
attachmentFiles.addEventListener("change", updateFiles);

importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  uploadError.textContent = "";
  reviewButton.disabled = true;
  reviewButton.textContent = "Reviewing…";
  try {
    const upload = selectedUpload();
    reviewed = await jsonRequest("/api/trip/import/review", { method: "POST", body: upload.form, headers: { "X-Trip-Size": String(upload.size) } });
    renderReview(reviewed);
    reviewStep.hidden = false;
    resultStep.hidden = true;
    reviewStep.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    uploadError.textContent = error.message;
  } finally {
    reviewButton.disabled = false;
    reviewButton.textContent = "Review Import";
  }
});

mergeButton.addEventListener("click", async () => {
  if (!reviewed?.canMerge) return;
  mergeError.textContent = "";
  mergeButton.disabled = true;
  mergeButton.textContent = "Merging…";
  try {
    const upload = selectedUpload(reviewed.reviewToken);
    const result = await jsonRequest("/api/trip/import/merge", { method: "POST", body: upload.form, headers: { "X-Trip-Size": String(upload.size) } });
    resultContent.innerHTML = `<div class="review-summary">${[["Added", result.summary.add], ["Updated", result.summary.update], ["Unchanged", result.summary.unchanged]].map(([label, value]) => `<div class="review-stat"><strong>${value}</strong><span>${label}</span></div>`).join("")}</div>
      <p>Merged ${escapeHtml(new Date(result.mergedAt).toLocaleString())}. Uploading the same workbook and file again should review as unchanged.</p>
      ${result.documents.length ? `<div class="result-documents"><h3>Protected documents</h3>${result.documents.map((document) => `<a class="secondary-button button-link" href="${escapeHtml(document.url)}" target="_blank" rel="noopener">Open ${escapeHtml(document.filename)}${document.legId ? ` · ${escapeHtml(document.legId)}` : ""} (${escapeHtml(document.action)})</a>`).join("")}</div>` : ""}`;
    resultStep.hidden = false;
    reviewStep.hidden = true;
    resultStep.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    mergeError.textContent = error.message;
    mergeButton.disabled = false;
    mergeButton.textContent = "Confirm Merge";
  }
});

$("#reviewAgain").addEventListener("click", () => { reviewStep.hidden = true; importForm.scrollIntoView({ behavior: "smooth" }); });
$("#importAgain").addEventListener("click", () => { reviewed = null; resultStep.hidden = true; importForm.reset(); selectedFiles.innerHTML = ""; importForm.scrollIntoView({ behavior: "smooth" }); });

initialize();
