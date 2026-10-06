ALTER TABLE desktop_play_sessions
  ADD COLUMN opening_progression_json TEXT
  CHECK (
    opening_progression_json IS NULL OR json_valid(opening_progression_json)
  );
