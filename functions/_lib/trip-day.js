import { RequestError } from "./http.js";

function text(value, name, maximum, { required = false } = {}) {
  if (value == null && !required) return "";
  if (typeof value !== "string") throw new RequestError(400, `Invalid ${name}`);
  const result = value.trim();
  if ((required && !result) || result.length > maximum) throw new RequestError(400, `Invalid ${name}`);
  return result;
}

function isoDate(value) {
  const result = text(value, "trip day date", 10, { required: true });
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(result);
  if (!match) throw new RequestError(400, "Invalid trip day date");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== result) throw new RequestError(400, "Invalid trip day date");
  return result;
}

function timeZone(value) {
  const result = text(value, "trip day time zone", 80, { required: true });
  try { new Intl.DateTimeFormat("en-US", { timeZone: result }).format(new Date()); }
  catch { throw new RequestError(400, "Invalid trip day time zone"); }
  return result;
}

export function validateTripDay(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError(400, "Invalid trip day");
  const mediaKey = text(value.mediaKey || "", "destination key", 80);
  if (mediaKey && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(mediaKey)) {
    throw new RequestError(400, "Destination key must use lower-case kebab-case");
  }
  return {
    date: isoDate(value.date),
    city: text(value.city, "trip day city", 160, { required: true }),
    timeZone: timeZone(value.timeZone),
    ...(mediaKey ? { mediaKey } : {}),
    activities: [],
  };
}

export function withTripDay(itinerary, day) {
  if (!itinerary || typeof itinerary !== "object" || !Array.isArray(itinerary.days) || !itinerary.trip) {
    throw new RequestError(503, "Trip data is not configured");
  }
  const existing = itinerary.days.find((candidate) => String(candidate.date) === day.date);
  if (existing) {
    const same = String(existing.city) === day.city
      && String(existing.timeZone) === day.timeZone
      && String(existing.mediaKey || "") === String(day.mediaKey || "");
    if (!same) throw new RequestError(409, "That trip day already exists with different destination details");
    return { itinerary, day: existing, created: false };
  }

  const days = [...itinerary.days, day].sort((left, right) => String(left.date).localeCompare(String(right.date)));
  return {
    itinerary: {
      ...itinerary,
      trip: {
        ...itinerary.trip,
        start: String(days[0].date),
        end: String(days.at(-1).date),
      },
      days,
    },
    day,
    created: true,
  };
}
