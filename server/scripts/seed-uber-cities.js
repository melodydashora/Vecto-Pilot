/**
 * Seed script for Uber cities data
 * Populates the platform_data table with Uber coverage data
 *
 * Run: node server/scripts/seed-uber-cities.js
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Uber cities data organized by country
// Total: 16,312 cities across 75 countries
const uberCitiesData = {
  "Andorra": {
    cities: ["Andorra"]
  },
  "Argentina": {
    cities: ["Bahía Blanca", "Buenos Aires", "Córdoba", "Mar del Plata", "Mendoza", "Neuquén", "Paraná", "Posadas", "Resistencia", "Rosario", "Salta", "San Juan", "San Luis", "San Miguel de Tucumán", "San Rafael", "Santa Fe", "Santiago del Estero", "Corrientes", "La Rioja", "Rio Cuarto"]
  },
  "Australia": {
    states: {
      "Australian Capital Territory": ["Canberra"],
      "New South Wales": ["Albury", "Bathurst", "Blue Mountains", "Byron Bay", "Central Coast", "Coffs Harbour", "Dubbo", "Hunter Region", "Lismore", "Nowra", "Orange", "Port Macquarie", "Southern Highlands", "Sydney", "Tamworth", "Tweed Heads", "Wagga Wagga", "Wollongong"],
      "Northern Territory": ["Alice Springs", "Darwin"],
      "Queensland": ["Brisbane", "Bundaberg", "Cairns", "Gladstone", "Gold Coast", "Hervey Bay", "Mackay", "Rockhampton", "Sunshine Coast", "Toowoomba", "Townsville"],
      "South Australia": ["Adelaide", "Barossa", "Fleurieu Peninsula", "Port Lincoln", "Whyalla"],
      "Tasmania": ["Hobart", "Launceston"],
      "Victoria": ["Ballarat", "Bendigo", "Geelong", "Gippsland", "Melbourne", "Mildura", "Shepparton", "Warrnambool"],
      "Western Australia": ["Bunbury", "Geraldton", "Kalgoorlie", "Perth"]
    }
  },
  "Austria": {
    cities: ["Graz", "Innsbruck", "Klagenfurt", "Linz", "Salzburg", "Vienna"]
  },
  "Bahrain": {
    cities: ["Bahrain"]
  },
  "Bangladesh": {
    cities: ["Chattogram", "Dhaka", "Gazipur", "Narayanganj", "Sylhet"]
  },
  "Barbados": {
    cities: ["Barbados"]
  },
  "Belgium": {
    cities: ["Antwerp", "Brussels", "Charleroi", "Ghent", "Liège", "Mons"]
  },
  "Bolivia": {
    cities: ["Cochabamba", "La Paz", "Santa Cruz"]
  },
  "Brazil": {
    states: {
      "Amazonas": ["Manaus"],
      "Bahia": ["Feira de Santana", "Salvador", "Vitória da Conquista"],
      "Ceará": ["Fortaleza", "Juazeiro do Norte", "Sobral"],
      "Distrito Federal": ["Brasília"],
      "Espírito Santo": ["Vitória"],
      "Goiás": ["Anápolis", "Goiânia"],
      "Maranhão": ["Imperatriz", "São Luís"],
      "Mato Grosso": ["Cuiabá", "Rondonópolis", "Sinop", "Várzea Grande"],
      "Mato Grosso do Sul": ["Campo Grande", "Dourados"],
      "Minas Gerais": ["Belo Horizonte", "Governador Valadares", "Juiz de Fora", "Montes Claros", "Poços de Caldas", "Uberaba", "Uberlândia", "Varginha"],
      "Pará": ["Belém"],
      "Paraíba": ["Campina Grande", "João Pessoa"],
      "Paraná": ["Cascavel", "Curitiba", "Foz do Iguaçu", "Londrina", "Maringá", "Ponta Grossa"],
      "Pernambuco": ["Recife"],
      "Piauí": ["Teresina"],
      "Rio de Janeiro": ["Cabo Frio", "Campos", "Macaé", "Petrópolis", "Rio de Janeiro"],
      "Rio Grande do Norte": ["Mossoró", "Natal"],
      "Rio Grande do Sul": ["Caxias do Sul", "Novo Hamburgo", "Passo Fundo", "Pelotas", "Porto Alegre", "Santa Maria"],
      "Rondônia": ["Porto Velho"],
      "Santa Catarina": ["Balneário Camboriú", "Blumenau", "Chapecó", "Criciúma", "Florianópolis", "Itajaí", "Joinville"],
      "São Paulo": ["Campinas", "Guarujá", "Jundiaí", "Marília", "Piracicaba", "Presidente Prudente", "Ribeirão Preto", "Santos", "São Carlos", "São José do Rio Preto", "São José dos Campos", "São Paulo", "Sorocaba", "Taubaté"],
      "Sergipe": ["Aracaju"],
      "Tocantins": ["Palmas"]
    }
  },
  "Canada": {
    states: {
      "Alberta": ["Airdrie", "Banff", "Calgary", "Canmore", "Cochrane", "Edmonton", "Fort McMurray", "Grande Prairie", "Leduc", "Lethbridge", "Medicine Hat", "Okotoks", "Red Deer", "Spruce Grove", "St. Albert"],
      "British Columbia": ["Abbotsford", "Campbell River", "Chilliwack", "Courtenay", "Cranbrook", "Kamloops", "Kelowna", "Langford", "Langley", "Nanaimo", "Penticton", "Port Coquitlam", "Prince George", "Richmond", "Surrey", "Vancouver", "Vernon", "Victoria", "Whistler"],
      "Manitoba": ["Brandon", "Winnipeg"],
      "New Brunswick": ["Fredericton", "Moncton", "Saint John"],
      "Newfoundland and Labrador": ["St. John's"],
      "Nova Scotia": ["Halifax", "Sydney"],
      "Ontario": ["Barrie", "Belleville", "Brampton", "Brantford", "Burlington", "Cambridge", "Chatham-Kent", "Cornwall", "Guelph", "Hamilton", "Kingston", "Kitchener", "London", "Markham", "Mississauga", "Newmarket", "Niagara Falls", "North Bay", "Oakville", "Oshawa", "Ottawa", "Owen Sound", "Peterborough", "Pickering", "Richmond Hill", "Sarnia", "Sault Ste. Marie", "St. Catharines", "Sudbury", "Thunder Bay", "Toronto", "Vaughan", "Waterloo", "Whitby", "Windsor"],
      "Prince Edward Island": ["Charlottetown"],
      "Quebec": ["Gatineau", "Laval", "Lévis", "Longueuil", "Montreal", "Quebec City", "Saguenay", "Sherbrooke", "Trois-Rivières"],
      "Saskatchewan": ["Regina", "Saskatoon"]
    }
  },
  "Chile": {
    cities: ["Antofagasta", "Arica", "Chillán", "Concepción", "Copiapó", "Coquimbo", "Iquique", "La Serena", "Los Ángeles", "Osorno", "Puerto Montt", "Punta Arenas", "Rancagua", "Santiago", "Talca", "Temuco", "Valdivia", "Valparaíso", "Viña del Mar"]
  },
  "Colombia": {
    cities: ["Armenia", "Barranquilla", "Bucaramanga", "Cali", "Cartagena", "Cúcuta", "Ibagué", "Manizales", "Medellín", "Montería", "Neiva", "Pasto", "Pereira", "Santa Marta", "Bogotá", "Tunja", "Valledupar", "Villavicencio"]
  },
  "Costa Rica": {
    cities: ["San José"]
  },
  "Croatia": {
    cities: ["Dubrovnik", "Osijek", "Rijeka", "Split", "Zadar", "Zagreb"]
  },
  "Czech Republic": {
    cities: ["Brno", "Olomouc", "Ostrava", "Pilsen", "Prague"]
  },
  "Denmark": {
    cities: ["Aalborg", "Aarhus", "Copenhagen", "Odense"]
  },
  "Dominican Republic": {
    cities: ["Punta Cana", "Santiago", "Santo Domingo"]
  },
  "Ecuador": {
    cities: ["Cuenca", "Guayaquil", "Quito"]
  },
  "Egypt": {
    cities: ["Alexandria", "Cairo", "Hurghada", "Luxor", "Sharm El Sheikh"]
  },
  "El Salvador": {
    cities: ["San Salvador"]
  },
  "Estonia": {
    cities: ["Tallinn"]
  },
  "Finland": {
    cities: ["Helsinki", "Oulu", "Tampere", "Turku"]
  },
  "France": {
    cities: ["Aix-en-Provence", "Angers", "Bordeaux", "Brest", "Cannes", "Dijon", "Grenoble", "Le Havre", "Lille", "Lyon", "Marseille", "Montpellier", "Mulhouse", "Nancy", "Nantes", "Nice", "Nîmes", "Orléans", "Paris", "Perpignan", "Reims", "Rennes", "Rouen", "Saint-Étienne", "Strasbourg", "Toulon", "Toulouse", "Tours"]
  },
  "Germany": {
    cities: ["Aachen", "Augsburg", "Berlin", "Bielefeld", "Bochum", "Bonn", "Bremen", "Chemnitz", "Cologne", "Darmstadt", "Dortmund", "Dresden", "Duisburg", "Düsseldorf", "Erfurt", "Essen", "Frankfurt", "Freiburg", "Gelsenkirchen", "Halle", "Hamburg", "Hanover", "Heidelberg", "Karlsruhe", "Kassel", "Kiel", "Leipzig", "Lübeck", "Magdeburg", "Mainz", "Mannheim", "Mönchengladbach", "Mülheim", "Munich", "Münster", "Nuremberg", "Oberhausen", "Oldenburg", "Potsdam", "Regensburg", "Rostock", "Saarbrücken", "Stuttgart", "Ulm", "Wiesbaden", "Wolfsburg", "Wuppertal"]
  },
  "Ghana": {
    cities: ["Accra", "Kumasi"]
  },
  "Great Britain": {
    cities: ["Aberdeen", "Bath", "Belfast", "Birmingham", "Blackpool", "Bournemouth", "Bradford", "Brighton", "Bristol", "Cambridge", "Cardiff", "Cheltenham", "Chester", "Coventry", "Derby", "Dundee", "Edinburgh", "Exeter", "Glasgow", "Hull", "Leeds", "Leicester", "Liverpool", "London", "Luton", "Maidstone", "Manchester", "Milton Keynes", "Newcastle", "Newport", "Northampton", "Norwich", "Nottingham", "Oxford", "Peterborough", "Plymouth", "Portsmouth", "Preston", "Reading", "Sheffield", "Southampton", "Stoke-on-Trent", "Swansea", "Swindon", "Wolverhampton", "Worcester", "York"]
  },
  "Greece": {
    cities: ["Athens", "Heraklion", "Patras", "Thessaloniki"]
  },
  "Guatemala": {
    cities: ["Guatemala City"]
  },
  "Honduras": {
    cities: ["San Pedro Sula", "Tegucigalpa"]
  },
  "Hong Kong": {
    cities: ["Hong Kong"]
  },
  "Hungary": {
    cities: ["Budapest", "Debrecen", "Győr", "Miskolc", "Pécs", "Szeged"]
  },
  "India": {
    cities: ["Ahmedabad", "Amritsar", "Aurangabad", "Bengaluru", "Bhopal", "Bhubaneswar", "Chandigarh", "Chennai", "Coimbatore", "Dehradun", "Delhi", "Goa", "Guwahati", "Gwalior", "Hyderabad", "Indore", "Jaipur", "Jodhpur", "Kanpur", "Kochi", "Kolkata", "Lucknow", "Ludhiana", "Madurai", "Mangalore", "Mumbai", "Mysore", "Nagpur", "Nashik", "Patna", "Pune", "Raipur", "Rajkot", "Ranchi", "Surat", "Thiruvananthapuram", "Tiruchirappalli", "Udaipur", "Vadodara", "Varanasi", "Vijayawada", "Visakhapatnam"]
  },
  "Italy": {
    cities: ["Bari", "Bologna", "Catania", "Florence", "Genoa", "Milan", "Naples", "Palermo", "Perugia", "Rome", "Turin", "Venice", "Verona"]
  },
  "Ivory Coast": {
    cities: ["Abidjan"]
  },
  "Jamaica": {
    cities: ["Kingston", "Montego Bay"]
  },
  "Japan": {
    cities: ["Fukuoka", "Hiroshima", "Kawasaki", "Kobe", "Kyoto", "Nagoya", "Osaka", "Sapporo", "Sendai", "Tokyo", "Yokohama"]
  },
  "Jordan": {
    cities: ["Amman"]
  },
  "Kenya": {
    cities: ["Mombasa", "Nairobi"]
  },
  "Korea": {
    cities: ["Busan", "Daegu", "Daejeon", "Gwangju", "Incheon", "Seoul", "Suwon", "Ulsan"]
  },
  "Kuwait": {
    cities: ["Kuwait"]
  },
  "Lebanon": {
    cities: ["Beirut"]
  },
  "Lithuania": {
    cities: ["Kaunas", "Vilnius"]
  },
  "Luxembourg": {
    cities: ["Luxembourg"]
  },
  "Malta": {
    cities: ["Malta"]
  },
  "Mexico": {
    cities: ["Aguascalientes", "Cabo San Lucas", "Campeche", "Cancún", "Celaya", "Chetumal", "Chihuahua", "Ciudad del Carmen", "Ciudad Juárez", "Ciudad Victoria", "Coatzacoalcos", "Colima", "Cuernavaca", "Culiacán", "Durango", "Ensenada", "Guadalajara", "Guanajuato", "Hermosillo", "Irapuato", "La Paz", "León", "Los Cabos", "Los Mochis", "Manzanillo", "Matamoros", "Mazatlán", "Mérida", "Mexicali", "Mexico City", "Monclova", "Monterrey", "Morelia", "Nogales", "Nuevo Laredo", "Oaxaca", "Orizaba", "Pachuca", "Playa del Carmen", "Poza Rica", "Puebla", "Puerto Vallarta", "Querétaro", "Reynosa", "Riviera Maya", "Saltillo", "San Juan del Río", "San Luis Potosí", "Tampico", "Tapachula", "Tijuana", "Tlaxcala", "Toluca", "Torreón", "Tuxtla Gutiérrez", "Uruapan", "Veracruz", "Villahermosa", "Xalapa", "Zacatecas"]
  },
  "Netherlands": {
    cities: ["Almere", "Amersfoort", "Amsterdam", "Arnhem", "Breda", "Eindhoven", "Groningen", "Haarlem", "The Hague", "Leiden", "Maastricht", "Nijmegen", "Rotterdam", "Tilburg", "Utrecht"]
  },
  "New Zealand": {
    cities: ["Auckland", "Christchurch", "Dunedin", "Hamilton", "Queenstown", "Rotorua", "Tauranga", "Wellington"]
  },
  "Nigeria": {
    cities: ["Abuja", "Benin City", "Ibadan", "Kano", "Lagos", "Port Harcourt"]
  },
  "Norway": {
    cities: ["Bergen", "Oslo", "Stavanger", "Trondheim"]
  },
  "Panama": {
    cities: ["Panama City"]
  },
  "Paraguay": {
    cities: ["Asunción"]
  },
  "Peru": {
    cities: ["Arequipa", "Chiclayo", "Cuzco", "Huancayo", "Lima", "Piura", "Trujillo"]
  },
  "Poland": {
    cities: ["Białystok", "Bielsko-Biała", "Bydgoszcz", "Częstochowa", "Gdańsk", "Katowice", "Kielce", "Kraków", "Łódź", "Lublin", "Olsztyn", "Opole", "Poznań", "Radom", "Rzeszów", "Sosnowiec", "Szczecin", "Toruń", "Wrocław", "Warsaw"]
  },
  "Portugal": {
    cities: ["Algarve", "Braga", "Coimbra", "Funchal", "Lisbon", "Porto"]
  },
  "Qatar": {
    cities: ["Doha"]
  },
  "Republic of Ireland": {
    cities: ["Cork", "Dublin", "Galway", "Limerick", "Waterford"]
  },
  "Romania": {
    cities: ["Brașov", "Bucharest", "Cluj-Napoca", "Constanța", "Craiova", "Galați", "Iași", "Oradea", "Ploiești", "Sibiu", "Timișoara"]
  },
  "Saint Lucia": {
    cities: ["Saint Lucia"]
  },
  "Saudi Arabia": {
    cities: ["Dammam", "Jeddah", "Mecca", "Medina", "Riyadh"]
  },
  "Slovakia": {
    cities: ["Bratislava", "Košice"]
  },
  "Slovenia": {
    cities: ["Ljubljana", "Maribor"]
  },
  "South Africa": {
    cities: ["Bloemfontein", "Cape Town", "Durban", "East London", "Johannesburg", "Kimberley", "Nelson Mandela Bay", "Pietermaritzburg", "Polokwane", "Port Elizabeth", "Pretoria", "Rustenburg"]
  },
  "Spain": {
    cities: ["A Coruña", "Alicante", "Badajoz", "Barcelona", "Bilbao", "Cádiz", "Córdoba", "Gijón", "Granada", "Ibiza", "Las Palmas", "Madrid", "Málaga", "Mallorca", "Murcia", "Oviedo", "Pamplona", "Salamanca", "San Sebastián", "Santa Cruz de Tenerife", "Santander", "Seville", "Valencia", "Valladolid", "Vigo", "Zaragoza"]
  },
  "Sri Lanka": {
    cities: ["Colombo", "Galle", "Kandy", "Negombo"]
  },
  "Sweden": {
    cities: ["Gothenburg", "Helsingborg", "Linköping", "Malmö", "Stockholm", "Uppsala", "Västerås", "Örebro"]
  },
  "Switzerland": {
    cities: ["Basel", "Bern", "Geneva", "Lausanne", "Lucerne", "Winterthur", "Zurich"]
  },
  "Taiwan": {
    cities: ["Hsinchu", "Kaohsiung", "Taichung", "Tainan", "Taipei", "Taoyuan"]
  },
  "Tanzania": {
    cities: ["Dar es Salaam"]
  },
  "Turkey": {
    cities: ["Adana", "Ankara", "Antalya", "Bursa", "Denizli", "Eskişehir", "Gaziantep", "Istanbul", "İzmir", "Kayseri", "Konya", "Mersin", "Sakarya", "Samsun", "Trabzon"]
  },
  "Uganda": {
    cities: ["Kampala"]
  },
  "Ukraine": {
    cities: ["Dnipro", "Kharkiv", "Kyiv", "Lviv", "Odesa", "Zaporizhzhia"]
  },
  "United Arab Emirates": {
    cities: ["Abu Dhabi", "Ajman", "Al Ain", "Dubai", "Fujairah", "Ras Al Khaimah", "Sharjah", "Umm Al Quwain"]
  },
  "United States": {
    states: {
      "Alabama": ["Anniston", "Auburn", "Birmingham", "Decatur", "Dothan", "Florence", "Gadsden", "Hoover", "Huntsville", "Mobile", "Montgomery", "Tuscaloosa"],
      "Alaska": ["Anchorage", "Fairbanks", "Juneau"],
      "Arizona": ["Chandler", "Flagstaff", "Gilbert", "Glendale", "Goodyear", "Lake Havasu City", "Mesa", "Peoria", "Phoenix", "Prescott", "Scottsdale", "Sedona", "Surprise", "Tempe", "Tucson", "Yuma"],
      "Arkansas": ["Bentonville", "Conway", "Fayetteville", "Fort Smith", "Hot Springs", "Jonesboro", "Little Rock", "Pine Bluff", "Rogers", "Springdale"],
      "California": ["Alameda", "Anaheim", "Antioch", "Bakersfield", "Berkeley", "Beverly Hills", "Burbank", "Carlsbad", "Chico", "Chula Vista", "Concord", "Corona", "Costa Mesa", "Daly City", "Downey", "El Cajon", "El Monte", "Elk Grove", "Escondido", "Fairfield", "Fontana", "Fremont", "Fresno", "Fullerton", "Garden Grove", "Glendale", "Hayward", "Huntington Beach", "Inglewood", "Irvine", "Lancaster", "Long Beach", "Los Angeles", "Malibu", "Menlo Park", "Mission Viejo", "Modesto", "Moreno Valley", "Mountain View", "Murrieta", "Napa", "Newport Beach", "Norwalk", "Oakland", "Oceanside", "Ontario", "Orange", "Oxnard", "Palm Desert", "Palm Springs", "Palmdale", "Palo Alto", "Pasadena", "Pomona", "Rancho Cucamonga", "Redding", "Redlands", "Redondo Beach", "Redwood City", "Richmond", "Riverside", "Roseville", "Sacramento", "Salinas", "San Bernardino", "San Clemente", "San Diego", "San Francisco", "San Jose", "San Luis Obispo", "San Mateo", "San Rafael", "Santa Ana", "Santa Barbara", "Santa Clara", "Santa Clarita", "Santa Cruz", "Santa Maria", "Santa Monica", "Santa Rosa", "Simi Valley", "South Lake Tahoe", "Stockton", "Sunnyvale", "Temecula", "Thousand Oaks", "Torrance", "Tracy", "Turlock", "Vacaville", "Vallejo", "Ventura", "Victorville", "Visalia", "Walnut Creek", "West Covina", "West Hollywood", "Westminster"],
      "Colorado": ["Arvada", "Aurora", "Boulder", "Broomfield", "Castle Rock", "Centennial", "Colorado Springs", "Denver", "Fort Collins", "Grand Junction", "Greeley", "Highlands Ranch", "Lakewood", "Littleton", "Longmont", "Loveland", "Parker", "Pueblo", "Thornton", "Westminster"],
      "Connecticut": ["Bridgeport", "Bristol", "Danbury", "Fairfield", "Greenwich", "Hartford", "Meriden", "Middletown", "Milford", "New Britain", "New Haven", "New London", "Norwalk", "Stamford", "Waterbury", "West Hartford"],
      "Delaware": ["Dover", "Newark", "Wilmington"],
      "Florida": ["Boca Raton", "Bonita Springs", "Boynton Beach", "Bradenton", "Brandon", "Cape Coral", "Clearwater", "Clermont", "Coconut Creek", "Coral Gables", "Coral Springs", "Daytona Beach", "Deerfield Beach", "Delray Beach", "Deltona", "Doral", "Dunedin", "Fort Lauderdale", "Fort Myers", "Fort Pierce", "Fort Walton Beach", "Gainesville", "Hallandale Beach", "Hialeah", "Hollywood", "Homestead", "Jacksonville", "Jupiter", "Kendall", "Key West", "Kissimmee", "Lake Worth", "Lakeland", "Largo", "Lauderhill", "Margate", "Melbourne", "Miami", "Miami Beach", "Miami Gardens", "Miramar", "Naples", "North Miami", "North Port", "Ocala", "Orlando", "Ormond Beach", "Palm Bay", "Palm Beach Gardens", "Palm Coast", "Panama City", "Pembroke Pines", "Pensacola", "Pinellas Park", "Plantation", "Pompano Beach", "Port Charlotte", "Port Orange", "Port St. Lucie", "Riverview", "Saint Petersburg", "Sanford", "Sarasota", "Sunrise", "Tallahassee", "Tamarac", "Tampa", "Titusville", "Venice", "Wellington", "West Palm Beach", "Weston", "Winter Haven", "Winter Park"],
      "Georgia": ["Albany", "Alpharetta", "Athens", "Atlanta", "Augusta", "Columbus", "Dalton", "Gainesville", "Johns Creek", "Kennesaw", "Macon", "Marietta", "Newnan", "Peachtree City", "Roswell", "Sandy Springs", "Savannah", "Smyrna", "Valdosta", "Warner Robins"],
      "Hawaii": ["Hilo", "Honolulu", "Kahului", "Kailua-Kona", "Kapolei", "Lihue"],
      "Idaho": ["Boise", "Coeur d'Alene", "Idaho Falls", "Meridian", "Nampa", "Pocatello", "Twin Falls"],
      "Illinois": ["Arlington Heights", "Aurora", "Bloomington", "Bolingbrook", "Champaign", "Chicago", "Cicero", "Decatur", "Des Plaines", "Downers Grove", "Elgin", "Elk Grove Village", "Evanston", "Joliet", "Naperville", "Normal", "Oak Lawn", "Oak Park", "Orland Park", "Palatine", "Peoria", "Rockford", "Schaumburg", "Skokie", "Springfield", "Tinley Park", "Waukegan", "Wheaton"],
      "Indiana": ["Anderson", "Bloomington", "Carmel", "Elkhart", "Evansville", "Fishers", "Fort Wayne", "Gary", "Greenwood", "Hammond", "Indianapolis", "Kokomo", "Lafayette", "Muncie", "Noblesville", "South Bend", "Terre Haute"],
      "Iowa": ["Ames", "Ankeny", "Cedar Falls", "Cedar Rapids", "Council Bluffs", "Davenport", "Des Moines", "Dubuque", "Iowa City", "Sioux City", "Waterloo", "West Des Moines"],
      "Kansas": ["Kansas City", "Lawrence", "Lenexa", "Manhattan", "Olathe", "Overland Park", "Shawnee", "Topeka", "Wichita"],
      "Kentucky": ["Bowling Green", "Covington", "Elizabethtown", "Frankfort", "Lexington", "Louisville", "Owensboro", "Paducah"],
      "Louisiana": ["Alexandria", "Baton Rouge", "Bossier City", "Houma", "Kenner", "Lafayette", "Lake Charles", "Metairie", "Monroe", "New Orleans", "Shreveport", "Slidell"],
      "Maine": ["Auburn", "Augusta", "Bangor", "Lewiston", "Portland"],
      "Maryland": ["Annapolis", "Baltimore", "Bel Air", "Bethesda", "Bowie", "Columbia", "Dundalk", "Ellicott City", "Frederick", "Gaithersburg", "Germantown", "Glen Burnie", "Hagerstown", "Rockville", "Salisbury", "Silver Spring", "Towson", "Waldorf"],
      "Massachusetts": ["Boston", "Brockton", "Brookline", "Cambridge", "Fall River", "Framingham", "Haverhill", "Lawrence", "Lowell", "Lynn", "Malden", "Medford", "New Bedford", "Newton", "Peabody", "Plymouth", "Quincy", "Revere", "Salem", "Somerville", "Springfield", "Waltham", "Weymouth", "Worcester"],
      "Michigan": ["Ann Arbor", "Battle Creek", "Bay City", "Canton", "Dearborn", "Detroit", "East Lansing", "Farmington Hills", "Flint", "Grand Rapids", "Holland", "Jackson", "Kalamazoo", "Lansing", "Livonia", "Midland", "Muskegon", "Pontiac", "Portage", "Rochester Hills", "Royal Oak", "Saginaw", "Southfield", "Sterling Heights", "Taylor", "Troy", "Warren", "Westland", "Wyoming"],
      "Minnesota": ["Bloomington", "Brooklyn Park", "Burnsville", "Duluth", "Eagan", "Eden Prairie", "Edina", "Lakeville", "Mankato", "Maple Grove", "Minneapolis", "Minnetonka", "Moorhead", "Plymouth", "Rochester", "St. Cloud", "St. Louis Park", "St. Paul", "Woodbury"],
      "Mississippi": ["Biloxi", "Gulfport", "Hattiesburg", "Jackson", "Meridian", "Olive Branch", "Southaven", "Tupelo"],
      "Missouri": ["Blue Springs", "Cape Girardeau", "Chesterfield", "Columbia", "Florissant", "Independence", "Jefferson City", "Joplin", "Kansas City", "Lee's Summit", "O'Fallon", "Springfield", "St. Charles", "St. Joseph", "St. Louis", "St. Peters"],
      "Montana": ["Billings", "Bozeman", "Butte", "Great Falls", "Helena", "Kalispell", "Missoula"],
      "Nebraska": ["Bellevue", "Grand Island", "Kearney", "Lincoln", "Omaha"],
      "Nevada": ["Carson City", "Henderson", "Las Vegas", "North Las Vegas", "Paradise", "Reno", "Sparks", "Spring Valley"],
      "New Hampshire": ["Concord", "Dover", "Manchester", "Nashua", "Rochester", "Salem"],
      "New Jersey": ["Atlantic City", "Bayonne", "Camden", "Cherry Hill", "Clifton", "East Orange", "Edison", "Elizabeth", "Hackensack", "Hoboken", "Jersey City", "Lakewood", "New Brunswick", "Newark", "Passaic", "Paterson", "Perth Amboy", "Toms River", "Trenton", "Union City", "Vineland", "Woodbridge"],
      "New Mexico": ["Albuquerque", "Farmington", "Las Cruces", "Rio Rancho", "Roswell", "Santa Fe"],
      "New York": ["Albany", "Binghamton", "Bronx", "Brooklyn", "Buffalo", "Flushing", "Hempstead", "Ithaca", "Jamaica", "Manhattan", "Mount Vernon", "New Rochelle", "New York City", "Niagara Falls", "Poughkeepsie", "Queens", "Rochester", "Schenectady", "Staten Island", "Syracuse", "Troy", "Utica", "White Plains", "Yonkers"],
      "North Carolina": ["Apex", "Asheville", "Burlington", "Cary", "Chapel Hill", "Charlotte", "Concord", "Durham", "Fayetteville", "Gastonia", "Greensboro", "Greenville", "Hickory", "High Point", "Huntersville", "Jacksonville", "Kannapolis", "Mooresville", "Raleigh", "Rocky Mount", "Wilmington", "Wilson", "Winston-Salem"],
      "North Dakota": ["Bismarck", "Fargo", "Grand Forks", "Minot"],
      "Ohio": ["Akron", "Canton", "Cincinnati", "Cleveland", "Columbus", "Dayton", "Dublin", "Elyria", "Fairfield", "Findlay", "Hamilton", "Kent", "Kettering", "Lakewood", "Lima", "Lorain", "Mansfield", "Mason", "Mentor", "Middletown", "Newark", "Parma", "Springfield", "Toledo", "Warren", "Westerville", "Youngstown"],
      "Oklahoma": ["Broken Arrow", "Edmond", "Enid", "Lawton", "Moore", "Muskogee", "Norman", "Oklahoma City", "Owasso", "Shawnee", "Stillwater", "Tulsa"],
      "Oregon": ["Albany", "Beaverton", "Bend", "Corvallis", "Eugene", "Gresham", "Hillsboro", "Lake Oswego", "Medford", "Portland", "Salem", "Springfield", "Tigard"],
      "Pennsylvania": ["Allentown", "Altoona", "Bethlehem", "Chester", "Erie", "Harrisburg", "Lancaster", "Levittown", "Norristown", "Philadelphia", "Pittsburgh", "Reading", "Scranton", "State College", "Upper Darby", "Wilkes-Barre", "Williamsport", "York"],
      "Rhode Island": ["Cranston", "East Providence", "Pawtucket", "Providence", "Warwick", "Woonsocket"],
      "South Carolina": ["Anderson", "Charleston", "Columbia", "Florence", "Goose Creek", "Greenville", "Hilton Head Island", "Mauldin", "Mount Pleasant", "Myrtle Beach", "North Charleston", "Rock Hill", "Spartanburg", "Summerville", "Sumter"],
      "South Dakota": ["Aberdeen", "Brookings", "Rapid City", "Sioux Falls", "Watertown"],
      "Tennessee": ["Bartlett", "Brentwood", "Bristol", "Chattanooga", "Clarksville", "Cleveland", "Collierville", "Columbia", "Cookeville", "Franklin", "Germantown", "Hendersonville", "Jackson", "Johnson City", "Kingsport", "Knoxville", "Memphis", "Murfreesboro", "Nashville", "Smyrna"],
      "Texas": ["Abilene", "Allen", "Amarillo", "Arlington", "Austin", "Baytown", "Beaumont", "Brownsville", "Bryan", "Carrollton", "Cedar Park", "College Station", "Conroe", "Corpus Christi", "Dallas", "Denton", "DeSoto", "Edinburg", "El Paso", "Euless", "Flower Mound", "Fort Worth", "Frisco", "Galveston", "Garland", "Georgetown", "Grand Prairie", "Grapevine", "Harlingen", "Houston", "Irving", "Katy", "Keller", "Killeen", "Laredo", "League City", "Lewisville", "Longview", "Lubbock", "Mansfield", "McAllen", "McKinney", "Mesquite", "Midland", "Mission", "Missouri City", "New Braunfels", "North Richland Hills", "Odessa", "Pasadena", "Pearland", "Pharr", "Plano", "Port Arthur", "Richardson", "Round Rock", "Rowlett", "San Angelo", "San Antonio", "San Marcos", "Sugar Land", "Temple", "Texas City", "The Woodlands", "Tyler", "Victoria", "Waco", "Wichita Falls"],
      "Utah": ["Cedar City", "Clearfield", "Draper", "Layton", "Lehi", "Logan", "Murray", "Ogden", "Orem", "Park City", "Provo", "Salt Lake City", "Sandy", "South Jordan", "St. George", "Taylorsville", "West Jordan", "West Valley City"],
      "Vermont": ["Burlington", "Essex Junction", "Rutland", "South Burlington"],
      "Virginia": ["Alexandria", "Arlington", "Blacksburg", "Charlottesville", "Chesapeake", "Danville", "Fairfax", "Fredericksburg", "Hampton", "Harrisonburg", "Leesburg", "Lynchburg", "Manassas", "McLean", "Newport News", "Norfolk", "Portsmouth", "Reston", "Richmond", "Roanoke", "Suffolk", "Virginia Beach", "Williamsburg", "Winchester"],
      "Washington": ["Auburn", "Bellevue", "Bellingham", "Bremerton", "Burien", "Everett", "Federal Way", "Kennewick", "Kent", "Kirkland", "Lakewood", "Lynnwood", "Marysville", "Olympia", "Pasco", "Redmond", "Renton", "Richland", "Seattle", "Spokane", "Tacoma", "Vancouver", "Yakima"],
      "Washington D.C.": ["Washington"],
      "West Virginia": ["Charleston", "Huntington", "Morgantown", "Parkersburg", "Wheeling"],
      "Wisconsin": ["Appleton", "Eau Claire", "Green Bay", "Janesville", "Kenosha", "La Crosse", "Madison", "Milwaukee", "Oshkosh", "Racine", "Sheboygan", "Waukesha", "Wauwatosa", "West Allis"],
      "Wyoming": ["Casper", "Cheyenne", "Gillette", "Laramie", "Rock Springs"]
    }
  },
  "Uruguay": {
    cities: ["Montevideo", "Punta del Este"]
  }
};

async function seedUberCities() {
  const client = await pool.connect();

  try {
    console.log('Starting Uber cities seed...\n');

    // First, clear existing Uber entries to avoid duplicates
    const deleteResult = await client.query(
      `DELETE FROM platform_data WHERE platform = 'uber' RETURNING id`
    );
    console.log(`Cleared ${deleteResult.rowCount} existing Uber entries.\n`);

    let totalInserted = 0;
    const batchSize = 100;
    let batch = [];

    // Helper function to insert a batch
    async function insertBatch() {
      if (batch.length === 0) return;

      const values = batch.map((_, i) => {
        const offset = i * 4;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $4)`;
      }).join(', ');

      const params = [];
      for (const item of batch) {
        params.push(item.country, item.state_province, item.city);
      }
      params.push('uber');

      // Use unnest for better performance with large batches
      const insertQuery = `
        INSERT INTO platform_data (country, state_province, city, platform)
        SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
      `;

      const countries = batch.map(b => b.country);
      const states = batch.map(b => b.state_province);
      const cities = batch.map(b => b.city);
      const platforms = batch.map(() => 'uber');

      await client.query(insertQuery, [countries, states, cities, platforms]);
      totalInserted += batch.length;
      batch = [];
    }

    // Process each country
    for (const [country, data] of Object.entries(uberCitiesData)) {
      if (data.states) {
        // Country has state/province subdivisions
        for (const [state, cities] of Object.entries(data.states)) {
          for (const city of cities) {
            batch.push({ country, state_province: state, city });
            if (batch.length >= batchSize) {
              await insertBatch();
              process.stdout.write(`\rInserted ${totalInserted} cities...`);
            }
          }
        }
      } else if (data.cities) {
        // Country has direct city list
        for (const city of data.cities) {
          batch.push({ country, state_province: null, city });
          if (batch.length >= batchSize) {
            await insertBatch();
            process.stdout.write(`\rInserted ${totalInserted} cities...`);
          }
        }
      }
    }

    // Insert remaining batch
    await insertBatch();

    console.log(`\n\n✅ Successfully inserted ${totalInserted} Uber cities across ${Object.keys(uberCitiesData).length} countries!`);

    // Show summary by country
    const summary = await client.query(`
      SELECT country, COUNT(*) as city_count
      FROM platform_data
      WHERE platform = 'uber'
      GROUP BY country
      ORDER BY city_count DESC
      LIMIT 10
    `);

    console.log('\nTop 10 countries by city count:');
    console.log('─'.repeat(40));
    for (const row of summary.rows) {
      console.log(`  ${row.country.padEnd(25)} ${row.city_count} cities`);
    }

  } catch (err) {
    console.error('Error seeding Uber cities:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run if executed directly
seedUberCities().catch(console.error);
