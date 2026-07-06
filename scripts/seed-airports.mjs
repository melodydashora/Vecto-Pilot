// scripts/seed-airports.mjs
// Seed the airports table (todo #22) — the deterministic identity layer for
// airport selection at AIRPORT_RADIUS_MILES (50).
//
// PROVENANCE RULES (app_rules: no-hardcoded-location + determinism):
//   - The curated list below is IDENTITY ONLY (IATA code + search name).
//   - Every coordinate comes from Google Places Text Search at seed time —
//     never typed by hand, never model-generated. A lookup that fails is
//     SKIPPED LOUDLY (listed in the summary), not guessed.
//   - Terminal inventory is seeded only where provenance is known
//     (DFW/DAL: Melody-stated facts, marked as such).
//
// Usage: node scripts/seed-airports.mjs           (requires GOOGLE_MAPS_API_KEY + DATABASE_URL)
// Idempotent: upserts by IATA; re-running refreshes coords from Google.

import { db } from '../server/db/drizzle.js';
import { sql } from 'drizzle-orm';

const KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!KEY) {
  console.error('GOOGLE_MAPS_API_KEY required — coords must come from Google, no other source.');
  process.exit(1);
}

// Identity list: [iata, search name, city, ISO country]
const AIRPORTS = [
  // ── US majors ──────────────────────────────────────────────────────────
  ['ATL', 'Hartsfield-Jackson Atlanta International Airport', 'Atlanta', 'US'],
  ['AUS', 'Austin-Bergstrom International Airport', 'Austin', 'US'],
  ['BNA', 'Nashville International Airport', 'Nashville', 'US'],
  ['BOS', 'Boston Logan International Airport', 'Boston', 'US'],
  ['BWI', 'Baltimore/Washington International Thurgood Marshall Airport', 'Baltimore', 'US'],
  ['CLT', 'Charlotte Douglas International Airport', 'Charlotte', 'US'],
  ['CLE', 'Cleveland Hopkins International Airport', 'Cleveland', 'US'],
  ['CMH', 'John Glenn Columbus International Airport', 'Columbus', 'US'],
  ['CVG', 'Cincinnati/Northern Kentucky International Airport', 'Cincinnati', 'US'],
  ['DAL', 'Dallas Love Field Airport', 'Dallas', 'US'],
  ['DCA', 'Ronald Reagan Washington National Airport', 'Washington', 'US'],
  ['DEN', 'Denver International Airport', 'Denver', 'US'],
  ['DFW', 'Dallas/Fort Worth International Airport', 'Dallas', 'US'],
  ['DTW', 'Detroit Metropolitan Wayne County Airport', 'Detroit', 'US'],
  ['EWR', 'Newark Liberty International Airport', 'Newark', 'US'],
  ['FLL', 'Fort Lauderdale-Hollywood International Airport', 'Fort Lauderdale', 'US'],
  ['HNL', 'Daniel K. Inouye International Airport Honolulu', 'Honolulu', 'US'],
  ['HOU', 'William P. Hobby Airport Houston', 'Houston', 'US'],
  ['IAD', 'Washington Dulles International Airport', 'Washington', 'US'],
  ['IAH', 'George Bush Intercontinental Airport Houston', 'Houston', 'US'],
  ['IND', 'Indianapolis International Airport', 'Indianapolis', 'US'],
  ['JAX', 'Jacksonville International Airport', 'Jacksonville', 'US'],
  ['JFK', 'John F. Kennedy International Airport New York', 'New York', 'US'],
  ['LAS', 'Harry Reid International Airport Las Vegas', 'Las Vegas', 'US'],
  ['LAX', 'Los Angeles International Airport', 'Los Angeles', 'US'],
  ['LGA', 'LaGuardia Airport New York', 'New York', 'US'],
  ['MCI', 'Kansas City International Airport', 'Kansas City', 'US'],
  ['MCO', 'Orlando International Airport', 'Orlando', 'US'],
  ['MDW', 'Chicago Midway International Airport', 'Chicago', 'US'],
  ['MEM', 'Memphis International Airport', 'Memphis', 'US'],
  ['MIA', 'Miami International Airport', 'Miami', 'US'],
  ['MKE', 'Milwaukee Mitchell International Airport', 'Milwaukee', 'US'],
  ['MSP', 'Minneapolis-Saint Paul International Airport', 'Minneapolis', 'US'],
  ['MSY', 'Louis Armstrong New Orleans International Airport', 'New Orleans', 'US'],
  ['OAK', 'Oakland International Airport', 'Oakland', 'US'],
  ['OKC', 'Will Rogers World Airport Oklahoma City', 'Oklahoma City', 'US'],
  ['OMA', 'Eppley Airfield Omaha', 'Omaha', 'US'],
  ['ONT', 'Ontario International Airport California', 'Ontario', 'US'],
  ['ORD', "Chicago O'Hare International Airport", 'Chicago', 'US'],
  ['PDX', 'Portland International Airport Oregon', 'Portland', 'US'],
  ['PHL', 'Philadelphia International Airport', 'Philadelphia', 'US'],
  ['PHX', 'Phoenix Sky Harbor International Airport', 'Phoenix', 'US'],
  ['PIT', 'Pittsburgh International Airport', 'Pittsburgh', 'US'],
  ['RDU', 'Raleigh-Durham International Airport', 'Raleigh', 'US'],
  ['RIC', 'Richmond International Airport', 'Richmond', 'US'],
  ['RSW', 'Southwest Florida International Airport Fort Myers', 'Fort Myers', 'US'],
  ['SAN', 'San Diego International Airport', 'San Diego', 'US'],
  ['SAT', 'San Antonio International Airport', 'San Antonio', 'US'],
  ['SDF', 'Louisville Muhammad Ali International Airport', 'Louisville', 'US'],
  ['SEA', 'Seattle-Tacoma International Airport', 'Seattle', 'US'],
  ['SFO', 'San Francisco International Airport', 'San Francisco', 'US'],
  ['SJC', 'San Jose Mineta International Airport', 'San Jose', 'US'],
  ['SLC', 'Salt Lake City International Airport', 'Salt Lake City', 'US'],
  ['SMF', 'Sacramento International Airport', 'Sacramento', 'US'],
  ['SNA', 'John Wayne Airport Orange County', 'Santa Ana', 'US'],
  ['STL', 'St. Louis Lambert International Airport', 'St. Louis', 'US'],
  ['TPA', 'Tampa International Airport', 'Tampa', 'US'],
  ['TUL', 'Tulsa International Airport', 'Tulsa', 'US'],
  ['TUS', 'Tucson International Airport', 'Tucson', 'US'],
  ['ABQ', 'Albuquerque International Sunport', 'Albuquerque', 'US'],
  ['ANC', 'Ted Stevens Anchorage International Airport', 'Anchorage', 'US'],
  ['BDL', 'Bradley International Airport Hartford', 'Hartford', 'US'],
  ['BHM', 'Birmingham-Shuttlesworth International Airport', 'Birmingham', 'US'],
  ['BOI', 'Boise Airport', 'Boise', 'US'],
  ['BUF', 'Buffalo Niagara International Airport', 'Buffalo', 'US'],
  ['BUR', 'Hollywood Burbank Airport', 'Burbank', 'US'],
  ['CHS', 'Charleston International Airport South Carolina', 'Charleston', 'US'],
  ['ELP', 'El Paso International Airport', 'El Paso', 'US'],
  ['GEG', 'Spokane International Airport', 'Spokane', 'US'],
  ['GRR', 'Gerald R. Ford International Airport Grand Rapids', 'Grand Rapids', 'US'],
  ['GSP', 'Greenville-Spartanburg International Airport', 'Greenville', 'US'],
  ['HSV', 'Huntsville International Airport', 'Huntsville', 'US'],
  ['LGB', 'Long Beach Airport', 'Long Beach', 'US'],
  ['LIT', 'Bill and Hillary Clinton National Airport Little Rock', 'Little Rock', 'US'],
  ['ORF', 'Norfolk International Airport', 'Norfolk', 'US'],
  ['PBI', 'Palm Beach International Airport', 'West Palm Beach', 'US'],
  ['PSP', 'Palm Springs International Airport', 'Palm Springs', 'US'],
  ['PVD', 'Rhode Island T. F. Green International Airport', 'Providence', 'US'],
  ['SAV', 'Savannah/Hilton Head International Airport', 'Savannah', 'US'],
  ['SJU', 'Luis Muñoz Marín International Airport San Juan', 'San Juan', 'US'],
  ['SRQ', 'Sarasota-Bradenton International Airport', 'Sarasota', 'US'],
  ['XNA', 'Northwest Arkansas National Airport', 'Bentonville', 'US'],
  // ── Canada / Mexico ────────────────────────────────────────────────────
  ['YYZ', 'Toronto Pearson International Airport', 'Toronto', 'CA'],
  ['YVR', 'Vancouver International Airport', 'Vancouver', 'CA'],
  ['YUL', 'Montréal-Trudeau International Airport', 'Montreal', 'CA'],
  ['YYC', 'Calgary International Airport', 'Calgary', 'CA'],
  ['MEX', 'Mexico City International Airport Benito Juárez', 'Mexico City', 'MX'],
  ['CUN', 'Cancún International Airport', 'Cancún', 'MX'],
  ['GDL', 'Guadalajara International Airport', 'Guadalajara', 'MX'],
  ['MTY', 'Monterrey International Airport', 'Monterrey', 'MX'],
  // ── Europe ─────────────────────────────────────────────────────────────
  ['LHR', 'London Heathrow Airport', 'London', 'GB'],
  ['LGW', 'London Gatwick Airport', 'London', 'GB'],
  ['CDG', 'Paris Charles de Gaulle Airport', 'Paris', 'FR'],
  ['ORY', 'Paris Orly Airport', 'Paris', 'FR'],
  ['AMS', 'Amsterdam Airport Schiphol', 'Amsterdam', 'NL'],
  ['FRA', 'Frankfurt Airport', 'Frankfurt', 'DE'],
  ['MUC', 'Munich Airport', 'Munich', 'DE'],
  ['MAD', 'Adolfo Suárez Madrid-Barajas Airport', 'Madrid', 'ES'],
  ['BCN', 'Barcelona-El Prat Airport', 'Barcelona', 'ES'],
  ['FCO', 'Rome Fiumicino Airport Leonardo da Vinci', 'Rome', 'IT'],
  ['MXP', 'Milan Malpensa Airport', 'Milan', 'IT'],
  ['ZRH', 'Zurich Airport', 'Zurich', 'CH'],
  ['VIE', 'Vienna International Airport', 'Vienna', 'AT'],
  ['BRU', 'Brussels Airport', 'Brussels', 'BE'],
  ['CPH', 'Copenhagen Airport', 'Copenhagen', 'DK'],
  ['ARN', 'Stockholm Arlanda Airport', 'Stockholm', 'SE'],
  ['OSL', 'Oslo Airport Gardermoen', 'Oslo', 'NO'],
  ['HEL', 'Helsinki Airport', 'Helsinki', 'FI'],
  ['DUB', 'Dublin Airport', 'Dublin', 'IE'],
  ['LIS', 'Lisbon Humberto Delgado Airport', 'Lisbon', 'PT'],
  ['IST', 'Istanbul Airport', 'Istanbul', 'TR'],
  // ── Middle East / Asia / Oceania ───────────────────────────────────────
  ['DXB', 'Dubai International Airport', 'Dubai', 'AE'],
  ['AUH', 'Zayed International Airport Abu Dhabi', 'Abu Dhabi', 'AE'],
  ['DOH', 'Hamad International Airport Doha', 'Doha', 'QA'],
  ['TLV', 'Ben Gurion Airport Tel Aviv', 'Tel Aviv', 'IL'],
  ['HND', 'Tokyo Haneda Airport', 'Tokyo', 'JP'],
  ['NRT', 'Narita International Airport', 'Tokyo', 'JP'],
  ['KIX', 'Kansai International Airport Osaka', 'Osaka', 'JP'],
  ['ICN', 'Incheon International Airport Seoul', 'Seoul', 'KR'],
  ['PEK', 'Beijing Capital International Airport', 'Beijing', 'CN'],
  ['PVG', 'Shanghai Pudong International Airport', 'Shanghai', 'CN'],
  ['CAN', 'Guangzhou Baiyun International Airport', 'Guangzhou', 'CN'],
  ['HKG', 'Hong Kong International Airport', 'Hong Kong', 'HK'],
  ['TPE', 'Taiwan Taoyuan International Airport', 'Taipei', 'TW'],
  ['SIN', 'Singapore Changi Airport', 'Singapore', 'SG'],
  ['BKK', 'Suvarnabhumi Airport Bangkok', 'Bangkok', 'TH'],
  ['KUL', 'Kuala Lumpur International Airport', 'Kuala Lumpur', 'MY'],
  ['CGK', 'Soekarno-Hatta International Airport Jakarta', 'Jakarta', 'ID'],
  ['DEL', 'Indira Gandhi International Airport Delhi', 'Delhi', 'IN'],
  ['BOM', 'Chhatrapati Shivaji Maharaj International Airport Mumbai', 'Mumbai', 'IN'],
  ['SYD', 'Sydney Kingsford Smith Airport', 'Sydney', 'AU'],
  ['MEL', 'Melbourne Airport Tullamarine', 'Melbourne', 'AU'],
  ['BNE', 'Brisbane Airport', 'Brisbane', 'AU'],
  ['AKL', 'Auckland Airport', 'Auckland', 'NZ'],
  // ── South America / Africa ─────────────────────────────────────────────
  ['GRU', 'São Paulo/Guarulhos International Airport', 'São Paulo', 'BR'],
  ['GIG', 'Rio de Janeiro/Galeão International Airport', 'Rio de Janeiro', 'BR'],
  ['EZE', 'Ministro Pistarini International Airport Ezeiza Buenos Aires', 'Buenos Aires', 'AR'],
  ['SCL', 'Santiago Arturo Merino Benítez International Airport', 'Santiago', 'CL'],
  ['BOG', 'El Dorado International Airport Bogotá', 'Bogotá', 'CO'],
  ['LIM', 'Jorge Chávez International Airport Lima', 'Lima', 'PE'],
  ['PTY', 'Tocumen International Airport Panama City', 'Panama City', 'PA'],
  ['JNB', 'O.R. Tambo International Airport Johannesburg', 'Johannesburg', 'ZA'],
  ['CPT', 'Cape Town International Airport', 'Cape Town', 'ZA'],
  ['CAI', 'Cairo International Airport', 'Cairo', 'EG'],
];

// Static terminal inventory — seeded ONLY where provenance is known.
// DFW/DAL facts are Melody-stated (2026-07-06): ~2 checkpoints per terminal,
// Clear at DFW Terminal E. Checkpoint NAMES and live waits are researched by
// the BRIEFING_AIRPORT role at briefing time — never seeded from guesses.
const TERMINAL_INVENTORY = {
  DFW: {
    provenance: 'melody-2026-07-06',
    terminals: [
      { terminal: 'A', clear_available: false, checkpoints_estimate: 2 },
      { terminal: 'B', clear_available: false, checkpoints_estimate: 2 },
      { terminal: 'C', clear_available: false, checkpoints_estimate: 2 },
      { terminal: 'D', clear_available: false, checkpoints_estimate: 2 },
      { terminal: 'E', clear_available: true, checkpoints_estimate: 2 },
    ],
  },
  DAL: {
    provenance: 'melody-2026-07-06',
    terminals: [
      { terminal: 'Main Terminal', clear_available: false, checkpoints_estimate: 2 },
    ],
  },
};

async function lookupCoords(iata, name) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'places.displayName,places.location,places.types',
    },
    body: JSON.stringify({ textQuery: `${name} ${iata}`, maxResultCount: 1 }),
  });
  if (!res.ok) throw new Error(`Places ${res.status}`);
  const data = await res.json();
  const p = data.places?.[0];
  if (!p?.location) throw new Error('no result');
  if (!p.types?.some((t) => t.includes('airport'))) throw new Error(`not an airport type: ${p.types?.join(',')}`);
  return {
    lat: Number(p.location.latitude.toFixed(6)),
    lng: Number(p.location.longitude.toFixed(6)),
    resolvedName: p.displayName?.text,
  };
}

const failed = [];
let seeded = 0;

for (const [iata, name, city, country] of AIRPORTS) {
  try {
    const { lat, lng } = await lookupCoords(iata, name);
    const inv = TERMINAL_INVENTORY[iata];
    await db.execute(sql`
      INSERT INTO airports (iata, name, city, country, lat, lng, coord_source, terminals, terminals_provenance, updated_at)
      VALUES (${iata}, ${name}, ${city}, ${country}, ${lat}, ${lng}, 'google_places',
              ${inv ? JSON.stringify(inv.terminals) : null}::jsonb, ${inv ? inv.provenance : null}, now())
      ON CONFLICT (iata) DO UPDATE SET
        name = EXCLUDED.name, city = EXCLUDED.city, country = EXCLUDED.country,
        lat = EXCLUDED.lat, lng = EXCLUDED.lng, coord_source = 'google_places',
        terminals = COALESCE(EXCLUDED.terminals, airports.terminals),
        terminals_provenance = COALESCE(EXCLUDED.terminals_provenance, airports.terminals_provenance),
        updated_at = now()
    `);
    seeded++;
  } catch (err) {
    failed.push(`${iata}: ${err.message}`);
  }
}

console.log(`Seeded ${seeded}/${AIRPORTS.length} airports (coords: Google Places).`);
if (failed.length) {
  console.error(`FAILED (skipped loudly, NOT guessed):\n  ${failed.join('\n  ')}`);
  process.exit(2);
}
process.exit(0);
