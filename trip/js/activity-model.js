export const ACTIVITY_TYPES = [
  { id: "flight", label: "Flight", icon: "✈" },
  { id: "accommodation", label: "Accommodation", icon: "▰" },
  { id: "transfer", label: "Ride-Share, Taxi, Or Private Transfer", icon: "⌁" },
  { id: "transit", label: "Public Transit", icon: "⇄" },
  { id: "tour", label: "Tour Or Reservation", icon: "⌖" },
  { id: "dining", label: "Dining", icon: "♨" },
  { id: "general", label: "General Activity", icon: "＋" },
];

export const ACTIVITY_TYPE_IDS = new Set(ACTIVITY_TYPES.map((type) => type.id));

export const FLIGHT_CABIN_OPTIONS = [
  "First Class",
  "Business",
  "Premium Economy",
  "Main Cabin",
];

export const ACCOMMODATION_SUBTYPES = [
  { id: "hotel-resort", label: "Hotel Or Resort" },
  { id: "rental", label: "Airbnb Or Vrbo" },
  { id: "bed-breakfast", label: "Bed And Breakfast" },
  { id: "friends-family", label: "Friends Or Family" },
  { id: "other", label: "Other Accommodation" },
];

const FLIGHT_TITLE = /\b(?:flight|airlines?|airways?|air)\b|\b[A-Z]{2,3}\s?\d{1,4}\b/i;
const TRANSFER_TITLE = /\b(?:transfer|pickup|drop-?off|ride-?share|taxi|uber|grab|private car|car to)\b/i;
const TRANSIT_TITLE = /\b(?:metro|subway|underground|train|tram|ferry|public transit|shuttle|bus)\b/i;
const HOTEL_TITLE = /\b(?:hotel|resort|inn|lodging|check-?in|arrive at .*house)\b/i;
const DINING_TITLE = /\b(?:dinner|lunch|breakfast|brunch|restaurant|dining|supper)\b/i;
const TOUR_TITLE = /\b(?:tour|observatory|museum|garden|excursion|reservation|experience|attraction|temple|terrace)\b/i;

export function activityTypeFor(activity = {}) {
  if (activity.activityType === "hotel") return "accommodation";
  if (ACTIVITY_TYPE_IDS.has(activity.activityType)) return activity.activityType;
  const title = String(activity.title || "");
  if (activity.flight?.legs?.length || activity.airlineUrl || activity.startUtc || FLIGHT_TITLE.test(title)) return "flight";
  if (activity.accommodation || activity.hotel || HOTEL_TITLE.test(title)) return "accommodation";
  if (activity.transfer || TRANSFER_TITLE.test(title)) return "transfer";
  if (activity.transit || TRANSIT_TITLE.test(title)) return "transit";
  if (activity.dining || DINING_TITLE.test(title)) return "dining";
  if (activity.tour || TOUR_TITLE.test(title)) return "tour";
  return "general";
}

export function activityTypeLabel(typeId) {
  return ACTIVITY_TYPES.find((type) => type.id === typeId)?.label || "General Activity";
}

export function cityRideServices(city = "", editableDefaults = {}) {
  const normalized = String(city).toLowerCase();
  const defaults = normalized.includes("singapore")
    ? ["Grab", "Taxi", "Private Transfer"]
    : ["Uber", "Taxi", "Private Transfer"];
  const configured = editableDefaults[city] || editableDefaults[normalized] || [];
  return [...new Set([...configured, ...defaults])];
}

function endpointFromLegacy(value, fallbackCity = "") {
  const text = String(value || "").trim();
  const terminal = text.match(/\bTerminal\s+([A-Za-z0-9-]+)/i)?.[1] || "";
  const withoutTerminal = text.replace(/\s*Terminal\s+[A-Za-z0-9-]+\s*/i, " ").trim();
  const airport = withoutTerminal.match(/\b[A-Z]{3}\b/)?.[0] || "";
  return { airport, city: withoutTerminal || fallbackCity, terminal };
}

const AIRPORT_TIME_ZONES = {
  BOS: "America/New_York",
  JFK: "America/New_York",
  LGA: "America/New_York",
  EWR: "America/New_York",
  LHR: "Europe/London",
  LGW: "Europe/London",
  ICN: "Asia/Seoul",
  GMP: "Asia/Seoul",
  SIN: "Asia/Singapore",
  HKG: "Asia/Hong_Kong",
  NRT: "Asia/Tokyo",
  HND: "Asia/Tokyo",
  SYD: "Australia/Sydney",
};

function endpointTimeZone(endpoint, fallback = "UTC") {
  const airport = String(endpoint?.airport || "").toUpperCase();
  if (AIRPORT_TIME_ZONES[airport]) return AIRPORT_TIME_ZONES[airport];
  const city = String(endpoint?.city || "").toLowerCase();
  if (city.includes("seoul") || city.includes("incheon")) return "Asia/Seoul";
  if (city.includes("singapore")) return "Asia/Singapore";
  if (city.includes("hong kong")) return "Asia/Hong_Kong";
  if (city.includes("boston")) return "America/New_York";
  return fallback || "UTC";
}

function legacyFlight(activity) {
  const route = String(activity.venue || "").split(/\s+(?:to|→)\s+/i);
  const title = String(activity.title || "").trim();
  const flightNumber = title.match(/\b[A-Z]{2,3}\s?\d{1,4}\b/i)?.[0]?.replace(/\s+/g, "") || "";
  const airline = flightNumber ? title.replace(flightNumber, "").trim() : title;
  const departureEndpoint = endpointFromLegacy(route[0], activity.city);
  const arrivalEndpoint = endpointFromLegacy(route[1], "");
  return {
    journeyTitle: title || "Flight Journey",
    bookingReference: String(activity.bookingReference || ""),
    airlineUrl: String(activity.airlineUrl || ""),
    legs: [{
      legId: "leg-1",
      airline,
      flightNumber,
      departure: {
        ...departureEndpoint,
        date: activity.dayDate || "",
        time: activity.start || "",
        timeZone: endpointTimeZone(departureEndpoint, activity.timeZone),
      },
      arrival: {
        ...arrivalEndpoint,
        date: activity.endDate || activity.dayDate || "",
        time: activity.end || "",
        timeZone: String(activity.arrivalTimeZone || endpointTimeZone(arrivalEndpoint, activity.timeZone)),
      },
      cabin: parseLegacyCabin(activity.party),
      seats: parseLegacySeats(activity.party),
      bookingReference: "",
      status: "",
      documents: [],
    }],
  };
}

function parseLegacySeats(party = "") {
  const seats = [];
  for (const name of ["Dan", "Ken"]) {
    const match = String(party).match(new RegExp(`${name}\\s+([0-9]{1,2}[A-Z])`, "i"));
    if (match) seats.push({ traveler: name, seat: match[1].toUpperCase() });
  }
  return seats;
}

function parseLegacyCabin(party = "") {
  const text = String(party || "");
  const match = text.match(/\b(First Class|Prestige Class|Business Class|Business|Premium Economy|Main Cabin|Economy Class|Economy)\b/i);
  if (!match) return "";
  const cabin = match[1].toLowerCase();
  if (cabin === "business class" || cabin === "business") return "Business";
  if (cabin === "economy class" || cabin === "economy" || cabin === "main cabin") return "Main Cabin";
  return match[1].replace(/\b\w/g, (character) => character.toUpperCase());
}

export function typeDetailsFor(activity = {}, type = activityTypeFor(activity)) {
  if (type === "flight") return structuredClone(activity.flight || legacyFlight(activity));
  if (type === "accommodation" || type === "hotel") return structuredClone({
    subtype: "hotel-resort",
    propertyOrHostName: activity.venue || activity.title || "",
    address: activity.address || "",
    reservedFrom: activity.reservedFrom || activity.dayDate || "",
    reservedTo: activity.reservedTo || activity.endDate || activity.dayDate || "",
    checkInTime: activity.checkInTime || activity.start || "",
    checkOutTime: activity.checkOutTime || activity.end || "",
    expectedArrivalDate: activity.dayDate || "",
    expectedArrivalTime: activity.start || "",
    expectedDepartureDate: activity.endDate || activity.dayDate || "",
    expectedDepartureTime: activity.end || "",
    roomDetails: activity.party || "",
    listingUrl: "",
    accessInstructions: "",
    checkoutInstructions: "",
    directions: activity.directions || "",
    contactDetails: activity.contact || "",
    ...(activity.hotel || {}),
    ...(activity.accommodation || {}),
  });
  if (type === "transfer") return structuredClone(activity.transfer || {
    service: activity.service || activity.title || "",
    pickup: activity.meetingPoint || activity.venue || "",
    dropoff: activity.address || "",
    pickupDate: activity.dayDate || "",
    pickupTime: activity.start || "",
    expectedArrivalTime: activity.end || "",
    meetingInstructions: activity.note || "",
    providerContact: activity.contact || "",
    prebooked: Boolean(activity.fixed || activity.bookingDetails || activity.evidence),
    backupServices: [],
  });
  if (type === "transit") return structuredClone(activity.transit || {
    mode: activity.mode || "Public Transit",
    from: activity.venue || "",
    to: activity.address || "",
    lineOrService: activity.title || "",
    departureDate: activity.dayDate || "",
    departureTime: activity.start || "",
    arrivalDate: activity.endDate || activity.dayDate || "",
    arrivalTime: activity.end || "",
    ticketDetails: activity.bookingDetails || "",
  });
  if (type === "tour") return structuredClone(activity.tour || {
    experience: activity.title || "",
    provider: activity.provider || "",
    meetingPoint: activity.meetingPoint || activity.venue || "",
    date: activity.dayDate || "",
    start: activity.start || "",
    end: activity.end || "",
  });
  if (type === "dining") return structuredClone(activity.dining || {
    restaurant: activity.venue || activity.title || "",
    reservationDate: activity.dayDate || "",
    reservationTime: activity.start || "",
    endTime: activity.end || "",
    partySize: activity.party || "",
    address: activity.address || "",
    dressCode: activity.whatToWear || "",
  });
  return structuredClone(activity.general || {
    title: activity.title || "",
    location: activity.venue || activity.address || "",
    date: activity.dayDate || "",
    start: activity.start || "",
    end: activity.end || "",
  });
}

export function bookingReferenceFor(activity = {}, legIndex = activity.flightLegIndex) {
  if (activityTypeFor(activity) !== "flight") return String(activity.bookingReference || "").trim();
  const flight = typeDetailsFor(activity, "flight");
  const legReference = Number.isInteger(legIndex) ? flight.legs?.[legIndex]?.bookingReference : "";
  return String(legReference || flight.bookingReference || activity.bookingReference || "").trim();
}

export function zonedDateTimeToEpoch(date, time, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^\d{2}:\d{2}$/.test(String(time)) || !timeZone) return NaN;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  let epoch = wallClock;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    for (let pass = 0; pass < 3; pass += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(epoch)).map((part) => [part.type, part.value]));
      const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
      epoch += wallClock - rendered;
    }
    return epoch;
  } catch {
    return NaN;
  }
}

export function legElapsedMinutes(leg) {
  const start = zonedDateTimeToEpoch(leg.departure?.date, leg.departure?.time, leg.departure?.timeZone);
  const end = zonedDateTimeToEpoch(leg.arrival?.date, leg.arrival?.time, leg.arrival?.timeZone);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 60000) : NaN;
}

export function connectionDetails(legs = []) {
  return legs.slice(0, -1).map((leg, index) => {
    const next = legs[index + 1];
    const arrival = leg.arrival || {};
    const departure = next.departure || {};
    const arrivedAt = zonedDateTimeToEpoch(arrival.date, arrival.time, arrival.timeZone);
    const departsAt = zonedDateTimeToEpoch(departure.date, departure.time, departure.timeZone);
    const durationMinutes = Number.isFinite(arrivedAt) && Number.isFinite(departsAt)
      ? Math.round((departsAt - arrivedAt) / 60000)
      : NaN;
    const arrivalAirport = String(arrival.airport || "").toUpperCase();
    const departureAirport = String(departure.airport || "").toUpperCase();
    const airportChange = Boolean(arrivalAirport && departureAirport && arrivalAirport !== departureAirport);
    const hub = airportChange ? `${arrivalAirport} → ${departureAirport}` : (arrivalAirport || departureAirport || arrival.city || departure.city || "Hub");
    return {
      afterLeg: index,
      durationMinutes,
      hub,
      airportChange,
      overnight: Boolean(arrival.date && departure.date && arrival.date !== departure.date),
      inconsistentChronology: Number.isFinite(durationMinutes) && durationMinutes < 0,
      needsReview: !Number.isFinite(durationMinutes) || durationMinutes < 0 || airportChange,
    };
  });
}

export function durationLabel(minutes) {
  if (!Number.isFinite(minutes)) return "Duration unavailable";
  if (minutes < 0) return "Chronology conflict";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours}h` : "", remainder ? `${remainder}m` : ""].filter(Boolean).join(" ") || "0m";
}

export function flightJourneySummary(activity = {}) {
  const flight = typeDetailsFor(activity, "flight");
  const legs = flight.legs || [];
  const first = legs[0];
  const last = legs.at(-1);
  const connections = connectionDetails(legs);
  const route = [first?.departure?.airport || first?.departure?.city, ...legs.map((leg) => leg.arrival?.airport || leg.arrival?.city)].filter(Boolean).join(" → ");
  return {
    title: flight.journeyTitle || activity.title || "Flight Journey",
    route,
    legCount: legs.length,
    connections,
    startsAt: first ? zonedDateTimeToEpoch(first.departure?.date, first.departure?.time, first.departure?.timeZone) : NaN,
    endsAt: last ? zonedDateTimeToEpoch(last.arrival?.date, last.arrival?.time, last.arrival?.timeZone) : NaN,
  };
}

function projectionId(rootId, legIndex, phase) {
  return `${rootId}--leg-${legIndex + 1}-${phase}`;
}

function flightProjections(activity) {
  const flight = typeDetailsFor(activity, "flight");
  const legs = flight.legs || [];
  const connections = connectionDetails(legs);
  const projections = [];
  legs.forEach((leg, index) => {
    const departure = leg.departure || {};
    const arrival = leg.arrival || {};
    const airlineAndNumber = [leg.airline, leg.flightNumber].filter(Boolean).join(" ") || flight.journeyTitle || activity.title || `Flight Leg ${index + 1}`;
    const route = `${departure.airport || departure.city || "Departure"} to ${arrival.airport || arrival.city || "Arrival"}`;
    const startEpoch = zonedDateTimeToEpoch(departure.date, departure.time, departure.timeZone);
    const endEpoch = zonedDateTimeToEpoch(arrival.date, arrival.time, arrival.timeZone);
    const connection = index ? connections[index - 1] : null;
    projections.push({
      ...activity,
      id: projectionId(activity.id, index, "departure"),
      rootId: activity.id,
      activityType: "flight",
      projectionKind: "flight-departure",
      flightLegIndex: index,
      dayDate: departure.date || activity.dayDate,
      timeZone: departure.timeZone || activity.timeZone,
      start: departure.time || activity.start || "00:00",
      end: arrival.time || activity.end || departure.time || "00:00",
      endDate: arrival.date || departure.date || activity.endDate,
      startUtc: Number.isFinite(startEpoch) ? new Date(startEpoch).toISOString() : activity.startUtc,
      endUtc: Number.isFinite(endEpoch) ? new Date(endEpoch).toISOString() : activity.endUtc,
      title: airlineAndNumber,
      venue: route,
      address: arrival.city || arrival.airport || activity.address || "",
      connection,
      journeyTitle: flight.journeyTitle || activity.title,
      original: activity.original,
    });
    if (arrival.date && departure.date && arrival.date !== departure.date) {
      projections.push({
        ...activity,
        id: projectionId(activity.id, index, "arrival"),
        rootId: activity.id,
        activityType: "flight",
        projectionKind: "flight-arrival",
        flightLegIndex: index,
        dayDate: arrival.date,
        timeZone: arrival.timeZone || activity.timeZone,
        start: arrival.time || "00:00",
        end: arrival.time || "00:00",
        title: `Arrival — ${airlineAndNumber}`,
        venue: arrival.airport || arrival.city || "Arrival Airport",
        address: arrival.city || arrival.airport || "",
        displayTime: `Arrives ${arrival.time || ""}`.trim(),
        arrivalContinuation: true,
        journeyTitle: flight.journeyTitle || activity.title,
        original: activity.original,
      });
    }
  });
  return projections.length ? projections : [{ ...activity, rootId: activity.id }];
}

export function materializeActivityDays(baseDays = [], overrides = {}) {
  const roots = new Map();
  const baseIds = new Set();
  for (const day of baseDays) {
    for (const original of day.activities || []) {
      baseIds.add(original.id);
      const activity = {
        ...original,
        ...(overrides[original.id] || {}),
        id: original.id,
        rootId: original.id,
        original,
        custom: false,
        dayDate: overrides[original.id]?.dayDate || original.dayDate || day.date,
        city: day.city,
        timeZone: day.timeZone,
      };
      activity.activityType = activityTypeFor(activity);
      roots.set(activity.id, activity);
    }
  }
  for (const [id, value] of Object.entries(overrides)) {
    if (!value?.custom || baseIds.has(id)) continue;
    const day = baseDays.find((candidate) => candidate.date === value.dayDate) || baseDays[0] || {};
    const activity = {
      ...value,
      id,
      rootId: id,
      original: null,
      custom: true,
      dayDate: value.dayDate || day.date,
      city: value.city || day.city || "",
      timeZone: value.timeZone || day.timeZone || "UTC",
    };
    activity.activityType = activityTypeFor(activity);
    roots.set(id, activity);
  }

  const projections = [];
  for (const activity of roots.values()) {
    projections.push(...(activity.activityType === "flight" ? flightProjections(activity) : [{ ...activity, rootId: activity.id }]));
  }
  const days = baseDays.map((day) => ({
    ...day,
    activities: projections
      .filter((activity) => activity.dayDate === day.date)
      .map((activity) => ({ ...activity, city: day.city, timeZone: activity.timeZone || day.timeZone }))
      .sort((left, right) => String(left.start || "").localeCompare(String(right.start || ""))),
  }));
  return { days, roots, projections };
}

export function editableActivityId(activityOrId) {
  if (activityOrId && typeof activityOrId === "object") return activityOrId.rootId || activityOrId.id;
  return String(activityOrId || "").split(/--leg-\d+-(?:departure|arrival)$/)[0];
}

export function transitAppleMapsUrl(activity = {}) {
  const details = typeDetailsFor(activity, "transit");
  const parameters = new URLSearchParams({
    saddr: details.from || activity.venue || "",
    daddr: details.to || activity.address || "",
    dirflg: "r",
  });
  return `https://maps.apple.com/?${parameters}`;
}
