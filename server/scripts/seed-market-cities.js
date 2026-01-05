/**
 * Seed US Market Cities Data
 *
 * Populates the us_market_cities table with city → market mappings
 * Source: Official Uber market listings + GPT analysis (Jan 2026)
 *
 * Usage: node server/scripts/seed-market-cities.js
 *
 * 2026-01-05: Initial creation
 */

import { db } from '../db/drizzle.js';
import { us_market_cities } from '../../shared/schema.js';
import { sql } from 'drizzle-orm';

// State abbreviation mapping
const STATE_ABBR = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Puerto Rico': 'PR', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX',
  'Utah': 'UT', 'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA',
  'Washington, D.C.': 'DC', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY'
};

// Market city data from GPT research findings
// Format: [state, market_name, city, region_type, source_ref]
// Region types: 'Core' = anchor city, 'Satellite' = suburb/nearby city
const MARKET_CITIES = [
  // Alabama
  ['Alabama', 'Auburn', 'Auburn', 'Core', 'uber.com'],
  ['Alabama', 'Auburn', 'Opelika', 'Satellite', 'uber.com'],
  ['Alabama', 'Birmingham', 'Birmingham', 'Core', 'uber.com'],
  ['Alabama', 'Birmingham', 'Hoover', 'Satellite', 'uber.com'],
  ['Alabama', 'Birmingham', 'Mountain Brook', 'Satellite', 'uber.com'],
  ['Alabama', 'Birmingham', 'Vestavia Hills', 'Satellite', 'uber.com'],
  ['Alabama', 'Birmingham', 'Bessemer', 'Satellite', 'uber.com'],
  ['Alabama', 'Birmingham', 'Alabaster', 'Satellite', 'uber.com'],
  ['Alabama', 'Birmingham', 'Homewood', 'Satellite', 'uber.com'],
  ['Alabama', 'Birmingham', 'Center Point', 'Satellite', 'uber.com'],
  ['Alabama', 'Huntsville', 'Huntsville', 'Core', 'uber.com'],
  ['Alabama', 'Huntsville', 'Decatur', 'Satellite', 'uber.com'],
  ['Alabama', 'Huntsville', 'Madison', 'Satellite', 'uber.com'],
  ['Alabama', 'Huntsville', 'Athens', 'Satellite', 'uber.com'],
  ['Alabama', 'Huntsville', 'Hartselle', 'Satellite', 'uber.com'],
  ['Alabama', 'Mobile', 'Mobile', 'Core', 'uber.com'],
  ['Alabama', 'Mobile', 'Prichard', 'Satellite', 'uber.com'],
  ['Alabama', 'Mobile', 'Daphne', 'Satellite', 'uber.com'],
  ['Alabama', 'Mobile', 'Fairhope', 'Satellite', 'uber.com'],
  ['Alabama', 'Mobile', 'Gulf Shores', 'Satellite', 'uber.com'],
  ['Alabama', 'Montgomery', 'Montgomery', 'Core', 'uber.com'],
  ['Alabama', 'Montgomery', 'Prattville', 'Satellite', 'uber.com'],
  ['Alabama', 'Montgomery', 'Millbrook', 'Satellite', 'uber.com'],
  ['Alabama', 'Montgomery', 'Wetumpka', 'Satellite', 'uber.com'],
  ['Alabama', 'Dothan', 'Dothan', 'Core', 'uber.com'],
  ['Alabama', 'Dothan', 'Enterprise', 'Satellite', 'uber.com'],
  ['Alabama', 'Dothan', 'Ozark', 'Satellite', 'uber.com'],
  ['Alabama', 'East Alabama', 'Anniston', 'Satellite', 'uber.com'],
  ['Alabama', 'East Alabama', 'Gadsden', 'Satellite', 'uber.com'],
  ['Alabama', 'East Alabama', 'Oxford', 'Satellite', 'uber.com'],
  ['Alabama', 'East Alabama', 'Jacksonville', 'Satellite', 'uber.com'],
  ['Alabama', 'East Alabama', 'Glencoe', 'Satellite', 'uber.com'],
  ['Alabama', 'East Alabama', 'Southside', 'Satellite', 'uber.com'],
  ['Alabama', 'East Alabama', 'Rainbow City', 'Satellite', 'uber.com'],
  ['Alabama', 'East Alabama', 'Attalla', 'Satellite', 'uber.com'],
  ['Alabama', 'East Alabama', 'Heflin', 'Satellite', 'uber.com'],
  ['Alabama', 'South Alabama', 'Brewton', 'Satellite', 'uber.com'],
  ['Alabama', 'South Alabama', 'Evergreen', 'Satellite', 'uber.com'],
  ['Alabama', 'South Alabama', 'Andalusia', 'Satellite', 'uber.com'],
  ['Alabama', 'South Alabama', 'Greenville', 'Satellite', 'uber.com'],
  ['Alabama', 'South Alabama', 'Monroeville', 'Satellite', 'uber.com'],
  ['Alabama', 'South Alabama', 'Selma', 'Satellite', 'uber.com'],
  ['Alabama', 'The Shoals', 'Florence', 'Core', 'uber.com'],
  ['Alabama', 'The Shoals', 'Muscle Shoals', 'Satellite', 'uber.com'],
  ['Alabama', 'The Shoals', 'Sheffield', 'Satellite', 'uber.com'],
  ['Alabama', 'The Shoals', 'Tuscumbia', 'Satellite', 'uber.com'],
  ['Alabama', 'The Shoals', 'Russellville', 'Satellite', 'uber.com'],
  ['Alabama', 'The Shoals', 'Killen', 'Satellite', 'uber.com'],
  ['Alabama', 'The Shoals', 'Rogersville', 'Satellite', 'uber.com'],
  ['Alabama', 'Tuscaloosa', 'Tuscaloosa', 'Core', 'uber.com'],
  ['Alabama', 'Tuscaloosa', 'Northport', 'Satellite', 'uber.com'],
  ['Alabama', 'Tuscaloosa', 'Aliceville', 'Satellite', 'uber.com'],
  ['Alabama', 'Tuscaloosa', 'Fayette', 'Satellite', 'uber.com'],

  // Alaska
  ['Alaska', 'Anchorage', 'Anchorage', 'Core', 'uber.com'],
  ['Alaska', 'Fairbanks', 'Fairbanks', 'Core', 'uber.com'],
  ['Alaska', 'Juneau', 'Juneau', 'Core', 'uber.com'],

  // Arizona
  ['Arizona', 'Flagstaff', 'Flagstaff', 'Core', 'uber.com'],
  ['Arizona', 'Phoenix', 'Phoenix', 'Core', 'uber.com'],
  ['Arizona', 'Phoenix', 'Mesa', 'Satellite', 'uber.com'],
  ['Arizona', 'Phoenix', 'Chandler', 'Satellite', 'uber.com'],
  ['Arizona', 'Phoenix', 'Gilbert', 'Satellite', 'uber.com'],
  ['Arizona', 'Phoenix', 'Glendale', 'Satellite', 'uber.com'],
  ['Arizona', 'Phoenix', 'Scottsdale', 'Satellite', 'uber.com'],
  ['Arizona', 'Phoenix', 'Tempe', 'Satellite', 'uber.com'],
  ['Arizona', 'Phoenix', 'Peoria', 'Satellite', 'uber.com'],
  ['Arizona', 'Phoenix', 'Surprise', 'Satellite', 'uber.com'],
  ['Arizona', 'Phoenix', 'Avondale', 'Satellite', 'uber.com'],
  ['Arizona', 'Phoenix', 'Goodyear', 'Satellite', 'uber.com'],
  ['Arizona', 'Phoenix', 'Buckeye', 'Satellite', 'uber.com'],
  ['Arizona', 'Phoenix', 'Apache Junction', 'Satellite', 'uber.com'],
  ['Arizona', 'Tucson', 'Tucson', 'Core', 'uber.com'],
  ['Arizona', 'Tucson', 'Oro Valley', 'Satellite', 'uber.com'],
  ['Arizona', 'Tucson', 'Marana', 'Satellite', 'uber.com'],
  ['Arizona', 'Tucson', 'Sahuarita', 'Satellite', 'uber.com'],
  ['Arizona', 'Western Arizona', 'Kingman', 'Satellite', 'ridester.com'],
  ['Arizona', 'Western Arizona', 'Lake Havasu City', 'Core', 'ridester.com'],
  ['Arizona', 'Western Arizona', 'Bullhead City', 'Satellite', 'ridester.com'],
  ['Arizona', 'Yuma', 'Yuma', 'Core', 'uber.com'],
  ['Arizona', 'Yuma', 'Somerton', 'Satellite', 'uber.com'],
  ['Arizona', 'Yuma', 'San Luis', 'Satellite', 'uber.com'],

  // Arkansas
  ['Arkansas', 'Fayetteville', 'Fayetteville', 'Core', 'uber.com'],
  ['Arkansas', 'Fayetteville', 'Springdale', 'Satellite', 'uber.com'],
  ['Arkansas', 'Fayetteville', 'Bentonville', 'Satellite', 'uber.com'],
  ['Arkansas', 'Fayetteville', 'Rogers', 'Satellite', 'uber.com'],
  ['Arkansas', 'Fayetteville', 'Bella Vista', 'Satellite', 'uber.com'],
  ['Arkansas', 'Jonesboro', 'Jonesboro', 'Core', 'uber.com'],
  ['Arkansas', 'Little Rock', 'Little Rock', 'Core', 'uber.com'],
  ['Arkansas', 'Little Rock', 'North Little Rock', 'Satellite', 'uber.com'],
  ['Arkansas', 'Little Rock', 'Conway', 'Satellite', 'uber.com'],
  ['Arkansas', 'Little Rock', 'Benton', 'Satellite', 'uber.com'],
  ['Arkansas', 'Little Rock', 'Sherwood', 'Satellite', 'uber.com'],
  ['Arkansas', 'Little Rock', 'Jacksonville', 'Satellite', 'uber.com'],
  ['Arkansas', 'Southern Arkansas', 'Fort Smith', 'Satellite', 'ridester.com'],
  ['Arkansas', 'Southern Arkansas', 'Hot Springs', 'Satellite', 'ridester.com'],
  ['Arkansas', 'Southern Arkansas', 'El Dorado', 'Satellite', 'ridester.com'],
  ['Arkansas', 'Southern Arkansas', 'Texarkana', 'Satellite', 'ridester.com'],

  // California
  ['California', 'Bakersfield', 'Bakersfield', 'Core', 'uber.com'],
  ['California', 'Bakersfield', 'Delano', 'Satellite', 'uber.com'],
  ['California', 'Bakersfield', 'Wasco', 'Satellite', 'uber.com'],
  ['California', 'Fresno', 'Fresno', 'Core', 'uber.com'],
  ['California', 'Fresno', 'Clovis', 'Satellite', 'uber.com'],
  ['California', 'Fresno', 'Madera', 'Satellite', 'uber.com'],
  ['California', 'Inland Empire', 'Riverside', 'Core', 'ridester.com'],
  ['California', 'Inland Empire', 'San Bernardino', 'Core', 'ridester.com'],
  ['California', 'Inland Empire', 'Ontario', 'Satellite', 'ridester.com'],
  ['California', 'Inland Empire', 'Fontana', 'Satellite', 'ridester.com'],
  ['California', 'Inland Empire', 'Victorville', 'Satellite', 'ridester.com'],
  ['California', 'Inland Empire', 'Temecula', 'Satellite', 'ridester.com'],
  ['California', 'Los Angeles', 'Los Angeles', 'Core', 'uber.com'],
  ['California', 'Los Angeles', 'Anaheim', 'Satellite', 'ridester.com'],
  ['California', 'Los Angeles', 'Long Beach', 'Satellite', 'ridester.com'],
  ['California', 'Los Angeles', 'Santa Monica', 'Satellite', 'uber.com'],
  ['California', 'Los Angeles', 'Irvine', 'Satellite', 'ridester.com'],
  ['California', 'Los Angeles', 'Burbank', 'Satellite', 'uber.com'],
  ['California', 'Los Angeles', 'Pasadena', 'Satellite', 'uber.com'],
  ['California', 'Los Angeles', 'Glendale', 'Satellite', 'uber.com'],
  ['California', 'Los Angeles', 'Inglewood', 'Satellite', 'uber.com'],
  ['California', 'Los Angeles', 'Pomona', 'Satellite', 'uber.com'],
  ['California', 'Los Angeles', 'Torrance', 'Satellite', 'uber.com'],
  ['California', 'Modesto', 'Modesto', 'Core', 'uber.com'],
  ['California', 'Modesto', 'Stockton', 'Satellite', 'uber.com'],
  ['California', 'Modesto', 'Tracy', 'Satellite', 'uber.com'],
  ['California', 'Palm Springs', 'Palm Springs', 'Core', 'uber.com'],
  ['California', 'Palm Springs', 'Palm Desert', 'Satellite', 'uber.com'],
  ['California', 'Palm Springs', 'Indio', 'Satellite', 'uber.com'],
  ['California', 'Sacramento', 'Sacramento', 'Core', 'uber.com'],
  ['California', 'Sacramento', 'Roseville', 'Satellite', 'uber.com'],
  ['California', 'Sacramento', 'Elk Grove', 'Satellite', 'uber.com'],
  ['California', 'Sacramento', 'Folsom', 'Satellite', 'uber.com'],
  ['California', 'Sacramento', 'Davis', 'Satellite', 'uber.com'],
  ['California', 'San Diego', 'San Diego', 'Core', 'uber.com'],
  ['California', 'San Diego', 'Chula Vista', 'Satellite', 'uber.com'],
  ['California', 'San Diego', 'Carlsbad', 'Satellite', 'uber.com'],
  ['California', 'San Diego', 'Escondido', 'Satellite', 'uber.com'],
  ['California', 'San Francisco Bay Area', 'San Francisco', 'Core', 'uber.com'],
  ['California', 'San Francisco Bay Area', 'Oakland', 'Core', 'uber.com'],
  ['California', 'San Francisco Bay Area', 'San Jose', 'Core', 'uber.com'],
  ['California', 'San Francisco Bay Area', 'Berkeley', 'Satellite', 'ridester.com'],
  ['California', 'San Francisco Bay Area', 'Fremont', 'Satellite', 'ridester.com'],
  ['California', 'San Francisco Bay Area', 'Sunnyvale', 'Satellite', 'ridester.com'],
  ['California', 'San Francisco Bay Area', 'Palo Alto', 'Satellite', 'ridester.com'],
  ['California', 'San Francisco Bay Area', 'Redwood City', 'Satellite', 'ridester.com'],
  ['California', 'San Luis Obispo', 'San Luis Obispo', 'Core', 'uber.com'],
  ['California', 'San Luis Obispo', 'Paso Robles', 'Satellite', 'uber.com'],
  ['California', 'Santa Barbara', 'Santa Barbara', 'Core', 'uber.com'],
  ['California', 'Santa Barbara', 'Santa Maria', 'Satellite', 'uber.com'],
  ['California', 'Santa Barbara', 'Lompoc', 'Satellite', 'uber.com'],
  ['California', 'Ventura', 'Ventura', 'Core', 'uber.com'],
  ['California', 'Ventura', 'Oxnard', 'Satellite', 'uber.com'],
  ['California', 'Ventura', 'Thousand Oaks', 'Satellite', 'uber.com'],

  // Colorado
  ['Colorado', 'Colorado Springs', 'Colorado Springs', 'Core', 'uber.com'],
  ['Colorado', 'Colorado Springs', 'Pueblo', 'Satellite', 'uber.com'],
  ['Colorado', 'Colorado Springs', 'Fountain', 'Satellite', 'uber.com'],
  ['Colorado', 'Denver', 'Denver', 'Core', 'uber.com'],
  ['Colorado', 'Denver', 'Aurora', 'Satellite', 'uber.com'],
  ['Colorado', 'Denver', 'Lakewood', 'Satellite', 'uber.com'],
  ['Colorado', 'Denver', 'Boulder', 'Satellite', 'uber.com'],
  ['Colorado', 'Denver', 'Arvada', 'Satellite', 'uber.com'],
  ['Colorado', 'Denver', 'Thornton', 'Satellite', 'uber.com'],
  ['Colorado', 'Fort Collins', 'Fort Collins', 'Core', 'uber.com'],
  ['Colorado', 'Fort Collins', 'Greeley', 'Satellite', 'uber.com'],
  ['Colorado', 'Fort Collins', 'Loveland', 'Satellite', 'uber.com'],
  ['Colorado', 'Rockies', 'Aspen', 'Satellite', 'ridester.com'],
  ['Colorado', 'Rockies', 'Vail', 'Core', 'ridester.com'],
  ['Colorado', 'Rockies', 'Breckenridge', 'Satellite', 'ridester.com'],
  ['Colorado', 'Rockies', 'Telluride', 'Satellite', 'ridester.com'],

  // Connecticut (statewide)
  ['Connecticut', 'Connecticut', 'Bridgeport', 'Core', 'ridester.com'],
  ['Connecticut', 'Connecticut', 'New Haven', 'Core', 'ridester.com'],
  ['Connecticut', 'Connecticut', 'Hartford', 'Core', 'ridester.com'],
  ['Connecticut', 'Connecticut', 'Stamford', 'Core', 'ridester.com'],
  ['Connecticut', 'Connecticut', 'Waterbury', 'Satellite', 'ridester.com'],
  ['Connecticut', 'Connecticut', 'Norwalk', 'Satellite', 'ridester.com'],

  // Delaware (statewide)
  ['Delaware', 'Delaware', 'Wilmington', 'Core', 'ridester.com'],
  ['Delaware', 'Delaware', 'Dover', 'Core', 'ridester.com'],
  ['Delaware', 'Delaware', 'Newark', 'Satellite', 'ridester.com'],
  ['Delaware', 'Delaware', 'Rehoboth Beach', 'Satellite', 'ridester.com'],

  // Florida
  ['Florida', 'Central Atlantic Coast', 'Daytona Beach', 'Core', 'ridester.com'],
  ['Florida', 'Central Atlantic Coast', 'Palm Coast', 'Satellite', 'ridester.com'],
  ['Florida', 'Central Atlantic Coast', 'Titusville', 'Satellite', 'ridester.com'],
  ['Florida', 'Florida Keys', 'Key West', 'Core', 'ridester.com'],
  ['Florida', 'Florida Keys', 'Marathon', 'Satellite', 'ridester.com'],
  ['Florida', 'Florida Keys', 'Key Largo', 'Satellite', 'ridester.com'],
  ['Florida', 'Fort Myers-Naples', 'Fort Myers', 'Core', 'uber.com'],
  ['Florida', 'Fort Myers-Naples', 'Naples', 'Core', 'uber.com'],
  ['Florida', 'Fort Myers-Naples', 'Cape Coral', 'Satellite', 'uber.com'],
  ['Florida', 'Fort Myers-Naples', 'Bonita Springs', 'Satellite', 'uber.com'],
  ['Florida', 'Gainesville', 'Gainesville', 'Core', 'uber.com'],
  ['Florida', 'Jacksonville', 'Jacksonville', 'Core', 'uber.com'],
  ['Florida', 'Jacksonville', 'St. Augustine', 'Satellite', 'uber.com'],
  ['Florida', 'Jacksonville', 'Orange Park', 'Satellite', 'uber.com'],
  ['Florida', 'Jacksonville', 'Fernandina Beach', 'Satellite', 'uber.com'],
  ['Florida', 'Miami', 'Miami', 'Core', 'uber.com'],
  ['Florida', 'Miami', 'Fort Lauderdale', 'Core', 'uber.com'],
  ['Florida', 'Miami', 'West Palm Beach', 'Core', 'uber.com'],
  ['Florida', 'Miami', 'Boca Raton', 'Satellite', 'uber.com'],
  ['Florida', 'Ocala', 'Ocala', 'Core', 'uber.com'],
  ['Florida', 'Orlando', 'Orlando', 'Core', 'uber.com'],
  ['Florida', 'Orlando', 'Kissimmee', 'Satellite', 'uber.com'],
  ['Florida', 'Orlando', 'Sanford', 'Satellite', 'uber.com'],
  ['Florida', 'Orlando', 'Winter Park', 'Satellite', 'uber.com'],
  ['Florida', 'Pensacola', 'Pensacola', 'Core', 'uber.com'],
  ['Florida', 'Pensacola', 'Destin', 'Satellite', 'uber.com'],
  ['Florida', 'Pensacola', 'Fort Walton Beach', 'Satellite', 'uber.com'],
  ['Florida', 'Sarasota', 'Sarasota', 'Core', 'uber.com'],
  ['Florida', 'Sarasota', 'Bradenton', 'Satellite', 'uber.com'],
  ['Florida', 'Sarasota', 'Venice', 'Satellite', 'uber.com'],
  ['Florida', 'Sarasota', 'North Port', 'Satellite', 'uber.com'],
  ['Florida', 'Tallahassee', 'Tallahassee', 'Core', 'uber.com'],
  ['Florida', 'Tampa Bay', 'Tampa', 'Core', 'uber.com'],
  ['Florida', 'Tampa Bay', 'St. Petersburg', 'Core', 'uber.com'],
  ['Florida', 'Tampa Bay', 'Clearwater', 'Satellite', 'ridester.com'],
  ['Florida', 'Tampa Bay', 'Lakeland', 'Satellite', 'ridester.com'],
  ['Florida', 'Tampa Bay', 'Brandon', 'Satellite', 'ridester.com'],

  // Georgia
  ['Georgia', 'Athens', 'Athens', 'Core', 'uber.com'],
  ['Georgia', 'Atlanta', 'Atlanta', 'Core', 'uber.com'],
  ['Georgia', 'Atlanta', 'Marietta', 'Satellite', 'uber.com'],
  ['Georgia', 'Atlanta', 'Decatur', 'Satellite', 'uber.com'],
  ['Georgia', 'Atlanta', 'Sandy Springs', 'Satellite', 'uber.com'],
  ['Georgia', 'Atlanta', 'Roswell', 'Satellite', 'uber.com'],
  ['Georgia', 'Atlanta', 'Alpharetta', 'Satellite', 'uber.com'],
  ['Georgia', 'Augusta', 'Augusta', 'Core', 'uber.com'],
  ['Georgia', 'Coastal Georgia', 'Savannah', 'Core', 'ridester.com'],
  ['Georgia', 'Coastal Georgia', 'Brunswick', 'Satellite', 'ridester.com'],
  ['Georgia', 'Coastal Georgia', 'Hinesville', 'Satellite', 'ridester.com'],
  ['Georgia', 'Coastal Georgia', 'Waycross', 'Satellite', 'ridester.com'],
  ['Georgia', 'Columbus', 'Columbus', 'Core', 'uber.com'],
  ['Georgia', 'Columbus', 'Phenix City', 'Satellite', 'uber.com'],
  ['Georgia', 'Macon', 'Macon', 'Core', 'uber.com'],
  ['Georgia', 'Macon', 'Warner Robins', 'Satellite', 'uber.com'],
  ['Georgia', 'North Georgia', 'Dalton', 'Satellite', 'ridester.com'],
  ['Georgia', 'North Georgia', 'Gainesville', 'Core', 'ridester.com'],
  ['Georgia', 'North Georgia', 'Helen', 'Satellite', 'ridester.com'],
  ['Georgia', 'North Georgia', 'Rome', 'Satellite', 'ridester.com'],
  ['Georgia', 'Savannah-Hilton Head', 'Savannah', 'Core', 'ridester.com'],
  ['Georgia', 'Savannah-Hilton Head', 'Hilton Head Island', 'Satellite', 'ridester.com'],
  ['Georgia', 'South Georgia', 'Albany', 'Core', 'ridester.com'],
  ['Georgia', 'South Georgia', 'Valdosta', 'Satellite', 'ridester.com'],
  ['Georgia', 'South Georgia', 'Tifton', 'Satellite', 'ridester.com'],
  ['Georgia', 'South Georgia', 'Thomasville', 'Satellite', 'ridester.com'],

  // Hawaii
  ['Hawaii', 'Big Island', 'Hilo', 'Core', 'uber.com'],
  ['Hawaii', 'Big Island', 'Kailua-Kona', 'Core', 'uber.com'],
  ['Hawaii', 'Honolulu', 'Honolulu', 'Core', 'uber.com'],
  ['Hawaii', 'Honolulu', 'Pearl City', 'Satellite', 'uber.com'],
  ['Hawaii', 'Kauai', 'Lihue', 'Core', 'uber.com'],
  ['Hawaii', 'Maui', 'Kahului', 'Core', 'uber.com'],
  ['Hawaii', 'Maui', 'Lahaina', 'Satellite', 'uber.com'],

  // Idaho
  ['Idaho', 'Boise', 'Boise', 'Core', 'uber.com'],
  ['Idaho', 'Boise', 'Nampa', 'Satellite', 'uber.com'],
  ['Idaho', 'Boise', 'Meridian', 'Satellite', 'uber.com'],
  ['Idaho', 'Boise', 'Caldwell', 'Satellite', 'uber.com'],
  ['Idaho', 'Coeur D\'Alene', 'Coeur d\'Alene', 'Core', 'uber.com'],
  ['Idaho', 'Coeur D\'Alene', 'Post Falls', 'Satellite', 'uber.com'],
  ['Idaho', 'Eastern Idaho', 'Idaho Falls', 'Core', 'ridester.com'],
  ['Idaho', 'Eastern Idaho', 'Pocatello', 'Satellite', 'ridester.com'],
  ['Idaho', 'Eastern Idaho', 'Rexburg', 'Satellite', 'ridester.com'],

  // Illinois
  ['Illinois', 'Carbondale', 'Carbondale', 'Core', 'uber.com'],
  ['Illinois', 'Champaign', 'Champaign', 'Core', 'uber.com'],
  ['Illinois', 'Champaign', 'Urbana', 'Satellite', 'uber.com'],
  ['Illinois', 'Chicago', 'Chicago', 'Core', 'uber.com'],
  ['Illinois', 'Chicago', 'Aurora', 'Satellite', 'uber.com'],
  ['Illinois', 'Chicago', 'Naperville', 'Satellite', 'uber.com'],
  ['Illinois', 'Chicago', 'Joliet', 'Satellite', 'uber.com'],
  ['Illinois', 'Chicago', 'Elgin', 'Satellite', 'uber.com'],
  ['Illinois', 'Chicago', 'Waukegan', 'Satellite', 'uber.com'],
  ['Illinois', 'Peoria', 'Peoria', 'Core', 'uber.com'],
  ['Illinois', 'Peoria', 'Bloomington', 'Satellite', 'uber.com'],
  ['Illinois', 'Peoria', 'Normal', 'Satellite', 'uber.com'],
  ['Illinois', 'Quad Cities', 'Moline', 'Core', 'ridester.com'],
  ['Illinois', 'Quad Cities', 'Rock Island', 'Core', 'ridester.com'],
  ['Illinois', 'Rockford', 'Rockford', 'Core', 'uber.com'],
  ['Illinois', 'Springfield', 'Springfield', 'Core', 'uber.com'],
  ['Illinois', 'Springfield', 'Decatur', 'Satellite', 'uber.com'],

  // Indiana
  ['Indiana', 'Bloomington', 'Bloomington', 'Core', 'uber.com'],
  ['Indiana', 'Evansville', 'Evansville', 'Core', 'uber.com'],
  ['Indiana', 'Fort Wayne', 'Fort Wayne', 'Core', 'uber.com'],
  ['Indiana', 'Indianapolis', 'Indianapolis', 'Core', 'uber.com'],
  ['Indiana', 'Indianapolis', 'Carmel', 'Satellite', 'uber.com'],
  ['Indiana', 'Indianapolis', 'Fishers', 'Satellite', 'uber.com'],
  ['Indiana', 'Indianapolis', 'Greenwood', 'Satellite', 'uber.com'],
  ['Indiana', 'NW Indiana', 'Gary', 'Core', 'ridester.com'],
  ['Indiana', 'NW Indiana', 'Hammond', 'Satellite', 'ridester.com'],
  ['Indiana', 'NW Indiana', 'Valparaiso', 'Satellite', 'ridester.com'],
  ['Indiana', 'South Bend', 'South Bend', 'Core', 'uber.com'],
  ['Indiana', 'South Bend', 'Mishawaka', 'Satellite', 'uber.com'],
  ['Indiana', 'South Bend', 'Elkhart', 'Satellite', 'uber.com'],
  ['Indiana', 'Terre Haute', 'Terre Haute', 'Core', 'uber.com'],
  ['Indiana', 'West Lafayette', 'Lafayette', 'Core', 'uber.com'],
  ['Indiana', 'West Lafayette', 'West Lafayette', 'Core', 'uber.com'],

  // Iowa
  ['Iowa', 'Ames', 'Ames', 'Core', 'uber.com'],
  ['Iowa', 'Cedar Rapids', 'Cedar Rapids', 'Core', 'uber.com'],
  ['Iowa', 'Cedar Rapids', 'Marion', 'Satellite', 'uber.com'],
  ['Iowa', 'Cedar Rapids', 'Hiawatha', 'Satellite', 'uber.com'],
  ['Iowa', 'Des Moines', 'Des Moines', 'Core', 'uber.com'],
  ['Iowa', 'Des Moines', 'West Des Moines', 'Satellite', 'uber.com'],
  ['Iowa', 'Des Moines', 'Ankeny', 'Satellite', 'uber.com'],
  ['Iowa', 'Des Moines', 'Urbandale', 'Satellite', 'uber.com'],
  ['Iowa', 'Dubuque', 'Dubuque', 'Core', 'uber.com'],
  ['Iowa', 'Iowa City', 'Iowa City', 'Core', 'uber.com'],
  ['Iowa', 'Iowa City', 'Coralville', 'Satellite', 'uber.com'],
  ['Iowa', 'Quad Cities', 'Davenport', 'Core', 'ridester.com'],
  ['Iowa', 'Quad Cities', 'Bettendorf', 'Satellite', 'ridester.com'],
  ['Iowa', 'Sioux City', 'Sioux City', 'Core', 'uber.com'],
  ['Iowa', 'Waterloo-Cedar Falls', 'Waterloo', 'Core', 'uber.com'],
  ['Iowa', 'Waterloo-Cedar Falls', 'Cedar Falls', 'Satellite', 'uber.com'],

  // Kansas
  ['Kansas', 'Kansas City', 'Overland Park', 'Satellite', 'uber.com'],
  ['Kansas', 'Kansas City', 'Olathe', 'Satellite', 'uber.com'],
  ['Kansas', 'Kansas City', 'Lenexa', 'Satellite', 'uber.com'],
  ['Kansas', 'Kansas City', 'Kansas City', 'Core', 'uber.com'],
  ['Kansas', 'Lawrence', 'Lawrence', 'Core', 'uber.com'],
  ['Kansas', 'Manhattan', 'Manhattan', 'Core', 'uber.com'],
  ['Kansas', 'Topeka', 'Topeka', 'Core', 'uber.com'],
  ['Kansas', 'Wichita', 'Wichita', 'Core', 'uber.com'],
  ['Kansas', 'Wichita', 'Hutchinson', 'Satellite', 'uber.com'],
  ['Kansas', 'Wichita', 'Derby', 'Satellite', 'uber.com'],

  // Kentucky
  ['Kentucky', 'Bowling Green', 'Bowling Green', 'Core', 'uber.com'],
  ['Kentucky', 'Lexington', 'Lexington', 'Core', 'uber.com'],
  ['Kentucky', 'Louisville', 'Louisville', 'Core', 'uber.com'],
  ['Kentucky', 'Louisville', 'Jeffersonville', 'Satellite', 'ridester.com'],
  ['Kentucky', 'Louisville', 'New Albany', 'Satellite', 'ridester.com'],

  // Louisiana
  ['Louisiana', 'Baton Rouge', 'Baton Rouge', 'Core', 'uber.com'],
  ['Louisiana', 'Baton Rouge', 'Denham Springs', 'Satellite', 'uber.com'],
  ['Louisiana', 'Lafayette-Lake Charles', 'Lafayette', 'Core', 'ridester.com'],
  ['Louisiana', 'Lafayette-Lake Charles', 'Lake Charles', 'Core', 'ridester.com'],
  ['Louisiana', 'Lafayette-Lake Charles', 'Opelousas', 'Satellite', 'ridester.com'],
  ['Louisiana', 'Lafayette-Lake Charles', 'New Iberia', 'Satellite', 'ridester.com'],
  ['Louisiana', 'Monroe', 'Monroe', 'Core', 'uber.com'],
  ['Louisiana', 'Monroe', 'Ruston', 'Satellite', 'uber.com'],
  ['Louisiana', 'New Orleans', 'New Orleans', 'Core', 'uber.com'],
  ['Louisiana', 'New Orleans', 'Metairie', 'Satellite', 'uber.com'],
  ['Louisiana', 'New Orleans', 'Kenner', 'Satellite', 'uber.com'],
  ['Louisiana', 'New Orleans', 'Slidell', 'Satellite', 'uber.com'],
  ['Louisiana', 'Shreveport-Alexandria', 'Shreveport', 'Core', 'ridester.com'],
  ['Louisiana', 'Shreveport-Alexandria', 'Bossier City', 'Satellite', 'ridester.com'],
  ['Louisiana', 'Shreveport-Alexandria', 'Alexandria', 'Satellite', 'ridester.com'],
  ['Louisiana', 'Shreveport-Alexandria', 'Natchitoches', 'Satellite', 'ridester.com'],

  // Maine
  ['Maine', 'Greater Maine', 'Augusta', 'Core', 'ridester.com'],
  ['Maine', 'Greater Maine', 'Bangor', 'Core', 'ridester.com'],
  ['Maine', 'Greater Maine', 'Lewiston', 'Satellite', 'ridester.com'],
  ['Maine', 'Portland', 'Portland', 'Core', 'uber.com'],
  ['Maine', 'Portland', 'South Portland', 'Satellite', 'uber.com'],
  ['Maine', 'Portland', 'Brunswick', 'Satellite', 'uber.com'],

  // Maryland
  ['Maryland', 'Baltimore', 'Baltimore', 'Core', 'uber.com'],
  ['Maryland', 'Baltimore', 'Columbia', 'Satellite', 'uber.com'],
  ['Maryland', 'Baltimore', 'Towson', 'Satellite', 'uber.com'],
  ['Maryland', 'Baltimore', 'Glen Burnie', 'Satellite', 'uber.com'],
  ['Maryland', 'Eastern Shore', 'Salisbury', 'Core', 'ridester.com'],
  ['Maryland', 'Eastern Shore', 'Ocean City', 'Satellite', 'ridester.com'],
  ['Maryland', 'Eastern Shore', 'Easton', 'Satellite', 'ridester.com'],
  ['Maryland', 'Eastern Shore', 'Kent Island', 'Satellite', 'ridester.com'],

  // Massachusetts
  ['Massachusetts', 'Boston', 'Boston', 'Core', 'uber.com'],
  ['Massachusetts', 'Boston', 'Cambridge', 'Satellite', 'uber.com'],
  ['Massachusetts', 'Boston', 'Worcester', 'Satellite', 'uber.com'],
  ['Massachusetts', 'Boston', 'Springfield', 'Satellite', 'uber.com'],
  ['Massachusetts', 'Western Massachusetts', 'Springfield', 'Core', 'ridester.com'],
  ['Massachusetts', 'Western Massachusetts', 'Pittsfield', 'Satellite', 'ridester.com'],
  ['Massachusetts', 'Western Massachusetts', 'Amherst', 'Satellite', 'ridester.com'],
  ['Massachusetts', 'Worcester', 'Worcester', 'Core', 'uber.com'],

  // Michigan
  ['Michigan', 'Ann Arbor', 'Ann Arbor', 'Core', 'uber.com'],
  ['Michigan', 'Ann Arbor', 'Ypsilanti', 'Satellite', 'uber.com'],
  ['Michigan', 'Detroit', 'Detroit', 'Core', 'uber.com'],
  ['Michigan', 'Detroit', 'Warren', 'Satellite', 'uber.com'],
  ['Michigan', 'Detroit', 'Dearborn', 'Satellite', 'uber.com'],
  ['Michigan', 'Detroit', 'Southfield', 'Satellite', 'uber.com'],
  ['Michigan', 'Flint', 'Flint', 'Core', 'uber.com'],
  ['Michigan', 'Grand Rapids', 'Grand Rapids', 'Core', 'uber.com'],
  ['Michigan', 'Grand Rapids', 'Holland', 'Satellite', 'uber.com'],
  ['Michigan', 'Grand Rapids', 'Muskegon', 'Satellite', 'uber.com'],
  ['Michigan', 'Kalamazoo', 'Kalamazoo', 'Core', 'uber.com'],
  ['Michigan', 'Kalamazoo', 'Battle Creek', 'Satellite', 'uber.com'],
  ['Michigan', 'Lansing', 'Lansing', 'Core', 'uber.com'],
  ['Michigan', 'Lansing', 'East Lansing', 'Satellite', 'uber.com'],
  ['Michigan', 'Traverse City', 'Traverse City', 'Core', 'uber.com'],
  ['Michigan', 'Tri-Cities', 'Saginaw', 'Core', 'ridester.com'],
  ['Michigan', 'Tri-Cities', 'Bay City', 'Core', 'ridester.com'],
  ['Michigan', 'Tri-Cities', 'Midland', 'Satellite', 'ridester.com'],

  // Minnesota
  ['Minnesota', 'Duluth', 'Duluth', 'Core', 'uber.com'],
  ['Minnesota', 'Duluth', 'Superior', 'Satellite', 'uber.com'],
  ['Minnesota', 'Mankato', 'Mankato', 'Core', 'uber.com'],
  ['Minnesota', 'Minneapolis-St. Paul', 'Minneapolis', 'Core', 'uber.com'],
  ['Minnesota', 'Minneapolis-St. Paul', 'Saint Paul', 'Core', 'uber.com'],
  ['Minnesota', 'Minneapolis-St. Paul', 'Bloomington', 'Satellite', 'uber.com'],
  ['Minnesota', 'Minneapolis-St. Paul', 'Brooklyn Park', 'Satellite', 'uber.com'],
  ['Minnesota', 'Rochester', 'Rochester', 'Core', 'uber.com'],
  ['Minnesota', 'St. Cloud', 'St. Cloud', 'Core', 'uber.com'],

  // Mississippi
  ['Mississippi', 'Golden Triangle', 'Columbus', 'Core', 'ridester.com'],
  ['Mississippi', 'Golden Triangle', 'Starkville', 'Satellite', 'ridester.com'],
  ['Mississippi', 'Golden Triangle', 'West Point', 'Satellite', 'ridester.com'],
  ['Mississippi', 'Gulfport-Biloxi', 'Gulfport', 'Core', 'uber.com'],
  ['Mississippi', 'Gulfport-Biloxi', 'Biloxi', 'Core', 'uber.com'],
  ['Mississippi', 'Gulfport-Biloxi', 'Pascagoula', 'Satellite', 'uber.com'],
  ['Mississippi', 'Hattiesburg', 'Hattiesburg', 'Core', 'uber.com'],
  ['Mississippi', 'Jackson', 'Jackson', 'Core', 'uber.com'],
  ['Mississippi', 'Jackson', 'Pearl', 'Satellite', 'uber.com'],
  ['Mississippi', 'Jackson', 'Madison', 'Satellite', 'uber.com'],
  ['Mississippi', 'Jackson', 'Ridgeland', 'Satellite', 'uber.com'],
  ['Mississippi', 'Meridian', 'Meridian', 'Core', 'uber.com'],
  ['Mississippi', 'Mississippi Delta', 'Greenville', 'Core', 'uber.com'],
  ['Mississippi', 'Mississippi Delta', 'Greenwood', 'Satellite', 'uber.com'],
  ['Mississippi', 'Mississippi Delta', 'Cleveland', 'Satellite', 'uber.com'],
  ['Mississippi', 'Oxford', 'Oxford', 'Core', 'uber.com'],

  // Missouri
  ['Missouri', 'Columbia', 'Columbia', 'Core', 'uber.com'],
  ['Missouri', 'Kansas City', 'Kansas City', 'Core', 'uber.com'],
  ['Missouri', 'Kansas City', 'Independence', 'Satellite', 'uber.com'],
  ['Missouri', 'Kansas City', 'Lee\'s Summit', 'Satellite', 'uber.com'],
  ['Missouri', 'Kansas City', 'Blue Springs', 'Satellite', 'uber.com'],
  ['Missouri', 'Northern Missouri', 'St. Joseph', 'Core', 'ridester.com'],
  ['Missouri', 'Northern Missouri', 'Moberly', 'Satellite', 'ridester.com'],
  ['Missouri', 'Northern Missouri', 'Kirksville', 'Satellite', 'ridester.com'],
  ['Missouri', 'Springfield', 'Springfield', 'Core', 'uber.com'],
  ['Missouri', 'Springfield', 'Joplin', 'Satellite', 'uber.com'],
  ['Missouri', 'St. Louis', 'St. Louis', 'Core', 'uber.com'],
  ['Missouri', 'St. Louis', 'St. Charles', 'Satellite', 'uber.com'],
  ['Missouri', 'St. Louis', 'Chesterfield', 'Satellite', 'uber.com'],
  ['Missouri', 'St. Louis', 'Belleville', 'Satellite', 'uber.com'],

  // Montana
  ['Montana', 'Billings', 'Billings', 'Core', 'uber.com'],
  ['Montana', 'Bozeman', 'Bozeman', 'Core', 'uber.com'],
  ['Montana', 'Missoula', 'Missoula', 'Core', 'uber.com'],

  // Nebraska
  ['Nebraska', 'Lincoln', 'Lincoln', 'Core', 'uber.com'],
  ['Nebraska', 'Omaha', 'Omaha', 'Core', 'uber.com'],
  ['Nebraska', 'Omaha', 'Bellevue', 'Satellite', 'uber.com'],
  ['Nebraska', 'Omaha', 'Papillion', 'Satellite', 'uber.com'],

  // Nevada
  ['Nevada', 'Las Vegas', 'Las Vegas', 'Core', 'uber.com'],
  ['Nevada', 'Las Vegas', 'Henderson', 'Satellite', 'uber.com'],
  ['Nevada', 'Las Vegas', 'North Las Vegas', 'Satellite', 'uber.com'],
  ['Nevada', 'Reno', 'Reno', 'Core', 'uber.com'],
  ['Nevada', 'Reno', 'Sparks', 'Satellite', 'uber.com'],
  ['Nevada', 'Reno', 'Carson City', 'Satellite', 'uber.com'],

  // New Hampshire (statewide)
  ['New Hampshire', 'New Hampshire', 'Manchester', 'Core', 'ridester.com'],
  ['New Hampshire', 'New Hampshire', 'Nashua', 'Satellite', 'ridester.com'],
  ['New Hampshire', 'New Hampshire', 'Concord', 'Core', 'ridester.com'],
  ['New Hampshire', 'New Hampshire', 'Portsmouth', 'Satellite', 'ridester.com'],

  // New Jersey
  ['New Jersey', 'New Jersey', 'Newark', 'Core', 'ridester.com'],
  ['New Jersey', 'New Jersey', 'Jersey City', 'Core', 'ridester.com'],
  ['New Jersey', 'New Jersey', 'Trenton', 'Core', 'ridester.com'],
  ['New Jersey', 'New Jersey', 'Morristown', 'Satellite', 'ridester.com'],
  ['New Jersey', 'New Jersey Shore', 'Atlantic City', 'Core', 'ridester.com'],
  ['New Jersey', 'New Jersey Shore', 'Cape May', 'Satellite', 'ridester.com'],
  ['New Jersey', 'New Jersey Shore', 'Toms River', 'Satellite', 'ridester.com'],

  // New Mexico
  ['New Mexico', 'Albuquerque', 'Albuquerque', 'Core', 'uber.com'],
  ['New Mexico', 'Albuquerque', 'Rio Rancho', 'Satellite', 'uber.com'],
  ['New Mexico', 'Gallup', 'Gallup', 'Core', 'uber.com'],
  ['New Mexico', 'Las Cruces', 'Las Cruces', 'Core', 'uber.com'],
  ['New Mexico', 'Santa Fe', 'Santa Fe', 'Core', 'uber.com'],
  ['New Mexico', 'Santa Fe', 'Los Alamos', 'Satellite', 'uber.com'],
  ['New Mexico', 'Taos', 'Taos', 'Core', 'ridester.com'],

  // New York
  ['New York', 'The Hamptons', 'Southampton', 'Core', 'uber.com'],
  ['New York', 'The Hamptons', 'East Hampton', 'Satellite', 'uber.com'],
  ['New York', 'New York City', 'New York', 'Core', 'uber.com'],
  ['New York', 'New York City', 'Brooklyn', 'Core', 'ridester.com'],
  ['New York', 'New York City', 'Queens', 'Satellite', 'ridester.com'],
  ['New York', 'New York City', 'Bronx', 'Satellite', 'ridester.com'],
  ['New York', 'New York City', 'Staten Island', 'Satellite', 'ridester.com'],
  ['New York', 'NYC Suburbs', 'Long Island', 'Core', 'ridester.com'],
  ['New York', 'NYC Suburbs', 'Hempstead', 'Satellite', 'ridester.com'],
  ['New York', 'NYC Suburbs', 'Poughkeepsie', 'Satellite', 'ridester.com'],
  ['New York', 'Upstate NY', 'Albany', 'Core', 'ridester.com'],
  ['New York', 'Upstate NY', 'Rochester', 'Core', 'ridester.com'],
  ['New York', 'Upstate NY', 'Syracuse', 'Core', 'ridester.com'],
  ['New York', 'Upstate NY', 'Buffalo', 'Core', 'ridester.com'],
  ['New York', 'Upstate NY', 'Ithaca', 'Satellite', 'ridester.com'],

  // North Carolina
  ['North Carolina', 'Asheville', 'Asheville', 'Core', 'uber.com'],
  ['North Carolina', 'Boone', 'Boone', 'Core', 'uber.com'],
  ['North Carolina', 'Charlotte', 'Charlotte', 'Core', 'uber.com'],
  ['North Carolina', 'Charlotte', 'Concord', 'Satellite', 'uber.com'],
  ['North Carolina', 'Charlotte', 'Gastonia', 'Satellite', 'uber.com'],
  ['North Carolina', 'Charlotte', 'Rock Hill', 'Satellite', 'uber.com'],
  ['North Carolina', 'Eastern North Carolina', 'Greenville', 'Core', 'ridester.com'],
  ['North Carolina', 'Eastern North Carolina', 'Jacksonville', 'Satellite', 'ridester.com'],
  ['North Carolina', 'Eastern North Carolina', 'New Bern', 'Satellite', 'ridester.com'],
  ['North Carolina', 'Eastern North Carolina', 'Kinston', 'Satellite', 'ridester.com'],
  ['North Carolina', 'Fayetteville', 'Fayetteville', 'Core', 'uber.com'],
  ['North Carolina', 'Fayetteville', 'Fort Bragg', 'Satellite', 'uber.com'],
  ['North Carolina', 'Outer Banks', 'Nags Head', 'Core', 'uber.com'],
  ['North Carolina', 'Outer Banks', 'Kitty Hawk', 'Satellite', 'uber.com'],
  ['North Carolina', 'Piedmont Triad', 'Greensboro', 'Core', 'ridester.com'],
  ['North Carolina', 'Piedmont Triad', 'Winston-Salem', 'Core', 'ridester.com'],
  ['North Carolina', 'Piedmont Triad', 'High Point', 'Satellite', 'ridester.com'],
  ['North Carolina', 'Raleigh-Durham', 'Raleigh', 'Core', 'uber.com'],
  ['North Carolina', 'Raleigh-Durham', 'Durham', 'Core', 'ridester.com'],
  ['North Carolina', 'Raleigh-Durham', 'Chapel Hill', 'Satellite', 'ridester.com'],
  ['North Carolina', 'Wilmington', 'Wilmington', 'Core', 'uber.com'],

  // North Dakota
  ['North Dakota', 'Bismarck', 'Bismarck', 'Core', 'uber.com'],
  ['North Dakota', 'Dickinson', 'Dickinson', 'Core', 'uber.com'],
  ['North Dakota', 'Fargo-Moorhead', 'Fargo', 'Core', 'uber.com'],
  ['North Dakota', 'Fargo-Moorhead', 'Moorhead', 'Satellite', 'uber.com'],
  ['North Dakota', 'Grand Forks', 'Grand Forks', 'Core', 'uber.com'],

  // Ohio
  ['Ohio', 'Akron', 'Akron', 'Core', 'uber.com'],
  ['Ohio', 'Akron', 'Canton', 'Satellite', 'uber.com'],
  ['Ohio', 'Cincinnati', 'Cincinnati', 'Core', 'uber.com'],
  ['Ohio', 'Cincinnati', 'Covington', 'Satellite', 'uber.com'],
  ['Ohio', 'Cincinnati', 'Newport', 'Satellite', 'uber.com'],
  ['Ohio', 'Cleveland', 'Cleveland', 'Core', 'uber.com'],
  ['Ohio', 'Cleveland', 'Lorain', 'Satellite', 'uber.com'],
  ['Ohio', 'Cleveland', 'Elyria', 'Satellite', 'uber.com'],
  ['Ohio', 'Columbus', 'Columbus', 'Core', 'uber.com'],
  ['Ohio', 'Columbus', 'Newark', 'Satellite', 'uber.com'],
  ['Ohio', 'Columbus', 'Delaware', 'Satellite', 'uber.com'],
  ['Ohio', 'Columbus', 'Dublin', 'Satellite', 'uber.com'],
  ['Ohio', 'Dayton', 'Dayton', 'Core', 'uber.com'],
  ['Ohio', 'Dayton', 'Springfield', 'Satellite', 'uber.com'],
  ['Ohio', 'Dayton', 'Beavercreek', 'Satellite', 'uber.com'],
  ['Ohio', 'Toledo', 'Toledo', 'Core', 'uber.com'],
  ['Ohio', 'Toledo', 'Bowling Green', 'Satellite', 'uber.com'],
  ['Ohio', 'Youngstown', 'Youngstown', 'Core', 'uber.com'],
  ['Ohio', 'Youngstown', 'Warren', 'Satellite', 'uber.com'],

  // Oklahoma
  ['Oklahoma', 'Lawton', 'Lawton', 'Core', 'uber.com'],
  ['Oklahoma', 'Oklahoma City', 'Oklahoma City', 'Core', 'uber.com'],
  ['Oklahoma', 'Oklahoma City', 'Edmond', 'Satellite', 'uber.com'],
  ['Oklahoma', 'Oklahoma City', 'Norman', 'Satellite', 'uber.com'],
  ['Oklahoma', 'Oklahoma City', 'Moore', 'Satellite', 'uber.com'],
  ['Oklahoma', 'Stillwater', 'Stillwater', 'Core', 'uber.com'],
  ['Oklahoma', 'Tulsa', 'Tulsa', 'Core', 'uber.com'],
  ['Oklahoma', 'Tulsa', 'Broken Arrow', 'Satellite', 'uber.com'],
  ['Oklahoma', 'Tulsa', 'Owasso', 'Satellite', 'uber.com'],

  // Oregon
  ['Oregon', 'Central Oregon', 'Bend', 'Core', 'ridester.com'],
  ['Oregon', 'Central Oregon', 'Redmond', 'Satellite', 'ridester.com'],
  ['Oregon', 'Eugene', 'Eugene', 'Core', 'uber.com'],
  ['Oregon', 'Eugene', 'Springfield', 'Satellite', 'uber.com'],
  ['Oregon', 'Portland', 'Portland', 'Core', 'uber.com'],
  ['Oregon', 'Portland', 'Beaverton', 'Satellite', 'uber.com'],
  ['Oregon', 'Portland', 'Hillsboro', 'Satellite', 'uber.com'],
  ['Oregon', 'Portland', 'Gresham', 'Satellite', 'uber.com'],
  ['Oregon', 'Portland', 'Vancouver', 'Satellite', 'uber.com'],
  ['Oregon', 'Southern Oregon', 'Medford', 'Core', 'ridester.com'],
  ['Oregon', 'Southern Oregon', 'Grants Pass', 'Satellite', 'ridester.com'],
  ['Oregon', 'Southern Oregon', 'Ashland', 'Satellite', 'ridester.com'],
  ['Oregon', 'Willamette Valley', 'Salem', 'Core', 'ridester.com'],
  ['Oregon', 'Willamette Valley', 'Corvallis', 'Satellite', 'ridester.com'],
  ['Oregon', 'Willamette Valley', 'Albany', 'Satellite', 'ridester.com'],

  // Pennsylvania
  ['Pennsylvania', 'DuBois', 'DuBois', 'Core', 'uber.com'],
  ['Pennsylvania', 'Erie', 'Erie', 'Core', 'uber.com'],
  ['Pennsylvania', 'Greater Williamsport', 'Williamsport', 'Core', 'uber.com'],
  ['Pennsylvania', 'Harrisburg', 'Harrisburg', 'Core', 'uber.com'],
  ['Pennsylvania', 'Harrisburg', 'Hershey', 'Satellite', 'uber.com'],
  ['Pennsylvania', 'Harrisburg', 'Carlisle', 'Satellite', 'uber.com'],
  ['Pennsylvania', 'Harrisburg', 'York', 'Satellite', 'uber.com'],
  ['Pennsylvania', 'Johnstown-Altoona', 'Johnstown', 'Core', 'uber.com'],
  ['Pennsylvania', 'Johnstown-Altoona', 'Altoona', 'Core', 'uber.com'],
  ['Pennsylvania', 'Lancaster', 'Lancaster', 'Core', 'uber.com'],
  ['Pennsylvania', 'Lehigh Valley', 'Allentown', 'Core', 'uber.com'],
  ['Pennsylvania', 'Lehigh Valley', 'Bethlehem', 'Core', 'uber.com'],
  ['Pennsylvania', 'Lehigh Valley', 'Easton', 'Satellite', 'uber.com'],
  ['Pennsylvania', 'Philadelphia', 'Philadelphia', 'Core', 'uber.com'],
  ['Pennsylvania', 'Philadelphia', 'Bensalem', 'Satellite', 'uber.com'],
  ['Pennsylvania', 'Philadelphia', 'Allentown', 'Satellite', 'uber.com'],
  ['Pennsylvania', 'Philadelphia', 'Trenton', 'Satellite', 'uber.com'],
  ['Pennsylvania', 'Pittsburgh', 'Pittsburgh', 'Core', 'uber.com'],
  ['Pennsylvania', 'Pittsburgh', 'Monroeville', 'Satellite', 'uber.com'],
  ['Pennsylvania', 'Pittsburgh', 'McCandless', 'Satellite', 'uber.com'],
  ['Pennsylvania', 'Reading', 'Reading', 'Core', 'uber.com'],
  ['Pennsylvania', 'State College', 'State College', 'Core', 'uber.com'],
  ['Pennsylvania', 'Wilkes-Barre Scranton', 'Wilkes-Barre', 'Core', 'uber.com'],
  ['Pennsylvania', 'Wilkes-Barre Scranton', 'Scranton', 'Core', 'uber.com'],
  ['Pennsylvania', 'Wilkes-Barre Scranton', 'Hazleton', 'Satellite', 'uber.com'],

  // Puerto Rico
  ['Puerto Rico', 'Mayaguez', 'Mayagüez', 'Core', 'uber.com'],
  ['Puerto Rico', 'Ponce', 'Ponce', 'Core', 'uber.com'],
  ['Puerto Rico', 'San Juan', 'San Juan', 'Core', 'uber.com'],
  ['Puerto Rico', 'San Juan', 'Bayamón', 'Satellite', 'uber.com'],
  ['Puerto Rico', 'San Juan', 'Carolina', 'Satellite', 'uber.com'],
  ['Puerto Rico', 'San Juan', 'Caguas', 'Satellite', 'uber.com'],

  // Rhode Island (statewide)
  ['Rhode Island', 'Rhode Island', 'Providence', 'Core', 'ridester.com'],
  ['Rhode Island', 'Rhode Island', 'Warwick', 'Satellite', 'ridester.com'],
  ['Rhode Island', 'Rhode Island', 'Newport', 'Satellite', 'ridester.com'],

  // South Carolina
  ['South Carolina', 'Charleston', 'Charleston', 'Core', 'uber.com'],
  ['South Carolina', 'Charleston', 'North Charleston', 'Satellite', 'uber.com'],
  ['South Carolina', 'Charleston', 'Mount Pleasant', 'Satellite', 'uber.com'],
  ['South Carolina', 'Columbia', 'Columbia', 'Core', 'uber.com'],
  ['South Carolina', 'Columbia', 'Lexington', 'Satellite', 'uber.com'],
  ['South Carolina', 'Columbia', 'Irmo', 'Satellite', 'uber.com'],
  ['South Carolina', 'Florence', 'Florence', 'Core', 'uber.com'],
  ['South Carolina', 'Greenville', 'Greenville', 'Core', 'uber.com'],
  ['South Carolina', 'Greenville', 'Spartanburg', 'Satellite', 'uber.com'],
  ['South Carolina', 'Greenville', 'Anderson', 'Satellite', 'uber.com'],
  ['South Carolina', 'Myrtle Beach', 'Myrtle Beach', 'Core', 'uber.com'],
  ['South Carolina', 'Myrtle Beach', 'Conway', 'Satellite', 'uber.com'],
  ['South Carolina', 'Myrtle Beach', 'North Myrtle Beach', 'Satellite', 'uber.com'],

  // South Dakota
  ['South Dakota', 'Pierre', 'Pierre', 'Core', 'uber.com'],
  ['South Dakota', 'Rapid City', 'Rapid City', 'Core', 'uber.com'],
  ['South Dakota', 'Sioux Falls', 'Sioux Falls', 'Core', 'uber.com'],

  // Tennessee
  ['Tennessee', 'Chattanooga', 'Chattanooga', 'Core', 'uber.com'],
  ['Tennessee', 'Chattanooga', 'Cleveland', 'Satellite', 'uber.com'],
  ['Tennessee', 'Cookeville', 'Cookeville', 'Core', 'uber.com'],
  ['Tennessee', 'Jackson', 'Jackson', 'Core', 'uber.com'],
  ['Tennessee', 'Knoxville', 'Knoxville', 'Core', 'uber.com'],
  ['Tennessee', 'Knoxville', 'Maryville', 'Satellite', 'uber.com'],
  ['Tennessee', 'Knoxville', 'Oak Ridge', 'Satellite', 'uber.com'],
  ['Tennessee', 'Memphis', 'Memphis', 'Core', 'uber.com'],
  ['Tennessee', 'Memphis', 'Bartlett', 'Satellite', 'uber.com'],
  ['Tennessee', 'Memphis', 'Southaven', 'Satellite', 'uber.com'],
  ['Tennessee', 'Nashville', 'Nashville', 'Core', 'uber.com'],
  ['Tennessee', 'Nashville', 'Murfreesboro', 'Satellite', 'uber.com'],
  ['Tennessee', 'Nashville', 'Franklin', 'Satellite', 'uber.com'],
  ['Tennessee', 'Nashville', 'Hendersonville', 'Satellite', 'uber.com'],
  ['Tennessee', 'South Tennessee', 'Columbia', 'Core', 'ridester.com'],
  ['Tennessee', 'South Tennessee', 'Lawrenceburg', 'Satellite', 'ridester.com'],
  ['Tennessee', 'South Tennessee', 'Tullahoma', 'Satellite', 'ridester.com'],
  ['Tennessee', 'Tri-Cities', 'Johnson City', 'Core', 'uber.com'],
  ['Tennessee', 'Tri-Cities', 'Kingsport', 'Core', 'uber.com'],
  ['Tennessee', 'Tri-Cities', 'Bristol', 'Satellite', 'uber.com'],

  // Texas (This is the critical one for the user!)
  ['Texas', 'Abilene', 'Abilene', 'Core', 'uber.com'],
  ['Texas', 'Amarillo', 'Amarillo', 'Core', 'uber.com'],
  ['Texas', 'Austin', 'Austin', 'Core', 'uber.com'],
  ['Texas', 'Austin', 'Round Rock', 'Satellite', 'uber.com'],
  ['Texas', 'Austin', 'Cedar Park', 'Satellite', 'uber.com'],
  ['Texas', 'Austin', 'Georgetown', 'Satellite', 'uber.com'],
  ['Texas', 'Austin', 'Pflugerville', 'Satellite', 'uber.com'],
  ['Texas', 'Beaumont', 'Beaumont', 'Core', 'uber.com'],
  ['Texas', 'Beaumont', 'Port Arthur', 'Satellite', 'uber.com'],
  ['Texas', 'Beaumont', 'Orange', 'Satellite', 'uber.com'],
  ['Texas', 'College Station', 'College Station', 'Core', 'uber.com'],
  ['Texas', 'College Station', 'Bryan', 'Satellite', 'uber.com'],
  ['Texas', 'Corpus Christi', 'Corpus Christi', 'Core', 'uber.com'],
  ['Texas', 'Dallas', 'Dallas', 'Core', 'uber.com'],
  ['Texas', 'Dallas', 'Addison', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Allen', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Carrollton', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Farmers Branch', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Garland', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Irving', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Lewisville', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Plano', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Richardson', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'The Colony', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Frisco', 'Satellite', 'uber.com'],  // KEY CITY!
  ['Texas', 'Dallas', 'Prosper', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Coppell', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'McKinney', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Rowlett', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Mesquite', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Wylie', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Rockwall', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Sachse', 'Satellite', 'uber.com'],
  ['Texas', 'Dallas', 'Murphy', 'Satellite', 'uber.com'],
  ['Texas', 'Eagle Pass', 'Eagle Pass', 'Core', 'uber.com'],
  ['Texas', 'El Paso', 'El Paso', 'Core', 'uber.com'],
  ['Texas', 'Fort Worth', 'Fort Worth', 'Core', 'uber.com'],
  ['Texas', 'Fort Worth', 'North Richland Hills', 'Satellite', 'uber.com'],
  ['Texas', 'Fort Worth', 'Saginaw', 'Satellite', 'uber.com'],
  ['Texas', 'Fort Worth', 'Benbrook', 'Satellite', 'uber.com'],
  ['Texas', 'Fort Worth', 'Keller', 'Satellite', 'uber.com'],
  ['Texas', 'Fort Worth', 'Weatherford', 'Satellite', 'uber.com'],
  ['Texas', 'Fort Worth', 'Grapevine', 'Satellite', 'uber.com'],
  ['Texas', 'Fort Worth', 'Southlake', 'Satellite', 'uber.com'],
  ['Texas', 'Fort Worth', 'Colleyville', 'Satellite', 'uber.com'],
  ['Texas', 'Fort Worth', 'Bedford', 'Satellite', 'uber.com'],
  ['Texas', 'Fort Worth', 'Euless', 'Satellite', 'uber.com'],
  ['Texas', 'Fort Worth', 'Hurst', 'Satellite', 'uber.com'],
  ['Texas', 'Fort Worth', 'Arlington', 'Satellite', 'uber.com'],
  ['Texas', 'Fort Worth', 'Grand Prairie', 'Satellite', 'uber.com'],
  ['Texas', 'Fort Worth', 'Mansfield', 'Satellite', 'uber.com'],
  ['Texas', 'Houston', 'Houston', 'Core', 'uber.com'],
  ['Texas', 'Houston', 'Baytown', 'Satellite', 'ridester.com'],
  ['Texas', 'Houston', 'Pasadena', 'Satellite', 'ridester.com'],
  ['Texas', 'Houston', 'Sugar Land', 'Satellite', 'ridester.com'],
  ['Texas', 'Houston', 'Pearland', 'Satellite', 'ridester.com'],
  ['Texas', 'Houston', 'Conroe', 'Satellite', 'ridester.com'],
  ['Texas', 'Houston', 'The Woodlands', 'Satellite', 'ridester.com'],
  ['Texas', 'Houston', 'Galveston', 'Satellite', 'ridester.com'],
  ['Texas', 'Houston', 'Katy', 'Satellite', 'ridester.com'],
  ['Texas', 'Houston', 'League City', 'Satellite', 'ridester.com'],
  ['Texas', 'Houston', 'Missouri City', 'Satellite', 'ridester.com'],
  ['Texas', 'Killeen', 'Killeen', 'Core', 'uber.com'],
  ['Texas', 'Killeen', 'Temple', 'Satellite', 'uber.com'],
  ['Texas', 'Killeen', 'Copperas Cove', 'Satellite', 'uber.com'],
  ['Texas', 'Laredo', 'Laredo', 'Core', 'uber.com'],
  ['Texas', 'Lubbock', 'Lubbock', 'Core', 'uber.com'],
  ['Texas', 'Midland-Odessa', 'Midland', 'Core', 'ridester.com'],
  ['Texas', 'Midland-Odessa', 'Odessa', 'Core', 'ridester.com'],
  ['Texas', 'Nacogdoches', 'Nacogdoches', 'Core', 'uber.com'],
  ['Texas', 'Nacogdoches', 'Lufkin', 'Satellite', 'uber.com'],
  ['Texas', 'Rio Grande Valley', 'McAllen', 'Core', 'ridester.com'],
  ['Texas', 'Rio Grande Valley', 'Edinburg', 'Satellite', 'ridester.com'],
  ['Texas', 'Rio Grande Valley', 'Brownsville', 'Core', 'ridester.com'],
  ['Texas', 'Rio Grande Valley', 'Harlingen', 'Satellite', 'ridester.com'],
  ['Texas', 'San Angelo', 'San Angelo', 'Core', 'uber.com'],
  ['Texas', 'San Antonio', 'San Antonio', 'Core', 'uber.com'],
  ['Texas', 'San Antonio', 'New Braunfels', 'Satellite', 'uber.com'],
  ['Texas', 'San Antonio', 'San Marcos', 'Satellite', 'uber.com'],
  ['Texas', 'Texarkana', 'Texarkana', 'Core', 'uber.com'],
  ['Texas', 'Tyler', 'Tyler', 'Core', 'uber.com'],
  ['Texas', 'Tyler', 'Longview', 'Satellite', 'uber.com'],
  ['Texas', 'Waco', 'Waco', 'Core', 'uber.com'],
  ['Texas', 'West Texas', 'Alpine', 'Satellite', 'ridester.com'],
  ['Texas', 'West Texas', 'Fort Stockton', 'Satellite', 'ridester.com'],
  ['Texas', 'West Texas', 'Pecos', 'Satellite', 'ridester.com'],
  ['Texas', 'Wichita Falls', 'Wichita Falls', 'Core', 'uber.com'],

  // Utah
  ['Utah', 'Salt Lake City', 'Salt Lake City', 'Core', 'uber.com'],
  ['Utah', 'Salt Lake City', 'Ogden', 'Satellite', 'uber.com'],
  ['Utah', 'Salt Lake City', 'Provo', 'Satellite', 'uber.com'],
  ['Utah', 'Southern Utah', 'St. George', 'Core', 'ridester.com'],
  ['Utah', 'Southern Utah', 'Cedar City', 'Satellite', 'ridester.com'],

  // Vermont (statewide)
  ['Vermont', 'Vermont', 'Burlington', 'Core', 'ridester.com'],
  ['Vermont', 'Vermont', 'Montpelier', 'Core', 'ridester.com'],
  ['Vermont', 'Vermont', 'Rutland', 'Satellite', 'ridester.com'],

  // Virginia
  ['Virginia', 'Charlottesville-Harrisonburg', 'Charlottesville', 'Core', 'uber.com'],
  ['Virginia', 'Charlottesville-Harrisonburg', 'Harrisonburg', 'Core', 'uber.com'],
  ['Virginia', 'Hampton Roads', 'Norfolk', 'Core', 'ridester.com'],
  ['Virginia', 'Hampton Roads', 'Virginia Beach', 'Core', 'ridester.com'],
  ['Virginia', 'Hampton Roads', 'Chesapeake', 'Satellite', 'ridester.com'],
  ['Virginia', 'Hampton Roads', 'Newport News', 'Satellite', 'ridester.com'],
  ['Virginia', 'Hampton Roads', 'Hampton', 'Satellite', 'ridester.com'],
  ['Virginia', 'Richmond', 'Richmond', 'Core', 'uber.com'],
  ['Virginia', 'Richmond', 'Petersburg', 'Satellite', 'uber.com'],
  ['Virginia', 'Richmond', 'Mechanicsville', 'Satellite', 'uber.com'],
  ['Virginia', 'Roanoke-Blacksburg', 'Roanoke', 'Core', 'ridester.com'],
  ['Virginia', 'Roanoke-Blacksburg', 'Blacksburg', 'Core', 'ridester.com'],
  ['Virginia', 'Roanoke-Blacksburg', 'Christiansburg', 'Satellite', 'ridester.com'],

  // Washington
  ['Washington', 'Bellingham', 'Bellingham', 'Core', 'uber.com'],
  ['Washington', 'Eastern Washington', 'Spokane', 'Core', 'ridester.com'],
  ['Washington', 'Eastern Washington', 'Kennewick', 'Satellite', 'ridester.com'],
  ['Washington', 'Eastern Washington', 'Yakima', 'Satellite', 'ridester.com'],
  ['Washington', 'Eastern Washington', 'Walla Walla', 'Satellite', 'ridester.com'],
  ['Washington', 'Olympia', 'Olympia', 'Core', 'uber.com'],
  ['Washington', 'Peninsula and SW Washington', 'Bremerton', 'Core', 'ridester.com'],
  ['Washington', 'Peninsula and SW Washington', 'Port Angeles', 'Satellite', 'ridester.com'],
  ['Washington', 'Peninsula and SW Washington', 'Longview', 'Satellite', 'ridester.com'],
  ['Washington', 'Seattle', 'Seattle', 'Core', 'uber.com'],
  ['Washington', 'Seattle', 'Bellevue', 'Satellite', 'uber.com'],
  ['Washington', 'Seattle', 'Everett', 'Satellite', 'uber.com'],
  ['Washington', 'Seattle', 'Kirkland', 'Satellite', 'uber.com'],
  ['Washington', 'Seattle', 'Redmond', 'Satellite', 'uber.com'],
  ['Washington', 'Seattle', 'Tacoma', 'Satellite', 'uber.com'],

  // Washington, D.C.
  ['Washington, D.C.', 'Washington, D.C.', 'Washington', 'Core', 'ridester.com'],
];

async function seedMarketCities() {
  console.log('🌱 Seeding US Market Cities...\n');

  // Clear existing data
  console.log('  Clearing existing data...');
  await db.delete(us_market_cities);

  // Prepare rows with state abbreviations
  const rows = MARKET_CITIES.map(([state, market_name, city, region_type, source_ref]) => ({
    state,
    state_abbr: STATE_ABBR[state] || null,
    city,
    market_name,
    region_type,
    source_ref,
  }));

  console.log(`  Inserting ${rows.length} cities...\n`);

  // Insert in batches of 100
  const BATCH_SIZE = 100;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db.insert(us_market_cities).values(batch).onConflictDoNothing();
    inserted += batch.length;

    if (inserted % 200 === 0 || inserted === rows.length) {
      console.log(`  ✓ Inserted ${inserted}/${rows.length} cities`);
    }
  }

  // Show summary by state
  console.log('\n📊 Summary by State:');
  const stateCount = {};
  rows.forEach(row => {
    stateCount[row.state] = (stateCount[row.state] || 0) + 1;
  });

  const sortedStates = Object.entries(stateCount).sort((a, b) => b[1] - a[1]);
  const topStates = sortedStates.slice(0, 10);
  topStates.forEach(([state, count]) => {
    console.log(`    ${state}: ${count} cities`);
  });

  // Show Texas specifically (user's focus)
  console.log('\n🤠 Texas Markets (User\'s Focus):');
  const texasMarkets = [...new Set(rows.filter(r => r.state === 'Texas').map(r => r.market_name))];
  texasMarkets.forEach(market => {
    const cities = rows.filter(r => r.state === 'Texas' && r.market_name === market);
    const coreCities = cities.filter(c => c.region_type === 'Core').map(c => c.city);
    const satelliteCities = cities.filter(c => c.region_type === 'Satellite').map(c => c.city);
    console.log(`    ${market}: ${cities.length} cities`);
    if (coreCities.length > 0) console.log(`      Core: ${coreCities.join(', ')}`);
    if (satelliteCities.length > 0 && satelliteCities.length <= 5) {
      console.log(`      Satellite: ${satelliteCities.join(', ')}`);
    } else if (satelliteCities.length > 5) {
      console.log(`      Satellite: ${satelliteCities.slice(0, 5).join(', ')}... +${satelliteCities.length - 5} more`);
    }
  });

  console.log('\n✅ Seeding complete!\n');
}

// Run the seed
seedMarketCities()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  });
