# Google Places API (New) - Complete Field Reference

## Official Documentation
- **Main**: https://developers.google.com/maps/documentation/places/web-service/place-details
- **Opening Hours**: https://developers.google.com/maps/documentation/places/web-service/place-data-fields#opening_hours
- **All Fields**: https://developers.google.com/maps/documentation/places/web-service/place-data-fields

---

## Current Implementation (venue-enrichment.js)

```javascript
'X-Goog-FieldMask': 'places.id,places.displayName,places.businessStatus,places.formattedAddress,places.currentOpeningHours,places.regularOpeningHours,places.utcOffsetMinutes'
```

---

## Opening Hours Fields (What We Need)

### ✅ Currently Using:
- `places.regularOpeningHours` - Standard weekly hours
- `places.currentOpeningHours` - Includes special hours (holidays, events)
- `places.utcOffsetMinutes` - UTC offset for timezone

### 🆕 **Available But NOT Using:**
- **`places.currentSecondaryOpeningHours`** - Drive-through, delivery, takeout, pickup hours
- **`places.regularSecondaryOpeningHours`** - Regular secondary service hours

---

## Secondary Opening Hours Structure

```json
{
  "secondaryHourTypes": ["DRIVE_THROUGH", "DELIVERY", "TAKEOUT"],
  "openNow": true,
  "weekdayDescriptions": [
    "Monday: Drive-through 6:00 AM – 12:00 AM",
    "Monday: Delivery 11:00 AM – 9:00 PM"
  ],
  "periods": [...]
}
```

### Service Types:
- `DRIVE_THROUGH` - Drive-through hours (McDonald's, Chick-fil-A, banks)
- `DELIVERY` - Delivery service hours
- `TAKEOUT` - Takeout/pickup hours
- `PICKUP` - Curbside pickup hours
- `KITCHEN` - Kitchen hours (restaurants)
- `BREAKFAST` - Breakfast service hours
- `LUNCH` - Lunch hours
- `DINNER` - Dinner hours
- `BRUNCH` - Brunch hours
- `HAPPY_HOUR` - Happy hour specials

---

## Other Useful Fields

### Basic Info:
- `places.id` - Place ID ✅ Using
- `places.displayName` - Venue name ✅ Using
- `places.formattedAddress` - Full address ✅ Using
- `places.businessStatus` - OPERATIONAL/CLOSED_TEMPORARILY ✅ Using

### Location:
- `places.location` - Lat/lng coordinates
- `places.viewport` - Recommended viewing area
- `places.types` - Place categories (restaurant, gas_station, etc.)

### Contact:
- `places.phoneNumber` - International format
- `places.nationalPhoneNumber` - National format
- `places.websiteUri` - Website URL

### Reviews & Ratings:
- `places.rating` - Average rating (0-5)
- `places.userRatingCount` - Number of reviews
- `places.priceLevel` - $ to $$$$

### Accessibility:
- `places.accessibilityOptions` - Wheelchair accessible, etc.
- `places.parkingOptions` - Free parking, valet, garage
- `places.paymentOptions` - Accepts credit cards, NFC, etc.

### Attributes:
- `places.goodForChildren` - Family-friendly
- `places.goodForGroups` - Group-friendly
- `places.reservable` - Accepts reservations
- `places.servesBeer` - Alcohol service
- `places.servesBreakfast` / `servesLunch` / `servesDinner`
- `places.takeout` - Takeout available
- `places.delivery` - Delivery available
- `places.dineIn` - Dine-in available
- `places.curbsidePickup` - Curbside pickup

---

## Recommended Field Mask for Rideshare App

```javascript
'X-Goog-FieldMask': [
  // Basic
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.businessStatus',
  'places.types',
  
  // Hours (Critical for isOpen calculation)
  'places.currentOpeningHours',
  'places.regularOpeningHours',
  'places.currentSecondaryOpeningHours',  // NEW: Drive-through, delivery
  'places.regularSecondaryOpeningHours',  // NEW
  'places.utcOffsetMinutes',
  
  // Useful Context
  'places.phoneNumber',
  'places.websiteUri',
  'places.parkingOptions',             // NEW: Parking info
  'places.accessibilityOptions',       // NEW: Wheelchair access
  
  // Optional
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel'
].join(',')
```

---

## Why This Matters for Rideshare Drivers

### Drive-Through Hours (Most Important):
- **Chick-fil-A**: Dining room closes at 10 PM, drive-through open until 11 PM
- **McDonald's**: Lobby closes at 11 PM, drive-through 24/7
- **Starbucks**: Inside closes at 8 PM, drive-through until 10 PM
- **Banks**: Branch closes at 5 PM, ATM drive-through 24/7

### Why It Affects Pickups:
```
Scenario: Saturday 10:30 PM at Chick-fil-A
- regularOpeningHours.openNow: FALSE (dining room closed)
- secondaryOpeningHours[DRIVE_THROUGH].openNow: TRUE (still open!)

Current Bug: Shows "Closed" ❌
With Fix: Shows "Open (Drive-through only)" ✅
```

### Impact:
- Drivers miss pickup opportunities at drive-throughs
- False "closed" venues reduce available staging options
- Earnings lost when busy drive-throughs show as unavailable

---

## Implementation Plan

1. ✅ Add `currentSecondaryOpeningHours` to field mask
2. ✅ Parse drive-through/delivery hours in `getPlaceDetails()`
3. ✅ Update `calculateIsOpen()` to check secondary hours
4. ✅ Display drive-through status in UI ("Drive-through only")
5. ✅ Add to pro-tips: "Drive-through open until 11 PM"

---

## Example Response

```json
{
  "places": [{
    "id": "ChIJ...",
    "displayName": { "text": "Chick-fil-A" },
    "businessStatus": "OPERATIONAL",
    "regularOpeningHours": {
      "openNow": false,
      "weekdayDescriptions": [
        "Monday: 6:00 AM – 10:00 PM",
        "Sunday: Closed"
      ]
    },
    "currentSecondaryOpeningHours": [{
      "secondaryHoursType": "DRIVE_THROUGH",
      "openNow": true,
      "weekdayDescriptions": [
        "Monday: 6:00 AM – 11:00 PM",
        "Sunday: Closed"
      ]
    }],
    "utcOffsetMinutes": -300
  }]
}
```
