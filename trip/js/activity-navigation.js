export function activityNeighbors(days, activityId) {
  const activities = days.flatMap((day) => day.activities || []);
  const index = activities.findIndex((activity) => activity.id === activityId);
  if (index < 0) return { previous: null, next: null };
  return {
    previous: index > 0 ? activities[index - 1] : null,
    next: index < activities.length - 1 ? activities[index + 1] : null,
  };
}
