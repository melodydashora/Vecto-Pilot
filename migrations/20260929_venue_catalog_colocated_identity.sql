-- Google place_id identifies a venue; an address/coordinate can contain several
-- businesses. Preserve every row and the existing place_id uniqueness constraint.
-- coords_cache remains a coordinate cache and retains its separate unique key.
ALTER TABLE venue_catalog DROP CONSTRAINT IF EXISTS venue_catalog_coord_key_unique;
CREATE INDEX IF NOT EXISTS idx_venue_catalog_coord_key ON venue_catalog (coord_key);
