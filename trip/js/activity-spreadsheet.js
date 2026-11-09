import { activityTypeFor, FLIGHT_CABIN_OPTIONS, typeDetailsFor } from "./activity-model.js";

export const ACTIVITY_SPREADSHEET_VERSION = "5";

export const ACTIVITY_SPREADSHEET_COLUMNS = [
  "schema_version",
  "activity_id",
  "activity_type",
  "activity_subtype",
  "leg_id",
  "leg_number",
  "title",
  "status",
  "day_date",
  "start_date",
  "start_time",
  "start_time_zone",
  "end_date",
  "end_time",
  "end_time_zone",
  "departure_airport",
  "departure_city",
  "departure_terminal",
  "arrival_airport",
  "arrival_city",
  "arrival_terminal",
  "airline",
  "flight_number",
  "cabin",
  "property_or_host_name",
  "reserved_from",
  "reserved_to",
  "expected_arrival_date",
  "expected_arrival_time",
  "expected_departure_date",
  "expected_departure_time",
  "location_or_pickup",
  "destination_or_dropoff",
  "address",
  "provider_or_service",
  "booking_reference",
  "booking_status",
  "travelers",
  "seat_assignments",
  "cost",
  "currency",
  "cancellation_terms",
  "contact_details",
  "listing_url",
  "access_instructions_private",
  "checkout_instructions_private",
  "directions",
  "notes",
  "what_to_wear",
];

export const TRAVEL_WORKBOOK_SHEETS = {
  "Trip Details": {
    purpose: "One row describing the trip. Destination day/night artwork is intentionally excluded.",
    columns: [
      ["schema_version", true, "Do not change", "5"],
      ["trip_id", true, "Stable ID; keep unchanged when updating a trip", "south-korea-april-2027"],
      ["trip_name", true, "Traveler-facing trip name", "South Korea In April"],
      ["start_date", true, "YYYY-MM-DD", "2027-04-10"],
      ["end_date", true, "YYYY-MM-DD", "2027-04-22"],
      ["default_time_zone", true, "IANA time zone", "Asia/Seoul"],
      ["travelers", true, "Separate names with |", "Dan | Ken"],
      ["notes", false, "General private planning notes", "Spring trip"],
    ],
  },
  Activities: {
    purpose: "One row per underlying activity. Flights have their legs on Flight Legs.",
    columns: [
      ["schema_version", true, "Do not change", "5"],
      ["activity_id", true, "Stable unique ID; create it once for a proposed new row and never reuse it", "activity-palace-tour"],
      ["base_revision", false, "Exported server revision used for conflict review", "1740000000000"],
      ["activity_type", true, "Use the dropdown", "tour"],
      ["activity_subtype", false, "Required for Accommodation", "hotel-resort"],
      ["title", true, "Traveler-facing title", "Gyeongbokgung Palace Tour"],
      ["status", true, "Use the dropdown", "confirmed"],
      ["day_date", true, "YYYY-MM-DD", "2027-04-12"],
      ["start_time", true, "Local HH:MM", "09:00"],
      ["end_date", false, "YYYY-MM-DD when different", "2027-04-12"],
      ["end_time", false, "Local HH:MM", "12:00"],
      ["time_zone", true, "IANA time zone", "Asia/Seoul"],
      ["location_or_pickup", false, "Venue, origin, or pickup point", "Hotel Lobby"],
      ["destination_or_dropoff", false, "Destination where applicable", "Gyeongbokgung Palace"],
      ["address", false, "Street address", "161 Sajik-ro, Seoul"],
      ["provider_or_service", false, "Provider, airline, ride service, or transit mode", "Private Guide"],
      ["booking_reference", false, "Optional", "ABC123"],
      ["travelers", false, "Separate names with |", "Dan | Ken"],
      ["cost", false, "Number only", "120.00"],
      ["currency", false, "Three-letter code", "USD"],
      ["property_or_host_name", false, "Accommodation only", "Seoul Hotel"],
      ["reserved_from", false, "First reserved night", "2027-04-10"],
      ["reserved_to", false, "Date stay ends", "2027-04-14"],
      ["expected_arrival_date", false, "Actual expected arrival date", "2027-04-11"],
      ["expected_arrival_time", false, "Actual expected arrival time", "00:30"],
      ["expected_departure_date", false, "Actual expected departure date", "2027-04-14"],
      ["expected_departure_time", false, "Optional", "08:00"],
      ["listing_url", false, "Rental listing link", "https://example.com/listing"],
      ["access_instructions_private", false, "Private; protected and encrypted offline", "Door code in private note"],
      ["checkout_instructions_private", false, "Private; protected and encrypted offline", "Lock door on departure"],
      ["directions", false, "Directions or access guidance", "Use east entrance"],
      ["contact_details", false, "Private contact details", "+82 ..."],
      ["cancellation_terms", false, "Optional", "Cancel by April 1"],
      ["notes", false, "Private notes", "Bring passport"],
      ["what_to_wear", false, "Optional", "Walking shoes"],
      ["airline_url", false, "Flight only", "https://www.koreanair.com/"],
      ["booking_details", false, "Common optional booking details", "Voucher details or inclusions"],
      ["check_in_time", false, "Accommodation formal stay", "15:00"],
      ["check_out_time", false, "Accommodation formal stay", "11:00"],
      ["room_details", false, "Accommodation formal stay", "King room, harbor view"],
      ["transfer_prebooked", false, "Transfer: Yes or No", "Yes"],
      ["backup_services", false, "Transfer: separate values with |", "Uber | Grab"],
      ["ticket_details", false, "Public Transit only", "Stored-value card"],
      ["party_size", false, "Dining only", "2"],
    ],
    dropdowns: {
      activity_type: ["flight", "accommodation", "transfer", "transit", "tour", "dining", "general"],
      activity_subtype: ["hotel-resort", "rental", "bed-breakfast", "friends-family", "other"],
      status: ["planned", "confirmed", "awaiting", "purchased", "done", "skipped", "cancelled"],
    },
  },
  "Flight Legs": {
    purpose: "One row per leg, connected to one Flight activity by activity_id.",
    columns: [
      ["schema_version", true, "Do not change", "5"],
      ["activity_id", true, "Must match a Flight activity", "flight-bos-icn-sin"],
      ["leg_id", true, "Stable ID for this leg", "leg-bos-icn"],
      ["leg_number", true, "Journey order starting at 1", "1"],
      ["airline", true, "Operating or marketing airline", "Korean Air"],
      ["flight_number", true, "Flight number", "KE92"],
      ["cabin", false, "Choose the cabin for this leg", "Business"],
      ["departure_airport", true, "IATA airport code", "BOS"],
      ["departure_city", false, "Optional traveler-facing city", "Boston"],
      ["departure_terminal", false, "Optional", "E"],
      ["departure_date", true, "Local YYYY-MM-DD", "2027-04-10"],
      ["departure_time", true, "Local HH:MM", "11:10"],
      ["departure_time_zone", true, "IANA time zone", "America/New_York"],
      ["arrival_airport", true, "IATA airport code", "ICN"],
      ["arrival_city", false, "Optional traveler-facing city", "Seoul"],
      ["arrival_terminal", false, "Optional", "2"],
      ["arrival_date", true, "Local YYYY-MM-DD", "2027-04-11"],
      ["arrival_time", true, "Local HH:MM", "16:05"],
      ["arrival_time_zone", true, "IANA time zone", "Asia/Seoul"],
      ["dan_seat", false, "Dan's seat; leave blank when Dan is not traveling", "14H"],
      ["ken_seat", false, "Ken's seat; leave blank when Ken is not traveling", "14J"],
      ["leg_booking_reference", false, "Optional override", "ABC123"],
      ["leg_status", false, "Optional journey-status override", "confirmed"],
    ],
    dropdowns: {
      cabin: FLIGHT_CABIN_OPTIONS,
      leg_status: ["planned", "confirmed", "awaiting", "purchased", "done", "skipped", "cancelled"],
    },
  },
  Documents: {
    purpose: "Document metadata only. Files remain protected attachments in My Travels.",
    columns: [
      ["schema_version", true, "Do not change", "5"],
      ["document_id", false, "Stable ID for an existing attachment", "doc-example"],
      ["activity_id", true, "Owning activity ID", "flight-bos-icn-sin"],
      ["leg_id", false, "Flight leg ID when applicable", "leg-bos-icn"],
      ["label", true, "Button label", "Flight Confirmation"],
      ["filename", true, "Selected file name", "confirmation.pdf"],
      ["private", true, "Always Yes for traveler documents", "Yes"],
      ["include_offline", false, "Yes or No; traveler still chooses on-device download", "Yes"],
      ["notes", false, "Import review note; not file contents", "Latest confirmation"],
    ],
    dropdowns: { private: ["Yes"], include_offline: ["Yes", "No"] },
  },
};

export function travelWorkbookContract() {
  return structuredClone({ schemaVersion: ACTIVITY_SPREADSHEET_VERSION, sheets: TRAVEL_WORKBOOK_SHEETS });
}

function cell(value) {
  if (Array.isArray(value)) return value.join(" | ");
  if (value == null) return "";
  return String(value);
}

function csvCell(value) {
  const text = cell(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function baseRow(activity, type) {
  return {
    schema_version: ACTIVITY_SPREADSHEET_VERSION,
    activity_id: activity.rootId || activity.id || "",
    activity_type: type,
    activity_subtype: "",
    leg_id: "",
    leg_number: "",
    title: activity.title || "",
    status: activity.status || "planned",
    day_date: activity.dayDate || "",
    start_date: activity.dayDate || "",
    start_time: activity.start || "",
    start_time_zone: activity.timeZone || "",
    end_date: activity.endDate || activity.dayDate || "",
    end_time: activity.end || "",
    end_time_zone: activity.timeZone || "",
    departure_airport: "",
    departure_city: "",
    departure_terminal: "",
    arrival_airport: "",
    arrival_city: "",
    arrival_terminal: "",
    airline: "",
    flight_number: "",
    cabin: "",
    property_or_host_name: "",
    reserved_from: "",
    reserved_to: "",
    expected_arrival_date: "",
    expected_arrival_time: "",
    expected_departure_date: "",
    expected_departure_time: "",
    location_or_pickup: activity.venue || "",
    destination_or_dropoff: "",
    address: activity.address || "",
    provider_or_service: "",
    booking_reference: activity.bookingReference || "",
    booking_status: activity.status || "planned",
    travelers: activity.travelers || activity.party || "",
    seat_assignments: "",
    cost: activity.cost?.amount || activity.costAmount || "",
    currency: activity.cost?.currency || activity.currency || "",
    cancellation_terms: activity.cancellationTerms || "",
    contact_details: activity.contact || "",
    listing_url: "",
    access_instructions_private: "",
    checkout_instructions_private: "",
    directions: activity.directions || "",
    notes: activity.note || "",
    what_to_wear: activity.whatToWear || "",
  };
}

export function activitySpreadsheetRows(activities = []) {
  const rows = [];
  for (const activity of activities) {
    const type = activityTypeFor(activity);
    const row = baseRow(activity, type);
    const details = typeDetailsFor(activity, type);
    if (type === "flight") {
      (details.legs || []).forEach((leg, index) => rows.push({
        ...row,
        leg_id: leg.legId || `leg-${index + 1}`,
        leg_number: index + 1,
        title: details.journeyTitle || activity.title || "Flight Journey",
        start_date: leg.departure?.date || "",
        start_time: leg.departure?.time || "",
        start_time_zone: leg.departure?.timeZone || "",
        end_date: leg.arrival?.date || "",
        end_time: leg.arrival?.time || "",
        end_time_zone: leg.arrival?.timeZone || "",
        departure_airport: leg.departure?.airport || "",
        departure_city: leg.departure?.city || "",
        departure_terminal: leg.departure?.terminal || "",
        arrival_airport: leg.arrival?.airport || "",
        arrival_city: leg.arrival?.city || "",
        arrival_terminal: leg.arrival?.terminal || "",
        airline: leg.airline || "",
        flight_number: leg.flightNumber || "",
        cabin: leg.cabin || "",
        booking_reference: leg.bookingReference || details.bookingReference || row.booking_reference,
        booking_status: leg.status || row.booking_status,
        seat_assignments: (leg.seats || []).map((seat) => `${seat.traveler}: ${seat.seat}`).join(" | "),
      }));
      continue;
    }
    if (type === "accommodation") {
      rows.push({
        ...row,
        activity_subtype: details.subtype || "hotel-resort",
        property_or_host_name: details.propertyOrHostName || "",
        reserved_from: details.reservedFrom || "",
        reserved_to: details.reservedTo || "",
        expected_arrival_date: details.expectedArrivalDate || "",
        expected_arrival_time: details.expectedArrivalTime || "",
        expected_departure_date: details.expectedDepartureDate || "",
        expected_departure_time: details.expectedDepartureTime || "",
        address: details.address || row.address,
        start_date: details.reservedFrom || row.start_date,
        end_date: details.reservedTo || row.end_date,
        start_time: details.expectedArrivalTime || details.checkInTime || row.start_time,
        end_time: details.expectedDepartureTime || details.checkOutTime || row.end_time,
        contact_details: details.contactDetails || row.contact_details,
        listing_url: details.listingUrl || "",
        access_instructions_private: details.accessInstructions || "",
        checkout_instructions_private: details.checkoutInstructions || "",
        directions: details.directions || row.directions,
      });
      continue;
    }
    if (type === "transfer") {
      rows.push({ ...row, title: details.service || row.title, location_or_pickup: details.pickup || "", destination_or_dropoff: details.dropoff || "", start_date: details.pickupDate || row.start_date, start_time: details.pickupTime || row.start_time, end_time: details.expectedArrivalTime || row.end_time, provider_or_service: details.service || "", contact_details: details.providerContact || row.contact_details, notes: details.meetingInstructions || row.notes });
      continue;
    }
    if (type === "transit") {
      rows.push({ ...row, title: details.lineOrService || row.title, location_or_pickup: details.from || "", destination_or_dropoff: details.to || "", start_date: details.departureDate || row.start_date, start_time: details.departureTime || row.start_time, end_date: details.arrivalDate || row.end_date, end_time: details.arrivalTime || row.end_time, provider_or_service: details.mode || "" });
      continue;
    }
    if (type === "tour") {
      rows.push({ ...row, title: details.experience || row.title, location_or_pickup: details.meetingPoint || "", provider_or_service: details.provider || "", start_date: details.date || row.start_date, start_time: details.start || row.start_time, end_time: details.end || row.end_time });
      continue;
    }
    if (type === "dining") {
      rows.push({ ...row, title: details.restaurant || row.title, location_or_pickup: details.restaurant || "", address: details.address || row.address, start_date: details.reservationDate || row.start_date, start_time: details.reservationTime || row.start_time, end_time: details.endTime || row.end_time, travelers: details.partySize || row.travelers, what_to_wear: details.dressCode || row.what_to_wear });
      continue;
    }
    rows.push({ ...row, title: details.title || row.title, location_or_pickup: details.location || row.location_or_pickup, start_date: details.date || row.start_date, start_time: details.start || row.start_time, end_time: details.end || row.end_time });
  }
  return rows;
}

export function activitiesToCsv(activities = []) {
  const rows = activitySpreadsheetRows(activities);
  return `${ACTIVITY_SPREADSHEET_COLUMNS.join(",")}\n${rows.map((row) => ACTIVITY_SPREADSHEET_COLUMNS.map((column) => csvCell(row[column])).join(",")).join("\n")}\n`;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(value); value = ""; }
    else if (character === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  const [headers = [], ...records] = rows.filter((candidate) => candidate.some((item) => item !== ""));
  return records.map((record) => Object.fromEntries(headers.map((header, index) => [header.trim(), record[index] || ""])));
}

function splitList(value) {
  return String(value || "").split("|").map((item) => item.trim()).filter(Boolean);
}

function importedCommon(row, existing = {}) {
  return {
    ...structuredClone(existing),
    activityType: row.activity_type || activityTypeFor(existing),
    title: row.title || existing.title || "Imported Activity",
    status: row.status || row.booking_status || existing.status || "planned",
    dayDate: row.day_date || row.start_date || existing.dayDate || "",
    start: row.start_time || existing.start || "00:00",
    end: row.end_time || existing.end || row.start_time || "00:00",
    endDate: row.end_date || row.start_date || existing.endDate || existing.dayDate || "",
    timeZone: row.start_time_zone || existing.timeZone || "UTC",
    bookingReference: row.booking_reference || existing.bookingReference || "",
    travelers: splitList(row.travelers),
    cost: { amount: row.cost || "", currency: row.currency || "" },
    cancellationTerms: row.cancellation_terms || "",
    contact: row.contact_details || "",
    note: row.notes || "",
    whatToWear: row.what_to_wear || "",
  };
}

export function spreadsheetImportReview(text, existingActivities = []) {
  const existing = new Map(existingActivities.map((activity) => [activity.rootId || activity.id, activity]));
  const rows = parseCsv(text);
  const warnings = [];
  const grouped = new Map();
  for (const row of rows) {
    if (row.schema_version && row.schema_version !== ACTIVITY_SPREADSHEET_VERSION) warnings.push(`Activity ${row.activity_id || "without an ID"} uses schema ${row.schema_version}; expected ${ACTIVITY_SPREADSHEET_VERSION}.`);
    const id = String(row.activity_id || "").trim();
    if (!id) { warnings.push("A row without activity_id was skipped to protect stable identities."); continue; }
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(row);
  }
  const changes = [];
  for (const [id, activityRows] of grouped) {
    const first = activityRows[0];
    const prior = existing.get(id);
    const activity = importedCommon(first, prior);
    if (activity.activityType === "hotel") activity.activityType = "accommodation";
    if (activity.activityType === "flight") {
      activity.flight = {
        ...(prior?.flight || {}),
        journeyTitle: first.title || prior?.title || "Flight Journey",
        bookingReference: first.booking_reference || prior?.bookingReference || "",
        legs: [...activityRows]
          .sort((left, right) => Number(left.leg_number || 1) - Number(right.leg_number || 1))
          .map((row, index) => {
            const priorLeg = prior?.flight?.legs?.find((leg) => (leg.legId || leg.id) === row.leg_id) || prior?.flight?.legs?.[index] || {};
            return {
            ...priorLeg,
            legId: row.leg_id || priorLeg.legId || priorLeg.id || `leg-${index + 1}`,
            airline: row.airline || "",
            flightNumber: row.flight_number || "",
            cabin: row.cabin || priorLeg.cabin || "",
            departure: { airport: row.departure_airport || "", city: row.departure_city || "", terminal: row.departure_terminal || "", date: row.start_date || "", time: row.start_time || "", timeZone: row.start_time_zone || "UTC" },
            arrival: { airport: row.arrival_airport || "", city: row.arrival_city || "", terminal: row.arrival_terminal || "", date: row.end_date || "", time: row.end_time || "", timeZone: row.end_time_zone || "UTC" },
            bookingReference: row.booking_reference || "",
            status: row.booking_status || "",
            seats: splitList(row.seat_assignments).map((assignment) => { const [traveler, seat] = assignment.split(":").map((item) => item.trim()); return { traveler: traveler || "Traveler", seat: seat || "" }; }),
            documents: priorLeg.documents || [],
          };
          }),
      };
    } else if (activity.activityType === "accommodation") {
      activity.accommodation = {
        subtype: first.activity_subtype || "hotel-resort",
        propertyOrHostName: first.property_or_host_name || first.title || "",
        address: first.address || "",
        reservedFrom: first.reserved_from || first.start_date || "",
        reservedTo: first.reserved_to || first.end_date || "",
        expectedArrivalDate: first.expected_arrival_date || first.day_date || first.start_date || "",
        expectedArrivalTime: first.expected_arrival_time || first.start_time || "",
        expectedDepartureDate: first.expected_departure_date || first.end_date || "",
        expectedDepartureTime: first.expected_departure_time || first.end_time || "",
        contactDetails: first.contact_details || "",
        listingUrl: first.listing_url || "",
        accessInstructions: first.access_instructions_private || "",
        checkoutInstructions: first.checkout_instructions_private || "",
        directions: first.directions || "",
      };
    } else if (activity.activityType === "transfer") {
      activity.transfer = {
        service: first.provider_or_service || first.title || "Private Transfer",
        pickup: first.location_or_pickup || "",
        dropoff: first.destination_or_dropoff || first.address || "",
        pickupDate: first.start_date || first.day_date || "",
        pickupTime: first.start_time || "",
        expectedArrivalTime: first.end_time || "",
        meetingInstructions: first.notes || "",
        providerContact: first.contact_details || "",
        prebooked: Boolean(first.booking_reference),
        backupServices: prior?.transfer?.backupServices || [],
      };
    } else if (activity.activityType === "transit") {
      activity.transit = {
        mode: first.provider_or_service || "Public Transit",
        from: first.location_or_pickup || "",
        to: first.destination_or_dropoff || first.address || "",
        lineOrService: first.title || "",
        departureDate: first.start_date || first.day_date || "",
        departureTime: first.start_time || "",
        arrivalDate: first.end_date || first.start_date || "",
        arrivalTime: first.end_time || "",
        ticketDetails: first.notes || "",
      };
    } else if (activity.activityType === "tour") {
      activity.tour = { experience: first.title || "", provider: first.provider_or_service || "", meetingPoint: first.location_or_pickup || first.address || "", date: first.start_date || first.day_date || "", start: first.start_time || "", end: first.end_time || "" };
    } else if (activity.activityType === "dining") {
      activity.dining = { restaurant: first.title || first.location_or_pickup || "", reservationDate: first.start_date || first.day_date || "", reservationTime: first.start_time || "", endTime: first.end_time || "", partySize: first.travelers || "", address: first.address || "", dressCode: first.what_to_wear || "" };
    } else {
      activity.general = { title: first.title || "", location: first.location_or_pickup || first.address || "", date: first.start_date || first.day_date || "", start: first.start_time || "", end: first.end_time || "" };
    }
    changes.push({ id, kind: prior ? "update" : "add", activity, prior: prior || null });
  }
  return { rows, changes, warnings, adds: changes.filter((change) => change.kind === "add").length, updates: changes.filter((change) => change.kind === "update").length };
}

function activitySheetRow(activity, revisions = {}) {
  const type = activityTypeFor(activity);
  const details = typeDetailsFor(activity, type);
  const row = baseRow(activity, type);
  const id = activity.rootId || activity.id || "";
  const output = {
    schema_version: ACTIVITY_SPREADSHEET_VERSION,
    activity_id: id,
    base_revision: String(revisions[id] || 0),
    activity_type: type,
    activity_subtype: type === "accommodation" ? (details.subtype || "hotel-resort") : "",
    title: type === "flight" ? (details.journeyTitle || activity.title || "Flight Journey") : row.title,
    status: row.status,
    day_date: row.day_date,
    start_time: row.start_time,
    end_date: row.end_date,
    end_time: row.end_time,
    time_zone: row.start_time_zone,
    location_or_pickup: row.location_or_pickup,
    destination_or_dropoff: row.destination_or_dropoff,
    address: row.address,
    provider_or_service: row.provider_or_service,
    booking_reference: row.booking_reference,
    travelers: cell(row.travelers),
    cost: row.cost,
    currency: row.currency,
    property_or_host_name: "",
    reserved_from: "",
    reserved_to: "",
    expected_arrival_date: "",
    expected_arrival_time: "",
    expected_departure_date: "",
    expected_departure_time: "",
    listing_url: "",
    access_instructions_private: "",
    checkout_instructions_private: "",
    directions: row.directions,
    contact_details: row.contact_details,
    cancellation_terms: row.cancellation_terms,
    notes: row.notes,
    what_to_wear: row.what_to_wear,
    airline_url: type === "flight" ? (details.airlineUrl || activity.airlineUrl || "") : "",
    booking_details: activity.bookingDetails || "",
    check_in_time: "",
    check_out_time: "",
    room_details: "",
    transfer_prebooked: "",
    backup_services: "",
    ticket_details: "",
    party_size: "",
  };
  if (type === "accommodation") Object.assign(output, {
    property_or_host_name: details.propertyOrHostName || "",
    reserved_from: details.reservedFrom || "",
    reserved_to: details.reservedTo || "",
    expected_arrival_date: details.expectedArrivalDate || "",
    expected_arrival_time: details.expectedArrivalTime || "",
    expected_departure_date: details.expectedDepartureDate || "",
    expected_departure_time: details.expectedDepartureTime || "",
    listing_url: details.listingUrl || "",
    access_instructions_private: details.accessInstructions || "",
    checkout_instructions_private: details.checkoutInstructions || "",
    directions: details.directions || output.directions,
    contact_details: details.contactDetails || output.contact_details,
    address: details.address || output.address,
    check_in_time: details.checkInTime || "",
    check_out_time: details.checkOutTime || "",
    room_details: details.roomDetails || "",
  });
  if (type === "transfer") Object.assign(output, { location_or_pickup: details.pickup || "", destination_or_dropoff: details.dropoff || "", provider_or_service: details.service || "", transfer_prebooked: details.prebooked ? "Yes" : "No", backup_services: cell(details.backupServices || []) });
  if (type === "transit") Object.assign(output, { location_or_pickup: details.from || "", destination_or_dropoff: details.to || "", provider_or_service: details.mode || "", ticket_details: details.ticketDetails || "" });
  if (type === "tour") Object.assign(output, { location_or_pickup: details.meetingPoint || "", provider_or_service: details.provider || "" });
  if (type === "dining") Object.assign(output, { location_or_pickup: details.restaurant || "", address: details.address || "", party_size: details.partySize || activity.party || "" });
  return output;
}

export function travelWorkbookRows({ trip = {}, activities = [], revisions = {} } = {}) {
  const roots = [...new Map(activities.map((activity) => [activity.rootId || activity.id, activity])).values()];
  const activityRows = roots.map((activity) => activitySheetRow(activity, revisions));
  const flightLegRows = roots.flatMap((activity) => {
    if (activityTypeFor(activity) !== "flight") return [];
    const flight = typeDetailsFor(activity, "flight");
    return (flight.legs || []).map((leg, index) => ({
      schema_version: ACTIVITY_SPREADSHEET_VERSION,
      activity_id: activity.rootId || activity.id || "",
      leg_id: leg.legId || leg.id || `leg-${index + 1}`,
      leg_number: index + 1,
      airline: leg.airline || "",
      flight_number: leg.flightNumber || "",
      cabin: leg.cabin || "",
      departure_airport: leg.departure?.airport || "",
      departure_city: leg.departure?.city || "",
      departure_terminal: leg.departure?.terminal || "",
      departure_date: leg.departure?.date || "",
      departure_time: leg.departure?.time || "",
      departure_time_zone: leg.departure?.timeZone || "",
      arrival_airport: leg.arrival?.airport || "",
      arrival_city: leg.arrival?.city || "",
      arrival_terminal: leg.arrival?.terminal || "",
      arrival_date: leg.arrival?.date || "",
      arrival_time: leg.arrival?.time || "",
      arrival_time_zone: leg.arrival?.timeZone || "",
      dan_seat: (leg.seats || []).find((seat) => seat.traveler === "Dan")?.seat || "",
      ken_seat: (leg.seats || []).find((seat) => seat.traveler === "Ken")?.seat || "",
      leg_booking_reference: leg.bookingReference || "",
      leg_status: leg.status || "",
    }));
  });
  const documentRows = roots.flatMap((activity) => {
    const activityId = activity.rootId || activity.id || "";
    const documents = (activity.documents || []).map((document) => ({ document, legId: "" }));
    for (const leg of activity.flight?.legs || []) for (const document of leg.documents || []) documents.push({ document, legId: leg.legId || leg.id || "" });
    return documents.map(({ document, legId }) => ({
      schema_version: ACTIVITY_SPREADSHEET_VERSION,
      document_id: document.id || "",
      activity_id: activityId,
      leg_id: legId,
      label: document.label || document.filename || "Trip Document",
      filename: document.filename || "",
      private: "Yes",
      include_offline: document.offlineAvailable ? "Yes" : "No",
      notes: "",
    }));
  });
  return {
    "Trip Details": [{ schema_version: ACTIVITY_SPREADSHEET_VERSION, trip_id: trip.id || "", trip_name: trip.name || "", start_date: trip.start || "", end_date: trip.end || "", default_time_zone: trip.timeZone || "", travelers: cell(trip.travelers || ["Dan", "Ken"]), notes: trip.notes || "" }],
    Activities: activityRows,
    "Flight Legs": flightLegRows,
    Documents: documentRows,
  };
}

function requiredWorkbookCells(sheetName, row) {
  const definition = TRAVEL_WORKBOOK_SHEETS[sheetName];
  if (!definition) return [];
  return definition.columns
    .filter(([, required]) => required)
    .filter(([column]) => !String(row[column] ?? "").trim())
    .map(([column]) => column);
}

function normalizedComparable(activity) {
  const clone = structuredClone(activity || {});
  delete clone.original;
  delete clone.rootId;
  delete clone.updatedAt;
  delete clone.updatedBy;
  return clone;
}

export function reviewTravelWorkbookImport(workbookRows, existingActivities = [], revisions = {}) {
  const activityRows = Array.isArray(workbookRows?.Activities) ? workbookRows.Activities : [];
  const legRows = Array.isArray(workbookRows?.["Flight Legs"]) ? workbookRows["Flight Legs"] : [];
  const missingInformation = [];
  const warnings = [];
  activityRows.forEach((row, index) => {
    for (const column of requiredWorkbookCells("Activities", row)) missingInformation.push({ sheet: "Activities", row: index + 2, activityId: row.activity_id || "", column });
  });
  legRows.forEach((row, index) => {
    for (const column of requiredWorkbookCells("Flight Legs", row)) missingInformation.push({ sheet: "Flight Legs", row: index + 2, activityId: row.activity_id || "", column });
  });

  const flatRows = [];
  for (const row of activityRows) {
    const common = {
      schema_version: row.schema_version,
      activity_id: row.activity_id,
      activity_type: row.activity_type === "hotel" ? "accommodation" : row.activity_type,
      activity_subtype: row.activity_subtype,
      title: row.title,
      status: row.status,
      day_date: row.day_date,
      start_date: row.expected_arrival_date || row.reserved_from || row.day_date,
      start_time: row.expected_arrival_time || row.start_time,
      start_time_zone: row.time_zone,
      end_date: row.expected_departure_date || row.reserved_to || row.end_date,
      end_time: row.expected_departure_time || row.end_time,
      end_time_zone: row.time_zone,
      property_or_host_name: row.property_or_host_name,
      reserved_from: row.reserved_from,
      reserved_to: row.reserved_to,
      expected_arrival_date: row.expected_arrival_date,
      expected_arrival_time: row.expected_arrival_time,
      expected_departure_date: row.expected_departure_date,
      expected_departure_time: row.expected_departure_time,
      location_or_pickup: row.location_or_pickup,
      destination_or_dropoff: row.destination_or_dropoff,
      address: row.address,
      provider_or_service: row.provider_or_service,
      booking_reference: row.booking_reference,
      booking_status: row.status,
      travelers: row.travelers,
      cost: row.cost,
      currency: row.currency,
      cancellation_terms: row.cancellation_terms,
      contact_details: row.contact_details,
      listing_url: row.listing_url,
      access_instructions_private: row.access_instructions_private,
      checkout_instructions_private: row.checkout_instructions_private,
      directions: row.directions,
      notes: row.notes,
      what_to_wear: row.what_to_wear,
    };
    if (common.activity_type === "flight") {
      const matchingLegs = legRows.filter((leg) => leg.activity_id === row.activity_id);
      if (!matchingLegs.length) warnings.push(`Flight ${row.activity_id || row.title || "without an ID"} has no Flight Legs rows.`);
      matchingLegs.forEach((leg) => flatRows.push({
        ...common,
        leg_id: leg.leg_id,
        leg_number: leg.leg_number,
        airline: leg.airline,
        flight_number: leg.flight_number,
        cabin: leg.cabin,
        departure_airport: leg.departure_airport,
        departure_city: leg.departure_city,
        departure_terminal: leg.departure_terminal,
        start_date: leg.departure_date,
        start_time: leg.departure_time,
        start_time_zone: leg.departure_time_zone,
        arrival_airport: leg.arrival_airport,
        arrival_city: leg.arrival_city,
        arrival_terminal: leg.arrival_terminal,
        end_date: leg.arrival_date,
        end_time: leg.arrival_time,
        end_time_zone: leg.arrival_time_zone,
        seat_assignments: [`Dan: ${leg.dan_seat || ""}`, `Ken: ${leg.ken_seat || ""}`].filter((seat) => !seat.endsWith(": ")).join(" | "),
        booking_reference: leg.leg_booking_reference || common.booking_reference,
        booking_status: leg.leg_status || common.booking_status,
      }));
    } else flatRows.push(common);
  }

  const headers = ACTIVITY_SPREADSHEET_COLUMNS;
  const csv = `${headers.join(",")}\n${flatRows.map((row) => headers.map((header) => csvCell(row[header])).join(",")).join("\n")}\n`;
  const imported = spreadsheetImportReview(csv, existingActivities);
  warnings.push(...imported.warnings);
  const activityRowsById = new Map(activityRows.map((row) => [String(row.activity_id || ""), row]));
  const additions = [];
  const changes = [];
  const unchanged = [];
  const conflicts = [];
  for (const change of imported.changes) {
    if (change.kind === "add") { additions.push(change); continue; }
    const row = activityRowsById.get(change.id) || {};
    const exportedRevision = Number(row.base_revision || 0);
    const currentRevision = Number(revisions[change.id] || 0);
    const isChanged = JSON.stringify(normalizedComparable(change.activity)) !== JSON.stringify(normalizedComparable(change.prior));
    if (!isChanged) { unchanged.push(change); continue; }
    if (exportedRevision !== currentRevision) conflicts.push({ ...change, exportedRevision, currentRevision, reason: "The activity changed in My Travels after this workbook version was exported." });
    else changes.push(change);
  }
  return { additions, changes, unchanged, missingInformation, conflicts, warnings };
}

export function mergeReviewedWorkbook(review, acceptedIds = []) {
  const accepted = new Set(acceptedIds);
  return [...(review.additions || []), ...(review.changes || [])]
    .filter((item) => accepted.has(item.id))
    .map((item) => ({ id: item.id, kind: item.kind, activity: structuredClone(item.activity) }));
}
