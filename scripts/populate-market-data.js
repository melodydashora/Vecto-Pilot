/**
 * Populate Market Data Script
 *
 * Assigns cities to their respective metro markets based on US Census MSA definitions.
 * Also populates timezone data for US cities.
 *
 * Usage:
 *   node scripts/populate-market-data.js [--dry-run]
 */

import { db } from '../server/db/drizzle.js';
import { platform_data } from '../shared/schema.js';
import { eq, and, sql, inArray } from 'drizzle-orm';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

console.log(`\n🏙️ Market Data Population Script`);
console.log(`   Dry Run: ${dryRun ? 'YES (no writes)' : 'NO (will write to DB)'}\n`);

// Major US Metro Markets (based on US Census MSA definitions)
// Format: { market: 'Market Name', states: ['XX'], cities: ['City1', 'City2', ...], timezone: 'America/Timezone' }
const US_METRO_MARKETS = [
  // Texas
  {
    market: 'Dallas-Fort Worth',
    states: ['Texas'],
    cities: ['Dallas', 'Fort Worth', 'Arlington', 'Plano', 'Irving', 'Garland', 'Frisco', 'McKinney', 'Grand Prairie', 'Mesquite', 'Denton', 'Carrollton', 'Richardson', 'Lewisville', 'Allen', 'Flower Mound', 'Euless', 'Bedford', 'Grapevine', 'Mansfield', 'Cedar Hill', 'Rowlett', 'Coppell', 'Burleson', 'Haltom City', 'The Colony', 'Farmers Branch', 'Watauga', 'Sachse', 'Wylie', 'Murphy', 'Addison', 'Duncanville', 'Lancaster', 'DeSoto', 'Midlothian', 'Keller', 'Southlake', 'Colleyville', 'Prosper', 'Little Elm', 'Rockwall', 'Corinth', 'Forney', 'Saginaw', 'Trophy Club', 'Benbrook', 'White Settlement', 'Richland Hills', 'Azle'],
    timezone: 'America/Chicago'
  },
  {
    market: 'Houston',
    states: ['Texas'],
    cities: ['Houston', 'Pasadena', 'Pearland', 'League City', 'Sugar Land', 'Baytown', 'Conroe', 'Missouri City', 'The Woodlands', 'Spring', 'La Porte', 'Friendswood', 'Galveston', 'Texas City', 'Humble', 'Deer Park', 'Katy', 'Rosenberg', 'Stafford', 'Webster', 'Seabrook', 'Bellaire', 'West University Place', 'Galena Park', 'Jacinto City', 'South Houston', 'Channelview', 'Cypress', 'Tomball', 'Atascocita', 'Kingwood'],
    timezone: 'America/Chicago'
  },
  {
    market: 'San Antonio',
    states: ['Texas'],
    cities: ['San Antonio', 'New Braunfels', 'Schertz', 'Seguin', 'Cibolo', 'Universal City', 'Converse', 'Live Oak', 'Selma', 'Boerne', 'Helotes', 'Alamo Heights', 'Leon Valley', 'Windcrest', 'Kirby', 'Castle Hills'],
    timezone: 'America/Chicago'
  },
  {
    market: 'Austin',
    states: ['Texas'],
    cities: ['Austin', 'Round Rock', 'Cedar Park', 'Georgetown', 'Pflugerville', 'San Marcos', 'Kyle', 'Buda', 'Leander', 'Taylor', 'Hutto', 'Lakeway', 'Bastrop', 'Elgin', 'Dripping Springs', 'Bee Cave', 'Manor', 'West Lake Hills', 'Rollingwood'],
    timezone: 'America/Chicago'
  },
  // California
  {
    market: 'Los Angeles',
    states: ['California'],
    cities: ['Los Angeles', 'Long Beach', 'Anaheim', 'Santa Ana', 'Irvine', 'Glendale', 'Huntington Beach', 'Santa Clarita', 'Garden Grove', 'Oceanside', 'Fullerton', 'Costa Mesa', 'Mission Viejo', 'Westminster', 'Newport Beach', 'Whittier', 'Burbank', 'Torrance', 'Pasadena', 'El Monte', 'Downey', 'West Covina', 'Inglewood', 'Pomona', 'Norwalk', 'Compton', 'South Gate', 'Carson', 'Santa Monica', 'Hawthorne', 'Alhambra', 'Buena Park', 'Lakewood', 'Bellflower', 'Tustin', 'Baldwin Park', 'Lynwood', 'Redondo Beach', 'San Clemente', 'Laguna Niguel', 'Pico Rivera', 'Montebello', 'La Habra', 'Monterey Park', 'Gardena', 'Paramount', 'Rosemead', 'Arcadia', 'Diamond Bar', 'La Mirada'],
    timezone: 'America/Los_Angeles'
  },
  {
    market: 'San Francisco Bay Area',
    states: ['California'],
    cities: ['San Francisco', 'Oakland', 'San Jose', 'Fremont', 'Hayward', 'Sunnyvale', 'Santa Clara', 'Concord', 'Berkeley', 'Richmond', 'Antioch', 'Daly City', 'San Mateo', 'Vallejo', 'Fairfield', 'Vacaville', 'Alameda', 'Redwood City', 'Walnut Creek', 'Palo Alto', 'Mountain View', 'Milpitas', 'Union City', 'Cupertino', 'San Leandro', 'San Ramon', 'Pleasanton', 'Livermore', 'Newark', 'Foster City', 'South San Francisco', 'Menlo Park', 'Burlingame', 'San Bruno', 'Campbell', 'Saratoga', 'Los Gatos', 'Morgan Hill', 'Gilroy'],
    timezone: 'America/Los_Angeles'
  },
  {
    market: 'San Diego',
    states: ['California'],
    cities: ['San Diego', 'Chula Vista', 'Oceanside', 'Escondido', 'Carlsbad', 'El Cajon', 'Vista', 'San Marcos', 'Encinitas', 'National City', 'La Mesa', 'Santee', 'Poway', 'Imperial Beach', 'Solana Beach', 'Coronado', 'Del Mar', 'Lemon Grove'],
    timezone: 'America/Los_Angeles'
  },
  // New York Area
  {
    market: 'New York City',
    states: ['New York'],
    cities: ['New York', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island', 'Manhattan', 'Yonkers', 'New Rochelle', 'Mount Vernon', 'White Plains', 'Scarsdale', 'Rye', 'Tarrytown', 'Mamaroneck', 'Port Chester', 'Ossining', 'Peekskill', 'Harrison', 'Dobbs Ferry', 'Hastings-on-Hudson', 'Nyack', 'Spring Valley', 'Suffern', 'Haverstraw', 'Pearl River'],
    timezone: 'America/New_York'
  },
  // Illinois
  {
    market: 'Chicago',
    states: ['Illinois'],
    cities: ['Chicago', 'Aurora', 'Naperville', 'Joliet', 'Elgin', 'Waukegan', 'Cicero', 'Schaumburg', 'Bolingbrook', 'Evanston', 'Arlington Heights', 'Des Plaines', 'Skokie', 'Oak Lawn', 'Orland Park', 'Downers Grove', 'Tinley Park', 'Oak Park', 'Berwyn', 'Hoffman Estates', 'Palatine', 'Mount Prospect', 'Wheaton', 'Elmhurst', 'Buffalo Grove', 'Streamwood', 'Carol Stream', 'Lombard', 'Glenview', 'Bartlett', 'Addison', 'Calumet City', 'Park Ridge', 'Hanover Park', 'Highland Park', 'Northbrook', 'Lake Forest', 'Vernon Hills', 'Libertyville'],
    timezone: 'America/Chicago'
  },
  // Florida
  {
    market: 'Miami',
    states: ['Florida'],
    cities: ['Miami', 'Fort Lauderdale', 'Hollywood', 'Pembroke Pines', 'Coral Springs', 'Miramar', 'Pompano Beach', 'Davie', 'Plantation', 'Sunrise', 'Boca Raton', 'Deerfield Beach', 'Homestead', 'Tamarac', 'Delray Beach', 'Weston', 'Coconut Creek', 'Boynton Beach', 'Lauderhill', 'Margate', 'Coral Gables', 'Miami Beach', 'North Miami', 'Aventura', 'Doral', 'Hialeah', 'Miami Gardens', 'North Miami Beach', 'Kendall', 'Cutler Bay'],
    timezone: 'America/New_York'
  },
  {
    market: 'Orlando',
    states: ['Florida'],
    cities: ['Orlando', 'Kissimmee', 'Sanford', 'Altamonte Springs', 'Ocoee', 'Apopka', 'Winter Park', 'Winter Garden', 'Clermont', 'Casselberry', 'Lake Mary', 'Oviedo', 'Winter Springs', 'Longwood', 'Maitland', 'Celebration', 'Windermere', 'St. Cloud'],
    timezone: 'America/New_York'
  },
  {
    market: 'Tampa Bay',
    states: ['Florida'],
    cities: ['Tampa', 'St. Petersburg', 'Clearwater', 'Brandon', 'Largo', 'Palm Harbor', 'Riverview', 'Temple Terrace', 'Plant City', 'Dunedin', 'Pinellas Park', 'Safety Harbor', 'Tarpon Springs', 'Oldsmar', 'Seminole', 'New Port Richey', 'Port Richey', 'Wesley Chapel', 'Valrico', 'Ruskin'],
    timezone: 'America/New_York'
  },
  // Georgia
  {
    market: 'Atlanta',
    states: ['Georgia'],
    cities: ['Atlanta', 'Sandy Springs', 'Roswell', 'Johns Creek', 'Alpharetta', 'Marietta', 'Smyrna', 'Dunwoody', 'Brookhaven', 'Peachtree City', 'Kennesaw', 'Lawrenceville', 'Duluth', 'Stonecrest', 'Woodstock', 'Newnan', 'Decatur', 'East Point', 'Douglasville', 'Gainesville', 'Milton', 'Acworth', 'Canton', 'Chamblee', 'Tucker', 'Norcross', 'Suwanee', 'Lilburn', 'Snellville', 'Powder Springs'],
    timezone: 'America/New_York'
  },
  // Arizona
  {
    market: 'Phoenix',
    states: ['Arizona'],
    cities: ['Phoenix', 'Tucson', 'Mesa', 'Chandler', 'Gilbert', 'Glendale', 'Scottsdale', 'Peoria', 'Tempe', 'Surprise', 'Goodyear', 'Buckeye', 'Avondale', 'Casa Grande', 'Queen Creek', 'Maricopa', 'Apache Junction', 'El Mirage', 'Fountain Hills', 'Paradise Valley', 'Tolleson', 'Litchfield Park', 'Anthem'],
    timezone: 'America/Phoenix'
  },
  // Washington
  {
    market: 'Seattle',
    states: ['Washington'],
    cities: ['Seattle', 'Tacoma', 'Bellevue', 'Kent', 'Everett', 'Renton', 'Spokane', 'Federal Way', 'Kirkland', 'Auburn', 'Bellingham', 'Redmond', 'Sammamish', 'Puyallup', 'Lakewood', 'Lynnwood', 'Edmonds', 'Burien', 'Issaquah', 'Bothell', 'SeaTac', 'Tukwila', 'Mercer Island', 'Woodinville', 'Bainbridge Island', 'Covington', 'Maple Valley', 'Des Moines'],
    timezone: 'America/Los_Angeles'
  },
  // Colorado
  {
    market: 'Denver',
    states: ['Colorado'],
    cities: ['Denver', 'Colorado Springs', 'Aurora', 'Fort Collins', 'Lakewood', 'Thornton', 'Arvada', 'Westminster', 'Centennial', 'Boulder', 'Greeley', 'Longmont', 'Loveland', 'Broomfield', 'Castle Rock', 'Commerce City', 'Parker', 'Littleton', 'Northglenn', 'Brighton', 'Englewood', 'Wheat Ridge', 'Golden', 'Louisville', 'Lafayette', 'Erie', 'Lone Tree', 'Highlands Ranch', 'Greenwood Village', 'Cherry Hills Village'],
    timezone: 'America/Denver'
  },
  // Massachusetts
  {
    market: 'Boston',
    states: ['Massachusetts'],
    cities: ['Boston', 'Worcester', 'Springfield', 'Cambridge', 'Lowell', 'Brockton', 'Quincy', 'Lynn', 'New Bedford', 'Fall River', 'Newton', 'Somerville', 'Lawrence', 'Framingham', 'Haverhill', 'Waltham', 'Malden', 'Brookline', 'Plymouth', 'Medford', 'Taunton', 'Weymouth', 'Revere', 'Peabody', 'Methuen', 'Beverly', 'Fitchburg', 'Leominster', 'Billerica', 'Salem', 'Marlborough', 'Chelsea', 'Everett', 'Woburn', 'Natick'],
    timezone: 'America/New_York'
  },
  // Pennsylvania
  {
    market: 'Philadelphia',
    states: ['Pennsylvania'],
    cities: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Reading', 'Scranton', 'Bethlehem', 'Lancaster', 'Harrisburg', 'York', 'Wilkes-Barre', 'Chester', 'Erie', 'Easton', 'Norristown', 'Upper Darby', 'King of Prussia', 'Bensalem', 'Abington', 'Bristol', 'Levittown', 'Lansdale', 'Pottstown', 'West Chester', 'Doylestown', 'Conshohocken', 'Media', 'Wayne', 'Ardmore', 'Bryn Mawr'],
    timezone: 'America/New_York'
  },
  // Nevada
  {
    market: 'Las Vegas',
    states: ['Nevada'],
    cities: ['Las Vegas', 'Henderson', 'North Las Vegas', 'Reno', 'Sparks', 'Carson City', 'Paradise', 'Spring Valley', 'Sunrise Manor', 'Enterprise', 'Whitney', 'Summerlin', 'Boulder City', 'Mesquite', 'Pahrump'],
    timezone: 'America/Los_Angeles'
  },
  // Michigan
  {
    market: 'Detroit',
    states: ['Michigan'],
    cities: ['Detroit', 'Grand Rapids', 'Warren', 'Sterling Heights', 'Ann Arbor', 'Lansing', 'Flint', 'Dearborn', 'Livonia', 'Troy', 'Westland', 'Farmington Hills', 'Kalamazoo', 'Wyoming', 'Southfield', 'Rochester Hills', 'Taylor', 'Royal Oak', 'St. Clair Shores', 'Pontiac', 'Dearborn Heights', 'Novi', 'Battle Creek', 'Saginaw', 'Kentwood', 'East Lansing', 'Roseville', 'Portage', 'Midland', 'Lincoln Park', 'Muskegon', 'Holland', 'Bay City'],
    timezone: 'America/Detroit'
  },
  // Maryland/DC
  {
    market: 'Washington DC',
    states: ['Maryland', 'Virginia'],
    cities: ['Washington', 'Baltimore', 'Columbia', 'Silver Spring', 'Germantown', 'Waldorf', 'Rockville', 'Bethesda', 'Gaithersburg', 'Bowie', 'Frederick', 'College Park', 'Annapolis', 'Greenbelt', 'Laurel', 'Takoma Park', 'Alexandria', 'Arlington', 'Fairfax', 'Reston', 'Falls Church', 'Herndon', 'Vienna', 'McLean', 'Tysons', 'Annandale', 'Springfield', 'Centreville', 'Manassas', 'Leesburg', 'Sterling', 'Ashburn', 'Chantilly', 'Burke', 'Woodbridge'],
    timezone: 'America/New_York'
  },
  // Minnesota
  {
    market: 'Minneapolis-St. Paul',
    states: ['Minnesota'],
    cities: ['Minneapolis', 'St. Paul', 'Rochester', 'Bloomington', 'Brooklyn Park', 'Plymouth', 'Maple Grove', 'Woodbury', 'St. Cloud', 'Eagan', 'Eden Prairie', 'Coon Rapids', 'Burnsville', 'Blaine', 'Lakeville', 'Minnetonka', 'Apple Valley', 'Edina', 'St. Louis Park', 'Moorhead', 'Mankato', 'Shakopee', 'Richfield', 'Cottage Grove', 'Inver Grove Heights', 'Roseville', 'Andover', 'Fridley', 'Savage', 'Prior Lake', 'Chaska', 'Hopkins'],
    timezone: 'America/Chicago'
  },
  // North Carolina
  {
    market: 'Charlotte',
    states: ['North Carolina'],
    cities: ['Charlotte', 'Raleigh', 'Greensboro', 'Durham', 'Winston-Salem', 'Fayetteville', 'Cary', 'Wilmington', 'High Point', 'Concord', 'Gastonia', 'Asheville', 'Chapel Hill', 'Huntersville', 'Apex', 'Kannapolis', 'Mooresville', 'Indian Trail', 'Matthews', 'Monroe', 'Cornelius', 'Davidson', 'Mint Hill', 'Harrisburg', 'Stallings', 'Waxhaw', 'Pineville', 'Fort Mill'],
    timezone: 'America/New_York'
  },
  // Ohio
  {
    market: 'Columbus',
    states: ['Ohio'],
    cities: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton', 'Parma', 'Canton', 'Youngstown', 'Lorain', 'Hamilton', 'Springfield', 'Kettering', 'Elyria', 'Lakewood', 'Cuyahoga Falls', 'Middletown', 'Newark', 'Dublin', 'Westerville', 'Grove City', 'Hilliard', 'Reynoldsburg', 'Upper Arlington', 'Gahanna', 'Pickerington', 'Powell', 'New Albany', 'Grandview Heights'],
    timezone: 'America/New_York'
  },
  // Tennessee
  {
    market: 'Nashville',
    states: ['Tennessee'],
    cities: ['Nashville', 'Murfreesboro', 'Franklin', 'Clarksville', 'Hendersonville', 'Smyrna', 'Brentwood', 'Columbia', 'Spring Hill', 'La Vergne', 'Gallatin', 'Mount Juliet', 'Lebanon', 'Nolensville', 'Goodlettsville', 'White House', 'Dickson', 'Portland', 'Springfield'],
    timezone: 'America/Chicago'
  },
  {
    market: 'Memphis',
    states: ['Tennessee'],
    cities: ['Memphis', 'Bartlett', 'Collierville', 'Germantown', 'Lakeland', 'Arlington', 'Millington', 'Olive Branch', 'Southaven', 'Horn Lake'],
    timezone: 'America/Chicago'
  },
  // Oregon
  {
    market: 'Portland',
    states: ['Oregon', 'Washington'],
    cities: ['Portland', 'Salem', 'Eugene', 'Gresham', 'Hillsboro', 'Beaverton', 'Bend', 'Medford', 'Springfield', 'Corvallis', 'Albany', 'Tigard', 'Lake Oswego', 'Keizer', 'Oregon City', 'Tualatin', 'West Linn', 'Woodburn', 'Wilsonville', 'Forest Grove', 'Newberg', 'Ashland', 'Milwaukie', 'Sherwood', 'Happy Valley', 'Vancouver', 'Camas', 'Washougal'],
    timezone: 'America/Los_Angeles'
  },
  // California - Sacramento
  {
    market: 'Sacramento',
    states: ['California'],
    cities: ['Sacramento', 'Elk Grove', 'Roseville', 'Folsom', 'Rancho Cordova', 'Citrus Heights', 'Rocklin', 'Lincoln', 'Davis', 'Woodland', 'West Sacramento', 'Lodi', 'Stockton', 'Manteca', 'Tracy', 'Modesto', 'Turlock', 'Merced', 'Ceres', 'Oakdale', 'Ripon', 'Lathrop', 'Galt', 'Placerville', 'Auburn', 'Grass Valley'],
    timezone: 'America/Los_Angeles'
  },
  // Missouri
  {
    market: 'St. Louis',
    states: ['Missouri', 'Illinois'],
    cities: ['St. Louis', 'Springfield', 'Independence', 'Columbia', 'Lee\'s Summit', 'O\'Fallon', 'St. Joseph', 'St. Charles', 'St. Peters', 'Blue Springs', 'Florissant', 'Joplin', 'Chesterfield', 'Jefferson City', 'Cape Girardeau', 'Wildwood', 'University City', 'Ballwin', 'Raytown', 'Webster Groves', 'Kirkwood', 'Maryland Heights', 'Hazelwood', 'Creve Coeur', 'Ferguson', 'Belleville', 'Edwardsville', 'Collinsville', 'Granite City', 'Alton', 'O\'Fallon'],
    timezone: 'America/Chicago'
  },
  {
    market: 'Kansas City',
    states: ['Missouri', 'Kansas'],
    cities: ['Kansas City', 'Overland Park', 'Olathe', 'Shawnee', 'Lenexa', 'Leawood', 'Prairie Village', 'Gardner', 'Merriam', 'Mission', 'Roeland Park', 'Fairway', 'Westwood', 'Independence', 'Lee\'s Summit', 'Blue Springs', 'Gladstone', 'Liberty', 'Raytown', 'Grandview', 'Belton', 'Raymore', 'Grain Valley', 'Oak Grove', 'Leavenworth', 'Bonner Springs', 'Basehor', 'Lansing', 'Tonganoxie'],
    timezone: 'America/Chicago'
  },
  // Indiana
  {
    market: 'Indianapolis',
    states: ['Indiana'],
    cities: ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend', 'Carmel', 'Fishers', 'Bloomington', 'Hammond', 'Gary', 'Lafayette', 'Muncie', 'Terre Haute', 'Kokomo', 'Noblesville', 'Anderson', 'Greenwood', 'Elkhart', 'Mishawaka', 'Lawrence', 'Jeffersonville', 'Columbus', 'Portage', 'New Albany', 'Richmond', 'Westfield', 'Valparaiso', 'Goshen', 'Michigan City', 'Merrillville', 'Crown Point', 'Zionsville', 'Plainfield', 'Brownsburg', 'Avon'],
    timezone: 'America/Indiana/Indianapolis'
  },
  // Louisiana
  {
    market: 'New Orleans',
    states: ['Louisiana'],
    cities: ['New Orleans', 'Baton Rouge', 'Shreveport', 'Metairie', 'Lafayette', 'Lake Charles', 'Kenner', 'Bossier City', 'Monroe', 'Alexandria', 'Houma', 'Marrero', 'New Iberia', 'Laplace', 'Slidell', 'Central', 'Mandeville', 'Covington', 'Harvey', 'Terrytown', 'Chalmette', 'Gretna', 'Hammond', 'Gonzales', 'Prairieville', 'Zachary', 'Denham Springs'],
    timezone: 'America/Chicago'
  },
  // Utah
  {
    market: 'Salt Lake City',
    states: ['Utah'],
    cities: ['Salt Lake City', 'West Valley City', 'Provo', 'West Jordan', 'Orem', 'Sandy', 'Ogden', 'St. George', 'Layton', 'South Jordan', 'Lehi', 'Millcreek', 'Taylorsville', 'Logan', 'Murray', 'Draper', 'Bountiful', 'Riverton', 'Herriman', 'Spanish Fork', 'Roy', 'Pleasant Grove', 'Cottonwood Heights', 'Tooele', 'Springville', 'Eagle Mountain', 'Kaysville', 'Clearfield', 'Holladay', 'American Fork', 'Syracuse', 'Saratoga Springs', 'Midvale', 'Farmington', 'Cedar City', 'Clinton', 'North Salt Lake', 'Payson', 'Brigham City'],
    timezone: 'America/Denver'
  },
  // North Carolina - Raleigh-Durham separate market
  {
    market: 'Raleigh-Durham',
    states: ['North Carolina'],
    cities: ['Raleigh', 'Durham', 'Cary', 'Chapel Hill', 'Apex', 'Wake Forest', 'Morrisville', 'Holly Springs', 'Garner', 'Fuquay-Varina', 'Clayton', 'Knightdale', 'Wendell', 'Zebulon', 'Rolesville', 'Carrboro', 'Hillsborough', 'Mebane', 'Creedmoor', 'Butner'],
    timezone: 'America/New_York'
  },
  // Florida - Jacksonville
  {
    market: 'Jacksonville',
    states: ['Florida'],
    cities: ['Jacksonville', 'St. Augustine', 'Orange Park', 'Fleming Island', 'Ponte Vedra Beach', 'Jacksonville Beach', 'Neptune Beach', 'Atlantic Beach', 'Fernandina Beach', 'Green Cove Springs', 'Middleburg', 'Mandarin', 'Southside', 'Arlington', 'Westside'],
    timezone: 'America/New_York'
  },
  // Virginia - Hampton Roads
  {
    market: 'Virginia Beach-Norfolk',
    states: ['Virginia'],
    cities: ['Virginia Beach', 'Norfolk', 'Newport News', 'Hampton', 'Chesapeake', 'Portsmouth', 'Suffolk', 'Williamsburg', 'Poquoson', 'Yorktown', 'Smithfield', 'Franklin', 'Gloucester'],
    timezone: 'America/New_York'
  },
  // Oklahoma
  {
    market: 'Oklahoma City',
    states: ['Oklahoma'],
    cities: ['Oklahoma City', 'Tulsa', 'Norman', 'Broken Arrow', 'Edmond', 'Lawton', 'Moore', 'Midwest City', 'Enid', 'Stillwater', 'Muskogee', 'Bartlesville', 'Owasso', 'Shawnee', 'Bixby', 'Ponca City', 'Ardmore', 'Duncan', 'Del City', 'Yukon', 'Mustang', 'El Reno', 'Bethany', 'Jenks', 'Sand Springs', 'Claremore', 'Sapulpa'],
    timezone: 'America/Chicago'
  },
  // Wisconsin
  {
    market: 'Milwaukee',
    states: ['Wisconsin'],
    cities: ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha', 'Racine', 'Appleton', 'Waukesha', 'Oshkosh', 'Eau Claire', 'Janesville', 'West Allis', 'La Crosse', 'Sheboygan', 'Wauwatosa', 'Fond du Lac', 'New Berlin', 'Brookfield', 'Wausau', 'Beloit', 'Greenfield', 'Franklin', 'Oak Creek', 'Manitowoc', 'West Bend', 'Sun Prairie', 'Superior', 'Stevens Point', 'Neenah', 'Fitchburg', 'Muskego', 'Menomonee Falls', 'Cudahy', 'South Milwaukee', 'Germantown'],
    timezone: 'America/Chicago'
  },
  // Connecticut
  {
    market: 'Hartford',
    states: ['Connecticut'],
    cities: ['Hartford', 'Bridgeport', 'New Haven', 'Stamford', 'Waterbury', 'Norwalk', 'Danbury', 'New Britain', 'Bristol', 'Meriden', 'West Haven', 'Milford', 'Middletown', 'Shelton', 'Norwich', 'Torrington', 'Trumbull', 'Stratford', 'Wallingford', 'Greenwich', 'Fairfield', 'Hamden', 'Manchester', 'East Hartford', 'West Hartford', 'Glastonbury', 'Southington', 'Enfield', 'Vernon', 'Cheshire', 'Newington', 'Farmington'],
    timezone: 'America/New_York'
  },
  // Virginia - Richmond
  {
    market: 'Richmond',
    states: ['Virginia'],
    cities: ['Richmond', 'Henrico', 'Chesterfield', 'Midlothian', 'Glen Allen', 'Mechanicsville', 'Chester', 'Colonial Heights', 'Hopewell', 'Petersburg', 'Ashland', 'Short Pump', 'Bon Air', 'Tuckahoe', 'Lakeside'],
    timezone: 'America/New_York'
  },
  // New York - Buffalo
  {
    market: 'Buffalo',
    states: ['New York'],
    cities: ['Buffalo', 'Rochester', 'Syracuse', 'Albany', 'Schenectady', 'Troy', 'Utica', 'Binghamton', 'Cheektowaga', 'Tonawanda', 'Amherst', 'West Seneca', 'Irondequoit', 'Greece', 'Henrietta', 'Brighton', 'Penfield', 'Webster', 'Pittsford', 'Clarence', 'Hamburg', 'Lancaster', 'Orchard Park', 'East Aurora', 'Williamsville'],
    timezone: 'America/New_York'
  },
  // New Jersey
  {
    market: 'Newark-Jersey City',
    states: ['New Jersey'],
    cities: ['Newark', 'Jersey City', 'Paterson', 'Elizabeth', 'Edison', 'Woodbridge', 'Lakewood', 'Toms River', 'Hamilton', 'Trenton', 'Clifton', 'Camden', 'Brick', 'Cherry Hill', 'Passaic', 'Union City', 'Old Bridge', 'Middletown', 'East Orange', 'Bayonne', 'Franklin', 'North Bergen', 'Vineland', 'Union', 'Piscataway', 'New Brunswick', 'Hoboken', 'West New York', 'Perth Amboy', 'Plainfield', 'Hackensack', 'Sayreville', 'Kearny', 'Linden', 'Atlantic City', 'Montclair', 'Fort Lee', 'Paramus', 'Secaucus', 'Weehawken'],
    timezone: 'America/New_York'
  },
  // South Carolina
  {
    market: 'Charleston',
    states: ['South Carolina'],
    cities: ['Charleston', 'Columbia', 'North Charleston', 'Mount Pleasant', 'Rock Hill', 'Greenville', 'Summerville', 'Goose Creek', 'Hilton Head Island', 'Sumter', 'Florence', 'Spartanburg', 'Myrtle Beach', 'Anderson', 'Aiken', 'Mauldin', 'Greer', 'North Augusta', 'Easley', 'Simpsonville', 'Hanahan', 'Lexington', 'Conway', 'West Columbia', 'North Myrtle Beach', 'Bluffton', 'Ladson', 'James Island', 'Johns Island', 'Daniel Island'],
    timezone: 'America/New_York'
  },
  // Alabama
  {
    market: 'Birmingham',
    states: ['Alabama'],
    cities: ['Birmingham', 'Montgomery', 'Huntsville', 'Mobile', 'Tuscaloosa', 'Hoover', 'Dothan', 'Auburn', 'Decatur', 'Madison', 'Florence', 'Gadsden', 'Vestavia Hills', 'Prattville', 'Phenix City', 'Alabaster', 'Bessemer', 'Enterprise', 'Homewood', 'Opelika', 'Northport', 'Anniston', 'Prichard', 'Athens', 'Daphne', 'Pelham', 'Trussville', 'Oxford', 'Albertville', 'Selma', 'Mountain Brook', 'Helena', 'Fairhope', 'Troy', 'Center Point'],
    timezone: 'America/Chicago'
  },
  // Kentucky
  {
    market: 'Louisville',
    states: ['Kentucky'],
    cities: ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro', 'Covington', 'Richmond', 'Georgetown', 'Florence', 'Hopkinsville', 'Nicholasville', 'Elizabethtown', 'Henderson', 'Frankfort', 'Jeffersontown', 'Paducah', 'Independence', 'Radcliff', 'Ashland', 'Madisonville', 'Murray', 'St. Matthews', 'Erlanger', 'Winchester', 'Danville', 'Fort Thomas', 'Shelbyville', 'Newport', 'Bardstown', 'Shepherdsville', 'Berea'],
    timezone: 'America/Kentucky/Louisville'
  },
  // Hawaii
  {
    market: 'Honolulu',
    states: ['Hawaii'],
    cities: ['Honolulu', 'Pearl City', 'Hilo', 'Kailua', 'Waipahu', 'Kaneohe', 'Mililani', 'Kahului', 'Ewa Gentry', 'Kihei', 'Makakilo', 'Kapolei', 'Lahaina', 'Wailuku', 'Aiea', 'Kailua-Kona', 'Waimalu', 'Hawaii Kai', 'Kapaa', 'Lihue', 'Schofield Barracks', 'Royal Kunia', 'Halawa', 'Waimea', 'Ewa Beach', 'Ocean Pointe'],
    timezone: 'Pacific/Honolulu'
  },
];

// State to timezone mapping for non-metro cities
const STATE_TIMEZONES = {
  'Alabama': 'America/Chicago',
  'Alaska': 'America/Anchorage',
  'Arizona': 'America/Phoenix',
  'Arkansas': 'America/Chicago',
  'California': 'America/Los_Angeles',
  'Colorado': 'America/Denver',
  'Connecticut': 'America/New_York',
  'Delaware': 'America/New_York',
  'Florida': 'America/New_York',
  'Georgia': 'America/New_York',
  'Hawaii': 'Pacific/Honolulu',
  'Idaho': 'America/Boise',
  'Illinois': 'America/Chicago',
  'Indiana': 'America/Indiana/Indianapolis',
  'Iowa': 'America/Chicago',
  'Kansas': 'America/Chicago',
  'Kentucky': 'America/Kentucky/Louisville',
  'Louisiana': 'America/Chicago',
  'Maine': 'America/New_York',
  'Maryland': 'America/New_York',
  'Massachusetts': 'America/New_York',
  'Michigan': 'America/Detroit',
  'Minnesota': 'America/Chicago',
  'Mississippi': 'America/Chicago',
  'Missouri': 'America/Chicago',
  'Montana': 'America/Denver',
  'Nebraska': 'America/Chicago',
  'Nevada': 'America/Los_Angeles',
  'New Hampshire': 'America/New_York',
  'New Jersey': 'America/New_York',
  'New Mexico': 'America/Denver',
  'New York': 'America/New_York',
  'North Carolina': 'America/New_York',
  'North Dakota': 'America/Chicago',
  'Ohio': 'America/New_York',
  'Oklahoma': 'America/Chicago',
  'Oregon': 'America/Los_Angeles',
  'Pennsylvania': 'America/New_York',
  'Rhode Island': 'America/New_York',
  'South Carolina': 'America/New_York',
  'South Dakota': 'America/Chicago',
  'Tennessee': 'America/Chicago',
  'Texas': 'America/Chicago',
  'Utah': 'America/Denver',
  'Vermont': 'America/New_York',
  'Virginia': 'America/New_York',
  'Washington': 'America/Los_Angeles',
  'West Virginia': 'America/New_York',
  'Wisconsin': 'America/Chicago',
  'Wyoming': 'America/Denver',
};

async function populateMarkets() {
  let totalUpdated = 0;
  let marketsProcessed = 0;

  console.log(`📍 Processing ${US_METRO_MARKETS.length} metro markets...\n`);

  for (const metro of US_METRO_MARKETS) {
    // Process each city individually to avoid array syntax issues
    for (const city of metro.cities) {
      for (const state of metro.states) {
        try {
          const result = await db.execute(sql`
            UPDATE platform_data
            SET
              market = ${metro.market},
              timezone = ${metro.timezone}
            WHERE platform = 'uber'
              AND country = 'United States'
              AND region = ${state}
              AND LOWER(city) = ${city.toLowerCase()}
              AND (market IS NULL OR market = '')
          `);

          const rowCount = result.rowCount || 0;
          if (rowCount > 0) {
            totalUpdated += rowCount;
          }
        } catch (e) {
          // Ignore errors for cities not found
        }
      }
    }
    console.log(`   ✅ ${metro.market}: processed`);
    marketsProcessed++;
  }

  console.log(`\n📊 Metro markets: ${marketsProcessed} processed, ${totalUpdated} cities updated`);

  // Now update timezones for remaining US cities based on state
  console.log(`\n🕐 Updating timezones for remaining US cities...\n`);
  let timezoneUpdated = 0;

  for (const [state, timezone] of Object.entries(STATE_TIMEZONES)) {
    const result = await db.execute(sql`
      UPDATE platform_data
      SET timezone = ${timezone}
      WHERE platform = 'uber'
        AND country = 'United States'
        AND region = ${state}
        AND timezone IS NULL
    `);

    const rowCount = result.rowCount || 0;
    if (rowCount > 0) {
      timezoneUpdated += rowCount;
      console.log(`   ✅ ${state}: ${rowCount} cities got timezone`);
    }
  }

  console.log(`\n📊 Timezone updates: ${timezoneUpdated} additional cities`);
  console.log(`\n✅ Total updates: ${totalUpdated + timezoneUpdated} cities`);
}

async function showSummary() {
  // Show market distribution
  const marketStats = await db.execute(sql`
    SELECT
      COALESCE(market, '(Unassigned)') as market,
      COUNT(*) as cities
    FROM platform_data
    WHERE platform = 'uber' AND country = 'United States'
    GROUP BY market
    ORDER BY cities DESC
    LIMIT 20
  `);

  console.log(`\n📈 Top US Markets by City Count:`);
  for (const row of marketStats.rows) {
    console.log(`   ${row.market}: ${row.cities}`);
  }

  // Show timezone coverage
  const tzStats = await db.execute(sql`
    SELECT
      CASE WHEN timezone IS NULL THEN 'No timezone' ELSE 'Has timezone' END as status,
      COUNT(*) as count
    FROM platform_data
    WHERE platform = 'uber' AND country = 'United States'
    GROUP BY status
  `);

  console.log(`\n🕐 Timezone Coverage:`);
  for (const row of tzStats.rows) {
    console.log(`   ${row.status}: ${row.count}`);
  }
}

// Run
async function main() {
  if (dryRun) {
    console.log(`🔍 DRY RUN - Showing current state only\n`);
    await showSummary();
  } else {
    await populateMarkets();
    await showSummary();
  }
}

main()
  .then(() => {
    console.log(`\n👋 Done!\n`);
    process.exit(0);
  })
  .catch(error => {
    console.error(`\n❌ Error: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  });
