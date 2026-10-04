CREATE TABLE desktop_play_sessions (
  world_id TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
  generated_package_json TEXT CHECK (
    generated_package_json IS NULL OR json_valid(generated_package_json)
  ),
  player_actor_id TEXT NOT NULL,
  locality_scope_id TEXT,
  narration_preference TEXT NOT NULL DEFAULT 'standard'
    CHECK (narration_preference IN ('concise', 'standard', 'expansive')),
  transcript_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(transcript_json))
);
