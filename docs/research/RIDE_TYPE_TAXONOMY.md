# RIDE_TYPE_TAXONOMY.md — ride types, tiers, and vehicle eligibility

> **INTERNAL DATA ASSET — never ship verbatim to a driver-facing surface.** The matcher
> needs literal operator display strings, so platforms are named directly here; the
> driver-facing rule ("never say Uber — say *the third-party app*", Melody 2026-08-17)
> governs guides, marketing and UI copy, not this file. Server-side / internal only.
>
> **Version:** 2.0 · generated 2026-08-19 · anchor market Dallas–Fort Worth, TX · scope
> global (US/DFW facts are marked as such).
> **Provenance:** Claude-authored research (Cowork sessions 2026-08-18/19), four parallel
> primary-source agents + an adversarial verification pass (12 highest-stakes claims
> re-checked, 0 refuted). **Not yet reconciled against this repo's code** — it is research
> input per `AI_PARTNERSHIP_AGREEMENT.md` §19.1 until integrated. Every row carries a
> confidence grade (§0.2); Grade U rows are explicitly unknown and must fall through to
> generic rules, never be guessed.
> **Landed in the repo:** 2026-08-26, from Melody's Drive folder (Google Doc *Copy of
> Verify DFW Rideshare Taxonomy*, the v2.0 successor to the v1.0 PDF in the same folder;
> v1.0's US-only text differs only in the platform registry, the DoorDash tier thresholds
> — v2 replaces Grade-S guesses with the cited 0–100 points model — and two Lyft-Texas
> confirmations). Markdown normalized from the Doc export; **content verbatim**.
> **Integration status:** `todo` #71 (T1–T11). Nothing here is wired into the analyzer yet.
> `RIDE_TYPE_CATALOG.v1.json` (the machine-loadable companion named in the session report)
> was **not** in the Drive folder — still outstanding.
> **Refresh:** quarterly minimum, mandatory each January (model-year floors increment
> annually); Lyft announced vehicle-age changes effective 2026-01-01. Feed endpoint in §16.1.

---

## §0.1 How to use this document

This file answers two different questions. Keep them separate.

Question A — "What is this offer?" Input: OCR text from an offer card. Output: a canonical tier + a set of modifiers. Use §2 (canonical tiers), §3 (string normalization), §4 (modifier flags). Never infer a tier from price or distance. Match on strings only.

Question B — "What can this car do?" Input: platform + market + make + model + model year + trim seat count. Output: the set of tiers that vehicle is eligible for. Use §5 (gates), §6–§9 (vehicle lists), §10 (the six-seat trap).

Do not merge the two. A driver's eligibility does not tell you what an offer is, and an offer's tier does not prove the driver is eligible for it.

Matching order (deterministic — follow exactly)

1.  Normalize whitespace, strip punctuation except "•" and "&", uppercase-fold for comparison.
2.  Split the ride-type field on "•" (Uber composes as "{tier} • {modifier}").
3.  Match segment 1 against §3 EXACT_STRINGS. First exact match wins.
4.  If no exact match, match against §3 ALIASES (includes stale/legacy strings).
5.  If still no match → tier = UNKNOWN. Do NOT guess. Emit UNKNOWN and let the  
    ruleset fall through to its generic $/mile floor.
6.  Match remaining segments and any badge text against §4 MODIFIERS.  
    Modifiers are additive and orthogonal — a card can carry several.
7.  Emit: { platform, canonical_tier, display_string_raw, modifiers[], confidence }

Rules that prevent the known failure modes

UNKNOWN is a valid output. Inventing a tier is worse than admitting one wasn't read. A blank or partially-rendered screen must produce UNKNOWN, not a plausible-looking default.

Never treat XL eligibility as platform-agnostic. Documented DFW conflicts in §11. Four popular models pass on one platform and fail on the other.

Never derive green/EV eligibility from a platform's "Electric" product tag. Uber's own feed is defective on this point (§9.1). Derive from powertrain.

Black/premium tiers are a conjunction, not a lookup hit. Model on the eligible list is necessary, not sufficient — color, interior, rating, insurance, and (in Dallas) a city permit all gate it (§5.1).

## §0.2 Confidence grades

| **Grade** | **Meaning** |
|---|---|
| A | Pulled from the operator's own market-scoped eligibility feed or city page |
| B | Operator's national policy/help page — official, but not market-specific |
| C | Third-party verified (manufacturer specs, press) — not the operator |
| S | Secondhand only (driver blogs, aggregators) — treat as a hint, not a fact |
| U | UNVERIFIED — could not confirm from any source. Listed in §15 |
| Rows without an explicit grade inherit their section's grade. |   |

## §1 Platform registry

  

| **platform_id** | **Name** | **Owner-operator?** | **DFW live?** | **Generates offers?** | **Notes** |
|---|---|---|---|---|---|
| uber | Uber | yes | yes | yes | Primary |
| lyft | Lyft | yes | yes | yes | Primary |
| bolt | Bolt | yes | no | yes | Global platform (Europe, Africa, etc.)1 |
| didi | DiDi | yes | no | yes | Global platform (China, LATAM, etc.)1 |
| grab | Grab | yes | no | yes | Global platform (Southeast Asia)1 |
| freenow | FreeNow | yes | no | yes | Global platform (Europe)1 |
| ola | Ola Cabs | yes | no | yes | Global platform (India, etc.)1 |
| alto | Alto | NO | yes | no | W-2 employees in company vehicles. No owner-operator path in any market. Context only — see §12.1 |
| spark | Walmart Spark Driver | yes | yes | yes | Delivery only. There is no rideshare product named "Spark" in the US |
| uzurv | UZURV | yes | yes | yes | Adaptive TNC / paratransit / NEMT |
| hopskipdrive | HopSkipDrive | yes | yes | yes | Minors |
| veyo | Veyo (MTM Health) | yes | yes (TX) | yes | NEMT. Acquired by MTM Health, not ModivCare |
| ztrip | zTrip | yes (or lease) | yes | yes | Taxi/for-hire fleet |
| empower | Empower | yes | yes | yes | Driver sets own price, flat subscription |
| hitch | Hitch | yes | yes (TX lanes) | yes | Intercity, 165–240 mi trips |
| favor | Favor Delivery | yes | yes | yes | Texas-native (H-E-B) |
| doordash | DoorDash | yes | yes | yes | Delivery |
| ubereats | Uber Eats | yes | yes | yes | Delivery, dispatched in the Uber driver app |
| instacart | Instacart | yes | yes | yes | Delivery |
| amazonflex | Amazon Flex | yes | yes | yes | Block-based delivery |
| roadie | Roadie | yes | yes | yes | UPS subsidiary |
| curb | Curb | no | no | no | Regulator-licensed taxi only. TX presence = San Antonio Pair & Pay only |
| blacklane | Blacklane | no | — | no | Chauffeur companies only |
| zum | Zum | no | no | no | Company vehicles |
| gogograndparent | GoGoGrandparent | n/a | yes | no | Books Uber/Lyft on riders' behalf. Arrives as an ordinary Uber/Lyft offer |
| revel | Revel | — | — | no | Shut down rideshare 2025-08-11. Pivoted to EV charging |
| indrive | inDrive | yes | no | no | No Texas presence found |
| waymo | Waymo | n/a | yes | no | Autonomous. Model as demand suppression, not supply — see §12.3 |
| Engine rule: only generates_offers = yes platforms belong in the offer analyzer. Everything else is market context. |   |   |   |   |   |

## §2 Canonical tier taxonomy

The internal vocabulary. Every platform string in §3 resolves to exactly one of these. Tiers are ordered by rough revenue class within a platform, not across.

| **canonical_tier** | **Class** | **Typical pax** | **Meaning** |
|---|---|---|---|
| economy_shared | economy | 1–2 | Ride pooled with strangers. Discounted |
| economy_flex | economy | 4 | Standard car, rider accepted a longer wait for a lower price |
| economy_standard | economy | 4 | The base tier. UberX / Lyft Standard |
| economy_priority | economy | 4 | Standard car, rider paid for a faster pickup |
| comfort | mid | 4 | Newer/roomier car, driver rating + trip-count gated |
| comfort_ev | mid | 4 | Comfort, battery-electric vehicle required |
| eco | economy/mid | 4 | Low-emission vehicle requested. Powertrain rules differ by platform (§9) |
| xl | large | 6 | 7 factory seats / 7 seatbelts required |
| xl_cargo | large | 6 | XL plus large-luggage capacity |
| premium_sedan | premium | 4 | Black/Premier sedan class. Color + interior + rating gated |
| premium_suv | premium | 6 | Black SUV / Premier SUV class |
| premium_hourly | premium | 4–6 | Premium vehicle booked by the hour |
| accessible_wav | accessible | varies | Wheelchair-accessible vehicle. Certification required |
| assisted | accessible | 4 | Driver provides door-to-door physical assistance. Opt-in + training |
| senior_select | accessible | 4 | Low-entry vehicle, extended wait, simplified rider app |
| intercity | long-haul | varies | City-to-city, 100+ mi |
| delivery_food | delivery | 0 | Prepared food |
| delivery_retail | delivery | 0 | Groceries / general merchandise, may include shopping |
| delivery_package | delivery | 0 | Parcels, returns, courier |
| UNKNOWN | — | — | Emit this rather than guessing. See §0.1 |
| Tier is not the same as booking mode |   |   |   |
| reserve / scheduled / hourly are modifiers (§4), not tiers — they layer over a base tier. Uber Reserve on a Comfort car is {tier: comfort, modifiers: [reserve]}. |   |   |   |

The one exception is premium_hourly, which Uber's own DFW feed carries as a distinct product (Black Hourly) with its own vehicle list.

## §3 String normalization — OCR → canonical tier

This is the section the offer analyzer reads first.

Two label systems exist on both platforms. Marketing pages say "Uber Black"; the in-app picker and the driver offer card say Black. Lyft is internally inconsistent on three strings of its own. Carry every variant.

## §3.1 Uber strings (Grade A unless noted)

| **Exact string seen** | **Where it appears** | **→ canonical_tier** |
|---|---|---|
| UberX | in-app + driver card | economy_standard |
| Uber X | spacing variant | economy_standard |
| Share | in-app | economy_shared |
| UberX Share | marketing | economy_shared |
| Uber XShare | Uber Pro footnotes | economy_shared |
| Uber Share | Uber Pro footnotes | economy_shared |
| Route Share | Dallas launch product | economy_shared |
| Wait & Save | in-app | economy_flex |
| Uber Wait & Save | Uber Pro footnotes | economy_flex |
| Priority | in-app | economy_priority |
| UberX Priority | marketing | economy_priority |
| Comfort | in-app + driver card | comfort |
| Uber Comfort | marketing | comfort |
| Comfort Electric | in-app | comfort_ev |
| Uber Comfort Electric | marketing | comfort_ev |
| Electric | in-app | eco |
| Uber Electric | marketing (renamed 2025-10-22) | eco |
| Uber Green | stale, still in Uber's own driver copy | eco |
| Green | stale in-app | eco |
| UberXL | in-app + driver card | xl |
| Uber XL | spacing variant | xl |
| UberXL Priority | DFW feed product | xl |
| UberXXL | in-app | xl_cargo |
| Black | in-app + driver card | premium_sedan |
| Uber Black | marketing | premium_sedan |
| Premier | in-app (Premier markets only) | premium_sedan |
| Uber Premier | marketing | premium_sedan |
| Select | legacy, still in Uber's Comfort copy | premium_sedan |
| Black SUV | in-app + driver card | premium_suv |
| Uber Black SUV | marketing | premium_suv |
| Uber SUV | legacy | premium_suv |
| Premier SUV | in-app (Premier markets) | premium_suv |
| Black Hourly | DFW feed product | premium_hourly |
| Hourly | in-app | premium_hourly |
| Uber WAV | marketing | accessible_wav |
| WAV | in-app | accessible_wav |
| Uber Assist | Grade U in the US — no US page exists in 2026 | assisted |
| Uber Intercity | marketing | intercity |
| Uber Connect | marketing | delivery_package |
| Package Dropoff | feed product name | delivery_package |
| Uber Eats | driver card | delivery_food |
| Shuttle | in-app (not DFW) | — fixed-route, out of scope |
| Uber Taxi / Taxi | in-app (not DFW) | economy_standard |
| Uber's • composition rule — critical |   |   |
| Uber composes offer cards as {base tier} • {modifier}. Uber documents this directly for teen rides: "your offer card may read 'UberX • Teen.'" |   |   |

Parse on •. Expect UberX • Teen, and by extension Comfort • Pet, UberX • Reserve, etc. Segment 1 is the tier; every later segment is a modifier.

Premier and Black are mutually exclusive per city

A market gets one or the other, never both. DFW is a Black market — if you OCR Premier on a DFW screen, that is a read error or the driver is out of market. Austin is a Premier market. (Grade A: DFW/DAL/IAH/LAX airport feeds show Black; AUS shows Premier + Premier SUV.)

## §3.2 Lyft strings (Grade A unless noted)

| **Exact string seen** | **Where it appears** | **→ canonical_tier** |
|---|---|---|
| Standard | rider + driver | economy_standard |
| Shared | rider | economy_shared |
| Wait & Save | rider carousel | economy_flex |
| Wait and Save | no-ampersand variant, Lyft Silver page | economy_flex |
| Priority Pickup | rider | economy_priority |
| Extra Comfort | rider + driver | comfort |
| Green | rider | eco |
| XL | rider + driver | xl |
| Lyft XL | marketing | xl |
| XXL | rider | xl_cargo |
| Black | rider + driver | premium_sedan |
| Lyft Black | marketing | premium_sedan |
| Lux | RETIRED ~Oct–Nov 2023 → replaced by Extra Comfort | comfort |
| Lyft Preferred | RETIRED → Extra Comfort | comfort |
| Black SUV | rider + driver | premium_suv |
| Black XL | stale CMS key luxsuv | premium_suv |
| Lux Black | retired → renamed Black | premium_sedan |
| Lux Black XL | retired → renamed Black SUV | premium_suv |
| Wheelchair | current name | accessible_wav |
| Access | former name, still used in Lyft's own ride-types overview | accessible_wav |
| Lyft Assisted | driver offer label (verbatim) | assisted |
| Silver Select | driver | senior_select |
| Lyft Silver | NOT a ride type — simplified rider app only | — ignore as tier |
| Car Seat | NYC only | economy_standard + car_seat |
| Minnie Van | Walt Disney World only | xl |
| Lyft legacy CMS keys — backend cross-reference only, never display strings |   |   |
| standard → LYFT · plus → XL · premier → LUX · lux → BLACK · luxsuv → BLACK XL · lyft_line → Shared ride · lyft_plus → Supersized ride · lyft_premier → High-end ride · lyft_lux → Luxury ride · lyft_luxsuv → Spacious luxury ride |   |   |

Lyft naming collision — do not merge these

Priority Mode is a driver-side home-screen toggle ("you'll get more rides… less time waiting between requests"). Priority Pickup is a rider-side paid upgrade. Different things. A parser that collapses them will mis-tier offers.

## §3.3 Machine-readable alias map

  
  
  

JSON

{  
  "uber": {  
    "economy_standard": ["UberX", "Uber X", "Uber Taxi", "Taxi"],  
    "economy_shared":   ["Share", "UberX Share", "Uber XShare", "Uber Share", "Route Share"],  
    "economy_flex":     ["Wait & Save", "Uber Wait & Save", "Wait and Save"],  
    "economy_priority": ["Priority", "UberX Priority"],  
    "comfort":          ["Comfort", "Uber Comfort"],  
    "comfort_ev":       ["Comfort Electric", "Uber Comfort Electric"],  
    "eco":              ["Electric", "Uber Electric", "Uber Green", "Green"],  
    "xl":               ["UberXL", "Uber XL", "UberXL Priority"],  
    "xl_cargo":         ["UberXXL", "Uber XXL"],  
    "premium_sedan":    ["Black", "Uber Black", "Premier", "Uber Premier", "Select"],  
    "premium_suv":      ["Black SUV", "Uber Black SUV", "Uber SUV", "Premier SUV"],  
    "premium_hourly":   ["Black Hourly", "Hourly"],  
    "accessible_wav":   ["WAV", "Uber WAV"],  
    "assisted":         ["Uber Assist"],  
    "intercity":        ["Uber Intercity"],  
    "delivery_package": ["Uber Connect", "Package Dropoff"],  
    "delivery_food":    ["Uber Eats"]  
  },  
  "lyft": {  
    "economy_standard": ["Standard"],  
    "economy_shared":   ["Shared"],  
    "economy_flex":     ["Wait & Save", "Wait and Save"],  
    "economy_priority": ["Priority Pickup"],  
    "comfort":          ["Extra Comfort", "Lux", "Lyft Preferred"],  
    "eco":              ["Green"],  
    "xl":               ["XL", "Lyft XL", "Minnie Van"],  
    "xl_cargo":         ["XXL"],  
    "premium_sedan":    ["Black", "Lyft Black", "Lux Black"],  
    "premium_suv":      ["Black SUV", "Black XL", "Lux Black XL"],  
    "accessible_wav":   ["Wheelchair", "Access"],  
    "assisted":         ["Lyft Assisted"],  
    "senior_select":    ["Silver Select"]  
  },  
  "composition_separator": "•",  
  "unmatched_behavior": "emit UNKNOWN, never guess"  
}  
  

## §4 Modifier flags — badges, add-ons, booking modes

Modifiers are orthogonal to tier and additive. One card can carry several. They are what actually drive most accept/reject rules, so parse them independently of the tier field.

## §4.1 Uber

| **Exact string** | **Kind** | **Grade** | **Meaning / effect on a driver rule** |
|---|---|---|---|
| Exclusive | badge | A | Request sent only to you. Counts toward acceptance rate. Guaranteed if accepted |
| Accept | button | A | Appears on Exclusive requests. Blue for rides, green for deliveries |
| Match | button | A | Trip Radar request — broadcast to multiple drivers, not guaranteed. Does NOT affect acceptance rate |
| Verified | badge | A | Rider completed ID verification (CLEAR partnership, launched 2024-09) |
| Teen | composition segment | A | Official teen account. Appears as UberX • Teen |
| Pet label | badge | S | Pet on board. Exact string not published |
| Uber Reserve / Reserve | booking mode | A | Scheduled up to 90 days out. Locked price. Higher cancellation fees than on-demand |
| Multi-stop trips | trip format | B | Uber's prose term. The literal offer-card badge string is UNVERIFIED |
| Back-to-back trips | trip format | B | Next request arrives before the current trip ends |
| Surge / Promotion | pricing | U | Exact offer-card strings UNVERIFIED |
| Long trip | badge | U | UNVERIFIED |
| Round trip | badge | U | UNVERIFIED |
| Trip Radar rule (Grade A, verbatim): "Trip Radar trip requests won't have the 'Exclusive' badge, and you will see a 'Match' button instead of an 'Accept' button." At select airports, joining the waiting lot means all requests arrive via Trip Radar with no Exclusive badge — so absence of Exclusive at an airport is normal, not a signal. |   |   |   |

⚠️ Acceptance rate and cancellation rate are not symmetric here. Uber: "Trip Radar does not impact your acceptance rate." But also: "canceling a trip after being matched will affect your cancellation rate." A Match is free to ignore and not free to abandon. Any rule that treats Trip Radar as consequence-free must still guard the cancel path.

Uber's own driver-preference taxonomy (verbatim, Grade A):

Ride type (depending on eligibility): UberX, UberXL, Uber Comfort, Uber Black, Uber Electric

Ride add-ons: Uber Pet, Uber Car Seat

Other services: Deliveries (such as food and packages)

Trip filters: Area preferences, payment preferences, rider preferences (such as Women Rider Preference)

## §4.2 Lyft

| **Exact string** | **Kind** | **Grade** | **Meaning** |
|---|---|---|---|
| Teen passenger | badge on accept screen | A | Teen account. Pairs with a Teen passenger bonus of $1 |
| Lyft Assisted | request label | A | Assisted ride. Bonus amount shown on the request |
| Pet ride bonus | earnings line | A | $4. Drivers are auto opted-in; toggle in Ride Preferences |
| Turbo | bonus | A | Planned bonus, folded into Upfront Pay on the accept screen. 10%+ on base earnings. Not in WA state, NYC, Portland |
| Flash Turbo | bonus | A | Real-time map zones (replaced "bonus zones"). Lost if you change ride types after entering the zone |
| Ride Challenges | bonus | A | Up to 3 stacking tiers, home-screen progress |
| Scheduled Rides Premium | earnings line | A | Premium on scheduled pickups |
| Queued Rides | pre-match | A | Timed decline window, then auto-accept into queue. Cancelling after queueing hurts acceptance rate |
| Rider verification badge | badge | A | Driver sees only: first name, rating, verification status, photo. Data hidden after 24h. Cancelling solely because a rider is unverified incurs the standard penalty |
| Lyft driver offer card baseline (Grade A): passenger name, pickup ETA, ride type, Upfront Pay amount, pickup + drop-off, estimated time & distance, map view, and optionally an estimated $/hour rate at the bottom of the request. Upfront Pay covers Standard, Extra Comfort, Black, XL, Black SUV. |   |   |   |

Not confirmed as driver-visible badges (Grade U): Priority Pickup, Wait & Save, Shared, Women+ Connect, Silver Select. Evidence indicates Priority Pickup and Wait & Save dispatch into the Standard pool — expect Standard on those cards until observed otherwise.

## §4.3 Canonical modifier vocabulary

  
  
  

JSON

{  
  "modifiers": [  
    "exclusive", "trip_radar_match", "verified_rider", "unverified_rider",  
    "teen", "pet", "car_seat", "assisted", "wav",  
    "reserve", "scheduled", "queued", "hourly",  
    "shared", "multi_stop", "back_to_back", "round_trip", "long_trip",  
    "surge", "promotion", "bonus_zone", "streak",  
    "women_preference", "airport_queue"  
  ]  
}  
  

## §5 Eligibility gates — the hard rules

## §5.1 Uber, Dallas–Fort Worth (Grade A)

DFW is a single Uber market administered as "Dallas." There is no separate Fort Worth, Arlington, or Plano driver market.

Universal (all tiers):

15-year-old vehicle or newer → 2010+ floor, incrementing annually

4-door vehicle

Good condition, no cosmetic damage

No commercial branding

"The vehicle does not need to be registered in your name to qualify"

Driver minimums (national): 25 years old · 1+ year US licensed driving experience · valid US license · proof of residency · proof of insurance · driver profile photo.

| **Tier** | **MY floor (DFW)** | **Seats required** | **Extra gates** |
|---|---|---|---|
| economy_standard | 2010 | 5 factory seats + belts (4 pax) | Independently opening passenger doors; working windows + A/C |
| xl | 2010 | 7 factory seats + belts (6 pax) | Same, plus no vans/box trucks |
| xl_cargo | 2010 | 7+ seats, extra-large cargo | 23 models only (§7.3) |
| comfort | per-model: 2018 / 2020 / 2021–2023 | ≥5 | 4.85★ + 100 trips + already eligible on X/XL/Black |
| comfort_ev | 2018 (2021 Bolt EUV, 2019 Polestar 3) | ≥5 | 4.85★ + 100 trips + battery-electric only, no hybrids or PHEVs |
| premium_sedan | 2020 | ≥5 (4 pax + driver) | Black exterior only · black leather or vegan leather interior only · 4.85★ · commercial insurance · Dallas Driver Permit · no visible stains |
| premium_suv | 2020 | ≥7 (6 pax + driver) | Same as above |
| premium_hourly | 2020 | same as Black | Same as Black |
| Model-year discrepancy, resolved. Uber's Dallas page says Black = "7-year-old vehicle or newer." Uber's national Black page says "no older than 5 years." The live DFW eligibility feed enforces model year ≥ 2020. Use 2020 — the feed is what onboarding actually checks. |   |   |   |

Not present in the DFW feed as of 2026-08-18: Uber Electric, Uber Premier. If your schema has those columns, mark them not_offered_in_market for DFW, not false.

## §5.2 Lyft, Texas / DFW (Grade A)

There is no Dallas- or Fort Worth-specific Lyft driver page. DFW inherits the Texas statewide page. (Only Chicago, New Orleans, NYC, Portland, Seattle/King County/Tacoma, and Minneapolis/St. Paul have sub-state pages.)

Texas vehicle requirements, verbatim:

2010 or newer2 4 doors 5-8 seats, including the driver's Not a taxi, stretch limousine, or non-Express Drive rental vehicle Not titled as salvage, non-repairable, rebuilt or any other equivalent classification Texas driver requirements, verbatim:

Valid driver's license — Temporary or out-of-state licenses are also acceptable. You must be 25 years or older to drive3. Pass a driver screening, which reviews your driving history and criminal background check. Any smartphone that can download and run the Lyft Driver app. Texas is 25+, not 21+. Lyft's national statement is that the minimum "ranges from 21–25 and varies by region." Texas sits at the top of the range (Confirmed: drivers must be 25 or older3). Texas is not among the states requiring 1 year of licensed driving experience (that list is CA, HI, IL, MA, MN, OR, PA, VT).

Model-year conflict. lyft.com/driver-application-requirements/texas says 2009, but that page titles itself "…in Austin." help.lyft.com Texas Driver Information says 20102. Use 2010 for DFW. Lyft has posted: "Starting January 1, 2026, vehicle age requirements will be changing in select regions" — re-verify.

| **Tier** | **MY floor (DFW)** | **Seats** | **Extra gates** |
|---|---|---|---|
| economy_standard | 2010 | 4 doors, 5–8 seatbelts incl. driver | — |
| comfort (Extra Comfort) | per-model, mostly 2018 | ≥5 | 4.95★ · ≥20 trips · ≤1 safety flag/20 rides · ≤1 cleanliness flag/100 · ≤1 service flag/100 |
| xl | region | ≥7 seatbelts | Plus the explicit blacklist in §11.1 |
| xl_cargo (XXL) | mostly base | ≥7 seatbelts AND >27 cu ft trunk | 14 nameplates carry the XXL tag |
| premium_sedan (Black) | mostly 2019 | 4 riders | Black exterior · black leather interior · 4.95★ · ≥20 trips · ≤2 flags of each type per 50 rides |
| premium_suv (Black SUV) | mostly 2019 | 6 riders | Same as Black |
| senior_select | — | "low-entry vehicle" (Lyft never defines this — Grade U) | 4.95★, auto opt-in, 7-minute wait, $2/ride bonus |
| Lyft's hard ceiling: maximum 8 seatbelts including driver. National page, verbatim: "Vehicles are required to have a minimum of 5 seatbelts (including the driver's), with a maximum of 8 seatbelts." A 9-passenger Chevrolet Suburban LS with the front bench is disqualified from Lyft entirely while remaining fully Uber XL/XXL eligible. Real DFW edge case. |   |   |   |

Livery restriction: in Boston, Orlando, and Chicago only commercial livery drivers can do Black/Black SUV. DFW is not on that list — DFW Black is open to personal-insurance drivers. (Contrast Uber, which does require commercial insurance + a Dallas Driver Permit for Black in DFW.)

Extra Comfort opt-out: automatic if qualified. Black and Black SUV drivers can opt in or out in ride preferences.

Losing Black: "If your rating falls below 4.95, you'll need to bring it back up with other ride types before you can get Black rides."

## §5.3 Tier stacking — what one vehicle unlocks

Uber, verbatim (Grade A): "Models eligible for UberX are also eligible for Uber Connect, Uber Pet, and UberX Share. Electric vehicle models are also eligible for Uber Electric. Eligibility for Uber Black, Uber Comfort, Uber Comfort Electric, and Uber Premier options also depends on driver rating and factors like legroom and exterior/interior color."

Also verbatim: "the year listed for each vehicle represents the oldest vehicle year that's allowed for that ride option. This generally increases by one year every year."

Comfort Electric drivers (verbatim): "When you're online, you can receive Uber Comfort Electric trip requests as well as UberX, Uber Green, or Uber Comfort trips. Uber Comfort Electric vehicles are not eligible for Uber Black trips."

Lyft stacking (Grade A):

| **Vehicle profile (DFW)** | **Auto-qualifies for** |
|---|---|
| 2010+, 4-door, 5–8 belts | Standard, Wait & Save, Priority Pickup (+Pet, +Teen if opted in) |
| Above + EV or hybrid | + Green (auto, not toggleable) — DFW airport only |
| Above + on premium list at its Extra Comfort year + driver ≥4.95★ / ≥20 trips | + Extra Comfort |
| 6 passenger seats + 7 seatbelts + on the XL approved list | + XL |
| Above + >27 cu ft trunk + on the XXL list | + XXL (select regions) |
| Black exterior + black leather + 4 seats + on Black list + ≥4.95★ | + Black |
| Black exterior + black leather + 6 pax + on Black SUV list | + Black SUV |
| Low-entry vehicle + 4.95★ | + Silver Select (auto, $2/ride) |
| WAV | + Wheelchair (Dallas is a live WAV market) |
| Worked maximum stack: a 2019+ black-on-black Cadillac Escalade ESV is listed by Lyft as 2018 (Extra Comfort) / 2019 (Black, Black SUV) / (XXL) → qualifies for Standard + XL + XXL + Extra Comfort + Black + Black SUV simultaneously. |   |

Grade U: that an UberXL driver automatically receives UberX. Operationally near-certain (a 7-seat vehicle satisfies UberX's 5-seat rule) but Uber never states it. Do not hardcode as a guarantee.

Lyft driver toggle path: Driver app → Driver Preferences → Ride types. "You can only select the ride types your vehicle and account are eligible for." Women+ Connect, Green, and WAV cannot be selected from this list. Also: "If you choose not to drive Standard rides, it may reduce the number of requests you receive."

## §6 Uber premium vehicle lists — DFW (Grade A)

Source: Uber's own market-scoped eligibility feed for citySlug=dallas, retrieved 2026-08-18 (430 makes / 4,996 model rows). Confirmed genuinely city-specific — Dallas returns UberXXL, Black Hourly, UberXL Priority and no Electric, while Houston returns WAV-Houston and Electric, and LA returns Taxi and Uber for teens.

All entries below require model year ≥ 2020, black exterior, and black leather or vegan leather interior.

## §6.1 Uber Black SUV — DFW complete list (21 models)

| **Make** | **Model** | **Also Black** | **Also XXL** |
|---|---|---|---|
| Cadillac | Escalade | ✅ | — |
| Cadillac | Escalade ESV | ✅ | ✅ |
| Cadillac | Escalade IQ | ✅ | — |
| Chevrolet | Suburban | ✅ | ✅ |
| Chevrolet | Tahoe | ✅ | — |
| Ford | Expedition | ✅ | — |
| Ford | Expedition MAX | ✅ | ✅ |
| Ford | Expedition MAX XLT | ✅ | ✅ |
| GMC | Yukon | ✅ | — |
| GMC | Yukon Denali | ✅ | — |
| GMC | Yukon XL | ✅ | ✅ |
| GMC | Yukon XL Denali | ✅ | ✅ |
| Infiniti | QX80 | ✅ | — |
| Jeep | Wagoneer | ✅ | ✅ |
| Jeep | Grand Wagoneer | ✅ | ✅ |
| Lincoln | MKT | ✅ | — |
| Lincoln | Navigator | ✅ | — |
| Lincoln | Navigator L | ✅ | ✅ |
| Mercedes-Benz | GL-Class | ✅ | — |
| Mercedes-Benz | GLS SUV | ✅ | — |
| Rivian | R1S | ✅ | — |
| String trap: Uber's feed carries GLS-Class and GLS SUV as separate rows with different tier sets — GLS SUV is on both Black and Black SUV; GLS-Class is Black only. Same for Escalade vs Escalade ESV, Expedition MAX vs Expedition MAX XLT, Yukon vs Yukon Denali. Store the operator's raw model string and normalize with an explicit alias table. Never fuzzy-match. |   |   |   |

## §6.2 Uber Black — DFW complete list (127 models, all MY 2020+)

| **Make** | **Models** |
|---|---|
| Audi | A6, A6 Avant, A7, A8, A8 L, Q4 e-tron, Q5, Q7, Q8, Q8 e-tron, RS 6, RS 7, S6, S7, S8, SQ5, SQ7, SQ8, e-tron |
| BMW | 5-series, 5-Series 530e, 7-series, 7-Series 745e, 740i, 750, Alpina B7, X3, X5, X6, X7, i5, i7, iX |
| Bentley | Bentayga, Flying Spur, Mulsanne |
| Cadillac | CT6, Escalade, Escalade ESV, Escalade IQ, LYRIQ, Optiq, VISTIQ, XT5, XT6, XTS |
| Chevrolet | Suburban, Tahoe |
| Ford | Expedition, Expedition MAX, Expedition MAX XLT |
| GMC | Yukon, Yukon Denali, Yukon XL, Yukon XL Denali |
| Genesis | G90, GV60, GV70, GV80 |
| Infiniti | QX80 |
| Jaguar | F-PACE, XJ |
| Jeep | Wagoneer, Grand Wagoneer |
| Kia | EV9 |
| Lamborghini | Urus |
| Land Rover | Defender, Range Rover, Range Rover Sport, Range Rover Velar |
| Lexus | GS, GS Hybrid, GX, LS, LX, TX, TX 350, TX 500h |
| Lincoln | Aviator, Continental, Corsair, MKT, Nautilus, Navigator, Navigator L |
| Lucid | Air, Air Pure, Air Touring, Air Grand Touring, Gravity |
| Maserati | Levante, Quattroporte |
| Mercedes-Benz | E-Class, E350e, EQB, EQE, EQE SUV, EQS, EQS SUV, G-Class, GL-Class, GLC-Class, GLC Coupe, GLE-Class, GLE Coupe, GLS SUV, GLS-Class, S-Class, Maybach S-Class |
| Porsche | Cayenne, Cayenne Coupe, Panamera, Taycan |
| Rivian | R1S |
| Rolls-Royce | Cullinan, Flying Spur, Ghost, Phantom |
| Tesla | Model S, Model X |
| Volvo | EX90, S90, S90 Hybrid, XC60, XC60 Hybrid, XC90, XC90 Hybrid |
| Sunsetting entries. Cadillac XTS and Lincoln Continental are both out of production. A 2020 XTS and a 2020 Continental are the only still-eligible examples, and both age out of DFW Black at the next annual increment. Flag them in the UI rather than letting a driver buy one. |   |

## §6.3 Uber Comfort — DFW (317 models, Grade A)

Uber publishes no numeric legroom threshold. The model list is the definition. DFW uses three model-year tiers, not one:

| **MY floor** | **Class** | **Representative models** |
|---|---|---|
| 2018 | Luxury/premium marques + all BEVs | Audi A4/A6/Q5/Q7 · BMW 3/5/7-series, X3, X5 · Mercedes E-Class/GLC/GLE/S-Class · Lexus ES/RX/GX/LS · Cadillac XTS/CT6/Escalade · Lincoln MKZ/Nautilus/Navigator · Genesis G80/G90 · Volvo XC60/XC90 · Tesla Model 3/Y/S/X · Porsche Macan/Cayenne · Land Rover Range Rover · Jaguar XE/XF |
| 2020 | Mainstream mid-size & 3-row | Honda Accord, CR-V, Pilot, Passport · Toyota RAV4, Highlander, Sequoia, Avalon · Nissan Rogue, Murano, Pathfinder, Armada · Kia Telluride, Sorento, Sportage · Hyundai Palisade, Santa Fe · Chevrolet Traverse, Blazer · Ford Explorer, Edge, Escape · Subaru Ascent, Forester, Outback · VW Atlas, Tiguan · Mazda CX-5/CX-9/CX-50 · Jeep Grand Cherokee · Dodge Durango · Chrysler 300 · GMC Acadia, Terrain |
| 2021–2023 | Late-added mainstream sedans | Toyota Camry — 2023 · Camry Hybrid — 2023 · Chevrolet Malibu — 2021 · Impala — 2021 · Equinox — 2021 · Ford Fusion — 2021 · VW Passat — 2021 · Hyundai Tucson — 2021 · Jeep Compass — 2021 · Kia Niro — 2021 · Chevrolet Bolt EUV — 2021 |
| Comfort driver traps — the expensive misconceptions |   |   |
| Toyota Camry needs MY 2023+ for DFW Comfort. A 2019 Camry is UberX-only. This is the single most common false expectation among DFW drivers. |   |   |
| Toyota Prius is not on the DFW Comfort list at any model year. UberX only. |   |   |
| Toyota Corolla, Honda Civic, Nissan Altima, Hyundai Sonata, and Kia K5 are not on DFW Comfort at any year. All UberX-only. |   |   |
| Honda Accord qualifies at 2020+, but Camry only at 2023+. The two are not symmetric — do not generalize from one mid-size sedan to another. |   |   |

## §7 Uber XL / XXL — DFW (Grade A)

UberXL requires 7 factory-installed seats and seat belts = 6 passengers + driver.

## §7.1 Clean XL qualifiers — no trim risk

All MY floor 2010 unless noted. These models never ship below 7 seats.

Toyota Sienna · Toyota Sienna Hybrid · Honda Odyssey · Chrysler Pacifica · Chrysler Pacifica Hybrid · Kia Carnival · Kia Sedona · Toyota Highlander · Toyota Grand Highlander · Toyota Sequoia · Honda Pilot · Chevrolet Traverse · Kia Telluride · Hyundai Palisade · Subaru Ascent¹ · Nissan Pathfinder · Chevrolet Tahoe · Chevrolet Suburban² · GMC Yukon · GMC Yukon Denali · GMC Yukon XL · GMC Yukon XL Denali · Ford Expedition · Ford Expedition MAX · Cadillac Escalade · Cadillac Escalade ESV · Lincoln Navigator · Lincoln Navigator L · Jeep Wagoneer · Jeep Grand Wagoneer · Nissan Armada · Infiniti QX80 · Rivian R1S · Mitsubishi Outlander¹ (MY 2014+) · Audi Q7¹ / SQ7¹

¹ Banned from Lyft XL — see §11.1 ² 9-seat LS front-bench trim exceeds Lyft's 8-belt cap — Uber-only

## §7.2 Trim-dependent XL — ð´ verify seat count before trusting

These models ship in both 7-seat (bench) and 6-seat (captain's chairs) configurations. The 6-seat build fails UberXL and Lyft XL. The VIN/window sticker decides, not the model name.

| **Model** | **Uber XL MY floor** | **XL Priority MY** | **Risk** |
|---|---|---|---|
| Ford Explorer | 2010 | 2015 | ð´ captain's chairs = 6 total |
| Volkswagen Atlas | 2010 | 2010 | ð´ SE w/Tech, SEL, Peak, SEL Premium = 6 |
| Mazda CX-9 | 2010 | 2010 | ð´ Signature = 6 |
| Kia Sorento | 2019 | 2019 | ð´ captain's-chair trims = 6 |
| Jeep Grand Cherokee L | 2010 | 2010 | ð´ |
| Dodge Durango | 2010 | 2010 | ð´ |
| Acura MDX | 2010 | 2010 | ð´ Advance / Type S = 6 |
| Infiniti QX60 | 2010 | 2010 | ð´ 2022+ Sensory / Autograph = 6 |
| Lincoln Aviator | 2010 | 2010 | ð´ |
| Cadillac XT6 | 2010 | 2010 | ð´ |
| Buick Enclave | 2010 | 2010 | ð´ |
| Volvo XC90 / XC90 Hybrid | 2010 | 2010 | ð´ |
| Lexus GX | 2010 | 2022 | ð´ 2024+ GX 550 Overtrail = 5; upper trims = 6 |
| Lexus RX L | 2010 | 2010 | ð´ 6 or 7 |
| Mercedes-Benz GLE-Class | 2022 | 2022 | ð´ 3rd row is optional — 5 or 7 |
| Dodge Journey | 2018 | 2018 | ð´ 5 or 7, and Lyft-banned |

## §7.3 UberXXL — DFW complete list (23 models, all MY 2010)

Cadillac Escalade ESV · Chevrolet Suburban · Chrysler Grand Caravan · Chrysler Pacifica · Chrysler Pacifica Hybrid · Chrysler Town and Country · Chrysler Voyager · Dodge Grand Caravan · Ford Excursion · Ford Expedition MAX · Ford Expedition MAX XLT · GMC Yukon XL · GMC Yukon XL Denali · Honda Odyssey · Hyundai Entourage · Jeep Wagoneer · Jeep Grand Wagoneer · Kia Carnival · Kia Sedona · Lincoln Navigator L · Mercedes-Benz Metris Passenger Van · Toyota Sienna · Volkswagen Routan

The Mercedes-Benz Metris Passenger Van is the documented exception to Uber's "no vans" rule — it is XXL-eligible in DFW. Transit and Sprinter vans are allowed only on the separate Shuttle product, which DFW does not have.

## §8 Lyft premium vehicle lists — DFW-resolved (Grade A)

Lyft ships a national default list plus region-override blocks. BMW, Lincoln, Tesla, and Volvo carry explicit DFW-tagged overrides; every other make uses the default. DFW-resolved totals: 351 Extra Comfort, 111 Black, 20 Black SUV, 22 XXL rows across 40 makes.

Footnote decoder — these only lower the floor in other cities. DFW always uses the base year.

¹ = 2018 for SEA, PDX

² = 2018 for SEA, PDX, DEN, MSP, SLC, SJC

³ = 2018 for SEA, PDX, CVG, SMF

⁴ = 2018 for SEA, PDX, IND, YYZ, YTZ

## §8.1 Lyft Black SUV — DFW (20 models)

| **Make** | **Model** | **MY floor** | **Also XXL** |
|---|---|---|---|
| Cadillac | Escalade | 2019 | — |
| Cadillac | Escalade ESV | 2019 | ✅ |
| Cadillac | Escalade IQ | 2024 | — |
| Chevrolet | Suburban | 2019 | ✅ |
| Chevrolet | Tahoe | 2019 | — |
| Ford | Expedition | 2019 | — |
| Ford | Expedition MAX | 2019 | ✅ (2018) |
| GMC | Yukon | 2019 | — |
| GMC | Yukon XL | 2019 | ✅ |
| GMC | Yukon XL Denali | 2019 | ✅ |
| Infiniti | QX80 | 2019 | — |
| Jeep | Wagoneer | 2022 | ✅ |
| Jeep | Wagoneer L | 2023 | ✅ |
| Jeep | Grand Wagoneer | 2022 | ✅ |
| Jeep | Grand Wagoneer L | 2023 | ✅ |
| Lexus | LX | 2019 | — |
| Lincoln | Navigator | 2019 | — |
| Lincoln | Navigator L | 2019 | ✅ |
| Lincoln | Aviator | ⚠️ "Black SUV only in select regions"⁴ — DFW not among them. Treat as Black-only (2021+) in DFW | — |
| Lincoln | Aviator Hybrid | ⚠️ same caveat | — |

## §8.2 Lyft Black — DFW (111 models)

MY 2019 unless noted in parentheses.

| **Make** | **Models** |
|---|---|
| Acura | MDX (2021), MDX Hybrid (2021) |
| Audi | A6, A7, A8, A8 L (2018), Q5, Q7, Q8, S6, S7, S8, S8 L, SQ5, SQ7, SQ8, e-tron |
| BMW (DFW override) | 5-Series, 5-Series Gran Turismo, 6-Series, 6-Series Gran Coupe, 7-Series, 740i, M550i, X5, X5 Hybrid, X5 M, X6, X7, i5 (2024), i7, iX |
| Bentley | Bentayga, Flying Spur, Mulsanne |
| Cadillac | CT6, CTS, CTS-V, XT5, XT6, XTS, LYRIQ (2023), Optiq (2025), VISTIQ (2026) |
| Genesis | G90, GV60 (2022), GV80 (2020) |
| Infiniti | QX60 |
| Jaguar | XJ. ⚠️ F-PACE and XF are "Black only in select regions" — do not assume DFW |
| Kia | EV9 |
| Land Rover | Defender (2020), Defender 110 (2020), Range Rover, Range Rover Hybrid (2021), Range Rover Sport, Range Rover Velar |
| Lexus | ES (2021), ES Hybrid (2021), GS, GX, LS, LS 500, LS Hybrid, LX 570, RX, RX Hybrid, TX, TX 350, TX 500h, TX 550h+, TX Hybrid |
| Lincoln (DFW override) | Aviator (2021), Aviator Hybrid (2021), Continental, Corsair (2020), MKT, MKZ, MKZ Hybrid, Nautilus. ⚠️ MKX = select regions only |
| Lucid | Air (2021), Air Dream Edition (2021), Gravity (2026) |
| Maserati | Levante, Quattroporte |
| Mercedes-Benz | E-Class, S-Class, Maybach, G-Class, GLC-Class, GLC-Class Hybrid, GLE, EQE (2023), EQS (2022), EQS SUV (2023) |
| Porsche | Cayenne, Macan, Panamera |
| Rivian | R1S (2022) |
| Rolls-Royce | Phantom |
| Tesla (DFW override) | Model S, Model X, Model Y (2020) — ⚠️ "Tesla Model Ys onboarded after April 2, 2025 will no longer be eligible for Black mode." Grandfathered vehicles only |
| Volvo (DFW override) | S90, S90 Recharge (2021), XC60, XC60 Recharge, XC90⁴, XC90 Plug-In Hybrid⁴, XC90 Recharge (2021) |

## §8.3 Lyft Extra Comfort — DFW mainstream extract

(351 rows total including luxury; mainstream brands shown — luxury marques on the Black list above are also Extra Comfort eligible at their listed years.)

| **Make** | **Model (Extra Comfort MY floor)** |
|---|---|
| Toyota | Camry (2024), Camry Hybrid (2024), Avalon Hybrid (2022), Crown (2024), Highlander (2018), Highlander Hybrid (2018), Grand Highlander (2025), Grand Highlander Hybrid (2025), Sequoia (2018), Venza (2022), RAV4 Hybrid (2018), RAV4 Prime (2018), bZ4X (2024), Land Cruiser (2018) |
| Honda | Accord (2022), Accord Hybrid (2022), CR-V (2018), CR-V Hybrid (2021), HR-V (2018), Insight (2022), Passport (2020), Pilot (2018) |
| Nissan | Rogue (2018), Rogue Hybrid (2018), Murano (2018), Pathfinder (2018), Armada (2018), Ariya (2023) |
| Hyundai | Santa Fe (2018), Santa Fe XL (2020), Santa Fe Sport (2018), Santa Fe Hybrid (2022), Santa Fe PHEV (2022), Tucson (2018), Tucson Hybrid (2022), Tucson PHEV (2022), Palisade (2021), IONIQ / IONIQ 5 (2022), IONIQ 9 (2026), Kona (2024), Kona Electric (2024), NEXO (2019) |
| Kia | Sorento (2018), Sorento Hybrid (2022), Sorento PHEV (2022), Sportage (2018), Sportage Hybrid (2024), Telluride (2021), Seltos (2022), Niro (2018), Niro EV (2020), Niro Hybrid (2018), Niro PHEV (2019), Soul EV (2022), K900 (2018), EV6 (2023), EV9 (2024) |
| Chevrolet | Equinox (2018), Blazer (2020), Blazer EV (2024), Traverse (2018), Trailblazer (2018), Trax (2024), Impala (2022), Bolt EUV (2022), Tahoe (2018), Suburban (2018) |
| Ford | Edge (2018), Escape (2022), Escape Hybrid (2022), Escape PHEV (2022), Explorer (2018), Explorer Hybrid (2021), Flex (2018), Fusion (2022), Fusion Energi (2022), Taurus (2022), Bronco (2022), Bronco Sport (2022), Mustang Mach-E (2022), Expedition (2018), Expedition MAX (2019) |
| Subaru | Forester (2018), Outback (2018), Legacy (2022), Solterra (2024) |
| Mazda | CX-5 (2018), CX-9 (2018), CX-50 (2023), CX-90 (2025), CX-90 Hybrid (2025), Mazda6 (2022) |
| Volkswagen | Tiguan (2018), Atlas (2019), Atlas Cross Sport (2021), Touareg (2018), Taos (2023), Arteon (2020), ID.4 (2022), Passat GTE (2020) |
| Jeep | Cherokee (2018), Compass (2022), Grand Cherokee (2018), Grand Cherokee L (2018), Grand Cherokee 4xe (2018), Grand Cherokee WK (2018), Wagoneer (2023), Wagoneer L (2024), Grand Wagoneer (2023), Grand Wagoneer L (2024) |
| Buick / GMC / Chrysler / Dodge | Enclave (2018), Envision (2018), Envista (2024), Regal (2018), Acadia (2018), Terrain (2018), Yukon (2018), Yukon XL (2018), Chrysler 300 (2018), Dodge Durango (2018) |
| EV-native | Tesla Model 3 (2018), Model Y (2021), Model S (2018), Model X (2018), Polestar 2 (2021), Polestar 3 (2024), Rivian R1S (2023), Fisker Ocean (2023), VinFast VF8/VF9 (2024), Mitsubishi Outlander PHEV (2019), Eclipse Cross (2022) |
| Extra Comfort traps: Toyota Camry needs MY 2024+ on Lyft vs 2023+ on Uber — the two platforms disagree by one year on the single most common DFW rideshare car. Honda Accord: Lyft 2022+ / Uber 2020+. Prius, Corolla, Civic, Altima, Sonata, K5, and non-hybrid RAV4 are absent from Lyft Extra Comfort entirely. |   |

## §9 Green / EV tiers — powertrain rules

This is where most vehicle catalogs get it wrong. The three programs have three different powertrain definitions.

| **Program** | **Platform** | **BEV** | **PHEV** | **Standard hybrid** | **DFW status** |
|---|---|---|---|---|---|
| Uber Comfort Electric | Uber | ✅ required | ❌ | ❌ | Live, MY 2018+ |
| Uber Electric (was Uber Green, renamed 2025-10-22) | Uber | ✅ required | ❌ | ❌ | Not in the DFW feed as of 2026-08-18 |
| Lyft Green | Lyft | ✅ | ✅ | ✅ yes | Rider option, DFW airport only (not citywide) |

Scope note: Uber's wording is "we took a big step, making Uber Green 100% electric in the U.S." The all-electric conversion is US-scoped — do not assert it globally. Uber's own Comfort Electric page is also stale, still telling drivers they can receive "Uber Green" trips.

Uber's own wording: Comfort Electric requires a vehicle "fully battery electric (not a hybrid)"4. Lyft's rider-facing wording: Green pairs you with "an electric vehicle (EV) or hybrid."

## §9.1 ⚠️ Data-quality warning — do not ingest Uber's Electric tag

In non-DFW Uber markets (Houston, Chicago, LA) the eligibility feed applies a product tag literally named Electric to gasoline-only vehicles, including Toyota Corolla, Honda Civic, Nissan Altima, and non-hybrid Camry/RAV4. That contradicts Uber's stated EV-only policy and is either a legacy internal product code or a feed defect.

Do not derive green-tier eligibility from the Electric tag. Derive it from powertrain:

BEV → Uber Comfort Electric eligible + Lyft Green eligible

PHEV → Lyft Green only

HEV → Lyft Green only

ICE → neither

## §9.2 Uber Comfort Electric — DFW complete list (60 models, MY 2018 unless noted)

Mass-market BEV: Tesla Model 3 · Tesla Model Y · Tesla Model S · Tesla Model X · Ford Mustang Mach-E · Chevrolet Bolt EUV (2021+) · Chevrolet Blazer EV · Chevrolet Equinox EV · Hyundai IONIQ 5 · IONIQ 6 · IONIQ Electric · Ioniq 9 · Kia EV6 · EV9 · Niro EV · E-Niro · Nissan Ariya · VW ID.4 · Toyota bZ4X · bZ · Subaru Solterra · Honda Prologue · Polestar 2 · Polestar 3 (2019+) · Fisker Ocean · VinFast VF8 · VinFast VF9

Premium BEV: Audi e-tron / e-tron Sportback / Q4 e-tron / Q4 Sportback e-tron / Q8 e-tron / RS e-tron GT · BMW i4, i5, i7, iX · Cadillac LYRIQ, Optiq, VISTIQ, Escalade IQ · Genesis GV60 · Jaguar I-PACE · Jeep Wagoneer S · Lexus RZ 450e · Lucid Air / Air Pure / Air Touring · Mercedes EQB, EQC, EQE, EQE SUV, EQS, EQS SUV · Porsche Taycan · Rivian R1S · Volvo C40 Recharge, EX90, XC40 Electric

Notably absent — verify before assuming:

Chevrolet Bolt EV (base, non-EUV) — UberX only in DFW

Nissan LEAF — in the DFW feed for UberX/Share/Care/Pet only, not Comfort or Comfort Electric

Toyota Prius, Prius Prime, RAV4 Prime, all conventional and plug-in hybrids — correctly excluded (they are not BEVs)

## §10 Seat-count catalog & the six-seat trap

"Pax" = passenger seats excluding the driver. Confidence: ✅ single configuration · ⚠️ trim-dependent, verify VIN or window sticker · ð´ has a config that fails XL.

## §10.1 The six-seat trap — canonical reference

A nominally "3-row 7-seater" delivered with second-row captain's chairs has only 6 factory seats (2 + 2 + 2). Both UberXL (7 seats) and Lyft XL (7 seatbelts) reject it. The trim decides, not the model name.

| **Model** | **Bench config** | **Captain's-chair config** | **XL-safe?** |
|---|---|---|---|
| Ford Explorer | 7 | 6 | ð´ trim-dependent |
| Volkswagen Atlas | 7 | 6 (SE w/Tech, SEL, Peak, SEL Premium) | ð´ |
| Mazda CX-9 | 7 | 6 (Signature) | ð´ |
| Mazda CX-90 | 8 | 6 or 7 | ð´ |
| Kia Sorento | 7 | 6 | ð´ |
| Jeep Grand Cherokee L | 7 | 6 | ð´ |
| Dodge Durango | 7 | 6 | ð´ |
| Acura MDX | 7 | 6 (Advance, Type S) | ð´ |
| Infiniti QX60 (2022+) | 7 | 6 (Sensory, Autograph) | ð´ |
| Lincoln Aviator | 7 | 6 | ð´ |
| Cadillac XT6 | 7 | 6 | ð´ |
| Buick Enclave | 7 | 6 | ð´ |
| Volvo XC90 | 7 | 6 | ð´ |
| BMW X7 | 7 | 6 | ð´ |
| Lexus RX L / GX | 7 | 6 | ð´ |
| Toyota Highlander | 8 | 7 | ✅ always ≥7 |
| Honda Pilot | 8 | 7 | ✅ |
| Kia Telluride | 8 | 7 | ✅ |
| Hyundai Palisade | 8 | 7 | ✅ |
| Chevrolet Traverse | 8 | 7 | ✅ |
| Nissan Pathfinder | 8 | 7 | ✅ |
| Toyota Grand Highlander | 8 | 7 | ✅ |
| Toyota Sequoia | 8 | 7 | ✅ |
| Subaru Ascent | 8 | 7 | ✅ Uber / ❌ Lyft-banned |
| Tahoe · Yukon · Expedition · Escalade · Navigator · Armada · QX80 · Wagoneer | 8 | 7 | ✅ |
| Chevrolet Suburban LS w/ front bench | 9 | — | ✅ Uber / ❌ Lyft: exceeds 8-belt cap |
| Toyota Sienna | 8 | 7 | ✅ |
| Honda Odyssey | 8 (EX+) | 7 (LX) | ✅ (LX is still 7) |
| Chrysler Pacifica | 8 (bench opt.) | 7 (standard) | ✅ |
| Kia Carnival | 8 (LX/EX) | 7 (SX / VIP Lounge) | ✅ |
| Tesla Model Y | — | 5 std; 7-seat opt. 2020–2023; 6-seat on newer builds | ❌ Lyft-XL banned; not on Uber DFW XL list |
| Tesla Model X | — | 5, 6, or 7 | ❌ Lyft-XL banned; not on Uber DFW XL list |
| VW Tiguan | 5 or 7 (FWD 3rd row, ≤2024) | — | ❌ Lyft-XL banned |
| Toyota 4Runner | 5 or 7 | — | ❌ Lyft-XL banned |
| Toyota Land Cruiser (2021+) | 5 | — | ❌ Lyft-XL banned |
| Mercedes GLE | 5 or 7 (3rd row optional) | — | ð´ Uber DFW floor 2022 |
| Hyundai Santa Fe (2024+) | 6 or 7 | — | ð´ and not on the Uber DFW XL list at all despite 3 rows |

## §10.2 Sedans & hatchbacks — all 5 total / 4 pax ✅

Toyota Camry · Corolla · Avalon · Crown · Prius · Honda Accord · Civic · Insight · Nissan Altima · Sentra · Versa · Maxima · Chevrolet Malibu · Impala · Cruze · Ford Fusion · Taurus · Hyundai Sonata · Elantra · Kia K5 / Optima · Forte · Mazda3 · Mazda6 · VW Jetta · Passat · Arteon · Subaru Legacy · Impreza · Chrysler 300 · Dodge Charger · Buick Regal · Lexus ES · Mercedes E-Class · BMW 5 Series · Cadillac XTS · Lincoln Continental · MKZ

## §10.3 Compact / mid-size 2-row SUVs — all 5 total / 4 pax ✅

Toyota RAV4 · Venza · bZ4X · Honda CR-V · HR-V · Passport · Nissan Rogue · Murano · Kicks · Ford Escape · Edge · Bronco Sport · Chevrolet Equinox · Blazer · Trailblazer · Trax · Hyundai Tucson · Kona · Kia Sportage · Seltos · Niro · Mazda CX-5 · CX-50 · Subaru Forester · Outback · Crosstrek · VW Taos · Jeep Cherokee · Compass · Grand Cherokee (2-row) · GMC Terrain · Buick Envision · Lexus RX (standard) · NX · Acura RDX · Cadillac XT4 / XT5 · Lincoln Corsair · Nautilus · Volvo XC40 / XC60 · BMW X3 / X5 (std) · Mercedes GLC

## §10.4 EVs

| **Model** | **Total seats** | **Pax** | **Conf.** |
|---|---|---|---|
| Tesla Model 3 | 5 | 4 | ✅ |
| Tesla Model Y | 5 std | 4 | ⚠️ 7-seat opt. MY2020–2023 → 6 pax; 6-seat variant on newer builds |
| Tesla Model S | 5 | 4 | ✅ (rear jump seats gone since 2016) |
| Tesla Model X | 5 / 6 / 7 | 4 / 5 / 6 | ⚠️ order-config |
| Chevrolet Bolt EV | 5 | 4 | ✅ |
| Chevrolet Bolt EUV | 5 | 4 | ✅ |
| Nissan LEAF | 5 | 4 | ✅ |
| Nissan Ariya | 5 | 4 | ✅ |
| Hyundai IONIQ 5 | 5 | 4 | ✅ |
| Hyundai IONIQ 6 | 5 | 4 | ✅ |
| Hyundai IONIQ 9 | 6 or 7 | 5 or 6 | ⚠️ |
| Kia EV6 | 5 | 4 | ✅ |
| Kia EV9 | 6 or 7 | 5 or 6 | ⚠️ 6-seat config fails XL |
| Ford Mustang Mach-E | 5 | 4 | ✅ |
| VW ID.4 | 5 | 4 | ✅ |
| Polestar 2 / 3 | 5 | 4 | ✅ |
| Rivian R1S | 7 | 6 | ✅ |
| Cadillac LYRIQ | 5 | 4 | ✅ |
| Cadillac VISTIQ | 6 or 7 | 5 or 6 | ⚠️ |
| Cadillac Escalade IQ | 7 | 6 | ✅ |
| Mercedes EQS SUV | 5 or 7 | 4 or 6 | ⚠️ |
| Volvo EX90 | 6 or 7 | 5 or 6 | ⚠️ |
| Subaru Solterra | 5 | 4 | ✅ |

## §10.5 Minivans

| **Model** | **Total** | **Pax** | **Conf.** |
|---|---|---|---|
| Toyota Sienna | 7 or 8 | 6 or 7 | ⚠️ Limited/Platinum = 7 total |
| Honda Odyssey | 7 (LX) or 8 (EX+) | 6 or 7 | ⚠️ LX has no removable center seat |
| Chrysler Pacifica | 7 std, 8 opt. | 6 or 7 | ⚠️ |
| Chrysler Voyager | 7 | 6 | ✅ |
| Kia Carnival | 7 (SX/VIP) or 8 (LX/EX) | 6 or 7 | ⚠️ |
| Dodge/Chrysler Grand Caravan | 7 | 6 | ✅ |
| Mercedes Metris Passenger Van | 7 or 8 | 6 or 7 | ⚠️ |

## §10.6 Full-size SUVs

| **Model** | **Total** | **Pax** | **Conf.** |
|---|---|---|---|
| Chevrolet Tahoe | 7 or 8 | 6 or 7 | ⚠️ |
| Chevrolet Suburban | 7, 8, or 9 | 6, 7, or 8 | ⚠️ 9-seat LS front bench exceeds Lyft's 8-belt max |
| GMC Yukon / Denali | 7 or 8 | 6 or 7 | ⚠️ |
| GMC Yukon XL / XL Denali | 7 or 8 | 6 or 7 | ⚠️ |
| Ford Expedition / MAX | 7 or 8 | 6 or 7 | ⚠️ |
| Cadillac Escalade / ESV | 7 or 8 | 6 or 7 | ⚠️ |
| Lincoln Navigator / L | 7 or 8 | 6 or 7 | ⚠️ |
| Nissan Armada | 7 or 8 | 6 or 7 | ⚠️ |
| Infiniti QX80 | 7 or 8 | 6 or 7 | ⚠️ |
| Toyota Sequoia | 7 or 8 | 6 or 7 | ⚠️ |
| Jeep Wagoneer / Grand Wagoneer | 7 or 8 | 6 or 7 | ⚠️ |
| Lexus LX | 5 or 7 | 4 or 6 | ⚠️ LX 600 F-Sport = 5 |
| Lexus GX (2024+) | 5, 6, or 7 | 4, 5, or 6 | ð´ |
| Mercedes GLS | 7 | 6 | ✅ |
| BMW X7 | 6 or 7 | 5 or 6 | ð´ |
| Toyota 4Runner | 5 or 7 | 4 or 6 | ð´ + Lyft-XL banned |
| Land Rover Discovery | 5, 6, or 7 | 4, 5, or 6 | ð´ |

## §11 Platform conflicts and exclusions

## §11.1 Lyft's explicit XL blacklist — verbatim, Grade A

"To qualify for SUV and XL rides, your car must have a vehicle with at least 7 seat belts. Some vehicles do not qualify for XL such as: Audi Q7, Dodge JOURNEY, Ford TRANSIT CONNECT, Mazda MAZDA5, Mercury MOUNTAINEER, Mitsubishi OUTLANDER, Subaru ASCENT, Suzuki XL7, Toyota 4RUNNER, Toyota LAND CRUISER (2021 and newer), TESLA MODELX, TESLA MODELY, Toyota RAV4, Volkswagen TIGUAN."

## §11.2 Documented Uber ↔ Lyft conflicts in DFW

Encode these as two separate columns. Never one boolean.

| **Vehicle / attribute** | **Uber DFW** | **Lyft DFW** |
|---|---|---|
| Audi Q7 | ✅ UberXL | ❌ blacklisted from XL |
| Subaru Ascent | ✅ UberXL | ❌ blacklisted from XL |
| Mitsubishi Outlander | ✅ UberXL (2014+) | ❌ blacklisted from XL |
| Dodge Journey | ✅ UberXL (2018+) | ❌ blacklisted from XL |
| Chevrolet Suburban, 9-seat LS | ✅ XL + XXL | ❌ exceeds 8-belt cap → ineligible entirely |
| Toyota Camry, Comfort floor | 2023+ | 2024+ |
| Honda Accord, Comfort floor | 2020+ | 2022+ |
| Black tier — insurance | Commercial insurance required | Personal insurance OK in DFW |
| Black tier — permit | Dallas Driver Permit required | None |
| Black tier — rating | 4.85★ | 4.95★ |
| Black tier — MY floor | 2020 | 2019 |
| Green/EV — hybrids | ❌ BEV only | ✅ hybrids qualify for Green |
| Subcompacts | Allowed if on the market list | ✅ explicitly allowed since 2021-08-25 |
| Seat ceiling | none stated | max 8 belts incl. driver |

## §11.3 Excluded and restricted vehicles

| **Restriction** | **Uber (US)** | **Lyft (US / TX)** |
|---|---|---|
| Salvage / rebuilt title | ❌ "No salvaged or rebuilt vehicles" | ❌ "Not titled as salvage, non-repairable, rebuilt or any other equivalent classification" |
| Taxis | ❌ "No taxi cabs, government cars, or other marked vehicles" | ❌ "Taxis and stretch limousines will not be approved" |
| Stretch limousines | ❌ via marked/commercial rule | ❌ explicit |
| Marked / government vehicles | ❌ explicit | not explicitly stated |
| Commercial branding | ❌ "No commercial branding" | not explicitly stated |
| Vans / cargo vans / box trucks | ❌ "No vans, box trucks, or similar vehicles" — exception: Mercedes Metris is XXL-eligible in DFW | ❌ effectively barred by the 8-belt cap |
| Aftermarket seating mods | ❌ "No aftermarket seating modifications, such as installed seats, seat belts, or BedRyder systems" — seats must be factory-installed | not explicit; 5–8 belt rule applies |
| 2-door vehicles | ❌ 4-door with independently opening passenger doors | ❌ "All Lyft vehicles are required to have 4 doors" |
| Subcompacts | allowed if on the market list; systematically absent from Comfort/Black | ✅ allowed since 2021-08-25 — the widely repeated "Lyft bans subcompacts" claim is obsolete |
| Cosmetic damage / stains | ❌ "Good condition with no cosmetic damage"; Black adds "No visible stains" | via inspection |
| Non-working windows / A/C | ❌ explicit | via inspection |
| Rentals | permitted via Uber-approved partners | ❌ "Rental vehicles must be rented through the Express Drive program" |
| Texas inspection layer (both platforms): annual state safety inspection required to get or renew the registration sticker. Emissions testing required in Dallas, Denton, Collin, Tarrant, Rockwall, Kaufman, Ellis, Johnson, and Parker counties — that is the entire DFW metro. |   |   |

Texas app quirk: "If you drive in Texas, you are required to verify your age with Apple or Google Play before you'll be able to use the Lyft driver app and give rides."

## §12 Other platforms

## §12.1 Alto — active in DFW, but closed to owner-operators

Include as market context only. Alto cannot generate an offer for a driver using their own car, in any market.

Verbatim, from Alto's own careers page: "When you drive with us, you don't have to buy a vehicle — we provide a luxury, safety-equipped vehicle for you. You don't have to pay for gas or vehicle maintenance." Drivers are W-2 employees paid hourly with benefits and a 401(k) match.

| **Market** | **Status** |
|---|---|
| Dallas–Fort Worth | LIVE — Alto's own app. HQ market. Curbside at DAL and DFW. Hours 3:30am–midnight; to 1am Thu; to 3:30am Fri–Sat |
| Houston | LIVE — Alto's own app |
| Los Angeles | LIVE, but on Uber only |
| Miami | LIVE, but on Uber only |
| Washington DC | DEAD — exited Feb 2024 |
| San Francisco | DEAD — exited 2023 |
| Silicon Valley | DEAD / never materialized |
| Verbatim: "In Los Angeles and Miami, Alto vehicles and W-2 drivers operate on the Uber platform through Uber Black, Uber XL, and UberTeen." |   |

Product structure: a single luxury-SUV ride class. There is no "Alto SUV" or "Alto Business" as an in-app tier name. Memberships: MonthlyPlus $19.95/mo · AnnualPlus $199/yr · Family $199/yr + $25 per additional member. Alto for Business exists as a separate B2B offering. Fleet: Buick Enclave historically; Kia EV9 deployed in Dallas from Apr 2024.

Competitive effect worth modeling: Alto holds 5-year exclusive curbside rights at Dallas Love Field, which suppresses DAL curbside availability for other platforms.

## §12.2 DFW owner-operator platforms — these DO generate offers

| **Platform** | **Min model year** | **Vehicle class** | **Min age** | **Hardest gate** |
|---|---|---|---|---|
| UZURV | 2019+ (Dallas-specific; 2016+ elsewhere) | 4-door, 4–8 pax. No pickups, rentals, or modified vehicles | 25 | 3 yrs uninterrupted driving history · drug screen · ADA/HIPAA credentials |
| HopSkipDrive | ≤15 yrs old (~2011+) | 4-door | 21 | Fingerprint + Child Abuse & Neglect scan · caregiving experience with children · annual mechanic inspection |
| Veyo / MTM (TX) | 2006+ | 4-door, 4 pax + driver. No pickups, no 2-doors. Seat height 20″–30″. Wheelchair storage space | 21 | TX DL + 3 yrs TX driving history · CPR + First Aid · drug test within 14 days |
| zTrip (DFW) | Local for-hire inspection standard (Grade U) | Own car or company lease | 25 | FBI fingerprint · no felony within 10 yrs |
| Empower (DFW) | Grade U — not published | Grade U | Grade U | $29.99/mo or $14.99/wk subscription. Driver sets own rate, keeps 100% of fare, zero commission |
| Hitch (TX lanes) | 2016+ | Full-size sedan or larger | 21 | Intercity trip shape — 165–240 mi, multi-hour, seat-fill |
| Favor (TX) | Grade U | Car, truck, motorcycle, scooter | 18 | Delivery only |
| Hitch tiers: Standby · Shared · Private · XL · Pets. TX corridors: Dallas↔Austin (195 mi), Dallas↔Houston (240 mi), Houston↔Austin (165 mi), San Antonio. Model separately from urban per-trip offers — the economics are structurally different. |   |   |   |   |

Empower legal warning: Empower's DC market collapsed under litigation (contempt orders and daily fines reinstated Feb 2026). DFW is unaffected, but the platform carries regulatory risk worth surfacing to a driver.

## §12.3 Waymo — model as demand suppression, not supply

Waymo launched public driverless service in Dallas on 2026-02-24 (alongside Houston, San Antonio, and Orlando — its first simultaneous multi-city opening).

Waymo's own app, not Uber, in these markets

Dallas service area ≈ 50 sq mi of central Dallas, bounded by Northwest Highway on the north to Bishop Arts District / South Dallas on the south

Avis manages the Dallas fleet

No human driver → no offers, ever

Engine treatment: overlay the Dallas polygon as a demand-suppression factor on short urban economy_standard / comfort trips. It is not a platform with tiers. Full public access is expanding through 2026 — re-check the polygon quarterly.

## §12.4 Excluded from the offer engine — and why

| **Platform** | **Reason** |
|---|---|
| Alto | W-2 employees, company fleet. No owner-operator path anywhere |
| Curb | Regulator-licensed taxi/fleet only. No DFW (TX = San Antonio Pair & Pay only) |
| Blacklane | Partners only with "insured, pre-existing chauffeur companies" |
| Carmel | Licensed TLC affiliates, NYC |
| Zum | Company vehicles, depot-based, no DFW |
| GoGoGrandparent | A concierge layer that books Uber and Lyft. Its pings arrive as ordinary Uber/Lyft offers — often with longer waits and assistance expectations. No separate offer stream |
| Revel | Shut down NYC rideshare 2025-08-11. Pivoted to EV charging |
| inDrive | No Texas presence found. US footprint = Miami, Tallahassee, Indianapolis |
| Wingz | Repositioned to NEMT-only; no Texas onboarding on its driver site (its consumer site still advertises Dallas — the two contradict each other) |
| Via | Municipal microtransit drivers are typically agency/contractor employees, not gig. DFW gig availability Grade U |
| ModivCare | Works through subcontracted transportation companies, not individual drivers |

## §13 Delivery platforms

Relevant because the product scope covers any third-party offer service, and because DFW drivers routinely stack these with passenger work.

| **Platform** | **Vehicle rule** | **Model year** | **Min age** | **Tier / rewards program** |
|---|---|---|---|---|
| Walmart Spark | Any reliable car, SUV, truck, or van. No motorcycles, bikes, or scooters | Any year | 18 | Silver / Gold / Sapphire |
| DoorDash | Car or truck; bike/scooter/walk in select markets | Any year | 18+, 19+ in TX | Dasher Rewards: Silver / Gold / Platinum |
| Uber Eats | Any 2- or 4-door car/truck/SUV/van; scooter <50cc; bicycle | None | 19+ car, 18+ bike | Uber Pro (2026 structure Grade U) |
| Instacart | "Reliable vehicle" | None | 18 | Cart Star: Gold / Platinum / Diamond |
| Amazon Flex | 4-door midsize sedan or larger; SUV/minivan/van; pickup only with covered bed | None | 21 | Flex Rewards Levels 1–4 |
| Roadie | "No minimum vehicle standards" | None | 18 | Driver Certifications gate some gig types |
| Favor | Car, truck, motorcycle, scooter | Grade U | 18 | — |

## §13.1 Walmart Spark — offer types (verbatim from Walmart's help docs)

| **Category** | **Official name** | **Meaning** |
|---|---|---|
| Core | Delivery | Pick up a prepared order, deliver |
| Core | Shopping | Shop a list in-store then deliver (Walmart + Sam's Club) |
| Core | Returns | Collect an item from a customer, return it to a store |
| Product line | Dotcom | General merchandise from walmart.com |
| Product line | Walmart GoLocal | Orders from other retailers — hardware, auto parts, flowers |
| Product line | Pharmacy | Prescriptions |
| Structure | Single Offers / Batched Offers | Batched = 2+ customer orders in one trip |
| Dispatch | Round Robin (timed, one driver) / First Come, First Serve (broadcast, no timer) |   |
| Offer tags | Express · Alcohol · Pharmacy · Heavy item · Apartment · Bulky item · Restaurant |   |
| "Curbside" is store-side terminology, not an in-app offer name. "Round Trip" does not appear in Walmart's offer-type documentation — Grade U as a product name. |   |   |

Spark Rewards tiers gate offer visibility, which matters for an analyzer: Gold sees offers before lower tiers; Sapphire sees offers before all lower tiers and gets a +10% incentive multiplier. Qualification combines "Points This Month" with on-time arrival, completed accepted trips, customer rating, and Quantity Found. Numeric thresholds are not published (Grade U). Base eligibility: ≥20 deliveries in a calendar month + Green Customer Rating.

Spark eligibility: 18+ · REAL ID-compliant license · proof of active auto insurance at state minimums (Spark provides no supplemental commercial coverage) · SSN · Checkr criminal + MVR · Branch-linked bank account.

## §13.2 Other delivery rewards structures DoorDash — Dasher Rewards (replaced Top Dasher). The Overall Dasher Rating uses a composite score that ranges from 0 to 100 points, weighted by Completion Rate (35 points), On-Time Rate (30 points), Acceptance Rate (25 points), and Customer Rating (10 points)5. Tiers: Silver = 60-64 points · Gold = 65-74 points · Platinum = 75-100 points5. The Large Order / catering program is gated behind Platinum; catering-bag onboarding required. Supplemental coverage up to $1M third-party liability while on an active delivery.

Instacart — Cart Star, quarterly cycles: Gold = 20 completed orders · Platinum = 100 · Diamond = 300, all requiring 4.7★+ and a minimum shopping-quality score. Platinum+ gets priority batch access. Platinum Protection at 4,000 lifetime orders locks the tier permanently.

Amazon Flex — Flex Rewards, rolling 3-month periods:

| **Level** | **Points** | **Preferred Scheduling** | **Shell fuel** | **Debit cash back** |
|---|---|---|---|---|
| 1 | 1–649 | 10 min | $0.05/gal | — |
| 2 | 650–2,999 | 15 min | $0.05/gal | 2% |
| 3 | 3,000–6,499 | 20 min | $0.06/gal | 4% |
| 4 | 6,500+ | 30 min | $0.07/gal | 6% |
| Block types: Amazon.com blocks · Whole Foods Market blocks · Amazon Fresh blocks, plus Large Vehicle blocks at roughly a 15% premium (Grade S). Excluded vehicles (Grade S): compacts, 2-door coupes, small hatchbacks, motorcycles, scooters, bikes, open truck beds. |   |   |   |   |

## §14 Loyalty programs — do they gate ride types?

No. On both primary platforms, loyalty tiers gate earnings perks and matching priority, not access to ride types. This matters: an analyzer should never infer tier eligibility from a driver's loyalty status.

## §14.1 Uber Pro (2026 redesign, effective 2026-02-11)

Tiers: Blue · Gold · Platinum · Diamond. 1 point per trip, bonus points at peak, status from a fixed 3-month window. "Requirements may vary by city" — no public numeric thresholds (Grade U).

5% Pro Perk on eligible trips (Gold+; California: Platinum+ only)

Priority Rides — Exclusive requests sooner (Gold+)

Trip Radar Advantage — priority airport/key-zone matching (Gold+)

Priority Reserve (Platinum+)

Extra Destination Mode — 3×/day, declines don't end the session (Platinum+)

Free 3-month Uber One (Diamond)

Cancellation gates: 4.01–10% freezes advancement; >10% loses Gold/Platinum/Diamond rewards immediately

The exclusion footnotes are useful as a product-name enumeration (Grade A):

5% excluded: Commute, delivery trips (Uber Eats, Uber Connect), Hourly, Uber Black, Uber Black SUV, Uber Intercity, Uber Premier, Uber Premier SUV, Uber Reserve

Exclusive-request perk excluded: Hourly, Uber Intercity, Uber XShare, Uber Wait & Save, Uber Black, Uber Black SUV, Uber Premier, Uber Premier SUV, Uber WAV, Uber Reserve, and ride requests originating at airports

Trip Radar Advantage excluded: Uber Intercity, Uber Wait & Save, Uber Share, Uber Reserve

## §14.2 Lyft Rewards

Tiers: Silver · Gold · Platinum · Elite. 1–2 tier points per $1 of ride earnings + tips (tips counted up to $15/ride; bonuses excluded). Monthly qualifying period, 5 AM first day → 5 AM last day, with a 7-day grace period.

Acceptance-rate multipliers, effective Aug 1 or Sep 1 2026 by region: <50% = 1× · 50–70% = 1.5× · 70–90% = 1.75× · 90–100% = 2×. New qualifying goal: "Smooth Cruiser Score", same effective date. Colorado and California exclude both acceptance rate and Smooth Cruiser Score.

Ride-adjacent benefits appear only at the top: Gold 3 location filters/day · Platinum 4/day · Elite premium airport pickups, 6 filters/day, early access to view and accept scheduled rides, and status protection after 3 consecutive Elite months. Texas/DFW: the full program applies.

## §15 Known gaps — do not fill these by inference

Everything below is Grade U. An LLM consuming this file should treat these as explicitly unknown and fall through to generic rules rather than guessing.

## §15.1 Uber

Offer-card badge strings for Long trip, Round trip, Multiple stops, Surge, Promotion. Uber uses "Multi-stop trips" in prose; the literal card badge is unconfirmed

Whether Uber Assist exists in the US at all in 2026 — no US page exists; only AU/GB/NL

Uber WAV presence in DFW — Uber publishes no city list; secondhand sources conflict and none list Dallas

UberXXL rider availability in DFW — it is in the driver eligibility feed but absent from the DFW/DAL rider option lists

Driver-side Reserve mechanics: offer lead time, no-show rules, cancellation windows

Exact Uber Pro point thresholds (city-specific, unpublished)

Uber Premier seat-count and color requirements (not a DFW concern — DFW is a Black market)

Whether an UberXL driver automatically receives UberX. Operationally near-certain; Uber never states it

Uber Pet confirmed nationally but not confirmed specifically for DFW

Uber Taxi appears in a DFW SEO city list, but that list is marketing boilerplate — unconfirmed as a real DFW dispatch tier

Root cause for most of the Uber gaps: every help.uber.com article returned HTTP 404 during collection, including the domain root. That is where Reserve driver rules, WAV city lists, and offer-card badge documentation live. Re-running collection from a network with help.uber.com reachable would close most of this list.

## §15.2 Lyft

Driver-side display strings for Priority Pickup and Wait & Save. Evidence points to both dispatching into the Standard pool. Expect Standard on those cards until observed otherwise

Extra Comfort max passenger count — never published

XXL region list — never published; DFW status unknown

Market lists for Pet rides, Lyft Assisted, Silver Select, Lyft Teen, and Shared — never published; DFW status unknown for all five

Lyft Teen numeric driver thresholds (rating, ride count)

The definition of "low-entry vehicle" for Silver Select — Lyft never defines it

Citywide DFW Green — only DFW airport is confirmed (Apr 2024 expansion post); no newer source

Texas model-year conflict: 2009 (lyft.com, page self-titled "Austin") vs 2010 (help.lyft.com). Use 2010 for DFW. Lyft has announced changes effective 2026-01-01

Whether Women+ Connect produces a driver-visible offer-card badge

## §15.3 Other

Empower vehicle requirements — model year, doors, seats: none published

zTrip model-year rule — governed by local for-hire inspection standards

Via DFW gig availability, and whether DART GoLink is Via-powered with gig-sourced drivers

Veho DFW zip coverage (behind a gated spreadsheet)

Trim-level seat counts for Kia Carnival and Toyota Sienna could not be confirmed against manufacturer spec sheets — dealer/SEO sources only. Both are marked ⚠️ rather than asserted

## §15.4 Corrections captured during collection — do not reintroduce

| **Claim seen in the wild** | **Reality** |
|---|---|
| Uber's national vehicle page lists Uber Black at "6-year-old or newer" | The national page has only UberX, UberXL, and Comfort sections. No national Black spec exists |
| Uber national driver minimum age is 23 | 25, on both the national and Dallas pages |
| A tier called "Uber Platinum" | Does not exist. Zero corroboration — a third-party fabrication |
| Lyft Extra Comfort needs 4.85★, Black needs 4.7★ | 4.95★ for both. Lyft primary contradicts the aggregator |
| Lyft bans subcompacts | Obsolete. Allowed since 2021-08-25 |
| Lyft Lux still exists | Retired ~Oct–Nov 2023. Lux and Lyft Preferred → Extra Comfort; Lux Black → Black; Lux Black XL → Black SUV |
| Veyo is owned by ModivCare | MTM Health, acquisition closed 2022-08-01 |
| Revel is an NYC rideshare option | Shut down 2025-08-11 |
| Uber Green is a current product name | Renamed Uber Electric 2025-10-22. Stale "Uber Green" strings persist in Uber's own driver copy — match both |

## §16 Suggested storage schema

  
  
  

SQL

-- Key on all six. Three of the six are load-bearing; dropping the trim  
-- dimension produces wrong answers for ~15 popular 3-row SUVs.  
CREATE TABLE vehicle_tier_eligibility (  
  platform          TEXT NOT NULL,      -- 'uber' | 'lyft' | 'grab' | ...  
  market            TEXT NOT NULL,      -- 'dallas' — never assume national  
  make              TEXT NOT NULL,  
  model_raw         TEXT NOT NULL,      -- the operator's exact string  
  model_normalized  TEXT NOT NULL,      -- via explicit alias table, never fuzzy  
  model_year_floor  INTEGER NOT NULL,  
  trim_seat_count   INTEGER,            -- NULL = unknown, treat as ineligible for xl  
  canonical_tier    TEXT NOT NULL,  
  requires_black_ext   BOOLEAN DEFAULT FALSE,  
  requires_black_int   BOOLEAN DEFAULT FALSE,  
  requires_bev         BOOLEAN DEFAULT FALSE,  
  min_driver_rating    NUMERIC,  
  min_trips            INTEGER,  
  requires_commercial_ins BOOLEAN DEFAULT FALSE,  
  requires_city_permit    BOOLEAN DEFAULT FALSE,  
  confidence        CHAR(1) NOT NULL,   -- A | B | C | S | U  
  valid_as_of       DATE NOT NULL,  
  source_url        TEXT  
);  
  

Non-negotiable implementation rules:

Key on (platform, market, make, model, model_year, trim_seat_count).

Store the operator's raw model string. Near-duplicate keys resolve to different tier sets (GLS-Class vs GLS SUV). Normalize with an explicit alias table. Never fuzzy-match.

Every row needs valid_as_of. Both operators state in writing that model-year floors increment annually. Re-pull quarterly, mandatory in January.

Never merge Uber and Lyft eligibility into one boolean (§11.2).

Premium tiers are a conjunction. A qualifying-model white Escalade is not Black-eligible.

Do not populate a green/EV column from Uber's Electric tag (§9.1).

not_offered_in_market ≠ false. DFW has no Uber Electric and no Uber Premier in the feed. Those are market absences, not eligibility failures.

trim_seat_count IS NULL must resolve to XL-ineligible, not XL-eligible-by-default.

## §16.1 Refreshing the Uber market feed

The published eligible-vehicles page renders client-side. The backing call:

POST https://www.uber.com/api/getEligibleVehiclesForCity

Header: x-csrf-token: x

Body: {"citySlug":"dallas"}

Verified genuinely market-specific: Dallas returns UberXXL, Black Hourly, UberXL Priority and no Electric; Houston returns WAV-Houston, Package Dropoff, Electric; Chicago returns WAV - Test; LA returns Taxi, Uber for teens, UberX SD. Different payloads per city means real market data, not a fallback. Swap the slug to onboard a new metro.

## §17 Sources

Uber — official (Grade A/B)

Ride options

Vehicle requirements — Dallas

Vehicle requirements — national

Eligible vehicles (market feed)

Driver basics

Uber Pro · Uber Pro reimagined (2026-02-11)

Comfort Electric · Electric

Teens (driver)

Trip Radar · Only on Uber

Reserve · Route Share

Uber Black · Black SUV · Uber Electric · WAV · Car Seat

DFW airport ride options

Lyft — official (Grade A/B)

Eligible Premium Vehicles

Ride types overview

Premium ride types for drivers

Texas Driver Information

Driver requirements · Vehicle requirements

Extra Comfort · Black and Black SUV · XL/XXL

Accessible vehicle dispatch (WAV)

Lyft Assisted (drivers) · Lyft Silver for Drivers

Pet rides (drivers) · Lyft Teen for Drivers

Scheduled pickups · Women+ Connect

Rider verification · Upfront pay · Lyft Rewards

Green mode expansion

DFW rider city page

Other platforms (Grade A/B)

Alto · Alto careers · Axios — Alto shrinks

Spark — offer types · Spark Rewards

UZURV · HopSkipDrive qualifications

Veyo Texas onboarding · MTM acquisition

zTrip DFW · Empower DFW pricing

Hitch · Favor

Waymo — Dallas launch (2026-02-24)

amNY — Revel exits rideshare

Dasher Rewards · Cart Star · Flex Rewards

Powertrain / rename (Grade C)

Electrek — Uber Green becomes Uber Electric (2025-10-22)

Electrive — Uber rebrands Green to Electric

End of RIDE_TYPE_TAXONOMY v2.0 — generated 2026-08-19. Model-year floors increment annually. Re-verify in January.

#### **Works cited**

1.  Rideshare Driver Panic Response Platform Market Research Report, <https://dataintelo.com/report/rideshare-driver-panic-response-platform-market>
2.  Texas Driver Information - Lyft Help, <https://help.lyft.com/hc/en-us/articles/115013083628-Texas-Driver-Information>
3.  Lyft Driver and Vehicle Requirements in Austin, <https://www.lyft.com/driver/cities/austin-tx/driver-application-requirements>
4.  Uber Comfort Electric: Reduce Emissions and Ride in Style, <https://www.uber.com/us/en/drive/services/comfort-electric/>
5.  How Our Latest Pilot Aims to Make Our Rewards Program