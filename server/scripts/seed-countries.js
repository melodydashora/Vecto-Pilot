/**
 * Seed script for countries reference table
 * Populates the countries table with ISO 3166-1 standard data
 *
 * Run: node server/scripts/seed-countries.js
 */

import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// ISO 3166-1 country data
// Format: [code, name, alpha3, phone_code]
const countriesData = [
  // Priority countries (display_order 0-10)
  ['US', 'United States', 'USA', '+1', 0],
  ['CA', 'Canada', 'CAN', '+1', 1],
  ['GB', 'United Kingdom', 'GBR', '+44', 2],
  ['AU', 'Australia', 'AUS', '+61', 3],
  ['DE', 'Germany', 'DEU', '+49', 4],
  ['FR', 'France', 'FRA', '+33', 5],
  ['MX', 'Mexico', 'MEX', '+52', 6],
  ['BR', 'Brazil', 'BRA', '+55', 7],
  ['IN', 'India', 'IND', '+91', 8],
  ['JP', 'Japan', 'JPN', '+81', 9],

  // All other countries (alphabetical, display_order 100+)
  ['AF', 'Afghanistan', 'AFG', '+93', 100],
  ['AL', 'Albania', 'ALB', '+355', 101],
  ['DZ', 'Algeria', 'DZA', '+213', 102],
  ['AD', 'Andorra', 'AND', '+376', 103],
  ['AO', 'Angola', 'AGO', '+244', 104],
  ['AG', 'Antigua and Barbuda', 'ATG', '+1-268', 105],
  ['AR', 'Argentina', 'ARG', '+54', 106],
  ['AM', 'Armenia', 'ARM', '+374', 107],
  ['AT', 'Austria', 'AUT', '+43', 108],
  ['AZ', 'Azerbaijan', 'AZE', '+994', 109],
  ['BS', 'Bahamas', 'BHS', '+1-242', 110],
  ['BH', 'Bahrain', 'BHR', '+973', 111],
  ['BD', 'Bangladesh', 'BGD', '+880', 112],
  ['BB', 'Barbados', 'BRB', '+1-246', 113],
  ['BY', 'Belarus', 'BLR', '+375', 114],
  ['BE', 'Belgium', 'BEL', '+32', 115],
  ['BZ', 'Belize', 'BLZ', '+501', 116],
  ['BJ', 'Benin', 'BEN', '+229', 117],
  ['BT', 'Bhutan', 'BTN', '+975', 118],
  ['BO', 'Bolivia', 'BOL', '+591', 119],
  ['BA', 'Bosnia and Herzegovina', 'BIH', '+387', 120],
  ['BW', 'Botswana', 'BWA', '+267', 121],
  ['BN', 'Brunei', 'BRN', '+673', 122],
  ['BG', 'Bulgaria', 'BGR', '+359', 123],
  ['BF', 'Burkina Faso', 'BFA', '+226', 124],
  ['BI', 'Burundi', 'BDI', '+257', 125],
  ['KH', 'Cambodia', 'KHM', '+855', 126],
  ['CM', 'Cameroon', 'CMR', '+237', 127],
  ['CV', 'Cape Verde', 'CPV', '+238', 128],
  ['CF', 'Central African Republic', 'CAF', '+236', 129],
  ['TD', 'Chad', 'TCD', '+235', 130],
  ['CL', 'Chile', 'CHL', '+56', 131],
  ['CN', 'China', 'CHN', '+86', 132],
  ['CO', 'Colombia', 'COL', '+57', 133],
  ['KM', 'Comoros', 'COM', '+269', 134],
  ['CG', 'Congo', 'COG', '+242', 135],
  ['CD', 'Congo (DRC)', 'COD', '+243', 136],
  ['CR', 'Costa Rica', 'CRI', '+506', 137],
  ['CI', 'Ivory Coast', 'CIV', '+225', 138],
  ['HR', 'Croatia', 'HRV', '+385', 139],
  ['CU', 'Cuba', 'CUB', '+53', 140],
  ['CY', 'Cyprus', 'CYP', '+357', 141],
  ['CZ', 'Czech Republic', 'CZE', '+420', 142],
  ['DK', 'Denmark', 'DNK', '+45', 143],
  ['DJ', 'Djibouti', 'DJI', '+253', 144],
  ['DM', 'Dominica', 'DMA', '+1-767', 145],
  ['DO', 'Dominican Republic', 'DOM', '+1-809', 146],
  ['EC', 'Ecuador', 'ECU', '+593', 147],
  ['EG', 'Egypt', 'EGY', '+20', 148],
  ['SV', 'El Salvador', 'SLV', '+503', 149],
  ['GQ', 'Equatorial Guinea', 'GNQ', '+240', 150],
  ['ER', 'Eritrea', 'ERI', '+291', 151],
  ['EE', 'Estonia', 'EST', '+372', 152],
  ['SZ', 'Eswatini', 'SWZ', '+268', 153],
  ['ET', 'Ethiopia', 'ETH', '+251', 154],
  ['FJ', 'Fiji', 'FJI', '+679', 155],
  ['FI', 'Finland', 'FIN', '+358', 156],
  ['GA', 'Gabon', 'GAB', '+241', 157],
  ['GM', 'Gambia', 'GMB', '+220', 158],
  ['GE', 'Georgia', 'GEO', '+995', 159],
  ['GH', 'Ghana', 'GHA', '+233', 160],
  ['GR', 'Greece', 'GRC', '+30', 161],
  ['GD', 'Grenada', 'GRD', '+1-473', 162],
  ['GT', 'Guatemala', 'GTM', '+502', 163],
  ['GN', 'Guinea', 'GIN', '+224', 164],
  ['GW', 'Guinea-Bissau', 'GNB', '+245', 165],
  ['GY', 'Guyana', 'GUY', '+592', 166],
  ['HT', 'Haiti', 'HTI', '+509', 167],
  ['HN', 'Honduras', 'HND', '+504', 168],
  ['HU', 'Hungary', 'HUN', '+36', 169],
  ['IS', 'Iceland', 'ISL', '+354', 170],
  ['ID', 'Indonesia', 'IDN', '+62', 171],
  ['IR', 'Iran', 'IRN', '+98', 172],
  ['IQ', 'Iraq', 'IRQ', '+964', 173],
  ['IE', 'Ireland', 'IRL', '+353', 174],
  ['IL', 'Israel', 'ISR', '+972', 175],
  ['IT', 'Italy', 'ITA', '+39', 176],
  ['JM', 'Jamaica', 'JAM', '+1-876', 177],
  ['JO', 'Jordan', 'JOR', '+962', 178],
  ['KZ', 'Kazakhstan', 'KAZ', '+7', 179],
  ['KE', 'Kenya', 'KEN', '+254', 180],
  ['KI', 'Kiribati', 'KIR', '+686', 181],
  ['KP', 'North Korea', 'PRK', '+850', 182],
  ['KR', 'South Korea', 'KOR', '+82', 183],
  ['KW', 'Kuwait', 'KWT', '+965', 184],
  ['KG', 'Kyrgyzstan', 'KGZ', '+996', 185],
  ['LA', 'Laos', 'LAO', '+856', 186],
  ['LV', 'Latvia', 'LVA', '+371', 187],
  ['LB', 'Lebanon', 'LBN', '+961', 188],
  ['LS', 'Lesotho', 'LSO', '+266', 189],
  ['LR', 'Liberia', 'LBR', '+231', 190],
  ['LY', 'Libya', 'LBY', '+218', 191],
  ['LI', 'Liechtenstein', 'LIE', '+423', 192],
  ['LT', 'Lithuania', 'LTU', '+370', 193],
  ['LU', 'Luxembourg', 'LUX', '+352', 194],
  ['MG', 'Madagascar', 'MDG', '+261', 195],
  ['MW', 'Malawi', 'MWI', '+265', 196],
  ['MY', 'Malaysia', 'MYS', '+60', 197],
  ['MV', 'Maldives', 'MDV', '+960', 198],
  ['ML', 'Mali', 'MLI', '+223', 199],
  ['MT', 'Malta', 'MLT', '+356', 200],
  ['MH', 'Marshall Islands', 'MHL', '+692', 201],
  ['MR', 'Mauritania', 'MRT', '+222', 202],
  ['MU', 'Mauritius', 'MUS', '+230', 203],
  ['FM', 'Micronesia', 'FSM', '+691', 204],
  ['MD', 'Moldova', 'MDA', '+373', 205],
  ['MC', 'Monaco', 'MCO', '+377', 206],
  ['MN', 'Mongolia', 'MNG', '+976', 207],
  ['ME', 'Montenegro', 'MNE', '+382', 208],
  ['MA', 'Morocco', 'MAR', '+212', 209],
  ['MZ', 'Mozambique', 'MOZ', '+258', 210],
  ['MM', 'Myanmar', 'MMR', '+95', 211],
  ['NA', 'Namibia', 'NAM', '+264', 212],
  ['NR', 'Nauru', 'NRU', '+674', 213],
  ['NP', 'Nepal', 'NPL', '+977', 214],
  ['NL', 'Netherlands', 'NLD', '+31', 215],
  ['NZ', 'New Zealand', 'NZL', '+64', 216],
  ['NI', 'Nicaragua', 'NIC', '+505', 217],
  ['NE', 'Niger', 'NER', '+227', 218],
  ['NG', 'Nigeria', 'NGA', '+234', 219],
  ['MK', 'North Macedonia', 'MKD', '+389', 220],
  ['NO', 'Norway', 'NOR', '+47', 221],
  ['OM', 'Oman', 'OMN', '+968', 222],
  ['PK', 'Pakistan', 'PAK', '+92', 223],
  ['PW', 'Palau', 'PLW', '+680', 224],
  ['PS', 'Palestine', 'PSE', '+970', 225],
  ['PA', 'Panama', 'PAN', '+507', 226],
  ['PG', 'Papua New Guinea', 'PNG', '+675', 227],
  ['PY', 'Paraguay', 'PRY', '+595', 228],
  ['PE', 'Peru', 'PER', '+51', 229],
  ['PH', 'Philippines', 'PHL', '+63', 230],
  ['PL', 'Poland', 'POL', '+48', 231],
  ['PT', 'Portugal', 'PRT', '+351', 232],
  ['QA', 'Qatar', 'QAT', '+974', 233],
  ['RO', 'Romania', 'ROU', '+40', 234],
  ['RU', 'Russia', 'RUS', '+7', 235],
  ['RW', 'Rwanda', 'RWA', '+250', 236],
  ['KN', 'Saint Kitts and Nevis', 'KNA', '+1-869', 237],
  ['LC', 'Saint Lucia', 'LCA', '+1-758', 238],
  ['VC', 'Saint Vincent and the Grenadines', 'VCT', '+1-784', 239],
  ['WS', 'Samoa', 'WSM', '+685', 240],
  ['SM', 'San Marino', 'SMR', '+378', 241],
  ['ST', 'Sao Tome and Principe', 'STP', '+239', 242],
  ['SA', 'Saudi Arabia', 'SAU', '+966', 243],
  ['SN', 'Senegal', 'SEN', '+221', 244],
  ['RS', 'Serbia', 'SRB', '+381', 245],
  ['SC', 'Seychelles', 'SYC', '+248', 246],
  ['SL', 'Sierra Leone', 'SLE', '+232', 247],
  ['SG', 'Singapore', 'SGP', '+65', 248],
  ['SK', 'Slovakia', 'SVK', '+421', 249],
  ['SI', 'Slovenia', 'SVN', '+386', 250],
  ['SB', 'Solomon Islands', 'SLB', '+677', 251],
  ['SO', 'Somalia', 'SOM', '+252', 252],
  ['ZA', 'South Africa', 'ZAF', '+27', 253],
  ['SS', 'South Sudan', 'SSD', '+211', 254],
  ['ES', 'Spain', 'ESP', '+34', 255],
  ['LK', 'Sri Lanka', 'LKA', '+94', 256],
  ['SD', 'Sudan', 'SDN', '+249', 257],
  ['SR', 'Suriname', 'SUR', '+597', 258],
  ['SE', 'Sweden', 'SWE', '+46', 259],
  ['CH', 'Switzerland', 'CHE', '+41', 260],
  ['SY', 'Syria', 'SYR', '+963', 261],
  ['TW', 'Taiwan', 'TWN', '+886', 262],
  ['TJ', 'Tajikistan', 'TJK', '+992', 263],
  ['TZ', 'Tanzania', 'TZA', '+255', 264],
  ['TH', 'Thailand', 'THA', '+66', 265],
  ['TL', 'Timor-Leste', 'TLS', '+670', 266],
  ['TG', 'Togo', 'TGO', '+228', 267],
  ['TO', 'Tonga', 'TON', '+676', 268],
  ['TT', 'Trinidad and Tobago', 'TTO', '+1-868', 269],
  ['TN', 'Tunisia', 'TUN', '+216', 270],
  ['TR', 'Turkey', 'TUR', '+90', 271],
  ['TM', 'Turkmenistan', 'TKM', '+993', 272],
  ['TV', 'Tuvalu', 'TUV', '+688', 273],
  ['UG', 'Uganda', 'UGA', '+256', 274],
  ['UA', 'Ukraine', 'UKR', '+380', 275],
  ['AE', 'United Arab Emirates', 'ARE', '+971', 276],
  ['UY', 'Uruguay', 'URY', '+598', 277],
  ['UZ', 'Uzbekistan', 'UZB', '+998', 278],
  ['VU', 'Vanuatu', 'VUT', '+678', 279],
  ['VA', 'Vatican City', 'VAT', '+379', 280],
  ['VE', 'Venezuela', 'VEN', '+58', 281],
  ['VN', 'Vietnam', 'VNM', '+84', 282],
  ['YE', 'Yemen', 'YEM', '+967', 283],
  ['ZM', 'Zambia', 'ZMB', '+260', 284],
  ['ZW', 'Zimbabwe', 'ZWE', '+263', 285],
];

async function seedCountries() {
  const client = await pool.connect();

  try {
    console.log('🌍 Seeding countries table...');

    // Create table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS countries (
        code VARCHAR(2) PRIMARY KEY,
        name TEXT NOT NULL,
        alpha3 VARCHAR(3),
        phone_code TEXT,
        has_platform_data BOOLEAN NOT NULL DEFAULT false,
        display_order INTEGER NOT NULL DEFAULT 999,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Get countries that have platform data
    const platformCountries = await client.query(`
      SELECT DISTINCT country_code
      FROM platform_data
      WHERE country_code IS NOT NULL AND country_code != ''
    `);
    const platformCodes = new Set(platformCountries.rows.map(r => r.country_code));
    console.log(`📊 Found ${platformCodes.size} countries with platform data`);

    // Upsert countries
    let inserted = 0;
    let updated = 0;

    for (const [code, name, alpha3, phone_code, display_order] of countriesData) {
      const hasPlatformData = platformCodes.has(code);

      const result = await client.query(`
        INSERT INTO countries (code, name, alpha3, phone_code, has_platform_data, display_order, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, true)
        ON CONFLICT (code) DO UPDATE SET
          name = EXCLUDED.name,
          alpha3 = EXCLUDED.alpha3,
          phone_code = EXCLUDED.phone_code,
          has_platform_data = EXCLUDED.has_platform_data,
          display_order = EXCLUDED.display_order
        RETURNING (xmax = 0) as inserted
      `, [code, name, alpha3, phone_code, hasPlatformData, display_order]);

      if (result.rows[0]?.inserted) {
        inserted++;
      } else {
        updated++;
      }
    }

    console.log(`✅ Countries seeded: ${inserted} inserted, ${updated} updated`);
    console.log(`🌐 Total countries: ${countriesData.length}`);

    // Show summary
    const summary = await client.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE has_platform_data) as with_platform_data,
        COUNT(*) FILTER (WHERE display_order < 100) as priority_countries
      FROM countries
    `);

    console.log('\n📈 Summary:');
    console.log(`   Total countries: ${summary.rows[0].total}`);
    console.log(`   With platform data: ${summary.rows[0].with_platform_data}`);
    console.log(`   Priority countries: ${summary.rows[0].priority_countries}`);

  } catch (error) {
    console.error('❌ Error seeding countries:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seedCountries()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed to seed countries:', error);
    process.exit(1);
  });
