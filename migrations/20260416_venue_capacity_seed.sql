-- 2026-04-16 (H-3a): Seed venue_catalog.capacity_estimate for top DFW-metro venues
-- Source: published max physical capacity (standing room included where published)
-- If a venue's capacity is not confidently known, it is NOT included (NULL preferred over guess)
-- Idempotent: uses ON CONFLICT-safe UPDATE pattern (matched by venue_name ILIKE + city)
-- DEV ONLY — prod migration requires Melody's approval

-- ═══ Major Stadiums & Arenas ═══
UPDATE venue_catalog SET capacity_estimate = 80000 WHERE venue_name ILIKE '%AT&T Stadium%' AND city ILIKE 'Arlington';
UPDATE venue_catalog SET capacity_estimate = 19200 WHERE venue_name ILIKE '%American Airlines Center%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 40300 WHERE venue_name ILIKE '%Globe Life Field%' AND city ILIKE 'Arlington';
UPDATE venue_catalog SET capacity_estimate = 14000 WHERE venue_name ILIKE '%Dickies Arena%' AND city ILIKE 'Fort Worth';
UPDATE venue_catalog SET capacity_estimate = 20500 WHERE venue_name ILIKE '%Toyota Stadium%' AND city ILIKE 'Frisco';
UPDATE venue_catalog SET capacity_estimate = 12000 WHERE venue_name ILIKE '%Ford Center%' AND city ILIKE 'Frisco';
UPDATE venue_catalog SET capacity_estimate = 5300 WHERE venue_name ILIKE '%Comerica Center%' AND city ILIKE 'Frisco';
UPDATE venue_catalog SET capacity_estimate = 14000 WHERE venue_name ILIKE '%Choctaw Stadium%' AND city ILIKE 'Arlington';
UPDATE venue_catalog SET capacity_estimate = 7000 WHERE venue_name ILIKE '%Dos Equis Pavilion%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 8000 WHERE venue_name ILIKE '%Toyota Music Factory%' AND city ILIKE 'Irving';
UPDATE venue_catalog SET capacity_estimate = 8000 WHERE venue_name ILIKE '%Pavilion at Toyota%' AND city ILIKE 'Irving';

-- ═══ Concert Halls & Theaters ═══
UPDATE venue_catalog SET capacity_estimate = 2200 WHERE venue_name ILIKE '%Winspear Opera%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 2066 WHERE venue_name ILIKE '%Meyerson Symphony%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 4200 WHERE venue_name ILIKE '%Bass Performance Hall%' AND city ILIKE 'Fort Worth';
UPDATE venue_catalog SET capacity_estimate = 4500 WHERE venue_name ILIKE '%Majestic Theatre%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 1300 WHERE venue_name ILIKE '%South Side Ballroom%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 2200 WHERE venue_name ILIKE '%House of Blues%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 1100 WHERE venue_name ILIKE '%Granada Theater%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 4000 WHERE venue_name ILIKE '%Factory in Deep Ellum%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 900 WHERE venue_name ILIKE '%Kessler Theater%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 700 WHERE venue_name ILIKE '%Echo Lounge%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 300 WHERE venue_name ILIKE '%Three Links%' AND city ILIKE 'Dallas';

-- ═══ Minor League / Smaller Sports ═══
UPDATE venue_catalog SET capacity_estimate = 10216 WHERE venue_name ILIKE '%Riders Field%' AND city ILIKE 'Frisco';
UPDATE venue_catalog SET capacity_estimate = 10216 WHERE venue_name ILIKE '%Dr Pepper Ballpark%' AND city ILIKE 'Frisco';
UPDATE venue_catalog SET capacity_estimate = 5300 WHERE venue_name ILIKE '%Comerica Center%' AND city ILIKE 'Frisco';
UPDATE venue_catalog SET capacity_estimate = 7200 WHERE venue_name ILIKE '%Credit Union of Texas%' AND city ILIKE 'Allen';
UPDATE venue_catalog SET capacity_estimate = 4500 WHERE venue_name ILIKE '%Moody Coliseum%' AND city ILIKE 'Dallas';

-- ═══ Entertainment & Event Venues ═══
UPDATE venue_catalog SET capacity_estimate = 2500 WHERE venue_name ILIKE '%Omni PGA Frisco%' AND city ILIKE 'Frisco';
UPDATE venue_catalog SET capacity_estimate = 5000 WHERE venue_name ILIKE '%Legacy Hall%' AND city ILIKE 'Plano';
UPDATE venue_catalog SET capacity_estimate = 1000 WHERE venue_name ILIKE '%Wild Detectives%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 4000 WHERE venue_name ILIKE '%Gilley%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 400 WHERE venue_name ILIKE '%Dallas Comedy Club%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 400 WHERE venue_name ILIKE '%Hyena%Comedy%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 300 WHERE venue_name ILIKE '%Plano House of Comedy%' AND city ILIKE 'Plano';
UPDATE venue_catalog SET capacity_estimate = 500 WHERE venue_name ILIKE '%SILO%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 2000 WHERE venue_name ILIKE '%Bomb Factory%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 1500 WHERE venue_name ILIKE '%Canton Hall%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 3000 WHERE venue_name ILIKE '%Lava Cantina%' AND city ILIKE '%Colony%';
UPDATE venue_catalog SET capacity_estimate = 10000 WHERE venue_name ILIKE '%Cotton Bowl%' AND city ILIKE 'Dallas';
UPDATE venue_catalog SET capacity_estimate = 3000 WHERE venue_name ILIKE '%Texas Live%' AND city ILIKE 'Arlington';
