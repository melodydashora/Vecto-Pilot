export const buildContext = (): string => {
  const now = new Date();

  const hours = now.getHours();
  const day = now.toLocaleDateString(undefined, { weekday: 'long' });
  const timeLabel =
    hours < 6 ? 'early morning'
    : hours < 12 ? 'morning'
    : hours < 17 ? 'afternoon'
    : hours < 22 ? 'evening'
    : 'late night';

  const formattedTime = now.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Add driver-specific context based on time
  let driverContext = '';
  if (hours < 6) {
    driverContext = ' Early morning shifts often have airport runs and late-night riders.';
  } else if (hours >= 6 && hours < 9) {
    driverContext = ' Morning rush hour - commuters heading to work.';
  } else if (hours >= 9 && hours < 12) {
    driverContext = ' Mid-morning - medical appointments and errands.';
  } else if (hours >= 12 && hours < 14) {
    driverContext = ' Lunch hour - business district activity peaks.';
  } else if (hours >= 14 && hours < 17) {
    driverContext = ' Afternoon - school pickups and early commuters.';
  } else if (hours >= 17 && hours < 20) {
    driverContext = ' Evening rush - peak demand time.';
  } else if (hours >= 20 && hours < 22) {
    driverContext = ' Evening - dinner and entertainment rides.';
  } else {
    driverContext = ' Late night - bar closings and night shift workers.';
  }

  return `Today is ${day}, and it's currently ${formattedTime} (${timeLabel}).${driverContext}`;
};