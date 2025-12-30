#!/usr/bin/env node
/**
 * Seed Market Intelligence from Research Data
 *
 * This script transforms the research findings into actionable intelligence
 * for the market_intelligence table. It creates:
 *
 * 1. Universal Intel - Applies to ALL markets (gravity model, strategies)
 * 2. Market-Specific Intel - Tailored to major markets
 * 3. Zone Intelligence - Honey holes, danger zones, dead zones
 * 4. Algorithm Mechanics - Upfront pricing, heatmaps, Area Preferences
 *
 * Based on: platform-data/uber/research-findings/research-intel.txt
 */

import { db } from '../server/db/drizzle.js';
import { market_intelligence } from '../shared/schema.js';
import { eq, and } from 'drizzle-orm';

// Generate slug from market name
function toSlug(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIVERSAL INTELLIGENCE - Applies to ALL markets
// ═══════════════════════════════════════════════════════════════════════════

const universalIntel = [
  // THE GRAVITY MODEL
  {
    market: 'Universal',
    market_slug: 'universal',
    intel_type: 'algorithm',
    title: 'The Gravity Model: How Markets Really Work',
    summary: 'Core cities hold satellite municipalities in their operational sphere, just like planets hold moons.',
    content: `Uber's markets are not defined by city limits—they're defined by economic gravity. A "Core City" holds "Satellite Municipalities" in its operational sphere based on commuter flow.

**Why This Matters:**
- If most people in your suburb commute to the Core city, you're in the same market
- Taking a ride TO the Core = easy return trip (high demand)
- Taking a ride AWAY from the Core = deadhead risk (low demand for return)
- The strength of "gravity" determines how safe your rides are

**Key Insight:** When the app shows you a ride destination, mentally calculate: "Is this toward or away from the Core?" That single question predicts your next 30 minutes.`,
    priority: 100,
    confidence: 95,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 100,
    tags: ['strategy', 'fundamentals', 'gravity-model'],
  },

  // REGION TYPES EXPLAINED
  {
    market: 'Universal',
    market_slug: 'universal',
    intel_type: 'strategy',
    intel_subtype: null,
    title: 'Understanding Core, Satellite, and Rural Markets',
    summary: 'Your region type determines your optimal strategy.',
    content: `**CORE Markets (Green Zone)**
- High density, constant demand
- Take rides in any direction—plenty of return trips
- Focus on ride volume over distance
- Airport runs are profitable here

**SATELLITE Markets (Yellow Zone)**
- Moderate density, directional risk
- Rides TOWARD Core = safe (high return demand)
- Rides AWAY from Core = risky (low return demand)
- Use Area Preferences to protect yourself

**RURAL Markets (Red Zone)**
- Low density, high deadhead risk
- Every ride likely means unpaid return
- Only accept if fare covers round trip
- Enable Long Pickup Premium
- Consider "Sniper" strategy (wait for premium fares)

**Pro Tip:** Check your city's region type in the Intel tab before starting your shift.`,
    priority: 95,
    confidence: 95,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 95,
    tags: ['strategy', 'region-type', 'fundamentals'],
  },

  // ANT VS SNIPER STRATEGY
  {
    market: 'Universal',
    market_slug: 'universal',
    intel_type: 'strategy',
    title: 'Ant vs Sniper: Choose Your Strategy',
    summary: 'Two fundamental approaches based on market density.',
    content: `**THE ANT STRATEGY 🐜**
Best for: Core markets, high-density areas
- Accept almost every ride
- Stay in constant motion
- Volume over selection
- Works when demand exceeds supply
- Low deadhead risk, quick returns

**THE SNIPER STRATEGY 🎯**
Best for: Rural/Satellite markets, low-density areas
- Be selective—decline unfavorable rides
- Wait for premium opportunities
- Quality over quantity
- Protect your position near surge zones
- Accept deadhead only for high-value fares

**When to Switch:**
- Morning rush in Core? Be an Ant
- Late night in Rural? Be a Sniper
- Airport queue? Be a Sniper
- Downtown dinner rush? Be an Ant

**The Key:** Match your strategy to your market density and time of day.`,
    priority: 90,
    confidence: 90,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 90,
    tags: ['strategy', 'ant-sniper', 'fundamentals'],
  },

  // UPFRONT PRICING MECHANICS
  {
    market: 'Universal',
    market_slug: 'universal',
    intel_type: 'algorithm',
    title: 'Upfront Pricing: What Drivers Need to Know',
    summary: 'When you see the destination upfront, the game changes completely.',
    content: `**How Upfront Pricing Changes the Game:**
- You see destination AND fare before accepting
- This hardens market boundaries—drivers avoid cross-market rides
- The "deadhead risk" becomes visible before you commit

**Strategic Implications:**
1. **Decline strategically:** You can now avoid rides that strand you
2. **Market edge awareness:** Don't accept rides to isolated areas unless fare is premium
3. **Calculate round-trip value:** If fare is $25 but return is 45 min unpaid, is it worth it?

**Pro Tips:**
- In Upfront markets, your acceptance rate matters less than your selection quality
- Use the destination preview to identify "deadhead traps"
- Premium fares to Rural areas should be 2x what you'd normally accept

**Warning:** Declining too many rides affects your status—balance selection with volume.`,
    priority: 85,
    confidence: 90,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 85,
    tags: ['algorithm', 'upfront-pricing', 'mechanics'],
  },

  // AREA PREFERENCES (PLATINUM/DIAMOND)
  {
    market: 'Universal',
    market_slug: 'universal',
    intel_type: 'algorithm',
    title: 'Area Preferences: Your Geographic Shield',
    summary: 'Platinum/Diamond drivers can restrict requests to specific areas.',
    content: `**What Area Preferences Does:**
- Restricts ride requests to your preferred zones
- Creates a "soft border" around profitable areas
- Protects you from being pulled into Rural dead zones

**How to Use It:**
1. Identify your market's Core cities
2. Set your preference to include Core + adjacent Satellites
3. Exclude Rural nodes that lead to deadhead

**Strategic Application:**
- LA drivers: Exclude Inland Empire from preferences
- DFW drivers: Focus on Dallas-Fort Worth Core, exclude distant satellites
- Bay Area drivers: Include Peninsula + East Bay, be cautious of Vacaville edge

**Important:** This feature is for Platinum and Diamond status. If you're grinding for status, it may be worth the short-term pain for the long-term protection.`,
    priority: 80,
    confidence: 85,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 80,
    tags: ['algorithm', 'area-preferences', 'status'],
  },

  // HEATMAPS DECODED
  {
    market: 'Universal',
    market_slug: 'universal',
    intel_type: 'algorithm',
    title: 'Reading Heatmaps Like a Pro',
    summary: 'The heatmap shows demand density—but not the full picture.',
    content: `**What the Heatmap Actually Shows:**
- Current demand concentration (where riders are requesting)
- NOT the profitability of those rides
- NOT the deadhead risk after dropoff

**How to Read Between the Lines:**
- **Dense cluster in Core:** High volume, safe to enter
- **Isolated hot spot in Rural:** Trap! Everyone's chasing one ride
- **Heat at market edge:** Proceed with caution—check destination

**Pro Strategies:**
1. **Position at the edge of heat:** Beat other drivers to incoming requests
2. **Ignore Rural heat spikes:** Usually one-off events with terrible returns
3. **Watch heat patterns over time:** Learn where demand builds predictably

**The Offline Heatmap:**
Some markets have their own dedicated heatmaps (Florida Keys, Abilene TX, etc.). These are "Micro-Markets"—operationally distinct from their parent market.`,
    priority: 75,
    confidence: 85,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 75,
    tags: ['algorithm', 'heatmap', 'positioning'],
  },

  // LONG PICKUP PREMIUM
  {
    market: 'Universal',
    market_slug: 'universal',
    intel_type: 'algorithm',
    title: 'Long Pickup Premium: When Distance Pays',
    summary: 'Enable this in Rural areas to get paid for pickup miles.',
    content: `**What Long Pickup Premium Does:**
- Pays you for pickup distance beyond a threshold
- Essential for Rural/Satellite drivers
- Compensates for the "spread out" nature of low-density areas

**When to Enable:**
- Operating in Rural regions
- Working market edges (exurbs)
- Late night in Satellite cities

**Strategic Considerations:**
- In Core markets, pickups are short—this doesn't help much
- In Rural markets, this can save unprofitable drives
- Balance: Enabling may reduce total requests, but increases quality

**Pro Tip:** Check if your market supports Long Pickup Premium. Not all markets have it.`,
    priority: 70,
    confidence: 80,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 70,
    tags: ['algorithm', 'long-pickup', 'rural-strategy'],
  },

  // DEADHEAD RISK CALCULATOR CONTEXT
  {
    market: 'Universal',
    market_slug: 'universal',
    intel_type: 'strategy',
    title: 'The Deadhead Equation',
    summary: 'Calculate true profitability by accounting for unpaid return miles.',
    content: `**The Deadhead Equation:**
True Profit = Fare - (Return Miles × Cost Per Mile) - (Return Time × Opportunity Cost)

**Example:**
- Fare: $35 for a 20-mile ride to Rural area
- Return: 20 miles, 30 minutes, no rides
- Cost per mile: $0.30
- Opportunity cost: $20/hour = $10 for 30 min

**Calculation:**
$35 - ($0.30 × 20) - $10 = $35 - $6 - $10 = $19 actual profit

**Rule of Thumb:**
- Core to Core: Accept most rides
- Core to Satellite: Accept if fare > 1.2x normal
- Core to Rural: Accept only if fare > 2x normal
- Satellite to Rural: Decline unless fare is exceptional

**Use the Deadhead Calculator in the Intel tab to run these numbers before accepting.`,
    priority: 85,
    confidence: 90,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 85,
    tags: ['strategy', 'deadhead', 'profitability'],
  },

  // GREENLIGHT HUB SIGNIFICANCE
  {
    market: 'Universal',
    market_slug: 'universal',
    intel_type: 'general',
    title: 'Greenlight Hubs: The Market Capital',
    summary: 'Where the Hub is located tells you where the market center is.',
    content: `**Why Greenlight Hubs Matter:**
- Physical evidence of market's center of gravity
- Drivers from Satellites must travel to the Hub
- Hub location = Core of the market

**Strategic Insight:**
- If your city has a Hub, you're in a Core market
- If you must travel to another city for the Hub, you're in a Satellite
- The Hub city has the highest demand density

**Example:**
A driver in Santa Clarita, CA doesn't have a local Hub—they go to the LA Hub. This confirms Santa Clarita is a Satellite of the Los Angeles market.

**Action:** Know where your nearest Hub is. That's your market's Core.`,
    priority: 60,
    confidence: 95,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 60,
    tags: ['general', 'greenlight-hub', 'market-structure'],
  },

  // DMA CORRELATION
  {
    market: 'Universal',
    market_slug: 'universal',
    intel_type: 'general',
    title: 'Media Markets = Rideshare Markets',
    summary: 'Uber markets closely follow Nielsen TV market areas.',
    content: `**The DMA Connection:**
Uber's market definitions almost perfectly match Nielsen's Designated Market Areas (DMAs)—the regions used for TV advertising.

**Why This Matters:**
- If two cities share a TV market, they likely share a rideshare market
- This is a proxy for economic integration (commuter flow)

**Practical Application:**
- When unsure if a city is in your market, check if you see the same local news
- DMAs predict where return trips are likely
- Cross-DMA rides are almost always deadheads

**Example:**
Anniston, Gadsden, and Talladega in Alabama are all Birmingham DMA → all part of Birmingham rideshare market.`,
    priority: 55,
    confidence: 85,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 55,
    tags: ['general', 'dma', 'market-structure'],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// MARKET-SPECIFIC INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════════════

const marketSpecificIntel = [
  // LOS ANGELES
  {
    market: 'Los Angeles',
    market_slug: 'los-angeles',
    intel_type: 'strategy',
    title: 'Los Angeles: The Nation-State Market',
    summary: 'LA is not a city—it\'s a continent. Master it zone by zone.',
    content: `**Market Overview:**
Los Angeles is the most complex operating environment in the US. With 80+ municipalities, it requires zone-by-zone mastery.

**The Critical Split: LA vs Inland Empire**
- LA proper and Inland Empire are SEPARATE markets
- A ride from Santa Monica to Moreno Valley = 2-hour unpaid return
- Use Area Preferences to wall off these zones

**Core Cities (Safe in All Directions):**
Beverly Hills, Burbank, Culver City, Glendale, Inglewood, Long Beach, Los Angeles, Pasadena, Santa Monica

**Dangerous Edge Zones:**
- Lancaster/Palmdale: Antelope Valley is a one-way trap
- Santa Clarita: Often leads to deadhead
- Malibu: Beautiful but isolated

**Airport Strategy (LAX):**
- LAX is a Core location—good for returns
- But traffic can kill your hourly
- Avoid during peak congestion unless surging`,
    priority: 90,
    confidence: 90,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 90,
    tags: ['los-angeles', 'market-strategy', 'core'],
    neighborhoods: ['Beverly Hills', 'Burbank', 'Santa Monica', 'Culver City'],
  },

  // SAN FRANCISCO BAY AREA
  {
    market: 'San Francisco',
    market_slug: 'san-francisco',
    intel_type: 'strategy',
    title: 'San Francisco Bay Area: The Amalgamation',
    summary: 'Peninsula, East Bay, and South Bay are one unified market.',
    content: `**Market Overview:**
The Bay Area unifies the Peninsula, East Bay, and South Bay into one massive market. This is good news—rides across these zones are generally safe.

**Core Cities (92 total in market):**
San Francisco, Oakland, San Jose, Berkeley, Fremont, Palo Alto, Mountain View, Menlo Park, Hayward

**The Outer Ring Challenge:**
Vacaville and Fairfield sit on the edge—sometimes grouped with Bay Area for airport runs (SFO), but share commuter ties with Sacramento.

**Strategic Zones:**
- **South Bay Tech:** Mountain View, Palo Alto, Cupertino = weekday corporate demand
- **SF Downtown:** Dense, walkable = short trips, high volume
- **East Bay:** Oakland, Berkeley = university + transit hub demand

**Airport Strategy:**
- SFO is central—good from anywhere in the market
- OAK serves East Bay effectively
- SJC for South Bay residents

**Warning:** Gilroy and rural Santa Clara County can strand you.`,
    priority: 88,
    confidence: 90,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 88,
    tags: ['san-francisco', 'bay-area', 'market-strategy'],
    neighborhoods: ['San Francisco', 'Oakland', 'San Jose', 'Palo Alto'],
  },

  // PHOENIX
  {
    market: 'Phoenix',
    market_slug: 'phoenix',
    intel_type: 'strategy',
    title: 'Phoenix: The Unified Grid',
    summary: 'Unlike LA, Phoenix functions as one massive, unified market.',
    content: `**Market Overview:**
Phoenix is a massive, unified grid—different from the distinct zones of the Bay Area. This means more flexibility but also more distance.

**Core Cities:**
Phoenix, Scottsdale, Tempe, Mesa, Chandler, Gilbert, Glendale

**The Exurb Challenge:**
Maricopa and Casa Grande are separated from Phoenix by tribal land or desert but economically tethered to it. These are "Phoenix Fringe" zones—expect spotty availability and long pickup fees.

**Independent Micro-Markets (Avoid from Phoenix):**
- Flagstaff: 2 hours north, separate driver pool
- Sedona: Tourist trap, but isolated
- Yuma: Completely separate market

**Grid Strategy:**
- Phoenix's grid system makes navigation predictable
- Use the grid to position yourself between Core cities
- Airport (Sky Harbor) is central—good for any direction

**Heat Warning:** Summer heat kills demand during midday—shift early or late.`,
    priority: 85,
    confidence: 90,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 85,
    tags: ['phoenix', 'market-strategy', 'grid'],
    neighborhoods: ['Scottsdale', 'Tempe', 'Mesa', 'Chandler'],
  },

  // DALLAS-FORT WORTH
  {
    market: 'Dallas-Fort Worth',
    market_slug: 'dallas-fort-worth',
    intel_type: 'strategy',
    title: 'Dallas-Fort Worth: The Dual Core',
    summary: 'Two anchors, one market—but know which direction you\'re headed.',
    content: `**Market Overview:**
DFW is a true "dual core" market—Dallas and Fort Worth are both Core cities. This creates interesting dynamics.

**Core Cities:**
Dallas, Fort Worth, Arlington, Irving

**Key Satellites:**
Frisco, Plano, McKinney, Denton, Lewisville, Grand Prairie, Garland, Mesquite

**Strategic Insight:**
- Rides between Dallas and Fort Worth are SAFE
- The 30-mile span between cores creates constant demand
- Arlington (between them) is a sweet spot

**Northern Expansion:**
Frisco, Plano, McKinney = rapidly growing tech suburbs. High demand but watch for rides going further north (deadhead).

**Airport Strategy (DFW):**
- DFW Airport is perfectly positioned between cores
- Airport runs are profitable from anywhere in the market
- Love Field (Dallas) is more localized

**Warning Zones:**
- Anything south of Fort Worth gets rural fast
- Denton can lead to deadhead toward Oklahoma`,
    priority: 85,
    confidence: 90,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 85,
    tags: ['dallas', 'fort-worth', 'dfw', 'market-strategy'],
    neighborhoods: ['Dallas', 'Fort Worth', 'Frisco', 'Plano', 'Arlington'],
  },

  // MIAMI / SOUTH FLORIDA
  {
    market: 'Miami',
    market_slug: 'miami',
    intel_type: 'strategy',
    title: 'South Florida: The Peninsula of Convergence',
    summary: 'Miami, Fort Lauderdale, and Palm Beach dissolve into one zone.',
    content: `**Market Overview:**
In South Florida, market boundaries dissolve. Miami, Fort Lauderdale, Boca Raton, and West Palm Beach form one continuous "South Florida" zone.

**Core Cities:**
Miami, Fort Lauderdale, Hollywood, Coral Gables, Boca Raton

**The Continuous Corridor:**
- You can pick up in Coral Gables and drop in Hollywood seamlessly
- The entire Gold Coast functions as one market
- I-95 is your spine—stay near it

**Florida Keys: THE EXCEPTION**
The Keys have their own heatmap and are operationally SEPARATE from Miami. The Overseas Highway creates a "hard border."
- Key Largo is NOT Miami
- A ride to the Keys is a one-way trip
- Only accept Keys rides if you want a vacation

**Airport Strategy:**
- MIA (Miami International) is central and high-volume
- FLL (Fort Lauderdale) serves cruise ports
- Both are safe for any direction

**Tourism Timing:**
- Winter (Nov-Mar) = peak season, heavy demand
- Summer = locals only, afternoon thunderstorms`,
    priority: 85,
    confidence: 90,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 85,
    tags: ['miami', 'south-florida', 'market-strategy', 'tourism'],
    neighborhoods: ['Miami Beach', 'Coral Gables', 'Fort Lauderdale', 'Boca Raton'],
  },

  // BIRMINGHAM (Example of Tri-Polar State)
  {
    market: 'Birmingham',
    market_slug: 'birmingham',
    intel_type: 'strategy',
    title: 'Birmingham: Alabama\'s Primary Hub',
    summary: 'The largest gravity well in Alabama—but know its limits.',
    content: `**Market Overview:**
Birmingham serves as Alabama's primary gravity well. It swallows most of Jefferson and Shelby counties.

**Core City:** Birmingham

**Key Satellites (Safe Returns):**
Hoover, Vestavia, Homewood, Mountain Brook, Trussville, Bessemer, Irondale, Gardendale

**The Southern Tail:**
The Birmingham market extends remarkably far south—even Clanton (halfway to Montgomery) is included. This captures I-65 transit traffic.

**Warning Zones:**
- Anniston/Gadsden: Part of Birmingham market but at the edge
- Talladega: Rural, deadhead risk
- Jasper: Rural, isolated

**State Context:**
Alabama is a "Tri-Polar State":
1. Birmingham (Central) - Largest
2. Mobile (Coastal) - Tourism/port economy
3. Huntsville (Northern) - Tech corridor

Rides between these three poles are long deadheads.`,
    priority: 80,
    confidence: 85,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 80,
    tags: ['birmingham', 'alabama', 'market-strategy'],
    neighborhoods: ['Hoover', 'Vestavia', 'Mountain Brook', 'Homewood'],
  },

  // ATLANTA
  {
    market: 'Atlanta',
    market_slug: 'atlanta',
    intel_type: 'strategy',
    title: 'Atlanta: The Southern Sprawl Capital',
    summary: 'Massive geographic spread with heavy traffic—position strategically.',
    content: `**Market Overview:**
Atlanta is the quintessential "sprawl" market. The metro area covers an enormous geographic footprint.

**Core Cities:**
Atlanta, Marietta, Sandy Springs, Roswell, Alpharetta, Decatur

**The ITP/OTP Divide:**
- ITP = Inside the Perimeter (I-285) = Higher density, more rides
- OTP = Outside the Perimeter = Suburbs, longer distances

**Strategic Positioning:**
- Buckhead: High-value corporate/nightlife
- Midtown: Entertainment district
- Airport (ATL): Massive demand, but traffic can kill hourly
- Perimeter Mall area: Corporate campus demand

**Traffic Warning:**
Atlanta traffic is legendary. A 10-mile ride can take 45 minutes.
- Avoid I-285 during rush hours
- Use local knowledge to navigate
- Factor traffic into deadhead calculations

**Airport Strategy (Hartsfield-Jackson):**
- World's busiest airport = constant demand
- But traffic TO the airport can strand you
- Best times: Early morning, late evening`,
    priority: 82,
    confidence: 85,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 82,
    tags: ['atlanta', 'georgia', 'market-strategy', 'sprawl'],
    neighborhoods: ['Buckhead', 'Midtown', 'Decatur', 'Sandy Springs'],
  },

  // HOUSTON
  {
    market: 'Houston',
    market_slug: 'houston',
    intel_type: 'strategy',
    title: 'Houston: The Sprawl Metroplex',
    summary: 'One of America\'s largest metros by area—distance is your enemy.',
    content: `**Market Overview:**
Houston is physically massive—one of the largest US metros by land area. Distance and traffic are your primary concerns.

**Core City:** Houston

**Key Satellites:**
Katy, Sugar Land, The Woodlands, Pearland, Pasadena, Baytown, Conroe

**Distance Warning:**
- Katy to downtown Houston: 30 miles
- The Woodlands to downtown: 27 miles
- These distances mean significant deadhead risk from edges

**Strategic Zones:**
- **Downtown/Midtown:** Dense corporate demand
- **Galleria area:** Shopping/hotel cluster
- **Medical Center:** Constant demand but parking challenges
- **Energy Corridor:** Corporate demand, weekday focused

**Airport Strategy:**
- IAH (Bush) is FAR north—watch for rides going further north
- HOU (Hobby) is closer to Core, safer returns
- Galveston cruises add seasonal demand

**Warning:** Galveston is at the edge. Beach rides are fun but returns can be painful.`,
    priority: 82,
    confidence: 85,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 82,
    tags: ['houston', 'texas', 'market-strategy', 'sprawl'],
    neighborhoods: ['Galleria', 'Downtown', 'Medical Center', 'Katy'],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// ZONE INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════════════

const zoneIntel = [
  {
    market: 'Universal',
    market_slug: 'universal',
    intel_type: 'zone',
    intel_subtype: 'honey_hole',
    title: 'Identifying Honey Holes',
    summary: 'High-demand zones with good return trip potential.',
    content: `**What Makes a Honey Hole:**
- High concentration of ride requests
- Good geographic positioning for returns
- Consistent demand patterns (predictable)
- Multiple pickup points in walking distance

**Common Honey Hole Locations:**
1. **Airport arrival zones** (not departures)
2. **Major entertainment districts** after 10 PM
3. **Hotel clusters** in Core cities
4. **Transit hubs** during rush hours
5. **Stadium/arena districts** 30 min after events

**How to Work a Honey Hole:**
- Position nearby, not inside (avoid congestion)
- Learn the timing patterns
- Don't fight other drivers—find the edge
- Be ready to pivot when demand shifts`,
    priority: 80,
    confidence: 85,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 80,
    tags: ['zone', 'honey-hole', 'positioning'],
  },
  {
    market: 'Universal',
    market_slug: 'universal',
    intel_type: 'zone',
    intel_subtype: 'dead_zone',
    title: 'Avoiding Dead Zones',
    summary: 'Areas with minimal demand and high deadhead risk.',
    content: `**What Makes a Dead Zone:**
- Low population density
- Few commercial/entertainment destinations
- Separated from Core by distance or geography
- Minimal return ride probability

**Common Dead Zone Patterns:**
1. **Industrial areas** after business hours
2. **Rural residential** beyond suburbs
3. **Geographic barriers** (mountains, water, tribal land)
4. **Gated communities** (drop-offs only)

**When You End Up in a Dead Zone:**
- Head toward the nearest Core immediately
- Don't wait for rides—probability is too low
- Calculate: Is it faster to drive back or wait?
- Enable Long Pickup Premium if available

**Prevention:** Use the market position indicator to avoid rides heading toward Rural zones.`,
    priority: 75,
    confidence: 85,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 75,
    tags: ['zone', 'dead-zone', 'avoidance'],
  },
  {
    market: 'Universal',
    market_slug: 'universal',
    intel_type: 'zone',
    intel_subtype: 'danger_zone',
    title: 'Managing Danger Zones',
    summary: 'Areas requiring extra awareness and caution.',
    content: `**Types of Danger Zones:**

**1. Economic Danger (Deadhead Traps)**
- Market edges with one-way demand
- Isolated venues (stadiums after events)
- Resort areas with limited return traffic

**2. Geographic Danger (Navigation Hazards)**
- Areas with poor cell coverage
- Confusing layouts (industrial complexes)
- Limited road options (one way in/out)

**3. Safety Danger (Personal Risk)**
- Check local crime data
- Trust your instincts
- Don't chase surge into unfamiliar areas

**How to Handle:**
- For economic danger: Use Upfront Pricing to preview
- For geographic danger: Verify route before accepting
- For safety danger: Keep doors locked, stay alert

**Key Rule:** It's always okay to cancel if something feels wrong.`,
    priority: 75,
    confidence: 80,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 75,
    tags: ['zone', 'danger-zone', 'safety'],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// TIMING INTELLIGENCE
// ═══════════════════════════════════════════════════════════════════════════

const timingIntel = [
  {
    market: 'Universal',
    market_slug: 'universal',
    intel_type: 'timing',
    title: 'Optimal Driving Windows',
    summary: 'When to drive based on market type and demand patterns.',
    content: `**Core Markets - Best Times:**
- **Morning Rush (6-9 AM):** Airport runs, commuters
- **Lunch (11 AM-1 PM):** Business meetings, errands
- **Evening Rush (4-7 PM):** Commuters returning home
- **Night (9 PM-2 AM):** Bars, entertainment, events

**Satellite Markets - Best Times:**
- **Morning Rush:** People heading TO Core
- **Evening Rush:** People returning FROM Core
- **Avoid Midday:** Low density, long waits

**Rural Markets - Best Times:**
- **Event-based only:** Concerts, games, festivals
- **Airport shuttles:** When flights align
- **Avoid random hours:** Not enough density

**Universal Peak Events:**
- Major sporting events (+30 min after)
- Concert venues (when doors open + after)
- Holiday weekends (travel days)
- Bad weather (demand spikes, fewer drivers)`,
    priority: 85,
    confidence: 85,
    source: 'research',
    coach_can_cite: true,
    coach_priority: 85,
    tags: ['timing', 'demand-patterns', 'optimization'],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SEEDING FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

async function seedIntelligence() {
  console.log('🧠 Seeding Market Intelligence from Research...\n');

  const allIntel = [
    ...universalIntel,
    ...marketSpecificIntel,
    ...zoneIntel,
    ...timingIntel,
  ];

  console.log(`📊 Total intelligence items to seed: ${allIntel.length}\n`);

  let inserted = 0;
  let updated = 0;
  let errors = 0;

  for (const intel of allIntel) {
    try {
      // Check if this intelligence already exists (by market_slug and title)
      const existing = await db
        .select()
        .from(market_intelligence)
        .where(and(
          eq(market_intelligence.market_slug, intel.market_slug),
          eq(market_intelligence.title, intel.title)
        ))
        .limit(1);

      if (existing.length > 0) {
        // Update existing
        await db
          .update(market_intelligence)
          .set({
            ...intel,
            updated_at: new Date(),
            version: existing[0].version + 1,
          })
          .where(eq(market_intelligence.id, existing[0].id));
        updated++;
        console.log(`  ✏️  Updated: ${intel.title}`);
      } else {
        // Insert new
        await db
          .insert(market_intelligence)
          .values({
            ...intel,
            is_active: true,
            is_verified: true,
            version: 1,
            effective_date: new Date(),
            created_by: 'research-seeder',
          });
        inserted++;
        console.log(`  ➕ Inserted: ${intel.title}`);
      }
    } catch (err) {
      console.error(`  ❌ Error with "${intel.title}":`, err.message);
      errors++;
    }
  }

  console.log('\n📊 Seeding Complete:');
  console.log(`   ➕ Inserted: ${inserted}`);
  console.log(`   ✏️  Updated: ${updated}`);
  if (errors > 0) console.log(`   ❌ Errors: ${errors}`);

  // Show summary
  const summary = await db.execute(`
    SELECT
      market_slug,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE intel_type = 'strategy') as strategies,
      COUNT(*) FILTER (WHERE intel_type = 'algorithm') as algorithm,
      COUNT(*) FILTER (WHERE intel_type = 'zone') as zones,
      COUNT(*) FILTER (WHERE intel_type = 'timing') as timing
    FROM market_intelligence
    WHERE is_active = true
    GROUP BY market_slug
    ORDER BY total DESC
  `);

  console.log('\n📋 Intelligence by Market:');
  console.table(summary.rows);

  process.exit(0);
}

seedIntelligence().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
