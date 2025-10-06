-- DFW region seed data

-- Melody policy (example user_id "melody")
INSERT INTO policies (user_id, region, name, rules)
VALUES ('melody','dfw','Melody DFW Policy', '{
  "boundaries": {
    "south_of_lat_exclude": 32.915,
    "polygons_exclude": [
      { "name": "Dallas Core", "points": [
        { "lat": 32.82, "lng": -96.75 },
        { "lat": 32.82, "lng": -96.82 },
        { "lat": 32.75, "lng": -96.82 },
        { "lat": 32.75, "lng": -96.75 }
      ]}
    ]
  },
  "scoring": {
    "distance": { "meters_per_point": 200, "max_bonus": 100 },
    "time_windows": [
      { "when": "night", "tags": ["airport_return","corporate"], "bonus": 12 }
    ],
    "suppressions": [
      { "tags": ["risky_profile"], "after_hour": 17, "penalty": 14 }
    ],
    "custom": [
      { "slug_matches": ["mckinney"], "penalty": 4, "note": "Prefer if return likely" }
    ]
  },
  "acceptance": { "max_pickup_eta_min": 12, "min_fare_per_mile": 1.5, "min_fare_per_hour": 28 }
}')
ON CONFLICT DO NOTHING;

-- DFW catalog of staging spots
INSERT INTO blocks_catalog (region, slug, name, address, lat, lng, meta) VALUES
('dfw','legacy-west','Legacy West Staging','5908 Headquarters Dr, Plano, TX 75024',33.07878,-96.82442,'{"tags":["corporate"]}'),
('dfw','stonebriar-north','Stonebriar Centre North Edge','2601 Preston Rd, Frisco, TX 75034',33.10428,-96.81069,'{"tags":["mall","evening"]}'),
('dfw','shops-legacy-north','The Shops at Legacy (North Edge)','5741 Legacy Dr, Plano, TX 75024',33.07547,-96.82106,'{"tags":["corporate","evening"]}'),
('dfw','dfw-north-return','DFW North Return Intercept','2600 Esters Blvd, Irving, TX 75062',32.90354,-97.00431,'{"tags":["airport_return","night"]}'),
('dfw','frisco-medcity','Medical City Frisco Perimeter','5500 Frisco Square Blvd, Frisco, TX 75034',33.15194,-96.83748,'{"tags":["hospital"]}'),
('dfw','mckinney-south','McKinney South Return Corridor','1751 N Central Expy, McKinney, TX 75070',33.2143,-96.6392,'{"tags":["outer","return_uncertain"]}')
ON CONFLICT DO NOTHING;