CREATE TABLE campaign_generation_drafts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  input_json TEXT NOT NULL CHECK (json_valid(input_json)),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  diagnostics_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(diagnostics_json)),
  generated_json TEXT CHECK (generated_json IS NULL OR json_valid(generated_json)),
  opening_proposal_json TEXT CHECK (
    opening_proposal_json IS NULL OR json_valid(opening_proposal_json)
  ),
  status TEXT NOT NULL CHECK (
    status IN ('generating', 'needs-input', 'failed')
  ),
  questions_json TEXT CHECK (questions_json IS NULL OR json_valid(questions_json)),
  last_completed_stage_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_campaign_generation_drafts_updated
  ON campaign_generation_drafts(updated_at DESC);
