
CREATE TABLE drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  first_name TEXT,
  home_lat DOUBLE PRECISION,
  home_lng DOUBLE PRECISION
);

CREATE TABLE driver_preferences (
  driver_id UUID REFERENCES drivers(id),
  no_go_zones TEXT[] DEFAULT '{}',
  vehicle_types TEXT[] DEFAULT '{}',
  must_be_home_by TIME,
  PRIMARY KEY (driver_id)
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID REFERENCES drivers(id),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  break_minutes INT DEFAULT 0,
  fatigue_index REAL DEFAULT 0
);

CREATE TABLE trip_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID REFERENCES drivers(id),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  start_lat DOUBLE PRECISION,
  start_lng DOUBLE PRECISION,
  end_lat DOUBLE PRECISION,
  end_lng DOUBLE PRECISION,
  earnings_cents INT,
  surge REAL
);

CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID REFERENCES drivers(id),
  location_id TEXT,
  up BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
