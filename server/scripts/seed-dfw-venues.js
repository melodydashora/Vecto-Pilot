import { db } from '../db/drizzle.js';
import { venue_catalog, venue_metrics } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

const dfwVenues = [
  {
    name: "Dallas/Fort Worth International Airport - Terminal C",
    address: "2400 Aviation Dr, DFW Airport, TX 75261",
    lat: 32.898787,
    lng: -97.037997,
    category: "airport",
    staging_notes: {
      type: "Dedicated Rideshare",
      name: "Terminal C Upper Level",
      tips: "FIFO queue, arrive 15-30 min before peak times"
    },
    city: "DFW Airport",
    metro: "Dallas-Fort Worth",
    ai_estimated_hours: "24/7"
  },
  {
    name: "Dallas Love Field Airport",
    address: "8008 Herb Kelleher Way, Dallas, TX 75235",
    lat: 32.847389,
    lng: -96.851778,
    category: "airport",
    staging_notes: {
      type: "Designated Pickup",
      name: "Lower Level Rideshare Zone",
      tips: "Southwest hub - frequent turnover"
    },
    city: "Dallas",
    metro: "Dallas-Fort Worth",
    ai_estimated_hours: "24/7"
  },
  {
    name: "The Star in Frisco",
    address: "9 Cowboys Way, Frisco, TX 75034",
    lat: 33.093056,
    lng: -96.839444,
    category: "entertainment",
    staging_notes: {
      type: "Free Lot",
      name: "Visitor Parking Lot A",
      tips: "Busy during Cowboys events and practices"
    },
    city: "Frisco",
    metro: "Dallas-Fort Worth",
    ai_estimated_hours: "Mon-Sun: 10am-10pm"
  },
  {
    name: "Legacy West",
    address: "7700 Windrose Ave, Plano, TX 75024",
    lat: 33.075833,
    lng: -96.828611,
    category: "mixed-use",
    staging_notes: {
      type: "Paid Lot",
      name: "Garage Levels 1-2",
      tips: "Dinner rush 5-9pm, weekend brunch 10am-2pm"
    },
    city: "Plano",
    metro: "Dallas-Fort Worth",
    ai_estimated_hours: "Mon-Sun: 7am-11pm"
  },
  {
    name: "American Airlines Center",
    address: "2500 Victory Ave, Dallas, TX 75219",
    lat: 32.790444,
    lng: -96.810278,
    category: "stadium",
    staging_notes: {
      type: "Designated Rideshare",
      name: "Victory Park Pickup Zone",
      tips: "Major surge during Mavericks/Stars games, concerts"
    },
    city: "Dallas",
    metro: "Dallas-Fort Worth",
    ai_estimated_hours: "Event-dependent, typically 6pm-11pm"
  },
  {
    name: "Galleria Dallas",
    address: "13350 Dallas Pkwy, Dallas, TX 75240",
    lat: 32.934167,
    lng: -96.835556,
    category: "mall",
    staging_notes: {
      type: "Paid Garage",
      name: "Level 1 Rideshare Zone",
      tips: "Holiday season peak 11am-8pm, slower mornings"
    },
    city: "Dallas",
    metro: "Dallas-Fort Worth",
    ai_estimated_hours: "Mon-Sat: 10am-9pm, Sun: 12pm-6pm"
  },
  {
    name: "Medical City Dallas",
    address: "7777 Forest Ln, Dallas, TX 75230",
    lat: 32.910278,
    lng: -96.754722,
    category: "medical",
    staging_notes: {
      type: "Designated Pickup",
      name: "Main Entrance Circle",
      tips: "24/7 demand, peak shift changes 7am, 3pm, 11pm"
    },
    city: "Dallas",
    metro: "Dallas-Fort Worth",
    ai_estimated_hours: "24/7"
  },
  {
    name: "University of Texas at Dallas",
    address: "800 W Campbell Rd, Richardson, TX 75080",
    lat: 32.985833,
    lng: -96.750556,
    category: "university",
    staging_notes: {
      type: "Free Lot",
      name: "Visitor Lot Green",
      tips: "Peak weekdays 8am-6pm, dead during summer"
    },
    city: "Richardson",
    metro: "Dallas-Fort Worth",
    ai_estimated_hours: "Mon-Fri: 6am-10pm, Sat-Sun: 8am-8pm"
  },
  {
    name: "Uptown Dallas - McKinney Avenue",
    address: "3000 McKinney Ave, Dallas, TX 75204",
    lat: 32.802222,
    lng: -96.800556,
    category: "entertainment",
    staging_notes: {
      type: "Street Pickup",
      name: "McKinney Ave curbside",
      tips: "Nightlife hub - peak Thu-Sat 8pm-2am"
    },
    city: "Dallas",
    metro: "Dallas-Fort Worth",
    ai_estimated_hours: "Most venues: 11am-2am"
  },
  {
    name: "Grapevine Mills Mall",
    address: "3000 Grapevine Mills Pkwy, Grapevine, TX 76051",
    lat: 32.934722,
    lng: -97.064167,
    category: "mall",
    staging_notes: {
      type: "Free Lot",
      name: "Lot A near entrance 1",
      tips: "Tourist heavy, peak weekends 11am-7pm"
    },
    city: "Grapevine",
    metro: "Dallas-Fort Worth",
    ai_estimated_hours: "Mon-Sat: 10am-9pm, Sun: 11am-7pm"
  },
  {
    name: "Toyota Music Factory",
    address: "316 W Las Colinas Blvd, Irving, TX 75039",
    lat: 32.883333,
    lng: -96.980278,
    category: "entertainment",
    staging_notes: {
      type: "Free Lot",
      name: "Visitor Parking Garage",
      tips: "Concert nights major surge, check event calendar"
    },
    city: "Irving",
    metro: "Dallas-Fort Worth",
    ai_estimated_hours: "Venues: 11am-12am, restaurants later"
  },
  {
    name: "Texas Live! - Arlington",
    address: "1650 E Randol Mill Rd, Arlington, TX 76011",
    lat: 32.751389,
    lng: -97.082778,
    category: "entertainment",
    staging_notes: {
      type: "Designated Rideshare",
      name: "Texas Live Pickup Zone",
      tips: "Rangers/Cowboys game days = major surge"
    },
    city: "Arlington",
    metro: "Dallas-Fort Worth",
    ai_estimated_hours: "Sun-Thu: 11am-12am, Fri-Sat: 11am-2am"
  },
  {
    name: "Stonebriar Centre",
    address: "2601 Preston Rd, Frisco, TX 75034",
    lat: 33.131111,
    lng: -96.800556,
    category: "mall",
    staging_notes: {
      type: "Paid Garage",
      name: "North Garage Level 1",
      tips: "Suburban location, steady but not high volume"
    },
    city: "Frisco",
    metro: "Dallas-Fort Worth",
    ai_estimated_hours: "Mon-Sat: 10am-9pm, Sun: 12pm-6pm"
  },
  {
    name: "Baylor Scott & White Medical Center - Plano",
    address: "4700 Alliance Blvd, Plano, TX 75093",
    lat: 33.075,
    lng: -96.810833,
    category: "medical",
    staging_notes: {
      type: "Designated Pickup",
      name: "Main Entrance",
      tips: "Major regional hospital, consistent 24/7 flow"
    },
    city: "Plano",
    metro: "Dallas-Fort Worth",
    ai_estimated_hours: "24/7"
  },
  {
    name: "Deep Ellum Entertainment District",
    address: "2824 Main St, Dallas, TX 75226",
    lat: 32.784167,
    lng: -96.780556,
    category: "entertainment",
    staging_notes: {
      type: "Street Pickup",
      name: "Main St or Elm St curbside",
      tips: "Live music scene - peak Fri-Sat 9pm-2am"
    },
    city: "Dallas",
    metro: "Dallas-Fort Worth",
    ai_estimated_hours: "Most venues: 5pm-2am daily"
  }
];

async function seedVenues() {
  console.log('🌱 Seeding DFW metro venues...');
  
  try {
    let added = 0;
    let skipped = 0;
    
    for (const venue of dfwVenues) {
      const existing = await db.select()
        .from(venue_catalog)
        .where(eq(venue_catalog.name, venue.name))
        .limit(1);
      
      if (existing.length > 0) {
        console.log(`⏭️  Skipped: ${venue.name} (already exists)`);
        skipped++;
        continue;
      }
      
      const [inserted] = await db.insert(venue_catalog)
        .values(venue)
        .returning({ venue_id: venue_catalog.venue_id });
      
      await db.insert(venue_metrics)
        .values({
          venue_id: inserted.venue_id,
          times_recommended: 0,
          times_chosen: 0,
          positive_feedback: 0,
          negative_feedback: 0,
          reliability_score: 0.5,
        });
      
      console.log(`✅ Added: ${venue.name}`);
      added++;
    }
    
    console.log(`\n🎉 Seeding complete!`);
    console.log(`   Added: ${added} venues`);
    console.log(`   Skipped: ${skipped} venues (already existed)`);
    console.log(`   Total in catalog: ${added + skipped} venues\n`);
    
  } catch (error) {
    console.error('❌ Seeding error:', error);
    throw error;
  }
}

seedVenues()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
