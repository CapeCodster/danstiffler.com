import { RequestError } from "./http.js";

const ALLOWED_ACTIVITY_TYPES = new Set(["flight", "accommodation", "transfer", "transit", "tour", "dining", "general"]);
const ALLOWED_ACCOMMODATION_SUBTYPES = new Set(["hotel-resort", "rental", "bed-breakfast", "friends-family", "other"]);
export const ALLOWED_ACTIVITY_STATUSES = new Set(["confirmed", "purchased", "planned", "awaiting", "done", "skipped", "cancelled"]);

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError(400, `Invalid ${name}`);
  return value;
}

function text(value, name, maximum, { required = false } = {}) {
  if (value == null && !required) return "";
  if (typeof value !== "string") throw new RequestError(400, `Invalid ${name}`);
  const result = value.trim();
  if ((required && !result) || result.length > maximum) throw new RequestError(400, `Invalid ${name}`);
  return result;
}

function date(value, name, { required = false } = {}) {
  const result = text(value, name, 10, { required });
  if (result && !/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new RequestError(400, `Invalid ${name}`);
  return result;
}

function time(value, name, { required = false } = {}) {
  const result = text(value, name, 5, { required });
  if (result && !/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new RequestError(400, `Invalid ${name}`);
  return result;
}

function timeZone(value, name, { required = false } = {}) {
  const result = text(value, name, 80, { required });
  if (result) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: result }).format(new Date()); }
    catch { throw new RequestError(400, `Invalid ${name}`); }
  }
  return result;
}

function optionalUrl(value, name) {
  const result = text(value, name, 600);
  if (!result) return "";
  let url;
  try { url = new URL(result); }
  catch { throw new RequestError(400, `Invalid ${name}`); }
  if (!new Set(["https:", "http:"]).has(url.protocol)) throw new RequestError(400, `Invalid ${name}`);
  return result;
}

function endpoint(value, name) {
  const input = object(value, name);
  const result = {
    airport: text(input.airport || "", `${name} airport`, 8).toUpperCase(),
    city: text(input.city || "", `${name} city`, 120),
    terminal: text(input.terminal || "", `${name} terminal`, 80),
    date: date(input.date, `${name} date`, { required: true }),
    time: time(input.time, `${name} time`, { required: true }),
    timeZone: timeZone(input.timeZone, `${name} time zone`, { required: true }),
  };
  if (!result.airport && !result.city) throw new RequestError(400, `${name} airport or city is required`);
  return result;
}

function seats(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 12) throw new RequestError(400, `Invalid ${name}`);
  return value.map((seat, index) => {
    const input = object(seat, `${name} ${index + 1}`);
    return { traveler: text(input.traveler, "traveler", 80, { required: true }), seat: text(input.seat || "", "seat", 12) };
  });
}

function documents(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 30) throw new RequestError(400, "Invalid documents");
  return value.map((document, index) => {
    const input = object(document, `document ${index + 1}`);
    const url = text(input.url, "document URL", 180, { required: true });
    if (!/^\/api\/trip\/document\/[a-z0-9][a-z0-9-]{1,79}$/.test(url)) throw new RequestError(400, "Invalid document URL");
    const scope = text(input.scope || "activity", "document scope", 20);
    if (!new Set(["activity", "journey", "leg"]).has(scope)) throw new RequestError(400, "Invalid document scope");
    const legIndex = input.legIndex == null ? null : Number(input.legIndex);
    if (legIndex !== null && (!Number.isInteger(legIndex) || legIndex < 0 || legIndex > 11)) throw new RequestError(400, "Invalid document leg");
    return {
      id: text(input.id || url.split("/").at(-1), "document ID", 80, { required: true }),
      url,
      label: text(input.label || "Trip Document", "document label", 160, { required: true }),
      filename: text(input.filename || "trip-document", "document filename", 160, { required: true }),
      contentType: text(input.contentType || "application/octet-stream", "document content type", 120),
      scope,
      legIndex,
      offlineAvailable: Boolean(input.offlineAvailable),
    };
  });
}

function flight(value) {
  const input = object(value, "flight journey");
  if (!Array.isArray(input.legs) || input.legs.length < 1 || input.legs.length > 12) throw new RequestError(400, "Supply between 1 and 12 flight legs");
  return {
    journeyTitle: text(input.journeyTitle || "Flight Journey", "journey title", 160, { required: true }),
    bookingReference: text(input.bookingReference || "", "journey booking reference", 120),
    airlineUrl: optionalUrl(input.airlineUrl || "", "airline URL"),
    legs: input.legs.map((leg, index) => {
      const item = object(leg, `flight leg ${index + 1}`);
      return {
        legId: text(item.legId || `leg-${index + 1}`, "flight leg identifier", 80, { required: true }),
        airline: text(item.airline, "airline", 120, { required: true }),
        flightNumber: text(item.flightNumber, "flight number", 20, { required: true }).toUpperCase(),
        cabin: text(item.cabin || "", "flight cabin", 80),
        departure: endpoint(item.departure, `leg ${index + 1} departure`),
        arrival: endpoint(item.arrival, `leg ${index + 1} arrival`),
        seats: seats(item.seats, `leg ${index + 1} seats`),
        bookingReference: text(item.bookingReference || "", "leg booking reference", 120),
        status: item.status ? status(item.status) : "",
        documents: documents(item.documents),
      };
    }),
  };
}

function accommodation(value) {
  const input = object(value, "accommodation");
  const subtype = text(input.subtype || "hotel-resort", "accommodation subtype", 30);
  if (!ALLOWED_ACCOMMODATION_SUBTYPES.has(subtype)) throw new RequestError(400, "Invalid accommodation subtype");
  return {
    subtype,
    propertyOrHostName: text(input.propertyOrHostName, "property or host name", 200, { required: true }),
    address: text(input.address, "accommodation address", 300, { required: true }),
    reservedFrom: date(input.reservedFrom, "reserved stay start", { required: true }),
    reservedTo: date(input.reservedTo, "reserved stay end", { required: true }),
    checkInTime: time(input.checkInTime || "", "check-in time"),
    checkOutTime: time(input.checkOutTime || "", "check-out time"),
    expectedArrivalDate: date(input.expectedArrivalDate, "expected arrival date", { required: true }),
    expectedArrivalTime: time(input.expectedArrivalTime, "expected arrival time", { required: true }),
    expectedDepartureDate: date(input.expectedDepartureDate || input.reservedTo, "expected departure date", { required: true }),
    expectedDepartureTime: time(input.expectedDepartureTime || "", "expected departure time"),
    roomDetails: text(input.roomDetails || "", "room details", 1000),
    listingUrl: optionalUrl(input.listingUrl || "", "listing URL"),
    accessInstructions: text(input.accessInstructions || "", "private access instructions", 4000),
    checkoutInstructions: text(input.checkoutInstructions || "", "checkout instructions", 3000),
    directions: text(input.directions || "", "directions", 2000),
    contactDetails: text(input.contactDetails || "", "contact details", 1000),
  };
}

function transfer(value) {
  const input = object(value, "transfer");
  return {
    service: text(input.service, "service", 160, { required: true }),
    pickup: text(input.pickup, "pickup", 300, { required: true }),
    dropoff: text(input.dropoff, "drop-off", 300, { required: true }),
    pickupDate: date(input.pickupDate, "pickup date", { required: true }),
    pickupTime: time(input.pickupTime, "pickup time", { required: true }),
    expectedArrivalTime: time(input.expectedArrivalTime || "", "expected arrival time"),
    meetingInstructions: text(input.meetingInstructions || "", "meeting instructions", 2000),
    providerContact: text(input.providerContact || "", "provider contact", 1000),
    prebooked: Boolean(input.prebooked),
    backupServices: Array.isArray(input.backupServices) ? input.backupServices.slice(0, 8).map((item) => text(item, "backup service", 80, { required: true })) : [],
  };
}

function transit(value) {
  const input = object(value, "public transit");
  return {
    mode: text(input.mode, "transit mode", 100, { required: true }),
    from: text(input.from, "transit origin", 300, { required: true }),
    to: text(input.to, "transit destination", 300, { required: true }),
    lineOrService: text(input.lineOrService || "", "line or service", 160),
    departureDate: date(input.departureDate, "transit departure date", { required: true }),
    departureTime: time(input.departureTime, "transit departure time", { required: true }),
    arrivalDate: date(input.arrivalDate || input.departureDate, "transit arrival date", { required: true }),
    arrivalTime: time(input.arrivalTime || "", "transit arrival time"),
    ticketDetails: text(input.ticketDetails || "", "ticket details", 2000),
  };
}

function tour(value) {
  const input = object(value, "tour or reservation");
  return {
    experience: text(input.experience, "experience", 200, { required: true }),
    provider: text(input.provider || "", "provider", 160),
    meetingPoint: text(input.meetingPoint, "meeting point", 300, { required: true }),
    date: date(input.date, "experience date", { required: true }),
    start: time(input.start, "experience start", { required: true }),
    end: time(input.end || "", "experience end"),
  };
}

function dining(value) {
  const input = object(value, "dining");
  return {
    restaurant: text(input.restaurant, "restaurant", 200, { required: true }),
    reservationDate: date(input.reservationDate, "reservation date", { required: true }),
    reservationTime: time(input.reservationTime, "reservation time", { required: true }),
    endTime: time(input.endTime || "", "dining end time"),
    partySize: text(input.partySize || "", "party size", 80),
    address: text(input.address || "", "restaurant address", 300),
    dressCode: text(input.dressCode || "", "dress code", 1000),
  };
}

function general(value) {
  const input = object(value, "general activity");
  return {
    title: text(input.title, "general activity title", 160, { required: true }),
    location: text(input.location || "", "general activity location", 300),
    date: date(input.date, "general activity date", { required: true }),
    start: time(input.start, "general activity start", { required: true }),
    end: time(input.end || "", "general activity end"),
  };
}

function status(value) {
  const result = text(value, "status", 30, { required: true });
  if (!ALLOWED_ACTIVITY_STATUSES.has(result)) throw new RequestError(400, "Invalid status");
  return result;
}

function commonFields(input, dayDates, { partial }) {
  const output = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  if (has("activityType") || !partial) {
    const activityType = text(input.activityType, "activity type", 30, { required: true });
    if (!ALLOWED_ACTIVITY_TYPES.has(activityType)) throw new RequestError(400, "Invalid activity type");
    output.activityType = activityType;
  }
  if (has("dayDate") || !partial) {
    output.dayDate = date(input.dayDate, "activity date", { required: true });
    if (!dayDates.has(output.dayDate)) throw new RequestError(400, "Activity date is outside this trip");
  }
  const textFields = [
    ["title", 160], ["venue", 200], ["address", 300], ["whatToWear", 1000], ["note", 4000],
    ["party", 300], ["bookingDetails", 4000], ["meetingPoint", 300], ["paid", 160], ["contact", 1000],
    ["cancellationTerms", 3000], ["bookingReference", 120], ["directions", 2000],
  ];
  for (const [key, maximum] of textFields) {
    if (has(key) || (!partial && key === "title")) output[key] = text(input[key] || "", key, maximum, { required: !partial && key === "title" });
  }
  for (const key of ["start", "end"]) if (has(key) || !partial) output[key] = time(input[key] || "", key, { required: !partial });
  if (has("endDate")) output.endDate = date(input.endDate || "", "end date");
  if (has("timeZone")) output.timeZone = timeZone(input.timeZone || "", "activity time zone");
  if (has("airlineUrl")) output.airlineUrl = optionalUrl(input.airlineUrl || "", "airline URL");
  if (has("status") || !partial) output.status = status(input.status || "planned");
  if (has("fixed")) output.fixed = Boolean(input.fixed);
  for (const key of ["travelMinutes", "arrivalBufferMinutes"]) {
    if (!has(key)) continue;
    const numeric = Number(input[key]);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 1440) throw new RequestError(400, `Invalid ${key}`);
    output[key] = numeric;
  }
  if (has("travelers")) {
    if (!Array.isArray(input.travelers) || input.travelers.length > 12) throw new RequestError(400, "Invalid travelers");
    output.travelers = input.travelers.map((traveler) => text(traveler, "traveler", 80, { required: true }));
  }
  if (has("cost")) {
    const value = object(input.cost, "cost");
    output.cost = { amount: text(value.amount || "", "cost amount", 40), currency: text(value.currency || "", "currency", 8).toUpperCase() };
  }
  if (has("documents")) output.documents = documents(input.documents);
  const typedFields = { flight, accommodation, transfer, transit, tour, dining, general };
  for (const [key, validator] of Object.entries(typedFields)) if (has(key)) output[key] = validator(input[key]);
  return output;
}

export function validateActivityChanges(value, dayDates) {
  const input = object(value, "activity changes");
  const output = commonFields(input, dayDates, { partial: true });
  if (!Object.keys(output).length) throw new RequestError(400, "No supported changes supplied");
  return output;
}

export function validateCustomActivity(value, dayDates) {
  const supplied = object(value, "custom activity");
  const input = { ...supplied };
  if (!input.activityType) input.activityType = "general";
  if (input.activityType === "hotel") input.activityType = "accommodation";
  if (input.activityType === "general" && !input.general) {
    input.general = {
      title: input.title,
      location: input.venue || input.address || "",
      date: input.dayDate,
      start: input.start,
      end: input.end || "",
    };
  }
  if (input.activityType === "accommodation" && !input.accommodation && input.hotel) input.accommodation = input.hotel;
  const output = commonFields(input, dayDates, { partial: false });
  const type = output.activityType;
  if (!output[type]) throw new RequestError(400, `Missing ${type} details`);
  return {
    custom: true,
    fixed: Boolean(input.fixed),
    travelMinutes: Number.isInteger(Number(input.travelMinutes)) ? Math.max(0, Math.min(1440, Number(input.travelMinutes))) : 0,
    arrivalBufferMinutes: Number.isInteger(Number(input.arrivalBufferMinutes)) ? Math.max(0, Math.min(1440, Number(input.arrivalBufferMinutes))) : 0,
    ...output,
  };
}
