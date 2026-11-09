const dates = Array.from({ length: 13 }, (_, index) => {
  const date = new Date(Date.UTC(2027, 3, 10 + index)).toISOString().slice(0, 10);
  const departureDay = index === 0;
  return {
    date,
    city: departureDay ? "Boston" : "Seoul",
    timeZone: departureDay ? "America/New_York" : "Asia/Seoul",
    mediaKey: departureDay ? "boston" : "seoul",
    activities: [],
  };
});

export default {
  trip: {
    id: "south-korea-april-2027",
    name: "South Korea In April",
    start: "2027-04-10",
    end: "2027-04-22",
    timeZone: "Asia/Seoul",
    travelers: ["Dan", "Ken"],
    notes: "Preview pilot only. Production is out of scope. Confirm the April dates and destination before import.",
    media: {},
  },
  days: dates,
  tasks: [],
  transportDefaults: {},
};
