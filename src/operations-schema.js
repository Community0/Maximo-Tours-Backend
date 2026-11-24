'use strict';
module.exports = `
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cart_count INTEGER NOT NULL DEFAULT 1 CHECK(cart_count BETWEEN 1 AND 100);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source_kind TEXT NOT NULL DEFAULT 'website';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source_label TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS analytics_session TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS acquisition_source TEXT;
CREATE TABLE IF NOT EXISTS maximo_resources (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('driver','vehicle')), name TEXT NOT NULL,
 phone TEXT NOT NULL DEFAULT '', seats INTEGER NOT NULL DEFAULT 7 CHECK(seats BETWEEN 1 AND 7),
 notes TEXT NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS maximo_assignments (
 booking_id TEXT NOT NULL REFERENCES bookings(id), cart_index INTEGER NOT NULL,
 people INTEGER NOT NULL CHECK(people BETWEEN 1 AND 7),
 vehicle_id TEXT REFERENCES maximo_resources(id), driver_id TEXT REFERENCES maximo_resources(id),
 PRIMARY KEY(booking_id,cart_index), UNIQUE(booking_id,vehicle_id), UNIQUE(booking_id,driver_id)
);
CREATE TABLE IF NOT EXISTS maximo_operations_keys (
 key UUID PRIMARY KEY, payload_hash TEXT NOT NULL, booking_id TEXT NOT NULL REFERENCES bookings(id)
);
CREATE TABLE IF NOT EXISTS maximo_visit_events (
 id UUID PRIMARY KEY, session_id UUID NOT NULL, event TEXT NOT NULL CHECK(event IN ('page_view','begin_checkout')),
 page TEXT NOT NULL, source TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS maximo_visits_created ON maximo_visit_events(created_at);
CREATE INDEX IF NOT EXISTS maximo_visits_session ON maximo_visit_events(session_id);
CREATE INDEX IF NOT EXISTS maximo_assignment_vehicle ON maximo_assignments(vehicle_id);
CREATE INDEX IF NOT EXISTS maximo_assignment_driver ON maximo_assignments(driver_id);
CREATE INDEX IF NOT EXISTS maximo_bookings_channel_date ON bookings(channel,date);
`;
