navigator.geolocation.getCurrentPosition(
  (position) => {
    const { latitude, longitude } = position.coords;
    updateLocation({ latitude, longitude });
  },
  (error) => {
    console.error('GPS position fetch failed:', error);
    alert('Unable to retrieve location; check GPS settings.');
  },
  { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
);
navigator.geolocation.getCurrentPosition(
  (position) => {
    const { latitude, longitude } = position.coords;
    updateLocation({ latitude, longitude });
  },
  (error) => {
    console.error('GPS position fetch failed:', error);
    alert('Unable to retrieve location; check GPS settings.');
  },
  { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
);
navigator.geolocation.getCurrentPosition(
  () => console.warn('Fallback was previously used here'),
  (error) => {
    console.error('Detailed location error:', error);
    switch(error.code) {
      case error.PERMISSION_DENIED:
        alert('GPS permission was denied. Please enable it in settings.');
        break;
      case error.POSITION_UNAVAILABLE:
        alert('Location is unavailable. Ensure your device supports GPS.');
        break;
      case error.TIMEOUT:
        alert('Location request timed out. Check your signal strength.');
        break;
      default:
        alert('An unexpected error occurred while trying to fetch location.');
    }
  }
);