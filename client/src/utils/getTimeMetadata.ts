export const getTimeMetadata = () => {
  const now = new Date();
  const hour = now.getHours();
  const day = now.toLocaleDateString(undefined, { weekday: 'long' });

  const timeLabel =
    hour < 6 ? 'early_morning' :
    hour < 12 ? 'morning' :
    hour < 17 ? 'afternoon' :
    hour < 22 ? 'evening' : 'late_night';

  const isBusinessHours = hour >= 7 && hour <= 19;
  const isWeekend = ['Saturday', 'Sunday'].includes(day);

  // Driver-specific context for different times
  let contextHint = '';
  if (timeLabel === 'early_morning') {
    contextHint = 'Airport runs and late-night pickup zones active';
  } else if (timeLabel === 'morning' && isBusinessHours) {
    contextHint = 'Business commute hours - high demand zones';
  } else if (timeLabel === 'afternoon' && !isWeekend) {
    contextHint = 'School pickups and errands peak time';
  } else if (timeLabel === 'evening') {
    contextHint = 'Dinner and entertainment zones heating up';
  } else if (timeLabel === 'late_night') {
    contextHint = 'Bar closings and night shift workers';
  } else if (isWeekend && timeLabel === 'morning') {
    contextHint = 'Weekend brunch and shopping trips';
  } else if (isWeekend && timeLabel === 'afternoon') {
    contextHint = 'Weekend leisure and family activities';
  }

  // Convert timeLabel to readable display text
  const displayTimeLabel = timeLabel.replace('_', ' ');

  return {
    timestamp: now.toISOString(),
    hour,
    day,
    timeLabel,
    displayTimeLabel,
    isBusinessHours,
    isWeekend,
    contextHint,
    formattedTime: now.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
};