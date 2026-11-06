const ARRIVAL_DESTINATIONS = {
  HKG: {
    city: "Hong Kong",
    mediaKey: "hongKong",
    timeZone: "Asia/Hong_Kong",
  },
};

function minutesFromClock(value) {
  const [hour, minute] = String(value || "00:00").split(":").map(Number);
  return (hour * 60) + minute;
}

function minutesAt(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return (Number(values.hour) * 60) + Number(values.minute);
}

function scheduledDestinationArrival(day) {
  for (const activity of day.activities || []) {
    const airportCode = activity.venue?.match(/\bto\s+([A-Z]{3})\b/i)?.[1]?.toUpperCase();
    const destination = ARRIVAL_DESTINATIONS[airportCode];
    if (destination && activity.end) return { activity, destination };
  }
  return null;
}

export function destinationPresentation(day, now, isActualToday) {
  const configured = {
    city: day.city,
    mediaKey: day.mediaKey,
    timeZone: day.timeZone,
  };
  if (!isActualToday) return configured;

  const arrival = scheduledDestinationArrival(day);
  if (!arrival) return configured;

  if (minutesAt(now, day.timeZone) >= minutesFromClock(arrival.activity.end)) {
    return arrival.destination;
  }

  return {
    ...configured,
    city: day.city.split("→")[0].trim(),
  };
}
