// utils/getGeoPosition.ts

type GeoCoords = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

export const getGeoPosition = async (): Promise<GeoCoords | null> => {
  const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  if (!GOOGLE_API_KEY) {
    console.error("Missing Google API Key.");
    return null;
  }

  try {
    if ("geolocation" in navigator) {
      return await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            console.log("✅ Browser geolocation success:", pos.coords);
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            });
          },
          async (error) => {
            console.warn("Browser location failed, trying Google API...", error);

            try {
              const res = await fetch(
                `https://www.googleapis.com/geolocation/v1/geolocate?key=${GOOGLE_API_KEY}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({})
                }
              );

              if (!res.ok) {
                console.error("Google API error:", await res.text());
                return resolve(null);
              }

              const data = await res.json();
              console.log("✅ Google Geolocation API success:", data);
              resolve({
                latitude: data.location.lat,
                longitude: data.location.lng,
                accuracy: data.accuracy,
              });
            } catch (googleError) {
              console.error("Google Geolocation fallback failed:", googleError);
              resolve(null);
            }
          },
          {
            enableHighAccuracy: true,
            timeout: 7000,
            maximumAge: 0,
          }
        );
      });
    } else {
      console.warn("Geolocation not supported in this browser.");
      return null;
    }
  } catch (err) {
    console.error("Unexpected error getting location:", err);
    return null;
  }
};