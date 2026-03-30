/**
 * Seed Uber Airport Data into Markets Table
 *
 * This script:
 * 1. Updates existing markets with primary_airport_code and secondary_airports
 * 2. Adds new markets that exist in Uber data but not in our markets table
 * 3. Adds city_aliases for Uber market names that differ from our naming
 *
 * Data source: platform-data/uber/Airports/uber-us-airports-with-market.txt
 * 71 airports across 62 unique Uber markets
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Uber airport data from the platform-data file
// Format: [market_slug, market_name, primary_city, state, timezone, primary_airport, secondary_airports, aliases]
const uberMarketData = [
  // Multi-airport markets (need secondary_airports)
  ['chicago', 'Chicago', 'Chicago', 'IL', 'America/Chicago', 'ORD', ['MDW'], []],
  ['dallas-tx', 'Dallas', 'Dallas', 'TX', 'America/Chicago', 'DFW', ['DAL'], []],
  ['houston', 'Houston', 'Houston', 'TX', 'America/Chicago', 'IAH', ['HOU'], []],
  ['queens-ny', 'Queens', 'Queens', 'NY', 'America/New_York', 'JFK', ['LGA'], ['New York', 'NYC', 'Manhattan', 'Brooklyn', 'Bronx']],

  // California markets
  ['los-angeles', 'Los Angeles', 'Los Angeles', 'CA', 'America/Los_Angeles', 'LAX', [], ['Hollywood', 'Beverly Hills', 'Santa Monica']],
  ['san-francisco', 'San Francisco', 'San Francisco', 'CA', 'America/Los_Angeles', 'SFO', [], ['South San Francisco']],
  ['oakland-ca', 'Oakland', 'Oakland', 'CA', 'America/Los_Angeles', 'OAK', [], ['Berkeley', 'Alameda', 'Emeryville']],
  ['san-jose-ca', 'San Jose', 'San Jose', 'CA', 'America/Los_Angeles', 'SJC', [], ['Santa Clara', 'Milpitas', 'Sunnyvale', 'Cupertino']],
  ['san-diego', 'San Diego', 'San Diego', 'CA', 'America/Los_Angeles', 'SAN', [], ['La Jolla', 'Coronado', 'Chula Vista']],
  ['burbank-ca', 'Burbank', 'Burbank', 'CA', 'America/Los_Angeles', 'BUR', [], ['Glendale', 'Pasadena', 'North Hollywood']],
  ['long-beach-ca', 'Long Beach', 'Long Beach', 'CA', 'America/Los_Angeles', 'LGB', [], ['Signal Hill', 'Lakewood']],
  ['santa-ana-ca', 'Santa Ana', 'Santa Ana', 'CA', 'America/Los_Angeles', 'SNA', [], ['Orange County', 'Irvine', 'Costa Mesa', 'Newport Beach']],
  ['ontario-ca', 'Ontario', 'Ontario', 'CA', 'America/Los_Angeles', 'ONT', [], ['Rancho Cucamonga', 'Fontana', 'Inland Empire']],
  ['sacramento', 'Sacramento', 'Sacramento', 'CA', 'America/Los_Angeles', 'SMF', [], ['West Sacramento', 'Elk Grove', 'Roseville']],
  ['palm-springs-ca', 'Palm Springs', 'Palm Springs', 'CA', 'America/Los_Angeles', 'PSP', [], ['Palm Desert', 'Rancho Mirage', 'Cathedral City']],
  ['fresno-ca', 'Fresno', 'Fresno', 'CA', 'America/Los_Angeles', 'FAT', [], ['Clovis']],

  // New York / New Jersey
  ['newark-nj', 'Newark', 'Newark', 'NJ', 'America/New_York', 'EWR', [], ['Jersey City', 'Elizabeth']],
  ['buffalo-ny', 'Buffalo', 'Buffalo', 'NY', 'America/New_York', 'BUF', [], ['Niagara Falls', 'Cheektowaga']],
  ['syracuse-ny', 'Syracuse', 'Syracuse', 'NY', 'America/New_York', 'SYR', [], []],

  // Texas
  ['austin', 'Austin', 'Austin', 'TX', 'America/Chicago', 'AUS', [], ['Round Rock', 'Cedar Park', 'Georgetown']],
  ['san-antonio', 'San Antonio', 'San Antonio', 'TX', 'America/Chicago', 'SAT', [], ['New Braunfels', 'Universal City']],
  ['el-paso-tx', 'El Paso', 'El Paso', 'TX', 'America/Denver', 'ELP', [], []],

  // Florida
  ['miami', 'Miami', 'Miami', 'FL', 'America/New_York', 'MIA', [], ['Miami Beach', 'Coral Gables', 'Hialeah', 'Doral']],
  ['fort-lauderdale-fl', 'Fort Lauderdale', 'Fort Lauderdale', 'FL', 'America/New_York', 'FLL', [], ['Hollywood', 'Pompano Beach', 'Deerfield Beach']],
  ['orlando', 'Orlando', 'Orlando', 'FL', 'America/New_York', 'MCO', [], ['Kissimmee', 'Lake Buena Vista', 'Winter Park']],
  ['tampa', 'Tampa Bay', 'Tampa', 'FL', 'America/New_York', 'TPA', [], ['St. Petersburg', 'Clearwater', 'Brandon']],
  ['jacksonville-fl', 'Jacksonville', 'Jacksonville', 'FL', 'America/New_York', 'JAX', [], ['Jacksonville Beach', 'Orange Park']],
  ['fort-myers-fl', 'Fort Myers', 'Fort Myers', 'FL', 'America/New_York', 'RSW', [], ['Cape Coral', 'Naples', 'Bonita Springs']],
  ['west-palm-beach-fl', 'West Palm Beach', 'West Palm Beach', 'FL', 'America/New_York', 'PBI', [], ['Palm Beach Gardens', 'Boca Raton', 'Delray Beach']],

  // Georgia
  ['atlanta', 'Atlanta', 'Atlanta', 'GA', 'America/New_York', 'ATL', [], ['Decatur', 'Sandy Springs', 'Marietta', 'Buckhead']],

  // Massachusetts
  ['boston', 'Boston', 'Boston', 'MA', 'America/New_York', 'BOS', [], ['Cambridge', 'Somerville', 'Brookline', 'Newton']],

  // Washington
  ['seattle', 'Seattle', 'Seattle', 'WA', 'America/Los_Angeles', 'SEA', [], ['Seatac', 'SeaTac', 'Bellevue', 'Tacoma', 'Redmond']],

  // Colorado
  ['denver', 'Denver', 'Denver', 'CO', 'America/Denver', 'DEN', [], ['Aurora', 'Lakewood', 'Arvada', 'Boulder']],

  // Arizona
  ['phoenix', 'Phoenix', 'Phoenix', 'AZ', 'America/Phoenix', 'PHX', [], ['Scottsdale', 'Tempe', 'Mesa', 'Chandler', 'Gilbert']],
  ['tucson', 'Tucson', 'Tucson', 'AZ', 'America/Phoenix', 'TUS', [], ['Oro Valley', 'Marana']],

  // Nevada
  ['las-vegas', 'Las Vegas', 'Las Vegas', 'NV', 'America/Los_Angeles', 'LAS', [], ['Henderson', 'North Las Vegas', 'Paradise', 'The Strip']],
  ['reno-nv', 'Reno', 'Reno', 'NV', 'America/Los_Angeles', 'RNO', [], ['Sparks', 'Lake Tahoe']],

  // Minnesota
  ['minneapolis', 'Minneapolis-St. Paul', 'Minneapolis', 'MN', 'America/Chicago', 'MSP', [], ['Saint Paul', 'St. Paul', 'Bloomington', 'Edina']],

  // Michigan
  ['detroit', 'Detroit', 'Detroit', 'MI', 'America/Detroit', 'DTW', [], ['Dearborn', 'Warren', 'Ann Arbor', 'Romulus']],

  // Pennsylvania
  ['philadelphia', 'Philadelphia', 'Philadelphia', 'PA', 'America/New_York', 'PHL', [], ['Camden', 'Cherry Hill', 'Wilmington']],
  ['pittsburgh-pa', 'Pittsburgh', 'Pittsburgh', 'PA', 'America/New_York', 'PIT', [], []],

  // DC / Virginia / Maryland
  ['arlington-va', 'Arlington', 'Arlington', 'VA', 'America/New_York', 'DCA', [], ['Alexandria', 'Rosslyn', 'Crystal City']],
  ['washington-dc', 'Washington', 'Washington', 'DC', 'America/New_York', 'IAD', [], ['Dulles', 'Reston', 'Tysons']],
  ['baltimore-md', 'Baltimore', 'Baltimore', 'MD', 'America/New_York', 'BWI', [], ['Annapolis', 'Towson', 'Columbia']],

  // North Carolina
  ['charlotte', 'Charlotte', 'Charlotte', 'NC', 'America/New_York', 'CLT', [], ['Concord', 'Gastonia', 'Matthews']],
  ['raleigh', 'Raleigh-Durham', 'Raleigh', 'NC', 'America/New_York', 'RDU', [], ['Morrisville', 'Durham', 'Cary', 'Chapel Hill']],

  // Oregon
  ['portland', 'Portland', 'Portland', 'OR', 'America/Los_Angeles', 'PDX', [], ['Beaverton', 'Hillsboro', 'Gresham']],

  // Utah
  ['salt-lake-city-ut', 'Salt Lake City', 'Salt Lake City', 'UT', 'America/Denver', 'SLC', [], ['West Valley City', 'Provo', 'Sandy']],

  // Missouri
  ['st-louis', 'St. Louis', 'St. Louis', 'MO', 'America/Chicago', 'STL', [], ['Saint Louis', 'Clayton', 'Chesterfield']],
  ['kansas-city', 'Kansas City', 'Kansas City', 'MO', 'America/Chicago', 'MCI', [], ['Overland Park', 'Olathe', 'Independence']],

  // Indiana
  ['indianapolis', 'Indianapolis', 'Indianapolis', 'IN', 'America/Indiana/Indianapolis', 'IND', [], ['Carmel', 'Fishers', 'Noblesville']],

  // Kentucky
  ['hebron-ky', 'Hebron', 'Hebron', 'KY', 'America/New_York', 'CVG', [], ['Cincinnati', 'Covington', 'Florence', 'Northern Kentucky']],
  ['louisville-ky', 'Louisville', 'Louisville', 'KY', 'America/Kentucky/Louisville', 'SDF', [], ['Jeffersontown', 'St. Matthews']],

  // Ohio
  ['cleveland-oh', 'Cleveland', 'Cleveland', 'OH', 'America/New_York', 'CLE', [], ['Lakewood', 'Parma', 'Akron']],
  ['columbus', 'Columbus', 'Columbus', 'OH', 'America/New_York', 'CMH', [], ['Dublin', 'Westerville', 'Grove City']],

  // Tennessee
  ['nashville', 'Nashville', 'Nashville', 'TN', 'America/Chicago', 'BNA', [], ['Franklin', 'Murfreesboro', 'Brentwood']],
  ['memphis-tn', 'Memphis', 'Memphis', 'TN', 'America/Chicago', 'MEM', [], ['Germantown', 'Southaven', 'Bartlett']],

  // Louisiana
  ['kenner-la', 'Kenner', 'Kenner', 'LA', 'America/Chicago', 'MSY', [], ['New Orleans', 'Metairie', 'French Quarter', 'NOLA']],

  // Nebraska
  ['omaha-ne', 'Omaha', 'Omaha', 'NE', 'America/Chicago', 'OMA', [], ['Council Bluffs', 'Bellevue', 'La Vista']],

  // New Mexico
  ['albuquerque-nm', 'Albuquerque', 'Albuquerque', 'NM', 'America/Denver', 'ABQ', [], ['Rio Rancho', 'Santa Fe']],

  // Hawaii
  ['honolulu-hi', 'Honolulu', 'Honolulu', 'HI', 'Pacific/Honolulu', 'HNL', [], ['Waikiki', 'Pearl City', 'Ewa Beach']],
  ['kahului-hi', 'Kahului', 'Kahului', 'HI', 'Pacific/Honolulu', 'OGG', [], ['Maui', 'Lahaina', 'Kihei', 'Wailea']],
  ['kailua-kona-hi', 'Kailua Kona', 'Kailua Kona', 'HI', 'Pacific/Honolulu', 'KOA', [], ['Big Island', 'Kona', 'Hilo']],

  // Alaska
  ['anchorage-ak', 'Anchorage', 'Anchorage', 'AK', 'America/Anchorage', 'ANC', [], ['Eagle River', 'Wasilla']],

  // Wisconsin
  ['milwaukee-wi', 'Milwaukee', 'Milwaukee', 'WI', 'America/Chicago', 'MKE', [], ['Wauwatosa', 'Brookfield', 'West Allis']],

  // South Carolina
  ['greer-sc', 'Greer', 'Greer', 'SC', 'America/New_York', 'GSP', [], ['Greenville', 'Spartanburg', 'Simpsonville']],
  ['north-charleston-sc', 'North Charleston', 'North Charleston', 'SC', 'America/New_York', 'CHS', [], ['Charleston', 'Mount Pleasant', 'Summerville']],
];

async function seedUberAirports() {
  const client = await pool.connect();
  console.log('🛫 Syncing Uber airport data with markets table...\n');

  try {
    let inserted = 0;
    let updated = 0;

    for (const [market_slug, market_name, primary_city, state, timezone, primary_airport, secondary_airports, aliases] of uberMarketData) {
      // Check if market exists
      const existing = await client.query(
        'SELECT market_slug, city_aliases FROM markets WHERE market_slug = $1',
        [market_slug]
      );

      if (existing.rows.length > 0) {
        // Update existing market with airport data and merge aliases
        const existingAliases = existing.rows[0].city_aliases || [];
        const mergedAliases = [...new Set([...existingAliases, ...aliases])];

        await client.query(`
          UPDATE markets SET
            primary_airport_code = $1,
            secondary_airports = $2,
            city_aliases = $3,
            updated_at = NOW()
          WHERE market_slug = $4
        `, [
          primary_airport,
          secondary_airports.length > 0 ? JSON.stringify(secondary_airports) : null,
          JSON.stringify(mergedAliases),
          market_slug
        ]);
        updated++;
        console.log(`  🔄 Updated: ${market_name} (${primary_airport}${secondary_airports.length > 0 ? '+' + secondary_airports.join(',') : ''})`);
      } else {
        // Insert new market
        await client.query(`
          INSERT INTO markets (
            market_slug, market_name, primary_city, state, country_code,
            timezone, primary_airport_code, secondary_airports, city_aliases,
            has_uber, has_lyft, is_active
          )
          VALUES ($1, $2, $3, $4, 'US', $5, $6, $7, $8, true, true, true)
        `, [
          market_slug,
          market_name,
          primary_city,
          state,
          timezone,
          primary_airport,
          secondary_airports.length > 0 ? JSON.stringify(secondary_airports) : null,
          JSON.stringify(aliases)
        ]);
        inserted++;
        console.log(`  ✅ Added: ${market_name}, ${state} (${primary_airport})`);
      }
    }

    console.log(`\n✅ Uber airports synced: ${inserted} new markets, ${updated} updated`);

    // Show summary
    const summary = await client.query(`
      SELECT
        COUNT(*) as total_markets,
        COUNT(primary_airport_code) as markets_with_airports,
        COUNT(secondary_airports) as markets_with_secondaries
      FROM markets
      WHERE country_code = 'US'
    `);

    console.log('\n📊 US Market Summary:');
    console.log(`   Total US markets: ${summary.rows[0].total_markets}`);
    console.log(`   Markets with airports: ${summary.rows[0].markets_with_airports}`);
    console.log(`   Markets with secondary airports: ${summary.rows[0].markets_with_secondaries}`);

    // Show multi-airport markets
    const multiAirport = await client.query(`
      SELECT market_name, primary_airport_code, secondary_airports
      FROM markets
      WHERE secondary_airports IS NOT NULL AND country_code = 'US'
      ORDER BY market_name
    `);

    if (multiAirport.rows.length > 0) {
      console.log('\n✈️ Multi-Airport Markets:');
      for (const row of multiAirport.rows) {
        const secondaries = row.secondary_airports || [];
        console.log(`   ${row.market_name}: ${row.primary_airport_code} + ${secondaries.join(', ')}`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedUberAirports()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed:', error);
    process.exit(1);
  });
