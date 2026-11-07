import {
  ACCOMMODATION_SUBTYPES,
  ACTIVITY_TYPES,
  activityTypeFor,
  cityRideServices,
  connectionDetails,
  durationLabel,
  flightJourneySummary,
  legElapsedMinutes,
  typeDetailsFor,
} from "./activity-model.js";

const TIME_ZONE_SUGGESTIONS = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "Europe/London", "Europe/Paris", "Asia/Seoul", "Asia/Singapore", "Asia/Hong_Kong",
  "Asia/Tokyo", "Asia/Bangkok", "Australia/Sydney", "Pacific/Auckland", "UTC",
];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function selected(value, expected) {
  return value === expected ? " selected" : "";
}

function checked(value) {
  return value ? " checked" : "";
}

function valueOf(form, name, fallback = "") {
  return String(new FormData(form).get(name) ?? fallback).trim();
}

function scopedValue(scope, name, fallback = "") {
  return String(scope.querySelector(`[name="${name}"]`)?.value ?? fallback).trim();
}

function dateOptions(days, current) {
  return days.map((day) => `<option value="${escapeHtml(day.date)}"${selected(day.date, current)}>${escapeHtml(day.date)} — ${escapeHtml(day.city)}</option>`).join("");
}

function statusOptions(current) {
  return ["planned", "confirmed", "awaiting", "purchased", "done", "skipped", "cancelled"]
    .map((status) => `<option value="${status}"${selected(status, current)}>${escapeHtml({ awaiting: "Awaiting Confirmation" }[status] || `${status.charAt(0).toUpperCase()}${status.slice(1)}`)}</option>`)
    .join("");
}

function timeZoneList() {
  return `<datalist id="travelTimeZones">${TIME_ZONE_SUGGESTIONS.map((zone) => `<option value="${zone}"></option>`).join("")}</datalist>`;
}

function travelerControls(travelers = []) {
  const source = Array.isArray(travelers) ? travelers.join(" ") : String(travelers || "");
  const selectedTravelers = new Set(["Dan", "Ken"].filter((name) => new RegExp(`\\b${name}\\b`, "i").test(source)));
  return `<fieldset class="traveler-fieldset"><legend>Travelers</legend>
    <label class="checkbox-row"><input type="checkbox" name="travelers" value="Dan"${checked(selectedTravelers.has("Dan"))}> Dan</label>
    <label class="checkbox-row"><input type="checkbox" name="travelers" value="Ken"${checked(selectedTravelers.has("Ken"))}> Ken</label>
  </fieldset>`;
}

function documentList(activity) {
  const documents = [
    ...(activity.documents || []),
    ...((activity.flight?.legs || []).flatMap((leg) => leg.documents || [])),
  ];
  return documents.length
    ? `<ul class="attached-document-list">${documents.map((document) => `<li><span>${escapeHtml(document.label || document.filename || "Trip Document")}</span><small>${document.scope === "leg" ? `Flight Leg ${Number(document.legIndex || 0) + 1}` : "Activity"}</small></li>`).join("")}</ul>`
    : '<p class="section-empty">No protected documents attached.</p>';
}

function commonOptionalSections(activity, offline) {
  const cost = activity.cost || {};
  return `
    <details class="form-section form-section--optional">
      <summary>Booking Details</summary>
      <div class="form-section-body">
        <label>Booking Reference<input name="bookingReference" maxlength="120" value="${escapeHtml(activity.bookingReference || "")}"></label>
        <div class="form-columns"><label>Cost<input name="costAmount" inputmode="decimal" maxlength="40" value="${escapeHtml(cost.amount || "")}"></label><label>Currency<input name="currency" maxlength="8" autocapitalize="characters" value="${escapeHtml(cost.currency || "")}"></label></div>
        <label>Cancellation Terms<textarea name="cancellationTerms" rows="3" maxlength="3000">${escapeHtml(activity.cancellationTerms || "")}</textarea></label>
        <label>Contact Details<textarea name="contact" rows="2" maxlength="1000">${escapeHtml(activity.contact || "")}</textarea></label>
        <label>Booking Details<textarea name="bookingDetails" rows="3" maxlength="4000">${escapeHtml(activity.bookingDetails || "")}</textarea></label>
      </div>
    </details>
    <details class="form-section form-section--optional">
      <summary>Documents And Notes</summary>
      <div class="form-section-body">
        ${documentList(activity)}
        <label>Attach Protected Documents<input name="activityDocuments" type="file" accept=".pdf,.jpg,.jpeg,.png,.txt,.eml,application/pdf,image/jpeg,image/png,text/plain,message/rfc822" multiple${offline ? " disabled" : ""}></label>
        ${offline ? '<p class="security-note">Reconnect before attaching documents. Offline activity details can still be saved and synchronized later.</p>' : '<p class="security-note">Files are delivered only through authenticated access. Select them again if you leave this form before saving.</p>'}
        <label>Notes<textarea name="note" rows="4" maxlength="4000">${escapeHtml(activity.note || "")}</textarea></label>
        <label>What To Wear<textarea name="whatToWear" rows="3" maxlength="1000">${escapeHtml(activity.whatToWear || "")}</textarea></label>
      </div>
    </details>`;
}

function endpointFields(prefix, endpoint, title) {
  return `<fieldset class="flight-endpoint"><legend>${title}</legend>
    <div class="form-columns"><label>Airport Code<input name="${prefix}Airport" maxlength="8" autocapitalize="characters" value="${escapeHtml(endpoint.airport || "")}" required></label><label>City<input name="${prefix}City" maxlength="120" value="${escapeHtml(endpoint.city || "")}"></label></div>
    <label>Terminal<input name="${prefix}Terminal" maxlength="80" value="${escapeHtml(endpoint.terminal || "")}"></label>
    <div class="form-columns"><label>Date<input name="${prefix}Date" type="date" value="${escapeHtml(endpoint.date || "")}" required></label><label>Local Time<input name="${prefix}Time" type="time" value="${escapeHtml(endpoint.time || "")}" required></label></div>
    <label>Time Zone<input name="${prefix}TimeZone" list="travelTimeZones" maxlength="80" value="${escapeHtml(endpoint.timeZone || "")}" required></label>
  </fieldset>`;
}

function flightLegCard(leg, index, offline = false) {
  const seats = new Map((leg.seats || []).map((seat) => [seat.traveler, seat.seat]));
  return `<section class="flight-leg-card" data-flight-leg="${index}">
    <header><div><span class="leg-number">${index + 1}</span><strong>Flight Leg ${index + 1}</strong></div><button class="secondary-button compact-button" type="button" data-remove-flight-leg${index === 0 ? " disabled" : ""}>Remove Leg</button></header>
    <div class="form-columns"><label>Airline<input name="legAirline" maxlength="120" value="${escapeHtml(leg.airline || "")}" required></label><label>Flight Number<input name="legFlightNumber" maxlength="20" autocapitalize="characters" value="${escapeHtml(leg.flightNumber || "")}" required></label></div>
    ${endpointFields("departure", leg.departure || {}, "Departure")}
    ${endpointFields("arrival", leg.arrival || {}, "Arrival")}
    <details class="leg-options"><summary>Seats And Separate Booking</summary><div class="form-section-body">
      <div class="form-columns"><label>Dan’s Seat<input name="seatDan" maxlength="12" autocapitalize="characters" value="${escapeHtml(seats.get("Dan") || "")}"></label><label>Ken’s Seat<input name="seatKen" maxlength="12" autocapitalize="characters" value="${escapeHtml(seats.get("Ken") || "")}"></label></div>
      <label>Leg Booking Reference<input name="legBookingReference" maxlength="120" value="${escapeHtml(leg.bookingReference || "")}"></label>
      <label>Leg Booking Status<select name="legStatus"><option value="">Use Journey Status</option>${statusOptions(leg.status || "")}</select></label>
      <label>Attach Leg Documents<input name="legDocuments" type="file" accept=".pdf,.jpg,.jpeg,.png,.txt,.eml,application/pdf,image/jpeg,image/png,text/plain,message/rfc822" multiple${offline ? " disabled" : ""}></label>
    </div></details>
  </section>`;
}

function flightFields(activity, offline = false) {
  const details = typeDetailsFor(activity, "flight");
  return `<label>Journey Name<input name="journeyTitle" maxlength="160" value="${escapeHtml(details.journeyTitle || activity.title || "")}" required></label>
    <label>Airline App Or Website<input name="airlineUrl" type="url" maxlength="600" value="${escapeHtml(details.airlineUrl || activity.airlineUrl || "")}"></label>
    <div class="flight-legs" data-flight-legs>${(details.legs || []).map((leg, index) => flightLegCard(leg, index, offline)).join("")}</div>
    <button class="secondary-button add-leg-button" type="button" data-add-flight-leg>Add Flight Leg</button>
    <section class="journey-summary" data-flight-summary aria-live="polite">${flightSummaryMarkup({ ...activity, flight: details })}</section>
    ${timeZoneList()}`;
}

function accommodationFields(activity) {
  const details = typeDetailsFor(activity, "accommodation");
  return `<label>Accommodation Type<select name="accommodationSubtype">${ACCOMMODATION_SUBTYPES.map((subtype) => `<option value="${subtype.id}"${selected(subtype.id, details.subtype || "hotel-resort")}>${escapeHtml(subtype.label)}</option>`).join("")}</select></label>
    <label>Property Or Host Name<input name="propertyOrHostName" maxlength="200" value="${escapeHtml(details.propertyOrHostName || "")}" required></label>
    <label>Address<input name="accommodationAddress" maxlength="300" autocomplete="street-address" value="${escapeHtml(details.address || "")}" required></label>
    <fieldset><legend>Reserved Stay Dates</legend><div class="form-columns"><label>First Reserved Night<input name="reservedFrom" type="date" value="${escapeHtml(details.reservedFrom || "")}" required></label><label>Stay Ends<input name="reservedTo" type="date" value="${escapeHtml(details.reservedTo || "")}" required></label></div></fieldset>
    <fieldset><legend>Expected Arrival</legend><div class="form-columns"><label>Date<input name="expectedArrivalDate" type="date" value="${escapeHtml(details.expectedArrivalDate || "")}" required></label><label>Time<input name="expectedArrivalTime" type="time" value="${escapeHtml(details.expectedArrivalTime || "")}" required></label></div></fieldset>
    <fieldset><legend>Expected Departure</legend><div class="form-columns"><label>Date<input name="expectedDepartureDate" type="date" value="${escapeHtml(details.expectedDepartureDate || details.reservedTo || "")}" required></label><label>Time<input name="expectedDepartureTime" type="time" value="${escapeHtml(details.expectedDepartureTime || "")}"></label></div></fieldset>
    <label>Directions<textarea name="accommodationDirections" rows="2" maxlength="2000">${escapeHtml(details.directions || "")}</textarea></label>
    <label>Property Or Host Contact<textarea name="accommodationContact" rows="2" maxlength="1000">${escapeHtml(details.contactDetails || "")}</textarea></label>
    <details class="subtype-fields" data-accommodation-formal><summary>Formal Check-In And Room Details</summary><div class="form-section-body">
      <div class="form-columns"><label>Check-In Time<input name="checkInTime" type="time" value="${escapeHtml(details.checkInTime || "")}"></label><label>Check-Out Time<input name="checkOutTime" type="time" value="${escapeHtml(details.checkOutTime || "")}"></label></div>
      <label>Room Details<textarea name="roomDetails" rows="2" maxlength="1000">${escapeHtml(details.roomDetails || "")}</textarea></label>
    </div></details>
    <details class="subtype-fields" data-accommodation-rental><summary>Rental Listing And Access</summary><div class="form-section-body">
      <label>Listing Link<input name="listingUrl" type="url" maxlength="600" value="${escapeHtml(details.listingUrl || "")}"></label>
      <label>Private Check-In And Access Instructions<textarea name="accessInstructions" rows="4" maxlength="4000">${escapeHtml(details.accessInstructions || "")}</textarea></label>
      <p class="private-field-note">Door codes and similar access details remain protected by traveler authentication and encrypted offline storage.</p>
      <label>Checkout Instructions<textarea name="checkoutInstructions" rows="3" maxlength="3000">${escapeHtml(details.checkoutInstructions || "")}</textarea></label>
    </div></details>`;
}

function transferFields(activity, city, defaults) {
  const details = typeDetailsFor(activity, "transfer");
  const services = cityRideServices(city, defaults);
  return `<label>Service<input name="transferService" list="rideServices" maxlength="160" value="${escapeHtml(details.service || "")}" required></label><datalist id="rideServices">${services.map((service) => `<option value="${escapeHtml(service)}"></option>`).join("")}</datalist>
    <label>Pickup<input name="pickup" maxlength="300" value="${escapeHtml(details.pickup || "")}" required></label>
    <label>Drop-Off<input name="dropoff" maxlength="300" value="${escapeHtml(details.dropoff || "")}" required></label>
    <div class="form-columns"><label>Pickup Date<input name="pickupDate" type="date" value="${escapeHtml(details.pickupDate || activity.dayDate || "")}" required></label><label>Pickup Time<input name="pickupTime" type="time" value="${escapeHtml(details.pickupTime || "")}" required></label></div>
    <label>Expected Arrival Time<input name="transferArrivalTime" type="time" value="${escapeHtml(details.expectedArrivalTime || "")}"></label>
    <label class="checkbox-row"><input name="prebooked" type="checkbox"${checked(details.prebooked)}> This Transfer Is Prebooked</label>
    <label>Meeting Instructions<textarea name="meetingInstructions" rows="3" maxlength="2000">${escapeHtml(details.meetingInstructions || "")}</textarea></label>
    <label>Driver Or Provider Contact<textarea name="providerContact" rows="2" maxlength="1000">${escapeHtml(details.providerContact || "")}</textarea></label>
    <fieldset class="backup-service-fieldset"><legend>Backup Ride Options</legend>${services.map((service) => `<label class="checkbox-row"><input type="checkbox" name="backupServices" value="${escapeHtml(service)}"${checked((details.backupServices || []).includes(service))}> ${escapeHtml(service)}</label>`).join("")}</fieldset>`;
}

function transitFields(activity) {
  const details = typeDetailsFor(activity, "transit");
  return `<label>Mode<input name="transitMode" maxlength="100" value="${escapeHtml(details.mode || "")}" required></label>
    <label>From<input name="transitFrom" maxlength="300" value="${escapeHtml(details.from || "")}" required></label>
    <label>To<input name="transitTo" maxlength="300" value="${escapeHtml(details.to || "")}" required></label>
    <label>Line Or Service<input name="lineOrService" maxlength="160" value="${escapeHtml(details.lineOrService || "")}"></label>
    <fieldset><legend>Departure</legend><div class="form-columns"><label>Date<input name="transitDepartureDate" type="date" value="${escapeHtml(details.departureDate || activity.dayDate || "")}" required></label><label>Time<input name="transitDepartureTime" type="time" value="${escapeHtml(details.departureTime || "")}" required></label></div></fieldset>
    <fieldset><legend>Arrival</legend><div class="form-columns"><label>Date<input name="transitArrivalDate" type="date" value="${escapeHtml(details.arrivalDate || activity.dayDate || "")}" required></label><label>Time<input name="transitArrivalTime" type="time" value="${escapeHtml(details.arrivalTime || "")}"></label></div></fieldset>
    <label>Ticket Details<textarea name="ticketDetails" rows="3" maxlength="2000">${escapeHtml(details.ticketDetails || "")}</textarea></label>
    <p class="form-guidance">The route button opens Apple Maps transit directions where supported. It does not imply live schedules, fares, or a confirmed booking.</p>`;
}

function tourFields(activity) {
  const details = typeDetailsFor(activity, "tour");
  return `<label>Experience<input name="experience" maxlength="200" value="${escapeHtml(details.experience || "")}" required></label>
    <label>Provider<input name="tourProvider" maxlength="160" value="${escapeHtml(details.provider || "")}"></label>
    <label>Meeting Point<input name="tourMeetingPoint" maxlength="300" value="${escapeHtml(details.meetingPoint || "")}" required></label>
    <label>Date<input name="tourDate" type="date" value="${escapeHtml(details.date || activity.dayDate || "")}" required></label>
    <div class="form-columns"><label>Start<input name="tourStart" type="time" value="${escapeHtml(details.start || "")}" required></label><label>End<input name="tourEnd" type="time" value="${escapeHtml(details.end || "")}"></label></div>`;
}

function diningFields(activity) {
  const details = typeDetailsFor(activity, "dining");
  return `<label>Restaurant<input name="restaurant" maxlength="200" value="${escapeHtml(details.restaurant || "")}" required></label>
    <label>Address<input name="diningAddress" maxlength="300" autocomplete="street-address" value="${escapeHtml(details.address || "")}"></label>
    <label>Reservation Date<input name="reservationDate" type="date" value="${escapeHtml(details.reservationDate || activity.dayDate || "")}" required></label>
    <div class="form-columns"><label>Reservation Time<input name="reservationTime" type="time" value="${escapeHtml(details.reservationTime || "")}" required></label><label>Optional End<input name="diningEndTime" type="time" value="${escapeHtml(details.endTime || "")}"></label></div>
    <label>Party Size<input name="partySize" maxlength="80" value="${escapeHtml(details.partySize || "")}"></label>
    <label>Dress Code<textarea name="dressCode" rows="2" maxlength="1000">${escapeHtml(details.dressCode || "")}</textarea></label>`;
}

function generalFields(activity) {
  const details = typeDetailsFor(activity, "general");
  return `<label>Title<input name="generalTitle" maxlength="160" value="${escapeHtml(details.title || activity.title || "")}" required></label>
    <label>Location<input name="generalLocation" maxlength="300" value="${escapeHtml(details.location || "")}"></label>
    <label>Date<input name="generalDate" type="date" value="${escapeHtml(details.date || activity.dayDate || "")}" required></label>
    <div class="form-columns"><label>Start<input name="generalStart" type="time" value="${escapeHtml(details.start || "")}" required></label><label>Optional End<input name="generalEnd" type="time" value="${escapeHtml(details.end || "")}"></label></div>`;
}

function typeFields(activity, context) {
  const type = activityTypeFor(activity);
  if (type === "flight") return flightFields(activity, context.offline);
  if (type === "accommodation") return accommodationFields(activity);
  if (type === "transfer") return transferFields(activity, context.city, context.transportDefaults || {});
  if (type === "transit") return transitFields(activity);
  if (type === "tour") return tourFields(activity);
  if (type === "dining") return diningFields(activity);
  return generalFields(activity);
}

export function renderTypePicker({ offline = false, draft = null } = {}) {
  return `<div class="modal-inner activity-type-picker">
    <button class="edit-back" type="button" data-close-activity-form>‹ Back</button>
    <p class="detail-kicker">${offline ? "Add Offline" : "Add Activity"}</p>
    <h2>Choose Activity Type</h2>
    <p class="detail-time">Choose the kind of activity so My Travels can ask for the right details.</p>
    ${draft ? `<div class="draft-resume"><strong>Unfinished Draft Available</strong><p>Your earlier ${escapeHtml(ACTIVITY_TYPES.find((type) => type.id === activityTypeFor(draft))?.label || "activity")} draft is still on this device.</p><div class="button-row"><button class="primary-button" type="button" data-resume-activity-draft>Resume Draft</button><button class="secondary-button" type="button" data-discard-activity-draft>Discard Draft</button></div></div>` : ""}
    <div class="activity-type-grid">${ACTIVITY_TYPES.map((type) => `<button class="activity-type-option${type.id === "general" ? " activity-type-option--general" : ""}" type="button" data-activity-type="${type.id}"><span aria-hidden="true">${type.icon}</span><strong>${escapeHtml(type.label)}</strong></button>`).join("")}</div>
  </div>`;
}

export function renderActivityForm(activity, context) {
  const type = activityTypeFor(activity);
  const label = ACTIVITY_TYPES.find((option) => option.id === type)?.label || "General Activity";
  const edit = context.mode === "edit";
  return `<div class="modal-inner type-aware-editor">
    <button class="edit-back" type="button" data-close-activity-form>‹ Back</button>
    <p class="detail-kicker">${edit ? "Edit Activity" : (context.offline ? "Add Offline" : "Add Activity")}</p>
    <h2>${edit ? escapeHtml(activity.title || label) : `New ${escapeHtml(label)}`}</h2>
    ${context.offline ? '<div class="prototype-banner">Changes remain encrypted on this device and are marked pending until authenticated synchronization.</div>' : ""}
    <form class="edit-form type-aware-form" id="typeAwareActivityForm" data-mode="${context.mode}" data-rendered-type="${type}" data-activity-id="${escapeHtml(activity.rootId || activity.id || "")}">
      <section class="form-section form-section--essential">
        <h3>Essentials</h3>
        <label>Activity Type<select name="activityType">${ACTIVITY_TYPES.map((option) => `<option value="${option.id}"${selected(option.id, type)}>${escapeHtml(option.label)}</option>`).join("")}</select></label>
        <p class="form-guidance">Changing type keeps the previous type-specific information for review. No information is silently removed.</p>
        ${typeFields(activity, context)}
        <label>Booking Status<select name="status">${statusOptions(activity.status || "planned")}</select></label>
        ${travelerControls(activity.travelers || activity.party || [])}
      </section>
      ${commonOptionalSections(activity, context.offline)}
      <p class="form-error" data-activity-form-error role="alert"></p>
      <div class="button-row sticky-form-actions"><button class="primary-button" type="submit">Save Activity</button><button class="secondary-button" type="button" data-cancel-activity-form>Cancel</button></div>
    </form>
  </div>`;
}

export function defaultActivityDraft(type, context) {
  const day = context.days.find((candidate) => candidate.date === context.selectedDate) || context.days[0] || { date: "", timeZone: "UTC", city: "" };
  const routeCities = String(day.city || "").split(/\s*(?:→| to )\s*/i).map((city) => city.trim()).filter(Boolean);
  const activity = { custom: true, activityType: type, dayDate: day.date, timeZone: day.timeZone, city: day.city, title: "", start: "09:00", end: "10:00", status: "planned", travelers: ["Dan", "Ken"], documents: [], cost: { amount: "", currency: "" } };
  if (type === "flight") activity.flight = { journeyTitle: "", bookingReference: "", airlineUrl: "", legs: [{ legId: "leg-1", airline: "", flightNumber: "", departure: { airport: "", city: routeCities[0] || day.city, terminal: "", date: day.date, time: "09:00", timeZone: day.timeZone }, arrival: { airport: "", city: routeCities[1] || "", terminal: "", date: day.date, time: "11:00", timeZone: day.timeZone }, seats: [], bookingReference: "", status: "", documents: [] }] };
  if (type === "accommodation") activity.accommodation = { subtype: "hotel-resort", propertyOrHostName: "", address: "", reservedFrom: day.date, reservedTo: day.date, checkInTime: "", checkOutTime: "", expectedArrivalDate: day.date, expectedArrivalTime: "15:00", expectedDepartureDate: day.date, expectedDepartureTime: "", roomDetails: "", listingUrl: "", accessInstructions: "", checkoutInstructions: "", directions: "", contactDetails: "" };
  if (type === "transfer") activity.transfer = { service: cityRideServices(day.city, context.transportDefaults || {})[0], pickup: "", dropoff: "", pickupDate: day.date, pickupTime: "09:00", expectedArrivalTime: "", meetingInstructions: "", providerContact: "", prebooked: false, backupServices: [] };
  if (type === "transit") activity.transit = { mode: "Public Transit", from: "", to: "", lineOrService: "", departureDate: day.date, departureTime: "09:00", arrivalDate: day.date, arrivalTime: "", ticketDetails: "" };
  if (type === "tour") activity.tour = { experience: "", provider: "", meetingPoint: "", date: day.date, start: "09:00", end: "" };
  if (type === "dining") activity.dining = { restaurant: "", reservationDate: day.date, reservationTime: "19:00", endTime: "", partySize: "2", address: "", dressCode: "" };
  if (type === "general") activity.general = { title: "", location: "", date: day.date, start: "09:00", end: "" };
  return activity;
}

function legFromCard(card, existing = {}) {
  const seats = [];
  const dan = scopedValue(card, "seatDan").toUpperCase();
  const ken = scopedValue(card, "seatKen").toUpperCase();
  if (dan) seats.push({ traveler: "Dan", seat: dan });
  if (ken) seats.push({ traveler: "Ken", seat: ken });
  return {
    ...existing,
    legId: existing.legId || existing.id || `leg-${Number(card.dataset.flightLeg || 0) + 1}`,
    airline: scopedValue(card, "legAirline"),
    flightNumber: scopedValue(card, "legFlightNumber").toUpperCase(),
    departure: { airport: scopedValue(card, "departureAirport").toUpperCase(), city: scopedValue(card, "departureCity"), terminal: scopedValue(card, "departureTerminal"), date: scopedValue(card, "departureDate"), time: scopedValue(card, "departureTime"), timeZone: scopedValue(card, "departureTimeZone") },
    arrival: { airport: scopedValue(card, "arrivalAirport").toUpperCase(), city: scopedValue(card, "arrivalCity"), terminal: scopedValue(card, "arrivalTerminal"), date: scopedValue(card, "arrivalDate"), time: scopedValue(card, "arrivalTime"), timeZone: scopedValue(card, "arrivalTimeZone") },
    seats,
    bookingReference: scopedValue(card, "legBookingReference"),
    status: scopedValue(card, "legStatus"),
    documents: existing.documents || [],
  };
}

export function activityFromForm(form, baseActivity = {}) {
  const type = valueOf(form, "activityType", activityTypeFor(baseActivity));
  const travelers = new FormData(form).getAll("travelers").map(String);
  const common = {
    ...structuredClone(baseActivity),
    activityType: type,
    status: valueOf(form, "status", "planned"),
    travelers,
    bookingReference: valueOf(form, "bookingReference"),
    cost: { amount: valueOf(form, "costAmount"), currency: valueOf(form, "currency").toUpperCase() },
    cancellationTerms: valueOf(form, "cancellationTerms"),
    contact: valueOf(form, "contact"),
    bookingDetails: valueOf(form, "bookingDetails"),
    note: valueOf(form, "note"),
    whatToWear: valueOf(form, "whatToWear"),
    documents: baseActivity.documents || [],
    fixed: Boolean(baseActivity.fixed),
    travelMinutes: Number(baseActivity.travelMinutes || 0),
    arrivalBufferMinutes: Number(baseActivity.arrivalBufferMinutes || 0),
  };
  if (type === "flight") {
    const prior = typeDetailsFor(baseActivity, "flight");
    const legs = [...form.querySelectorAll("[data-flight-leg]")].map((card, index) => legFromCard(card, prior.legs?.[index] || {}));
    const first = legs[0] || {};
    const last = legs.at(-1) || first;
    const route = `${first.departure?.airport || first.departure?.city || "Departure"} to ${last.arrival?.airport || last.arrival?.city || "Arrival"}`;
    const seats = legs.flatMap((leg) => leg.seats || []);
    const journeyTitle = valueOf(form, "journeyTitle") || route;
    return { ...common, title: journeyTitle, venue: route, address: last.arrival?.city || last.arrival?.airport || "", dayDate: first.departure?.date || baseActivity.dayDate, start: first.departure?.time || "00:00", end: last.arrival?.time || first.departure?.time || "00:00", endDate: last.arrival?.date || first.departure?.date, timeZone: first.departure?.timeZone || baseActivity.timeZone || "UTC", party: seats.map((seat) => `${seat.traveler} ${seat.seat}`).join(" · "), airlineUrl: valueOf(form, "airlineUrl"), flight: { ...prior, journeyTitle, bookingReference: valueOf(form, "bookingReference"), airlineUrl: valueOf(form, "airlineUrl"), legs } };
  }
  if (type === "accommodation") {
    const accommodation = { subtype: valueOf(form, "accommodationSubtype", "hotel-resort"), propertyOrHostName: valueOf(form, "propertyOrHostName"), address: valueOf(form, "accommodationAddress"), reservedFrom: valueOf(form, "reservedFrom"), reservedTo: valueOf(form, "reservedTo"), checkInTime: valueOf(form, "checkInTime"), checkOutTime: valueOf(form, "checkOutTime"), expectedArrivalDate: valueOf(form, "expectedArrivalDate"), expectedArrivalTime: valueOf(form, "expectedArrivalTime"), expectedDepartureDate: valueOf(form, "expectedDepartureDate"), expectedDepartureTime: valueOf(form, "expectedDepartureTime"), roomDetails: valueOf(form, "roomDetails"), listingUrl: valueOf(form, "listingUrl"), accessInstructions: valueOf(form, "accessInstructions"), checkoutInstructions: valueOf(form, "checkoutInstructions"), directions: valueOf(form, "accommodationDirections"), contactDetails: valueOf(form, "accommodationContact") };
    return { ...common, title: accommodation.propertyOrHostName, venue: accommodation.propertyOrHostName, address: accommodation.address, dayDate: accommodation.expectedArrivalDate, start: accommodation.expectedArrivalTime || "00:00", end: accommodation.expectedDepartureTime || accommodation.expectedArrivalTime || "00:00", endDate: accommodation.expectedDepartureDate || accommodation.reservedTo, directions: accommodation.directions, contact: accommodation.contactDetails || common.contact, accommodation };
  }
  if (type === "transfer") {
    const transfer = { service: valueOf(form, "transferService"), pickup: valueOf(form, "pickup"), dropoff: valueOf(form, "dropoff"), pickupDate: valueOf(form, "pickupDate"), pickupTime: valueOf(form, "pickupTime"), expectedArrivalTime: valueOf(form, "transferArrivalTime"), meetingInstructions: valueOf(form, "meetingInstructions"), providerContact: valueOf(form, "providerContact"), prebooked: Boolean(form.elements.prebooked?.checked), backupServices: new FormData(form).getAll("backupServices").map(String) };
    return { ...common, title: transfer.service || `Transfer To ${transfer.dropoff}`, venue: transfer.pickup, address: transfer.dropoff, dayDate: transfer.pickupDate, start: transfer.pickupTime, end: transfer.expectedArrivalTime || transfer.pickupTime, meetingPoint: transfer.pickup, note: transfer.meetingInstructions || common.note, contact: transfer.providerContact || common.contact, fixed: transfer.prebooked, transfer };
  }
  if (type === "transit") {
    const transit = { mode: valueOf(form, "transitMode"), from: valueOf(form, "transitFrom"), to: valueOf(form, "transitTo"), lineOrService: valueOf(form, "lineOrService"), departureDate: valueOf(form, "transitDepartureDate"), departureTime: valueOf(form, "transitDepartureTime"), arrivalDate: valueOf(form, "transitArrivalDate"), arrivalTime: valueOf(form, "transitArrivalTime"), ticketDetails: valueOf(form, "ticketDetails") };
    return { ...common, title: transit.lineOrService || transit.mode, venue: transit.from, address: transit.to, dayDate: transit.departureDate, start: transit.departureTime, end: transit.arrivalTime || transit.departureTime, endDate: transit.arrivalDate, bookingDetails: transit.ticketDetails || common.bookingDetails, transit };
  }
  if (type === "tour") {
    const tour = { experience: valueOf(form, "experience"), provider: valueOf(form, "tourProvider"), meetingPoint: valueOf(form, "tourMeetingPoint"), date: valueOf(form, "tourDate"), start: valueOf(form, "tourStart"), end: valueOf(form, "tourEnd") };
    return { ...common, title: tour.experience, venue: tour.meetingPoint, dayDate: tour.date, start: tour.start, end: tour.end || tour.start, meetingPoint: tour.meetingPoint, tour };
  }
  if (type === "dining") {
    const dining = { restaurant: valueOf(form, "restaurant"), reservationDate: valueOf(form, "reservationDate"), reservationTime: valueOf(form, "reservationTime"), endTime: valueOf(form, "diningEndTime"), partySize: valueOf(form, "partySize"), address: valueOf(form, "diningAddress"), dressCode: valueOf(form, "dressCode") };
    return { ...common, title: dining.restaurant, venue: dining.restaurant, address: dining.address, dayDate: dining.reservationDate, start: dining.reservationTime, end: dining.endTime || dining.reservationTime, party: dining.partySize, whatToWear: dining.dressCode || common.whatToWear, dining };
  }
  const general = { title: valueOf(form, "generalTitle"), location: valueOf(form, "generalLocation"), date: valueOf(form, "generalDate"), start: valueOf(form, "generalStart"), end: valueOf(form, "generalEnd") };
  return { ...common, title: general.title, venue: general.location, address: general.location, dayDate: general.date, start: general.start, end: general.end || general.start, general };
}

export function nextFlightLeg(existingLegs = [], context = {}) {
  const previous = existingLegs.at(-1);
  const departure = previous?.arrival || { airport: "", city: context.city || "", terminal: "", date: context.selectedDate || "", time: "", timeZone: context.timeZone || "UTC" };
  const legId = typeof crypto !== "undefined" && crypto.randomUUID ? `leg-${crypto.randomUUID().toLowerCase()}` : `leg-${existingLegs.length + 1}`;
  return { legId, airline: previous?.airline || "", flightNumber: "", departure: { ...departure }, arrival: { airport: "", city: "", terminal: "", date: departure.date || "", time: "", timeZone: departure.timeZone || "UTC" }, seats: [], bookingReference: "", status: "", documents: [] };
}

export function flightLegMarkup(leg, index, offline = false) {
  return flightLegCard(leg, index, offline);
}

export function flightSummaryMarkup(activity) {
  const summary = flightJourneySummary(activity);
  const warnings = [];
  for (const [index, leg] of (activity.flight?.legs || []).entries()) {
    const elapsed = legElapsedMinutes(leg);
    if (!leg.departure?.date || !leg.arrival?.date) warnings.push(`Leg ${index + 1} needs dates.`);
    if (!Number.isFinite(elapsed)) warnings.push(`Leg ${index + 1} needs valid dates, times, and time zones.`);
    else if (elapsed <= 0) warnings.push(`Leg ${index + 1} has inconsistent chronology.`);
  }
  for (const connection of summary.connections) {
    if (connection.inconsistentChronology) warnings.push(`Connection after leg ${connection.afterLeg + 1} has inconsistent chronology.`);
  }
  return `<h3>Journey Summary</h3><p><strong>${escapeHtml(summary.route || "Add flight legs to build the route")}</strong></p><p>${summary.legCount} flight leg${summary.legCount === 1 ? "" : "s"}</p>${summary.connections.map((connection) => `<p class="connection-summary${connection.needsReview ? " needs-review" : ""}">${escapeHtml(durationLabel(connection.durationMinutes))} at ${escapeHtml(connection.hub)}${connection.overnight ? " · Overnight" : ""}${connection.airportChange ? " · Airport Change" : ""} · Review Connection</p>`).join("")}${warnings.map((warning) => `<p class="form-warning">${escapeHtml(warning)}</p>`).join("")}`;
}

export function accommodationVisibility(form) {
  const subtype = valueOf(form, "accommodationSubtype", "hotel-resort");
  const rental = subtype === "rental";
  const formal = new Set(["hotel-resort", "rental", "bed-breakfast"]).has(subtype);
  form.querySelector("[data-accommodation-rental]")?.toggleAttribute("hidden", !rental);
  form.querySelector("[data-accommodation-formal]")?.toggleAttribute("hidden", !formal);
}
