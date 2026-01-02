/**
 * Seed script for markets reference table
 * Populates markets with pre-resolved timezones to skip Google Timezone API calls
 *
 * Run: node server/scripts/seed-markets.js
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// US Markets with timezones and city aliases
// Format: [market_slug, market_name, primary_city, state, timezone, city_aliases]
const marketsData = [
  // Texas (Central Time)
  ['dfw', 'DFW Metro', 'Dallas', 'Texas', 'America/Chicago',
    ['Frisco', 'Plano', 'McKinney', 'Richardson', 'Irving', 'Arlington', 'Fort Worth', 'Garland', 'Mesquite', 'Carrollton', 'Lewisville', 'Denton', 'Allen', 'Flower Mound', 'Coppell', 'Grapevine', 'Southlake', 'Keller', 'North Richland Hills', 'Bedford', 'Euless', 'Hurst', 'Colleyville', 'Grand Prairie', 'Mansfield', 'Cedar Hill', 'DeSoto', 'Duncanville', 'Lancaster', 'Rowlett', 'Rockwall', 'Wylie', 'Murphy', 'Sachse', 'The Colony', 'Little Elm', 'Prosper', 'Celina', 'Forney', 'Midlothian', 'Waxahachie', 'Weatherford']],
  ['houston', 'Houston', 'Houston', 'Texas', 'America/Chicago',
    ['Sugar Land', 'Pearland', 'League City', 'Pasadena', 'Baytown', 'Missouri City', 'Katy', 'Cypress', 'Spring', 'The Woodlands', 'Conroe', 'Humble', 'Kingwood', 'Atascocita', 'Friendswood', 'Clear Lake', 'Webster', 'Galveston', 'Texas City', 'La Porte', 'Deer Park', 'Channelview', 'Rosenberg', 'Richmond']],
  ['austin', 'Austin', 'Austin', 'Texas', 'America/Chicago',
    ['Round Rock', 'Cedar Park', 'Georgetown', 'Pflugerville', 'San Marcos', 'Kyle', 'Buda', 'Lakeway', 'Leander', 'Hutto', 'Dripping Springs', 'Bee Cave', 'Manor', 'Taylor', 'Bastrop']],
  ['san-antonio', 'San Antonio', 'San Antonio', 'Texas', 'America/Chicago',
    ['New Braunfels', 'Schertz', 'Cibolo', 'Universal City', 'Live Oak', 'Converse', 'Helotes', 'Leon Valley', 'Alamo Heights', 'Selma', 'Boerne', 'Seguin']],

  // California (Pacific Time)
  ['los-angeles', 'Los Angeles', 'Los Angeles', 'California', 'America/Los_Angeles',
    ['Long Beach', 'Santa Monica', 'Beverly Hills', 'Pasadena', 'Glendale', 'Burbank', 'Torrance', 'Inglewood', 'Downey', 'Whittier', 'Pomona', 'West Covina', 'El Monte', 'Arcadia', 'Monrovia', 'Azusa', 'Covina', 'Alhambra', 'Monterey Park', 'San Gabriel', 'Temple City', 'South Pasadena', 'Culver City', 'Marina del Rey', 'Manhattan Beach', 'Hermosa Beach', 'Redondo Beach', 'Palos Verdes', 'Carson', 'Compton', 'Norwalk', 'Cerritos', 'Lakewood', 'Bellflower', 'Paramount', 'Lynwood', 'South Gate', 'Bell Gardens', 'Huntington Park', 'Bell', 'Maywood', 'Commerce', 'Vernon', 'Montebello', 'Pico Rivera', 'Santa Fe Springs', 'La Mirada', 'La Habra', 'Brea', 'Fullerton', 'Placentia', 'Yorba Linda', 'Anaheim', 'Orange', 'Tustin', 'Irvine', 'Costa Mesa', 'Newport Beach', 'Huntington Beach', 'Fountain Valley', 'Garden Grove', 'Westminster', 'Stanton', 'Buena Park', 'Cypress', 'La Palma', 'Los Alamitos', 'Seal Beach', 'Santa Ana', 'Lake Forest', 'Mission Viejo', 'Laguna Niguel', 'Laguna Hills', 'Aliso Viejo', 'Laguna Beach', 'Dana Point', 'San Clemente', 'San Juan Capistrano', 'Rancho Santa Margarita', 'Ladera Ranch']],
  ['san-francisco', 'San Francisco Bay Area', 'San Francisco', 'California', 'America/Los_Angeles',
    ['Oakland', 'Berkeley', 'San Jose', 'Palo Alto', 'Mountain View', 'Sunnyvale', 'Santa Clara', 'Cupertino', 'Fremont', 'Hayward', 'San Mateo', 'Redwood City', 'Menlo Park', 'Daly City', 'South San Francisco', 'San Bruno', 'Burlingame', 'Foster City', 'Belmont', 'San Carlos', 'Millbrae', 'Brisbane', 'Pacifica', 'Half Moon Bay', 'Alameda', 'San Leandro', 'Union City', 'Newark', 'Milpitas', 'Campbell', 'Los Gatos', 'Saratoga', 'Los Altos', 'Los Altos Hills', 'Atherton', 'Woodside', 'Portola Valley', 'Hillsborough', 'Tiburon', 'Sausalito', 'Mill Valley', 'Corte Madera', 'Larkspur', 'San Rafael', 'Novato', 'San Anselmo', 'Fairfax', 'Ross', 'Kentfield', 'Walnut Creek', 'Concord', 'Pleasant Hill', 'Lafayette', 'Orinda', 'Moraga', 'Danville', 'San Ramon', 'Dublin', 'Pleasanton', 'Livermore', 'Tracy', 'Manteca', 'Stockton', 'Modesto']],
  ['san-diego', 'San Diego', 'San Diego', 'California', 'America/Los_Angeles',
    ['Chula Vista', 'Oceanside', 'Escondido', 'Carlsbad', 'El Cajon', 'Vista', 'San Marcos', 'Encinitas', 'National City', 'La Mesa', 'Santee', 'Poway', 'Imperial Beach', 'Coronado', 'Solana Beach', 'Del Mar', 'La Jolla', 'Pacific Beach', 'Ocean Beach', 'Point Loma', 'Mission Beach', 'Rancho Bernardo', 'Scripps Ranch', 'Mira Mesa', 'Clairemont', 'Kearny Mesa', 'Mission Valley', 'Hillcrest', 'North Park', 'South Park', 'Golden Hill', 'Barrio Logan', 'Logan Heights', 'Downtown San Diego', 'Gaslamp Quarter', 'Little Italy', 'East Village', 'Bankers Hill', 'University Heights', 'Normal Heights', 'City Heights', 'College Area', 'La Mesa', 'Spring Valley', 'Lemon Grove', 'Paradise Hills', 'Encanto', 'Skyline', 'Valencia Park', 'Bay Terraces', 'Otay Mesa', 'San Ysidro', 'Tijuana']],
  ['sacramento', 'Sacramento', 'Sacramento', 'California', 'America/Los_Angeles',
    ['Elk Grove', 'Roseville', 'Folsom', 'Rancho Cordova', 'Citrus Heights', 'Rocklin', 'Lincoln', 'West Sacramento', 'Davis', 'Woodland', 'Vacaville', 'Fairfield', 'Vallejo', 'Benicia', 'Dixon', 'Lodi', 'Galt', 'Stockton']],

  // Illinois (Central Time)
  ['chicago', 'Chicago', 'Chicago', 'Illinois', 'America/Chicago',
    ['Evanston', 'Oak Park', 'Cicero', 'Berwyn', 'Skokie', 'Des Plaines', 'Arlington Heights', 'Schaumburg', 'Naperville', 'Aurora', 'Joliet', 'Bolingbrook', 'Downers Grove', 'Wheaton', 'Oak Brook', 'Elmhurst', 'Lombard', 'Glen Ellyn', 'Palatine', 'Hoffman Estates', 'Buffalo Grove', 'Glenview', 'Northbrook', 'Highland Park', 'Lake Forest', 'Waukegan', 'North Chicago', 'Zion', 'Elgin', 'Crystal Lake', 'McHenry', 'Wauconda', 'Libertyville', 'Vernon Hills', 'Mundelein', 'Gurnee', 'Round Lake', 'Antioch', 'Park Ridge', 'Niles', 'Morton Grove', 'Lincolnwood', 'Wilmette', 'Winnetka', 'Kenilworth', 'Glencoe', 'Oak Lawn', 'Orland Park', 'Tinley Park', 'Mokena', 'Frankfort', 'New Lenox', 'Plainfield', 'Oswego', 'Yorkville', 'Montgomery', 'Sugar Grove', 'Batavia', 'Geneva', 'St. Charles', 'South Elgin', 'Bartlett', 'Streamwood', 'Hanover Park', 'Carol Stream', 'Bloomingdale', 'Glendale Heights', 'Addison', 'Villa Park', 'Bensenville', 'Wood Dale', 'Itasca', 'Roselle', 'Medinah', 'Elk Grove Village', 'Mount Prospect', 'Prospect Heights', 'Wheeling']],

  // New York (Eastern Time)
  ['new-york', 'New York City', 'New York', 'New York', 'America/New_York',
    ['Brooklyn', 'Queens', 'Manhattan', 'Bronx', 'Staten Island', 'Jersey City', 'Newark', 'Hoboken', 'Yonkers', 'White Plains', 'New Rochelle', 'Mount Vernon', 'Stamford', 'Greenwich', 'Port Chester', 'Rye', 'Harrison', 'Mamaroneck', 'Larchmont', 'Scarsdale', 'Eastchester', 'Tuckahoe', 'Bronxville', 'Pelham', 'New Rochelle', 'Tarrytown', 'Sleepy Hollow', 'Ossining', 'Croton-on-Hudson', 'Peekskill', 'Yorktown Heights', 'Mahopac', 'Carmel', 'Brewster', 'Patterson', 'Danbury', 'Ridgefield', 'Wilton', 'Westport', 'Fairfield', 'Bridgeport', 'Stratford', 'Milford', 'New Haven', 'West Haven', 'East Haven', 'North Haven', 'Hamden', 'Wallingford', 'Meriden', 'Middletown', 'Long Island', 'Garden City', 'Hempstead', 'Freeport', 'Long Beach', 'Valley Stream', 'Lynbrook', 'Rockville Centre', 'Oceanside', 'Massapequa', 'Farmingdale', 'Hicksville', 'Levittown', 'Westbury', 'Mineola', 'Great Neck', 'Manhasset', 'Port Washington', 'Roslyn', 'Glen Cove', 'Oyster Bay', 'Huntington', 'Northport', 'Smithtown', 'Hauppauge', 'Commack', 'Dix Hills', 'Melville', 'Plainview', 'Syosset', 'Woodbury', 'Jericho', 'Bethpage', 'Massapequa Park', 'Seaford', 'Wantagh', 'Bellmore', 'Merrick', 'Baldwin', 'Roosevelt', 'Uniondale', 'East Meadow', 'Carle Place']],

  // Florida (Eastern Time)
  ['miami', 'Miami', 'Miami', 'Florida', 'America/New_York',
    ['Miami Beach', 'Coral Gables', 'Hialeah', 'Fort Lauderdale', 'Hollywood', 'Pembroke Pines', 'Miramar', 'Davie', 'Plantation', 'Sunrise', 'Weston', 'Coral Springs', 'Pompano Beach', 'Deerfield Beach', 'Boca Raton', 'Delray Beach', 'Boynton Beach', 'West Palm Beach', 'Palm Beach Gardens', 'Jupiter', 'Aventura', 'Sunny Isles Beach', 'Bal Harbour', 'Surfside', 'North Miami Beach', 'North Miami', 'Miami Gardens', 'Opa-locka', 'Miami Lakes', 'Doral', 'Sweetwater', 'Kendall', 'Pinecrest', 'Palmetto Bay', 'Cutler Bay', 'Homestead', 'Florida City', 'Key Biscayne', 'Coconut Grove', 'Little Havana', 'Wynwood', 'Brickell', 'Downtown Miami', 'Edgewater', 'Midtown', 'Design District']],
  ['orlando', 'Orlando', 'Orlando', 'Florida', 'America/New_York',
    ['Kissimmee', 'Sanford', 'Altamonte Springs', 'Casselberry', 'Winter Park', 'Maitland', 'Lake Mary', 'Longwood', 'Oviedo', 'Winter Springs', 'Apopka', 'Clermont', 'Leesburg', 'Tavares', 'Eustis', 'Mount Dora', 'Daytona Beach', 'Port Orange', 'Ormond Beach', 'DeLand', 'Deltona', 'Melbourne', 'Palm Bay', 'Titusville', 'Cocoa', 'Merritt Island', 'Cape Canaveral', 'Cocoa Beach']],
  ['tampa', 'Tampa Bay', 'Tampa', 'Florida', 'America/New_York',
    ['St. Petersburg', 'Clearwater', 'Brandon', 'Riverview', 'Wesley Chapel', 'Land O\' Lakes', 'Lutz', 'New Tampa', 'Temple Terrace', 'Plant City', 'Lakeland', 'Winter Haven', 'Bartow', 'Auburndale', 'Haines City', 'Kissimmee', 'Largo', 'Pinellas Park', 'Seminole', 'Dunedin', 'Safety Harbor', 'Oldsmar', 'Palm Harbor', 'Tarpon Springs', 'New Port Richey', 'Port Richey', 'Holiday', 'Trinity', 'Odessa', 'Spring Hill', 'Brooksville', 'Dade City', 'Zephyrhills', 'Bradenton', 'Sarasota', 'Venice', 'North Port', 'Port Charlotte', 'Punta Gorda']],

  // Georgia (Eastern Time)
  ['atlanta', 'Atlanta', 'Atlanta', 'Georgia', 'America/New_York',
    ['Marietta', 'Roswell', 'Sandy Springs', 'Alpharetta', 'Johns Creek', 'Dunwoody', 'Brookhaven', 'Smyrna', 'Kennesaw', 'Lawrenceville', 'Duluth', 'Suwanee', 'Buford', 'Gainesville', 'Cumming', 'Decatur', 'Stone Mountain', 'Tucker', 'Lilburn', 'Snellville', 'Loganville', 'Monroe', 'Conyers', 'Covington', 'McDonough', 'Stockbridge', 'Jonesboro', 'Riverdale', 'College Park', 'East Point', 'Hapeville', 'Forest Park', 'Morrow', 'Union City', 'Fairburn', 'Palmetto', 'Newnan', 'Peachtree City', 'Fayetteville', 'Tyrone', 'Senoia', 'Griffin', 'Carrollton', 'Villa Rica', 'Douglasville', 'Austell', 'Powder Springs', 'Mableton', 'Vinings', 'Buckhead', 'Midtown Atlanta', 'Downtown Atlanta', 'West Midtown', 'Inman Park', 'Virginia-Highland', 'Little Five Points', 'East Atlanta', 'Grant Park', 'Cabbagetown', 'Old Fourth Ward', 'Poncey-Highland']],

  // Arizona (Mountain Time - no DST)
  ['phoenix', 'Phoenix', 'Phoenix', 'Arizona', 'America/Phoenix',
    ['Scottsdale', 'Tempe', 'Mesa', 'Chandler', 'Gilbert', 'Glendale', 'Peoria', 'Surprise', 'Goodyear', 'Avondale', 'Buckeye', 'Cave Creek', 'Carefree', 'Fountain Hills', 'Paradise Valley', 'Litchfield Park', 'Sun City', 'Sun City West', 'Queen Creek', 'San Tan Valley', 'Apache Junction', 'Gold Canyon', 'Anthem', 'New River', 'Desert Hills', 'Rio Verde', 'Fort McDowell']],
  ['tucson', 'Tucson', 'Tucson', 'Arizona', 'America/Phoenix',
    ['Oro Valley', 'Marana', 'Sahuarita', 'Green Valley', 'Catalina', 'Catalina Foothills', 'Casas Adobes', 'Flowing Wells', 'Tanque Verde', 'Vail', 'Corona de Tucson', 'South Tucson', 'Drexel Heights']],

  // Washington (Pacific Time)
  ['seattle', 'Seattle', 'Seattle', 'Washington', 'America/Los_Angeles',
    ['Bellevue', 'Tacoma', 'Everett', 'Kent', 'Renton', 'Federal Way', 'Spokane', 'Vancouver', 'Bellingham', 'Lakewood', 'Redmond', 'Kirkland', 'Sammamish', 'Issaquah', 'Burien', 'SeaTac', 'Tukwila', 'Shoreline', 'Lynnwood', 'Edmonds', 'Mountlake Terrace', 'Bothell', 'Kenmore', 'Lake Forest Park', 'Woodinville', 'Mukilteo', 'Marysville', 'Arlington', 'Snohomish', 'Monroe', 'Duvall', 'Carnation', 'North Bend', 'Snoqualmie', 'Maple Valley', 'Covington', 'Auburn', 'Puyallup', 'Bonney Lake', 'Sumner', 'Fife', 'Milton', 'Edgewood', 'University Place', 'Gig Harbor', 'Port Orchard', 'Bremerton', 'Silverdale', 'Poulsbo', 'Bainbridge Island', 'Kingston', 'Normandy Park', 'Des Moines', 'Mercer Island', 'Newcastle', 'Beaux Arts Village', 'Clyde Hill', 'Medina', 'Hunts Point', 'Yarrow Point']],

  // Colorado (Mountain Time)
  ['denver', 'Denver', 'Denver', 'Colorado', 'America/Denver',
    ['Aurora', 'Lakewood', 'Thornton', 'Arvada', 'Westminster', 'Centennial', 'Boulder', 'Greeley', 'Longmont', 'Loveland', 'Fort Collins', 'Broomfield', 'Castle Rock', 'Parker', 'Littleton', 'Englewood', 'Greenwood Village', 'Cherry Hills Village', 'Lone Tree', 'Highlands Ranch', 'Ken Caryl', 'Columbine', 'Morrison', 'Golden', 'Wheat Ridge', 'Edgewater', 'Commerce City', 'Brighton', 'Northglenn', 'Federal Heights', 'Sheridan', 'Glendale', 'Cherry Creek', 'Washington Park', 'Capitol Hill', 'LoDo', 'RiNo', 'Five Points', 'Stapleton', 'Park Hill', 'Montclair', 'Lowry', 'Hampden', 'University Hills', 'Wash Park', 'Platt Park', 'Baker', 'Speer', 'Golden Triangle', 'Congress Park', 'Cheesman Park', 'City Park', 'Cole', 'Elyria-Swansea', 'Globeville', 'Sunnyside', 'Highland', 'Berkeley', 'Regis', 'Chaffee Park', 'Southwest']],

  // Nevada (Pacific Time)
  ['las-vegas', 'Las Vegas', 'Las Vegas', 'Nevada', 'America/Los_Angeles',
    ['Henderson', 'North Las Vegas', 'Paradise', 'Spring Valley', 'Sunrise Manor', 'Enterprise', 'Winchester', 'Summerlin', 'Green Valley', 'Anthem', 'Seven Hills', 'MacDonald Ranch', 'Lake Las Vegas', 'Boulder City', 'Mesquite', 'Laughlin', 'Primm', 'Jean', 'Goodsprings', 'Blue Diamond', 'Red Rock Canyon', 'Mount Charleston']],

  // Massachusetts (Eastern Time)
  ['boston', 'Boston', 'Boston', 'Massachusetts', 'America/New_York',
    ['Cambridge', 'Somerville', 'Brookline', 'Newton', 'Quincy', 'Waltham', 'Medford', 'Malden', 'Revere', 'Chelsea', 'Everett', 'Lynn', 'Salem', 'Peabody', 'Danvers', 'Beverly', 'Marblehead', 'Swampscott', 'Saugus', 'Wakefield', 'Melrose', 'Stoneham', 'Woburn', 'Reading', 'Lexington', 'Arlington', 'Belmont', 'Watertown', 'Wellesley', 'Needham', 'Dedham', 'Milton', 'Braintree', 'Weymouth', 'Hingham', 'Cohasset', 'Scituate', 'Norwell', 'Hanover', 'Rockland', 'Holbrook', 'Randolph', 'Canton', 'Stoughton', 'Sharon', 'Norwood', 'Westwood', 'Dover', 'Natick', 'Framingham', 'Ashland', 'Hopkinton', 'Southborough', 'Westborough', 'Northborough', 'Marlborough', 'Hudson', 'Maynard', 'Stow', 'Acton', 'Concord', 'Lincoln', 'Weston', 'Wayland', 'Sudbury', 'Bedford', 'Burlington', 'Wilmington', 'Tewksbury', 'Lowell', 'Chelmsford', 'Billerica', 'North Andover', 'Andover', 'Lawrence', 'Methuen', 'Haverhill', 'Newburyport', 'Amesbury', 'Salisbury', 'Newbury', 'Rowley', 'Ipswich', 'Essex', 'Gloucester', 'Rockport', 'Manchester-by-the-Sea']],

  // Pennsylvania (Eastern Time)
  ['philadelphia', 'Philadelphia', 'Philadelphia', 'Pennsylvania', 'America/New_York',
    ['Camden', 'Cherry Hill', 'Moorestown', 'Marlton', 'Mount Laurel', 'Voorhees', 'Haddonfield', 'Collingswood', 'Gloucester City', 'Woodbury', 'Deptford', 'Glassboro', 'Vineland', 'Millville', 'Bridgeton', 'Wilmington', 'Newark', 'Elkton', 'Chester', 'Media', 'Springfield', 'Swarthmore', 'Wallingford', 'Ridley Park', 'Norristown', 'King of Prussia', 'Conshohocken', 'West Conshohocken', 'Ardmore', 'Bryn Mawr', 'Haverford', 'Villanova', 'Radnor', 'Wayne', 'Devon', 'Berwyn', 'Malvern', 'Exton', 'West Chester', 'Kennett Square', 'Chadds Ford', 'Glen Mills', 'Phoenixville', 'Pottstown', 'Lansdale', 'North Wales', 'Hatboro', 'Willow Grove', 'Abington', 'Jenkintown', 'Elkins Park', 'Cheltenham', 'Glenside', 'Wyncote', 'Bucks County', 'Doylestown', 'New Hope', 'Newtown', 'Yardley', 'Morrisville', 'Levittown', 'Trenton', 'Princeton', 'Lawrenceville', 'Hamilton', 'Ewing']],

  // Michigan (Eastern Time)
  ['detroit', 'Detroit', 'Detroit', 'Michigan', 'America/Detroit',
    ['Dearborn', 'Warren', 'Sterling Heights', 'Livonia', 'Troy', 'Southfield', 'Farmington Hills', 'West Bloomfield', 'Birmingham', 'Royal Oak', 'Ferndale', 'Berkley', 'Madison Heights', 'Clawson', 'Oak Park', 'Hazel Park', 'Roseville', 'St. Clair Shores', 'Eastpointe', 'Harper Woods', 'Grosse Pointe', 'Grosse Pointe Park', 'Grosse Pointe Woods', 'Grosse Pointe Farms', 'Grosse Pointe Shores', 'Hamtramck', 'Highland Park', 'Redford', 'Plymouth', 'Canton', 'Westland', 'Garden City', 'Inkster', 'Dearborn Heights', 'Taylor', 'Romulus', 'Belleville', 'Ypsilanti', 'Ann Arbor', 'Saline', 'Chelsea', 'Dexter', 'Howell', 'Brighton', 'Novi', 'Northville', 'Walled Lake', 'Commerce Township', 'Waterford', 'Pontiac', 'Auburn Hills', 'Rochester', 'Rochester Hills', 'Shelby Township', 'Utica', 'Clinton Township', 'Mount Clemens', 'Fraser', 'Chesterfield']],

  // Minnesota (Central Time)
  ['minneapolis', 'Minneapolis-St. Paul', 'Minneapolis', 'Minnesota', 'America/Chicago',
    ['St. Paul', 'Bloomington', 'Brooklyn Park', 'Plymouth', 'Maple Grove', 'Woodbury', 'Eagan', 'Burnsville', 'Eden Prairie', 'Minnetonka', 'Edina', 'St. Louis Park', 'Hopkins', 'Richfield', 'Fridley', 'Columbia Heights', 'New Brighton', 'Roseville', 'Shoreview', 'Maplewood', 'Oakdale', 'Stillwater', 'White Bear Lake', 'Hugo', 'Forest Lake', 'Lakeville', 'Apple Valley', 'Rosemount', 'Inver Grove Heights', 'South St. Paul', 'West St. Paul', 'Mendota Heights', 'Cottage Grove', 'Hastings', 'Farmington', 'Prior Lake', 'Savage', 'Shakopee', 'Chanhassen', 'Chaska', 'Victoria', 'Waconia', 'Excelsior', 'Wayzata', 'Orono', 'Long Lake', 'Medina', 'Corcoran', 'Rogers', 'Elk River', 'Anoka', 'Champlin', 'Osseo', 'Brooklyn Center', 'Crystal', 'Golden Valley', 'New Hope', 'Robbinsdale']],

  // Missouri (Central Time)
  ['st-louis', 'St. Louis', 'St. Louis', 'Missouri', 'America/Chicago',
    ['Clayton', 'Ladue', 'Frontenac', 'Town and Country', 'Chesterfield', 'Creve Coeur', 'Maryland Heights', 'Bridgeton', 'Florissant', 'Hazelwood', 'Ferguson', 'University City', 'Maplewood', 'Richmond Heights', 'Brentwood', 'Rock Hill', 'Webster Groves', 'Kirkwood', 'Glendale', 'Crestwood', 'Sunset Hills', 'Fenton', 'Arnold', 'Mehlville', 'Oakville', 'Affton', 'Lemay', 'Concord', 'South County', 'Ballwin', 'Manchester', 'Des Peres', 'Ellisville', 'Wildwood', 'Eureka', 'Pacific', 'St. Charles', 'St. Peters', 'O\'Fallon', 'Wentzville', 'Dardenne Prairie', 'Lake St. Louis', 'Weldon Spring', 'Cottleville', 'Belleville', 'Collinsville', 'Edwardsville', 'Glen Carbon', 'Maryville', 'Granite City', 'Alton', 'Wood River', 'Godfrey', 'Troy', 'Highland']],
  ['kansas-city', 'Kansas City', 'Kansas City', 'Missouri', 'America/Chicago',
    ['Overland Park', 'Olathe', 'Kansas City KS', 'Lee\'s Summit', 'Independence', 'Shawnee', 'Lenexa', 'Leawood', 'Prairie Village', 'Mission', 'Merriam', 'Roeland Park', 'Fairway', 'Mission Hills', 'Westwood', 'Lake Quivira', 'Gardner', 'Spring Hill', 'Paola', 'Ottawa', 'Lawrence', 'Bonner Springs', 'Edwardsville', 'Basehor', 'Tonganoxie', 'Lansing', 'Leavenworth', 'Platte City', 'Smithville', 'Kearney', 'Liberty', 'Gladstone', 'North Kansas City', 'Riverside', 'Parkville', 'Weatherby Lake', 'Blue Springs', 'Grain Valley', 'Oak Grove', 'Raytown', 'Grandview', 'Belton', 'Raymore', 'Peculiar', 'Harrisonville']],

  // Oregon (Pacific Time)
  ['portland', 'Portland', 'Portland', 'Oregon', 'America/Los_Angeles',
    ['Beaverton', 'Hillsboro', 'Tigard', 'Lake Oswego', 'Tualatin', 'West Linn', 'Oregon City', 'Milwaukie', 'Clackamas', 'Happy Valley', 'Damascus', 'Gresham', 'Troutdale', 'Wood Village', 'Fairview', 'Camas', 'Washougal', 'Vancouver', 'Battle Ground', 'Ridgefield', 'La Center', 'Woodland', 'Longview', 'Kelso', 'St. Helens', 'Scappoose', 'Forest Grove', 'Cornelius', 'Banks', 'North Plains', 'Sherwood', 'Wilsonville', 'Canby', 'Molalla', 'Estacada', 'Sandy', 'Boring', 'Gladstone', 'Johnson City', 'Oak Grove', 'Jennings Lodge', 'Sellwood', 'Brooklyn', 'Hawthorne', 'Division', 'Alberta', 'Mississippi', 'St. Johns', 'Kenton', 'Overlook', 'Arbor Lodge', 'Portsmouth', 'University Park', 'Piedmont', 'Woodstock', 'Foster-Powell', 'Lents', 'Montavilla', 'Roseway', 'Cully', 'Parkrose', 'Argay', 'Russell', 'Wilkes', 'Centennial', 'Pleasant Valley', 'Powellhurst-Gilbert', 'Brentwood-Darlington', 'Ardenwald', 'Woodmere']],

  // North Carolina (Eastern Time)
  ['charlotte', 'Charlotte', 'Charlotte', 'North Carolina', 'America/New_York',
    ['Matthews', 'Mint Hill', 'Pineville', 'Ballantyne', 'South Charlotte', 'Steele Creek', 'Fort Mill', 'Rock Hill', 'Indian Land', 'Tega Cay', 'Lake Wylie', 'Gastonia', 'Belmont', 'Mount Holly', 'Huntersville', 'Cornelius', 'Davidson', 'Mooresville', 'Lake Norman', 'Concord', 'Kannapolis', 'Harrisburg', 'Midland', 'Locust', 'Albemarle', 'Monroe', 'Waxhaw', 'Weddington', 'Marvin', 'Wesley Chapel', 'Stallings', 'Indian Trail', 'Hemby Bridge']],
  ['raleigh', 'Raleigh-Durham', 'Raleigh', 'North Carolina', 'America/New_York',
    ['Durham', 'Chapel Hill', 'Cary', 'Apex', 'Holly Springs', 'Fuquay-Varina', 'Garner', 'Clayton', 'Smithfield', 'Selma', 'Wake Forest', 'Rolesville', 'Youngsville', 'Franklinton', 'Louisburg', 'Henderson', 'Oxford', 'Creedmoor', 'Butner', 'Hillsborough', 'Mebane', 'Burlington', 'Graham', 'Carrboro', 'Pittsboro', 'Sanford', 'Southern Pines', 'Pinehurst', 'Aberdeen', 'Morrisville', 'Research Triangle Park', 'RTP']],

  // Tennessee (Central/Eastern Time split - using Nashville's Central)
  ['nashville', 'Nashville', 'Nashville', 'Tennessee', 'America/Chicago',
    ['Franklin', 'Brentwood', 'Murfreesboro', 'Smyrna', 'La Vergne', 'Antioch', 'Hermitage', 'Mount Juliet', 'Lebanon', 'Hendersonville', 'Gallatin', 'Goodlettsville', 'Madison', 'Old Hickory', 'Donelson', 'Belle Meade', 'Green Hills', 'Bellevue', 'Whites Creek', 'Joelton', 'Ashland City', 'Kingston Springs', 'Fairview', 'Spring Hill', 'Thompson\'s Station', 'Nolensville', 'College Grove', 'Eagleville', 'Rockvale', 'Christiana', 'Lascassas', 'Woodbury', 'Shelbyville', 'Tullahoma', 'Manchester', 'McMinnville', 'Cookeville', 'Clarksville', 'Springfield', 'Portland', 'White House', 'Millersville', 'Cross Plains', 'Greenbrier']],

  // Ohio (Eastern Time)
  ['columbus', 'Columbus', 'Columbus', 'Ohio', 'America/New_York',
    ['Dublin', 'Westerville', 'Worthington', 'Upper Arlington', 'Grandview Heights', 'Bexley', 'Whitehall', 'Reynoldsburg', 'Pickerington', 'Gahanna', 'New Albany', 'Powell', 'Delaware', 'Lewis Center', 'Galena', 'Sunbury', 'Johnstown', 'Pataskala', 'Etna', 'Newark', 'Zanesville', 'Lancaster', 'Circleville', 'Grove City', 'Galloway', 'Hilliard', 'Plain City', 'Marysville', 'London', 'Springfield', 'Dayton', 'Kettering', 'Centerville', 'Beavercreek', 'Xenia', 'Fairborn', 'Huber Heights', 'Vandalia', 'Englewood', 'Trotwood', 'West Carrollton']],

  // Indiana (Eastern Time - most of state)
  ['indianapolis', 'Indianapolis', 'Indianapolis', 'Indiana', 'America/Indiana/Indianapolis',
    ['Carmel', 'Fishers', 'Noblesville', 'Westfield', 'Zionsville', 'Brownsburg', 'Avon', 'Plainfield', 'Greenwood', 'Franklin', 'Greenfield', 'New Palestine', 'McCordsville', 'Fortville', 'Pendleton', 'Anderson', 'Muncie', 'Kokomo', 'Lafayette', 'West Lafayette', 'Terre Haute', 'Bloomington', 'Columbus', 'Shelbyville', 'Greensburg', 'Batesville', 'Richmond', 'Connersville', 'Rushville', 'Martinsville', 'Mooresville', 'Danville', 'Crawfordsville', 'Lebanon', 'Frankfort', 'Tipton', 'Elwood', 'Alexandria']],
];

// ═══════════════════════════════════════════════════════════════════════════
// INTERNATIONAL MARKETS
// Format: [market_slug, market_name, primary_city, state/province, timezone, city_aliases, country_code]
// ═══════════════════════════════════════════════════════════════════════════
const internationalMarketsData = [
  // CANADA
  ['toronto', 'Toronto', 'Toronto', 'Ontario', 'America/Toronto',
    ['Mississauga', 'Brampton', 'Markham', 'Vaughan', 'Richmond Hill', 'Oakville', 'Burlington', 'Hamilton', 'Scarborough', 'North York', 'Etobicoke', 'Ajax', 'Pickering', 'Whitby', 'Oshawa', 'Milton', 'Newmarket', 'Aurora', 'King City', 'Thornhill', 'Woodbridge', 'Maple', 'Concord', 'Stouffville', 'Georgetown', 'Halton Hills'], 'CA'],
  ['vancouver', 'Vancouver', 'Vancouver', 'British Columbia', 'America/Vancouver',
    ['Burnaby', 'Surrey', 'Richmond', 'Coquitlam', 'New Westminster', 'North Vancouver', 'West Vancouver', 'Port Moody', 'Port Coquitlam', 'Delta', 'White Rock', 'Langley', 'Abbotsford', 'Maple Ridge', 'Pitt Meadows', 'Tsawwassen', 'Ladner', 'Chilliwack'], 'CA'],
  ['montreal', 'Montreal', 'Montreal', 'Quebec', 'America/Montreal',
    ['Laval', 'Longueuil', 'Brossard', 'Terrebonne', 'Repentigny', 'Saint-Jerome', 'Blainville', 'Mirabel', 'Boisbriand', 'Dollard-des-Ormeaux', 'Pointe-Claire', 'Dorval', 'Lachine', 'Verdun', 'LaSalle', 'Saint-Laurent', 'Anjou', 'Saint-Leonard', 'Westmount', 'Outremont', 'Mont-Royal'], 'CA'],
  ['calgary', 'Calgary', 'Calgary', 'Alberta', 'America/Edmonton',
    ['Airdrie', 'Cochrane', 'Chestermere', 'Okotoks', 'High River', 'Strathmore', 'Canmore', 'Banff'], 'CA'],
  ['edmonton', 'Edmonton', 'Edmonton', 'Alberta', 'America/Edmonton',
    ['St. Albert', 'Sherwood Park', 'Spruce Grove', 'Leduc', 'Fort Saskatchewan', 'Beaumont', 'Devon', 'Stony Plain'], 'CA'],
  ['ottawa', 'Ottawa', 'Ottawa', 'Ontario', 'America/Toronto',
    ['Gatineau', 'Kanata', 'Orleans', 'Barrhaven', 'Nepean', 'Gloucester', 'Hull', 'Aylmer', 'Chelsea'], 'CA'],

  // UNITED KINGDOM
  ['london-uk', 'London', 'London', 'England', 'Europe/London',
    ['Westminster', 'Camden', 'Islington', 'Hackney', 'Tower Hamlets', 'Greenwich', 'Lewisham', 'Southwark', 'Lambeth', 'Wandsworth', 'Hammersmith', 'Kensington', 'Chelsea', 'Fulham', 'Richmond', 'Kingston', 'Merton', 'Sutton', 'Croydon', 'Bromley', 'Bexley', 'Havering', 'Barking', 'Redbridge', 'Newham', 'Walthamstow', 'Enfield', 'Barnet', 'Haringey', 'Brent', 'Ealing', 'Hounslow', 'Hillingdon', 'Harrow', 'Stratford', 'Canary Wharf', 'Shoreditch', 'Brixton', 'Peckham', 'Wimbledon', 'Hampstead', 'Notting Hill'], 'GB'],
  ['manchester', 'Manchester', 'Manchester', 'England', 'Europe/London',
    ['Salford', 'Stockport', 'Trafford', 'Oldham', 'Rochdale', 'Bury', 'Bolton', 'Wigan', 'Tameside', 'Altrincham', 'Sale', 'Stretford', 'Cheadle', 'Didsbury', 'Chorlton', 'Withington', 'Fallowfield', 'Moss Side', 'Hulme', 'Ancoats', 'Northern Quarter'], 'GB'],
  ['birmingham-uk', 'Birmingham', 'Birmingham', 'England', 'Europe/London',
    ['Solihull', 'Wolverhampton', 'Dudley', 'Walsall', 'West Bromwich', 'Sutton Coldfield', 'Coventry', 'Edgbaston', 'Moseley', 'Kings Heath', 'Harborne', 'Selly Oak', 'Erdington', 'Handsworth', 'Small Heath'], 'GB'],
  ['glasgow', 'Glasgow', 'Glasgow', 'Scotland', 'Europe/London',
    ['Paisley', 'East Kilbride', 'Hamilton', 'Clydebank', 'Motherwell', 'Coatbridge', 'Airdrie', 'Kirkintilloch', 'Bearsden', 'Milngavie', 'Rutherglen', 'Cambuslang', 'Bishopbriggs', 'Partick', 'Govan', 'Pollokshields'], 'GB'],
  ['edinburgh', 'Edinburgh', 'Edinburgh', 'Scotland', 'Europe/London',
    ['Leith', 'Portobello', 'Musselburgh', 'Dalkeith', 'Livingston', 'Dunfermline', 'Kirkcaldy', 'Falkirk', 'Morningside', 'Stockbridge', 'New Town', 'Old Town', 'Marchmont', 'Bruntsfield', 'Gorgie'], 'GB'],

  // AUSTRALIA
  ['sydney', 'Sydney', 'Sydney', 'New South Wales', 'Australia/Sydney',
    ['Parramatta', 'Liverpool', 'Penrith', 'Blacktown', 'Chatswood', 'North Sydney', 'Bondi', 'Manly', 'Cronulla', 'Sutherland', 'Hurstville', 'Bankstown', 'Canterbury', 'Strathfield', 'Burwood', 'Ryde', 'Hornsby', 'Castle Hill', 'Campbelltown', 'Camden', 'Wollongong', 'Newcastle', 'Central Coast', 'Gosford', 'Surry Hills', 'Newtown', 'Paddington', 'Darlinghurst', 'Redfern', 'Glebe', 'Pyrmont', 'Ultimo', 'Chippendale'], 'AU'],
  ['melbourne', 'Melbourne', 'Melbourne', 'Victoria', 'Australia/Melbourne',
    ['South Yarra', 'St Kilda', 'Fitzroy', 'Carlton', 'Richmond', 'Prahran', 'Collingwood', 'Brunswick', 'Northcote', 'Footscray', 'Williamstown', 'Brighton', 'Hawthorn', 'Camberwell', 'Box Hill', 'Doncaster', 'Glen Waverley', 'Dandenong', 'Frankston', 'Geelong', 'Ballarat', 'Bendigo', 'Mornington', 'Sunbury', 'Melton', 'Werribee', 'Point Cook', 'Tarneit', 'Craigieburn', 'South Melbourne', 'Docklands', 'Southbank'], 'AU'],
  ['brisbane', 'Brisbane', 'Brisbane', 'Queensland', 'Australia/Brisbane',
    ['Gold Coast', 'Sunshine Coast', 'Ipswich', 'Logan', 'Redlands', 'Moreton Bay', 'Caboolture', 'Redcliffe', 'Toowoomba', 'South Brisbane', 'Fortitude Valley', 'West End', 'Paddington', 'New Farm', 'Bulimba', 'Kangaroo Point', 'Woolloongabba', 'Indooroopilly', 'Chermside', 'Carindale', 'Mount Gravatt', 'Sunnybank', 'Eight Mile Plains'], 'AU'],
  ['perth', 'Perth', 'Perth', 'Western Australia', 'Australia/Perth',
    ['Fremantle', 'Joondalup', 'Rockingham', 'Mandurah', 'Armadale', 'Midland', 'Scarborough', 'Subiaco', 'Claremont', 'Cottesloe', 'Nedlands', 'South Perth', 'Victoria Park', 'Cannington', 'Canning Vale', 'Morley', 'Karrinyup', 'Stirling', 'Balcatta', 'Osborne Park', 'Northbridge', 'Leederville', 'Mount Lawley'], 'AU'],
  ['adelaide', 'Adelaide', 'Adelaide', 'South Australia', 'Australia/Adelaide',
    ['Glenelg', 'Norwood', 'Prospect', 'Unley', 'Burnside', 'Campbelltown', 'Salisbury', 'Tea Tree Gully', 'Marion', 'Port Adelaide', 'North Adelaide', 'Henley Beach', 'Semaphore', 'Brighton', 'Gawler', 'Mount Barker', 'Victor Harbor'], 'AU'],

  // MEXICO
  ['mexico-city', 'Mexico City', 'Mexico City', 'CDMX', 'America/Mexico_City',
    ['Polanco', 'Condesa', 'Roma Norte', 'Roma Sur', 'Coyoacan', 'San Angel', 'Santa Fe', 'Tlalpan', 'Xochimilco', 'Iztapalapa', 'Gustavo A. Madero', 'Azcapotzalco', 'Miguel Hidalgo', 'Cuauhtemoc', 'Benito Juarez', 'Naucalpan', 'Tlalnepantla', 'Ecatepec', 'Nezahualcoyotl', 'Texcoco', 'Cuautitlan Izcalli', 'Toluca', 'Metepec', 'Lerma'], 'MX'],
  ['guadalajara', 'Guadalajara', 'Guadalajara', 'Jalisco', 'America/Mexico_City',
    ['Zapopan', 'Tlaquepaque', 'Tonala', 'Tlajomulco', 'El Salto', 'Juanacatlan', 'Ixtlahuacan', 'Providencia', 'Chapalita', 'Americana', 'Lafayette', 'Colinas de San Javier', 'Puerta de Hierro', 'Andares', 'Valle Real'], 'MX'],
  ['monterrey', 'Monterrey', 'Monterrey', 'Nuevo Leon', 'America/Monterrey',
    ['San Pedro Garza Garcia', 'Santa Catarina', 'Guadalupe', 'Apodaca', 'Escobedo', 'San Nicolas de los Garza', 'Cumbres', 'Valle Oriente', 'Centrito Valle', 'Garza Sada', 'Contry', 'Carretera Nacional', 'Chipinque'], 'MX'],
  ['cancun', 'Cancun', 'Cancun', 'Quintana Roo', 'America/Cancun',
    ['Playa del Carmen', 'Tulum', 'Puerto Morelos', 'Isla Mujeres', 'Cozumel', 'Riviera Maya', 'Hotel Zone', 'Downtown Cancun', 'Puerto Aventuras', 'Akumal'], 'MX'],

  // BRAZIL
  ['sao-paulo', 'Sao Paulo', 'Sao Paulo', 'Sao Paulo', 'America/Sao_Paulo',
    ['Guarulhos', 'Campinas', 'Osasco', 'Santo Andre', 'Sao Bernardo do Campo', 'Sao Caetano do Sul', 'Diadema', 'Maua', 'Mogi das Cruzes', 'Suzano', 'Itaquaquecetuba', 'Barueri', 'Cotia', 'Taboao da Serra', 'Embu das Artes', 'Jardins', 'Pinheiros', 'Vila Madalena', 'Moema', 'Itaim Bibi', 'Vila Olimpia', 'Brooklin', 'Morumbi', 'Butanta', 'Barra Funda', 'Consolacao', 'Higienopolis', 'Perdizes', 'Pompeia', 'Lapa'], 'BR'],
  ['rio-de-janeiro', 'Rio de Janeiro', 'Rio de Janeiro', 'Rio de Janeiro', 'America/Sao_Paulo',
    ['Copacabana', 'Ipanema', 'Leblon', 'Botafogo', 'Flamengo', 'Laranjeiras', 'Catete', 'Gloria', 'Centro', 'Lapa', 'Santa Teresa', 'Tijuca', 'Vila Isabel', 'Meier', 'Barra da Tijuca', 'Recreio', 'Jacarepagua', 'Niteroi', 'Sao Goncalo', 'Duque de Caxias', 'Nova Iguacu', 'Petropolis', 'Teresopolis'], 'BR'],

  // INDIA
  ['delhi', 'Delhi NCR', 'New Delhi', 'Delhi', 'Asia/Kolkata',
    ['Gurgaon', 'Gurugram', 'Noida', 'Greater Noida', 'Faridabad', 'Ghaziabad', 'South Delhi', 'North Delhi', 'East Delhi', 'West Delhi', 'Dwarka', 'Rohini', 'Pitampura', 'Vasant Kunj', 'Saket', 'Hauz Khas', 'Lajpat Nagar', 'Defence Colony', 'Greater Kailash', 'Connaught Place', 'Karol Bagh', 'Rajouri Garden', 'Janakpuri', 'Nehru Place', 'Okhla', 'Indirapuram', 'Vaishali', 'Sector 62', 'Cyber City', 'DLF Phase'], 'IN'],
  ['mumbai', 'Mumbai', 'Mumbai', 'Maharashtra', 'Asia/Kolkata',
    ['Navi Mumbai', 'Thane', 'Andheri', 'Bandra', 'Juhu', 'Powai', 'Goregaon', 'Malad', 'Borivali', 'Kandivali', 'Dahisar', 'Mira Road', 'Vashi', 'Nerul', 'Kharghar', 'Panvel', 'Airoli', 'Belapur', 'Colaba', 'Churchgate', 'Fort', 'Marine Drive', 'Worli', 'Lower Parel', 'Dadar', 'Kurla', 'Chembur', 'Mulund', 'Vikhroli', 'Ghatkopar', 'BKC', 'Santacruz'], 'IN'],
  ['bangalore', 'Bangalore', 'Bangalore', 'Karnataka', 'Asia/Kolkata',
    ['Bengaluru', 'Whitefield', 'Electronic City', 'Koramangala', 'Indiranagar', 'HSR Layout', 'Jayanagar', 'JP Nagar', 'BTM Layout', 'Marathahalli', 'Bellandur', 'Sarjapur', 'Yelahanka', 'Hebbal', 'Malleshwaram', 'Rajajinagar', 'Basavanagudi', 'MG Road', 'Brigade Road', 'UB City', 'Lavelle Road', 'Richmond Town', 'Shivajinagar', 'Majestic', 'Yeshwanthpur', 'Peenya', 'Devanahalli', 'Kempegowda Airport'], 'IN'],
  ['chennai', 'Chennai', 'Chennai', 'Tamil Nadu', 'Asia/Kolkata',
    ['Anna Nagar', 'T. Nagar', 'Adyar', 'Velachery', 'OMR', 'Sholinganallur', 'Perungudi', 'Tambaram', 'Porur', 'Vadapalani', 'Nungambakkam', 'Egmore', 'Mylapore', 'Alwarpet', 'Besant Nagar', 'Thiruvanmiyur', 'ECR', 'Guindy', 'Mount Road', 'Marina Beach', 'Perambur', 'Kolathur', 'Ambattur', 'Avadi', 'Pallavaram', 'Chromepet'], 'IN'],
  ['hyderabad', 'Hyderabad', 'Hyderabad', 'Telangana', 'Asia/Kolkata',
    ['Secunderabad', 'Gachibowli', 'HITEC City', 'Madhapur', 'Kondapur', 'Kukatpally', 'Miyapur', 'Banjara Hills', 'Jubilee Hills', 'Somajiguda', 'Begumpet', 'Ameerpet', 'SR Nagar', 'Punjagutta', 'Himayatnagar', 'Abids', 'Nampally', 'Charminar', 'Dilsukhnagar', 'LB Nagar', 'Uppal', 'Habsiguda', 'Tarnaka', 'Malkajgiri', 'Kompally', 'Shamshabad Airport'], 'IN'],
  ['pune', 'Pune', 'Pune', 'Maharashtra', 'Asia/Kolkata',
    ['Pimpri-Chinchwad', 'Hinjewadi', 'Wakad', 'Baner', 'Aundh', 'Koregaon Park', 'Kalyani Nagar', 'Viman Nagar', 'Kharadi', 'Magarpatta', 'Hadapsar', 'NIBM Road', 'Kondhwa', 'Katraj', 'Sinhagad Road', 'Karve Nagar', 'Kothrud', 'Deccan', 'FC Road', 'JM Road', 'Shivajinagar', 'Camp', 'MG Road Pune'], 'IN'],

  // GERMANY
  ['berlin', 'Berlin', 'Berlin', 'Berlin', 'Europe/Berlin',
    ['Mitte', 'Kreuzberg', 'Prenzlauer Berg', 'Friedrichshain', 'Charlottenburg', 'Schoneberg', 'Neukolln', 'Wedding', 'Moabit', 'Tiergarten', 'Wilmersdorf', 'Steglitz', 'Zehlendorf', 'Spandau', 'Reinickendorf', 'Pankow', 'Lichtenberg', 'Marzahn', 'Treptow', 'Kopenick', 'Tempelhof', 'Alexanderplatz', 'Potsdamer Platz', 'Ku\'damm', 'Hackescher Markt'], 'DE'],
  ['munich', 'Munich', 'Munich', 'Bavaria', 'Europe/Berlin',
    ['Munchen', 'Schwabing', 'Maxvorstadt', 'Bogenhausen', 'Haidhausen', 'Sendling', 'Giesing', 'Pasing', 'Laim', 'Neuhausen', 'Nymphenburg', 'Lehel', 'Isarvorstadt', 'Glockenbachviertel', 'Au', 'Thalkirchen', 'Riem', 'Trudering', 'Berg am Laim', 'Moosach', 'Milbertshofen', 'Freimann', 'Garching', 'Unterschleissheim', 'Freising'], 'DE'],
  ['frankfurt', 'Frankfurt', 'Frankfurt', 'Hesse', 'Europe/Berlin',
    ['Frankfurt am Main', 'Sachsenhausen', 'Nordend', 'Bornheim', 'Bockenheim', 'Westend', 'Gallus', 'Offenbach', 'Bad Homburg', 'Oberursel', 'Eschborn', 'Kronberg', 'Hofheim', 'Hanau', 'Darmstadt', 'Wiesbaden', 'Mainz'], 'DE'],
  ['hamburg', 'Hamburg', 'Hamburg', 'Hamburg', 'Europe/Berlin',
    ['Altona', 'Eimsbuttel', 'Hamburg-Nord', 'Wandsbek', 'Bergedorf', 'Harburg', 'St. Pauli', 'St. Georg', 'Rotherbaum', 'Winterhude', 'Eppendorf', 'Barmbek', 'Ottensen', 'Blankenese', 'Bahrenfeld', 'HafenCity', 'Speicherstadt', 'Sternschanze', 'Neustadt'], 'DE'],

  // FRANCE
  ['paris', 'Paris', 'Paris', 'Ile-de-France', 'Europe/Paris',
    ['La Defense', 'Neuilly-sur-Seine', 'Boulogne-Billancourt', 'Levallois-Perret', 'Issy-les-Moulineaux', 'Montrouge', 'Vanves', 'Malakoff', 'Clamart', 'Meudon', 'Sevres', 'Saint-Cloud', 'Rueil-Malmaison', 'Nanterre', 'Courbevoie', 'Puteaux', 'Suresnes', 'Colombes', 'Asnieres-sur-Seine', 'Clichy', 'Saint-Ouen', 'Saint-Denis', 'Aubervilliers', 'Pantin', 'Le Pre-Saint-Gervais', 'Les Lilas', 'Bagnolet', 'Montreuil', 'Vincennes', 'Nogent-sur-Marne', 'Joinville-le-Pont', 'Saint-Mande', 'Charenton-le-Pont', 'Ivry-sur-Seine', 'Kremlin-Bicetre', 'Villejuif', 'Le Marais', 'Montmartre', 'Champs-Elysees', 'Saint-Germain', 'Bastille', 'Belleville', 'Oberkampf', 'Republique'], 'FR'],

  // SPAIN
  ['madrid', 'Madrid', 'Madrid', 'Community of Madrid', 'Europe/Madrid',
    ['Salamanca', 'Chamberi', 'Retiro', 'Chamartin', 'Centro', 'Arganzuela', 'Moncloa', 'Latina', 'Carabanchel', 'Usera', 'Puente de Vallecas', 'Moratalaz', 'Ciudad Lineal', 'Hortaleza', 'Fuencarral', 'Tetuan', 'Alcobendas', 'San Sebastian de los Reyes', 'Las Rozas', 'Majadahonda', 'Pozuelo de Alarcon', 'Getafe', 'Leganes', 'Alcorcon', 'Mostoles', 'Fuenlabrada', 'Parla', 'Torrejon de Ardoz', 'Alcala de Henares', 'Coslada', 'Rivas-Vaciamadrid', 'Gran Via', 'Sol', 'Malasana', 'Chueca', 'La Latina', 'Lavapies'], 'ES'],
  ['barcelona', 'Barcelona', 'Barcelona', 'Catalonia', 'Europe/Madrid',
    ['Eixample', 'Gracia', 'Sarria-Sant Gervasi', 'Les Corts', 'Sants-Montjuic', 'Nou Barris', 'Sant Andreu', 'Sant Marti', 'Horta-Guinardo', 'Ciutat Vella', 'El Born', 'Barceloneta', 'Raval', 'Gothic Quarter', 'Poblenou', 'Diagonal Mar', 'Vila Olimpica', 'Hospitalet de Llobregat', 'Badalona', 'Santa Coloma', 'Cornella', 'El Prat', 'Castelldefels', 'Sitges', 'Sabadell', 'Terrassa', 'Mataro', 'Granollers'], 'ES'],

  // ITALY
  ['milan', 'Milan', 'Milan', 'Lombardy', 'Europe/Rome',
    ['Milano', 'Monza', 'Bergamo', 'Brescia', 'Como', 'Varese', 'Pavia', 'Lodi', 'Sesto San Giovanni', 'Cinisello Balsamo', 'Rho', 'Legnano', 'Busto Arsizio', 'Gallarate', 'Navigli', 'Brera', 'Porta Romana', 'Isola', 'Porta Venezia', 'Città Studi', 'Porta Nuova', 'Corso Como', 'Duomo', 'Centrale', 'Lambrate'], 'IT'],
  ['rome', 'Rome', 'Rome', 'Lazio', 'Europe/Rome',
    ['Roma', 'Trastevere', 'Testaccio', 'Prati', 'San Giovanni', 'Pigneto', 'Ostiense', 'EUR', 'Monteverde', 'Garbatella', 'Flaminio', 'Trieste', 'Nomentano', 'San Lorenzo', 'Esquilino', 'Termini', 'Centro Storico', 'Vaticano', 'Tivoli', 'Frascati', 'Ostia', 'Fiumicino', 'Ciampino'], 'IT'],

  // NETHERLANDS
  ['amsterdam', 'Amsterdam', 'Amsterdam', 'North Holland', 'Europe/Amsterdam',
    ['Centrum', 'Noord', 'West', 'Nieuw-West', 'Zuid', 'Oost', 'Zuidoost', 'De Pijp', 'Jordaan', 'Oud-West', 'Oud-Zuid', 'Amstelveen', 'Diemen', 'Haarlem', 'Zaandam', 'Hoofddorp', 'Schiphol', 'Almere', 'Hilversum', 'Utrecht', 'Leiden', 'The Hague', 'Rotterdam'], 'NL'],

  // JAPAN
  ['tokyo', 'Tokyo', 'Tokyo', 'Tokyo', 'Asia/Tokyo',
    ['Shibuya', 'Shinjuku', 'Minato', 'Chiyoda', 'Chuo', 'Meguro', 'Setagaya', 'Shinagawa', 'Ota', 'Nakano', 'Suginami', 'Nerima', 'Toshima', 'Bunkyo', 'Taito', 'Sumida', 'Koto', 'Edogawa', 'Katsushika', 'Adachi', 'Itabashi', 'Kita', 'Arakawa', 'Roppongi', 'Ginza', 'Akihabara', 'Harajuku', 'Ebisu', 'Ikebukuro', 'Ueno', 'Asakusa', 'Odaiba', 'Yokohama', 'Kawasaki', 'Chiba', 'Saitama'], 'JP'],
  ['osaka', 'Osaka', 'Osaka', 'Osaka', 'Asia/Tokyo',
    ['Umeda', 'Namba', 'Shinsaibashi', 'Tennoji', 'Shinsekai', 'Dotonbori', 'Kita', 'Minami', 'Yodogawa', 'Higashiyodogawa', 'Nishiyodogawa', 'Konohana', 'Fukushima', 'Nishi', 'Chuo', 'Abeno', 'Sumiyoshi', 'Higashisumiyoshi', 'Hirano', 'Ikuno', 'Joto', 'Tsurumi', 'Asahi', 'Miyakojima', 'Kobe', 'Kyoto', 'Nara', 'Sakai'], 'JP'],

  // SINGAPORE
  ['singapore', 'Singapore', 'Singapore', 'Singapore', 'Asia/Singapore',
    ['Orchard', 'Marina Bay', 'Sentosa', 'Changi', 'Jurong', 'Tampines', 'Bedok', 'Woodlands', 'Yishun', 'Ang Mo Kio', 'Toa Payoh', 'Bishan', 'Serangoon', 'Hougang', 'Punggol', 'Sengkang', 'Bukit Timah', 'Clementi', 'Queenstown', 'Bukit Merah', 'Geylang', 'Kallang', 'Tanjong Pagar', 'Chinatown', 'Little India', 'Bugis', 'Clarke Quay', 'Holland Village', 'Tiong Bahru', 'Dhoby Ghaut'], 'SG'],

  // HONG KONG
  ['hong-kong', 'Hong Kong', 'Hong Kong', 'Hong Kong', 'Asia/Hong_Kong',
    ['Central', 'Wan Chai', 'Causeway Bay', 'North Point', 'Quarry Bay', 'Tai Koo', 'Shau Kei Wan', 'Chai Wan', 'Aberdeen', 'Stanley', 'Repulse Bay', 'Happy Valley', 'Mid-Levels', 'The Peak', 'Kennedy Town', 'Sai Ying Pun', 'Sheung Wan', 'Admiralty', 'Tsim Sha Tsui', 'Jordan', 'Yau Ma Tei', 'Mong Kok', 'Sham Shui Po', 'Kowloon Tong', 'Wong Tai Sin', 'Diamond Hill', 'Kwun Tong', 'Sha Tin', 'Tai Po', 'Fanling', 'Yuen Long', 'Tuen Mun', 'Tsuen Wan', 'Lantau', 'Tung Chung'], 'HK'],

  // SOUTH KOREA
  ['seoul', 'Seoul', 'Seoul', 'Seoul', 'Asia/Seoul',
    ['Gangnam', 'Songpa', 'Seocho', 'Jongno', 'Jung', 'Yongsan', 'Mapo', 'Seodaemun', 'Eunpyeong', 'Nowon', 'Gangbuk', 'Dobong', 'Dongdaemun', 'Jungnang', 'Gwangjin', 'Seongdong', 'Gwanak', 'Dongjak', 'Yeongdeungpo', 'Guro', 'Geumcheon', 'Yangcheon', 'Gangseo', 'Hongdae', 'Itaewon', 'Myeongdong', 'Insadong', 'Bukchon', 'Samcheongdong', 'Apgujeong', 'Cheongdam', 'Sinsa', 'Garosu-gil', 'Incheon'], 'KR'],

  // UAE
  ['dubai', 'Dubai', 'Dubai', 'Dubai', 'Asia/Dubai',
    ['Downtown Dubai', 'Dubai Marina', 'JBR', 'Palm Jumeirah', 'Business Bay', 'DIFC', 'Deira', 'Bur Dubai', 'Jumeirah', 'Al Barsha', 'Al Quoz', 'Sheikh Zayed Road', 'Internet City', 'Media City', 'Knowledge Village', 'JLT', 'Sports City', 'Motor City', 'Arabian Ranches', 'The Springs', 'The Meadows', 'Emirates Hills', 'Dubai Hills', 'Mirdif', 'Al Nahda', 'Al Rashidiya', 'Festival City', 'Silicon Oasis', 'Academic City', 'International City', 'Discovery Gardens', 'Jumeirah Village Circle', 'Jumeirah Village Triangle'], 'AE'],
  ['abu-dhabi', 'Abu Dhabi', 'Abu Dhabi', 'Abu Dhabi', 'Asia/Dubai',
    ['Al Reem Island', 'Saadiyat Island', 'Yas Island', 'Al Maryah Island', 'Corniche', 'Tourist Club Area', 'Electra Street', 'Hamdan Street', 'Al Khalidiyah', 'Al Bateen', 'Al Mushrif', 'Al Karamah', 'Al Nahyan', 'Al Muroor', 'Khalifa City', 'Mohammed Bin Zayed City', 'Musaffah', 'Al Raha Beach', 'Al Reef'], 'AE'],

  // SOUTH AFRICA
  ['johannesburg', 'Johannesburg', 'Johannesburg', 'Gauteng', 'Africa/Johannesburg',
    ['Sandton', 'Rosebank', 'Melrose', 'Hyde Park', 'Morningside', 'Illovo', 'Parkhurst', 'Parktown', 'Braamfontein', 'Newtown', 'Maboneng', 'Fourways', 'Midrand', 'Centurion', 'Pretoria', 'Randburg', 'Roodepoort', 'Soweto', 'Alexandra', 'Kempton Park', 'Bedfordview', 'Edenvale', 'Germiston', 'Boksburg', 'Benoni', 'Springs'], 'ZA'],
  ['cape-town', 'Cape Town', 'Cape Town', 'Western Cape', 'Africa/Johannesburg',
    ['City Bowl', 'Gardens', 'Tamboerskloof', 'Sea Point', 'Green Point', 'Waterfront', 'Camps Bay', 'Clifton', 'Bantry Bay', 'Mouille Point', 'De Waterkant', 'Bo-Kaap', 'Woodstock', 'Observatory', 'Salt River', 'Claremont', 'Newlands', 'Rondebosch', 'Constantia', 'Hout Bay', 'Llandudno', 'Noordhoek', 'Fish Hoek', 'Simons Town', 'Muizenberg', 'Kalk Bay', 'Century City', 'Bellville', 'Durbanville', 'Stellenbosch', 'Paarl', 'Franschhoek'], 'ZA'],

  // ARGENTINA
  ['buenos-aires', 'Buenos Aires', 'Buenos Aires', 'Buenos Aires', 'America/Argentina/Buenos_Aires',
    ['Palermo', 'Recoleta', 'Belgrano', 'Nunez', 'Puerto Madero', 'San Telmo', 'La Boca', 'Microcentro', 'Retiro', 'Barrio Norte', 'Villa Crespo', 'Colegiales', 'Chacarita', 'Villa Urquiza', 'Saavedra', 'Devoto', 'Caballito', 'Almagro', 'Boedo', 'San Cristobal', 'Constitucion', 'Flores', 'Floresta', 'Liniers', 'Mataderos', 'Villa Lugano', 'Tigre', 'San Isidro', 'Vicente Lopez', 'Olivos', 'Martinez', 'La Plata', 'Quilmes', 'Lomas de Zamora', 'Avellaneda', 'Lanus'], 'AR'],

  // CHILE
  ['santiago', 'Santiago', 'Santiago', 'Santiago Metropolitan', 'America/Santiago',
    ['Providencia', 'Las Condes', 'Vitacura', 'Lo Barnechea', 'Nunoa', 'La Reina', 'Penalolen', 'Macul', 'San Miguel', 'San Joaquin', 'La Florida', 'Puente Alto', 'Maipu', 'Pudahuel', 'Cerrillos', 'Lo Prado', 'Quinta Normal', 'Renca', 'Conchali', 'Recoleta', 'Independencia', 'Santiago Centro', 'Estacion Central', 'Pedro Aguirre Cerda', 'San Ramon', 'La Granja', 'El Bosque', 'La Pintana', 'San Bernardo', 'Colina', 'Lampa', 'Quilicura', 'Huechuraba'], 'CL'],

  // COLOMBIA
  ['bogota', 'Bogota', 'Bogota', 'Cundinamarca', 'America/Bogota',
    ['Chapinero', 'Usaquen', 'Suba', 'Engativa', 'Fontibon', 'Kennedy', 'Bosa', 'Ciudad Bolivar', 'Tunjuelito', 'Puente Aranda', 'Teusaquillo', 'Barrios Unidos', 'Santa Fe', 'La Candelaria', 'Los Martires', 'Antonio Narino', 'Rafael Uribe Uribe', 'San Cristobal', 'Usme', 'Sumapaz', 'Zona Rosa', 'Parque 93', 'Zona G', 'Zona T', 'La Macarena', 'Chia', 'Cajica', 'Zipaquira', 'Soacha', 'Cota', 'Tenjo'], 'CO'],
  ['medellin', 'Medellin', 'Medellin', 'Antioquia', 'America/Bogota',
    ['El Poblado', 'Laureles', 'Estadio', 'Envigado', 'Sabaneta', 'Itagui', 'Bello', 'La Estrella', 'Caldas', 'Copacabana', 'Girardota', 'Barbosa', 'Centro', 'La Candelaria', 'Buenos Aires', 'Boston', 'Prado', 'Aranjuez', 'Manrique', 'Popular', 'Santa Cruz', 'Robledo', 'Castilla', 'Doce de Octubre', 'Belen', 'Guayabal', 'San Javier'], 'CO'],

  // PERU
  ['lima', 'Lima', 'Lima', 'Lima', 'America/Lima',
    ['Miraflores', 'San Isidro', 'Barranco', 'Surco', 'La Molina', 'San Borja', 'Magdalena', 'Pueblo Libre', 'Jesus Maria', 'Lince', 'San Miguel', 'Breña', 'Cercado de Lima', 'Rimac', 'La Victoria', 'San Luis', 'Ate', 'Santa Anita', 'El Agustino', 'San Juan de Lurigancho', 'Comas', 'Los Olivos', 'San Martin de Porres', 'Independencia', 'Callao', 'La Perla', 'Bellavista', 'Carmen de la Legua', 'Chorrillos', 'Villa El Salvador', 'Villa Maria del Triunfo', 'San Juan de Miraflores'], 'PE'],

  // THAILAND
  ['bangkok', 'Bangkok', 'Bangkok', 'Bangkok', 'Asia/Bangkok',
    ['Sukhumvit', 'Silom', 'Sathorn', 'Siam', 'Ratchathewi', 'Phaya Thai', 'Ari', 'Chatuchak', 'Lat Phrao', 'Ramkhamhaeng', 'On Nut', 'Ekkamai', 'Thong Lor', 'Asok', 'Nana', 'Phrom Phong', 'Ploenchit', 'Chit Lom', 'Siam Square', 'Pratunam', 'Ratchaprasong', 'Bang Rak', 'Yaowarat', 'Khao San', 'Rattanakosin', 'Thonburi', 'Bang Na', 'Bearing', 'Samut Prakan', 'Nonthaburi', 'Pak Kret', 'Don Mueang', 'Suvarnabhumi'], 'TH'],

  // INDONESIA
  ['jakarta', 'Jakarta', 'Jakarta', 'Jakarta', 'Asia/Jakarta',
    ['Central Jakarta', 'South Jakarta', 'North Jakarta', 'West Jakarta', 'East Jakarta', 'Menteng', 'Kuningan', 'Sudirman', 'Thamrin', 'Senayan', 'Kemang', 'Pondok Indah', 'Kebayoran Baru', 'Tebet', 'Cikini', 'Kota Tua', 'Kelapa Gading', 'Sunter', 'Pluit', 'Pantai Indah Kapuk', 'Tangerang', 'BSD City', 'Serpong', 'Bekasi', 'Depok', 'Bogor', 'Tangerang Selatan', 'Bintaro'], 'ID'],

  // MALAYSIA
  ['kuala-lumpur', 'Kuala Lumpur', 'Kuala Lumpur', 'Kuala Lumpur', 'Asia/Kuala_Lumpur',
    ['KLCC', 'Bukit Bintang', 'Bangsar', 'Mont Kiara', 'Damansara Heights', 'Sri Hartamas', 'Desa ParkCity', 'Kepong', 'Sentul', 'Setapak', 'Wangsa Maju', 'Ampang', 'Cheras', 'Sri Petaling', 'Bukit Jalil', 'Puchong', 'Subang Jaya', 'Petaling Jaya', 'Shah Alam', 'Klang', 'Cyberjaya', 'Putrajaya', 'Kajang', 'Bangi', 'Seri Kembangan', 'Sunway', 'USJ', 'SS2', 'Damansara Utama', 'Mutiara Damansara', 'Kota Damansara'], 'MY'],

  // PHILIPPINES
  ['manila', 'Manila', 'Manila', 'Metro Manila', 'Asia/Manila',
    ['Makati', 'BGC', 'Taguig', 'Pasig', 'Ortigas', 'Quezon City', 'Mandaluyong', 'San Juan', 'Pasay', 'Paranaque', 'Las Pinas', 'Muntinlupa', 'Alabang', 'Caloocan', 'Malabon', 'Navotas', 'Valenzuela', 'Marikina', 'Antipolo', 'Cainta', 'Taytay', 'Ermita', 'Malate', 'Intramuros', 'Binondo', 'Quiapo', 'Sampaloc', 'Sta. Cruz', 'Tondo', 'Greenhills', 'Eastwood', 'Libis', 'Ayala Center', 'Rockwell', 'Fort Bonifacio', 'McKinley Hill', 'Mall of Asia'], 'PH'],

  // VIETNAM
  ['ho-chi-minh', 'Ho Chi Minh City', 'Ho Chi Minh City', 'Ho Chi Minh City', 'Asia/Ho_Chi_Minh',
    ['Saigon', 'District 1', 'District 2', 'District 3', 'District 4', 'District 5', 'District 6', 'District 7', 'District 8', 'District 9', 'District 10', 'District 11', 'District 12', 'Binh Thanh', 'Go Vap', 'Phu Nhuan', 'Tan Binh', 'Tan Phu', 'Binh Tan', 'Thu Duc', 'Binh Chanh', 'Can Gio', 'Cu Chi', 'Hoc Mon', 'Nha Be', 'Ben Thanh', 'Pham Ngu Lao', 'Thao Dien', 'An Phu', 'Phu My Hung'], 'VN'],
  ['hanoi', 'Hanoi', 'Hanoi', 'Hanoi', 'Asia/Ho_Chi_Minh',
    ['Hoan Kiem', 'Ba Dinh', 'Dong Da', 'Hai Ba Trung', 'Cau Giay', 'Thanh Xuan', 'Hoang Mai', 'Long Bien', 'Tay Ho', 'Ha Dong', 'Nam Tu Liem', 'Bac Tu Liem', 'Old Quarter', 'West Lake', 'French Quarter', 'Kim Ma', 'My Dinh', 'Trung Hoa', 'Times City', 'Royal City', 'Vincom', 'Noi Bai'], 'VN'],

  // ISRAEL
  ['tel-aviv', 'Tel Aviv', 'Tel Aviv', 'Tel Aviv', 'Asia/Jerusalem',
    ['Jaffa', 'Florentin', 'Neve Tzedek', 'Rothschild', 'Ramat Aviv', 'Herzliya', 'Ramat HaSharon', 'Givatayim', 'Bnei Brak', 'Petah Tikva', 'Bat Yam', 'Holon', 'Rishon LeZion', 'Netanya', 'Haifa', 'Jerusalem', 'Kfar Saba', 'Ra\'anana', 'Hod HaSharon', 'Kiryat Ono', 'Or Yehuda', 'Yehud'], 'IL'],

  // TURKEY
  ['istanbul', 'Istanbul', 'Istanbul', 'Istanbul', 'Europe/Istanbul',
    ['Kadikoy', 'Besiktas', 'Sisli', 'Beyoglu', 'Uskudar', 'Fatih', 'Bakirkoy', 'Bahcelievler', 'Bagcilar', 'Kucukcekmece', 'Esenyurt', 'Beylikduzu', 'Avcilar', 'Zeytinburnu', 'Eyupsultan', 'Sariyer', 'Beykoz', 'Atasehir', 'Maltepe', 'Pendik', 'Kartal', 'Sultanbeyli', 'Umraniye', 'Cekmekoy', 'Taksim', 'Nisantasi', 'Levent', 'Maslak', 'Bebek', 'Ortakoy', 'Karakoy', 'Galata', 'Sultanahmet', 'Eminonu'], 'TR'],

  // POLAND
  ['warsaw', 'Warsaw', 'Warsaw', 'Masovia', 'Europe/Warsaw',
    ['Warszawa', 'Srodmiescie', 'Mokotow', 'Ursynow', 'Wilanow', 'Wola', 'Ochota', 'Zoliborz', 'Bielany', 'Bemowo', 'Targowek', 'Praga Polnoc', 'Praga Poludnie', 'Rembertow', 'Wawer', 'Wesola', 'Ursus', 'Wlochy', 'Nowy Swiat', 'Stare Miasto', 'Powisle', 'Lazienki', 'Kabaty'], 'PL'],

  // CZECH REPUBLIC
  ['prague', 'Prague', 'Prague', 'Prague', 'Europe/Prague',
    ['Praha', 'Praha 1', 'Praha 2', 'Praha 3', 'Praha 4', 'Praha 5', 'Praha 6', 'Praha 7', 'Praha 8', 'Praha 9', 'Praha 10', 'Vinohrady', 'Zizkov', 'Smichov', 'Karlin', 'Holesovice', 'Letna', 'Dejvice', 'Stare Mesto', 'Nove Mesto', 'Mala Strana', 'Hradcany', 'Josefov', 'Nusle', 'Vrsovice', 'Branik', 'Modřany', 'Barrandov'], 'CZ'],

  // AUSTRIA
  ['vienna', 'Vienna', 'Vienna', 'Vienna', 'Europe/Vienna',
    ['Wien', 'Innere Stadt', 'Leopoldstadt', 'Landstrasse', 'Wieden', 'Margareten', 'Mariahilf', 'Neubau', 'Josefstadt', 'Alsergrund', 'Favoriten', 'Simmering', 'Meidling', 'Hietzing', 'Penzing', 'Rudolfsheim-Funfhaus', 'Ottakring', 'Hernals', 'Wahring', 'Dobling', 'Brigittenau', 'Floridsdorf', 'Donaustadt', 'Liesing', 'Stephansplatz', 'Schonbrunn', 'Prater'], 'AT'],

  // PORTUGAL
  ['lisbon', 'Lisbon', 'Lisbon', 'Lisbon', 'Europe/Lisbon',
    ['Lisboa', 'Baixa', 'Chiado', 'Bairro Alto', 'Alfama', 'Mouraria', 'Graca', 'Belem', 'Alcantara', 'Santos', 'Lapa', 'Estrela', 'Principe Real', 'Campo de Ourique', 'Avenidas Novas', 'Parque das Nacoes', 'Expo', 'Benfica', 'Lumiar', 'Alvalade', 'Areeiro', 'Arroios', 'Marvila', 'Beato', 'Olivais', 'Cascais', 'Estoril', 'Sintra', 'Oeiras', 'Amadora', 'Almada', 'Setúbal'], 'PT'],

  // IRELAND
  ['dublin', 'Dublin', 'Dublin', 'Dublin', 'Europe/Dublin',
    ['Dublin 1', 'Dublin 2', 'Dublin 3', 'Dublin 4', 'Dublin 5', 'Dublin 6', 'Dublin 7', 'Dublin 8', 'Dublin 9', 'Dublin 10', 'Dublin 11', 'Dublin 12', 'Dublin 13', 'Dublin 14', 'Dublin 15', 'Dublin 16', 'Dublin 17', 'Dublin 18', 'Dun Laoghaire', 'Blackrock', 'Dalkey', 'Howth', 'Malahide', 'Swords', 'Blanchardstown', 'Tallaght', 'Lucan', 'Clondalkin', 'Dundrum', 'Rathmines', 'Ranelagh', 'Ballsbridge', 'Sandyford', 'Stillorgan', 'Booterstown', 'Sandymount', 'Temple Bar', 'Grafton Street'], 'IE'],

  // NEW ZEALAND
  ['auckland', 'Auckland', 'Auckland', 'Auckland', 'Pacific/Auckland',
    ['Auckland CBD', 'Ponsonby', 'Grey Lynn', 'Parnell', 'Newmarket', 'Remuera', 'Epsom', 'Mt Eden', 'Kingsland', 'Mt Albert', 'Sandringham', 'New Lynn', 'Henderson', 'Titirangi', 'Devonport', 'Takapuna', 'Milford', 'Albany', 'North Shore', 'East Auckland', 'Howick', 'Pakuranga', 'Botany', 'Manukau', 'Papakura', 'Pukekohe', 'Mission Bay', 'St Heliers', 'Kohimarama', 'Orakei', 'Ellerslie', 'Penrose', 'Onehunga', 'Mt Roskill', 'Avondale'], 'NZ'],
  ['wellington', 'Wellington', 'Wellington', 'Wellington', 'Pacific/Auckland',
    ['Wellington CBD', 'Te Aro', 'Cuba Street', 'Thorndon', 'Kelburn', 'Karori', 'Wadestown', 'Northland', 'Khandallah', 'Ngaio', 'Crofton Downs', 'Johnsonville', 'Newlands', 'Churton Park', 'Tawa', 'Porirua', 'Petone', 'Lower Hutt', 'Upper Hutt', 'Eastbourne', 'Miramar', 'Kilbirnie', 'Lyall Bay', 'Island Bay', 'Newtown', 'Brooklyn', 'Mt Victoria', 'Oriental Bay', 'Seatoun', 'Hataitai'], 'NZ'],

  // EGYPT
  ['cairo', 'Cairo', 'Cairo', 'Cairo Governorate', 'Africa/Cairo',
    ['Downtown Cairo', 'Zamalek', 'Maadi', 'Heliopolis', 'Nasr City', 'New Cairo', '6th of October', 'Sheikh Zayed', 'Mohandessin', 'Dokki', 'Agouza', 'Garden City', 'Giza', 'Haram', 'Faisal', 'Shubra', 'Ain Shams', 'El Matariya', 'El Marg', 'Shorouk City', 'Rehab City', 'Tagamoa', 'Katameya', 'Mokattam', 'Sayeda Zeinab', 'El Azhar', 'Khan el-Khalili', 'Islamic Cairo', 'Coptic Cairo'], 'EG'],

  // NIGERIA
  ['lagos', 'Lagos', 'Lagos', 'Lagos', 'Africa/Lagos',
    ['Victoria Island', 'Ikoyi', 'Lekki', 'Ajah', 'Ikeja', 'Maryland', 'Yaba', 'Surulere', 'Festac', 'Apapa', 'Oshodi', 'Mushin', 'Somolu', 'Gbagada', 'Magodo', 'Ojodu', 'Ogba', 'Agege', 'Alimosho', 'Ikorodu', 'Epe', 'Badagry', 'Lagos Island', 'Marina', 'Broad Street', 'Tinubu', 'CMS', 'Onikan', 'Idumota', 'Balogun', 'Eko Atlantic'], 'NG'],

  // KENYA
  ['nairobi', 'Nairobi', 'Nairobi', 'Nairobi', 'Africa/Nairobi',
    ['Westlands', 'Kilimani', 'Kileleshwa', 'Lavington', 'Karen', 'Langata', 'Hurlingham', 'Upperhill', 'CBD', 'Parklands', 'Muthaiga', 'Runda', 'Gigiri', 'Spring Valley', 'Riverside', 'Ngong Road', 'Kenyatta Market', 'Kibera', 'Eastleigh', 'Embakasi', 'Umoja', 'Kayole', 'Ruaka', 'Ruiru', 'Juja', 'Thika', 'Kitengela', 'Athi River', 'Syokimau', 'Mlolongo'], 'KE'],

  // MOROCCO
  ['casablanca', 'Casablanca', 'Casablanca', 'Casablanca-Settat', 'Africa/Casablanca',
    ['Anfa', 'Racine', 'Maarif', 'Gauthier', 'Bourgogne', 'Ain Diab', 'Corniche', 'Oasis', 'California', 'Sidi Maarouf', 'Bouskoura', 'Ain Sebaa', 'Hay Mohammadi', 'Sidi Bernoussi', 'Ben M\'Sick', 'Sidi Othmane', 'Medina', 'Habous', 'Ain Chock', 'Hay Hassani', 'Moulay Rachid', 'Morocco Mall', 'Marina'], 'MA'],
];

async function seedMarkets() {
  const client = await pool.connect();

  try {
    console.log('🌍 Seeding markets table...\n');

    // Upsert markets
    let inserted = 0;
    let updated = 0;

    // Seed US markets
    console.log('🇺🇸 US Markets:');
    for (const [market_slug, market_name, primary_city, state, timezone, city_aliases] of marketsData) {
      const result = await client.query(`
        INSERT INTO markets (
          market_slug, market_name, primary_city, state, country_code,
          timezone, city_aliases, has_uber, has_lyft, is_active
        )
        VALUES ($1, $2, $3, $4, 'US', $5, $6, true, true, true)
        ON CONFLICT (market_slug) DO UPDATE SET
          market_name = EXCLUDED.market_name,
          primary_city = EXCLUDED.primary_city,
          state = EXCLUDED.state,
          timezone = EXCLUDED.timezone,
          city_aliases = EXCLUDED.city_aliases,
          updated_at = NOW()
        RETURNING (xmax = 0) as inserted
      `, [market_slug, market_name, primary_city, state, timezone, JSON.stringify(city_aliases)]);

      if (result.rows[0]?.inserted) {
        inserted++;
        console.log(`  ✅ Added: ${market_name} (${timezone})`);
      } else {
        updated++;
        console.log(`  🔄 Updated: ${market_name}`);
      }
    }

    // Seed international markets
    console.log('\n🌐 International Markets:');
    for (const [market_slug, market_name, primary_city, state, timezone, city_aliases, country_code] of internationalMarketsData) {
      const result = await client.query(`
        INSERT INTO markets (
          market_slug, market_name, primary_city, state, country_code,
          timezone, city_aliases, has_uber, has_lyft, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, true, true, true)
        ON CONFLICT (market_slug) DO UPDATE SET
          market_name = EXCLUDED.market_name,
          primary_city = EXCLUDED.primary_city,
          state = EXCLUDED.state,
          country_code = EXCLUDED.country_code,
          timezone = EXCLUDED.timezone,
          city_aliases = EXCLUDED.city_aliases,
          updated_at = NOW()
        RETURNING (xmax = 0) as inserted
      `, [market_slug, market_name, primary_city, state, country_code, timezone, JSON.stringify(city_aliases)]);

      if (result.rows[0]?.inserted) {
        inserted++;
        console.log(`  ✅ Added: ${market_name}, ${country_code} (${timezone})`);
      } else {
        updated++;
        console.log(`  🔄 Updated: ${market_name}, ${country_code}`);
      }
    }

    console.log(`\n✅ Markets seeded: ${inserted} inserted, ${updated} updated`);
    console.log(`🌐 Total markets: ${marketsData.length}`);

    // Show summary by timezone
    const summary = await client.query(`
      SELECT timezone, COUNT(*) as market_count
      FROM markets
      GROUP BY timezone
      ORDER BY market_count DESC
    `);

    console.log('\n📈 Markets by Timezone:');
    for (const row of summary.rows) {
      console.log(`   ${row.timezone}: ${row.market_count} markets`);
    }

    // Count total city aliases
    const aliasCount = await client.query(`
      SELECT SUM(jsonb_array_length(city_aliases)) as total_aliases
      FROM markets
      WHERE city_aliases IS NOT NULL
    `);
    console.log(`\n📍 Total city aliases for matching: ${aliasCount.rows[0].total_aliases || 0}`);

  } catch (error) {
    console.error('❌ Error seeding markets:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedMarkets()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed to seed markets:', error);
    process.exit(1);
  });
