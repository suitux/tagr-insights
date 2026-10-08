-- One row per instance and UTC day: a second report the same day replaces the first.
CREATE TABLE reports (
  instance_id TEXT NOT NULL,
  day TEXT NOT NULL,
  received_at TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (instance_id, day)
);

CREATE INDEX reports_day_idx ON reports (day);

-- Aggregated history behind the public dashboard. Never purged.
CREATE TABLE daily_summaries (
  day TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
