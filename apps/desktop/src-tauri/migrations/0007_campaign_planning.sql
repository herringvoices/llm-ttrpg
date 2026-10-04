CREATE TABLE campaign_plans (
  world_id TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  plan_revision INTEGER NOT NULL CHECK (plan_revision >= 0),
  based_on_world_revision INTEGER NOT NULL CHECK (based_on_world_revision >= 0),
  based_on_event_sequence INTEGER NOT NULL CHECK (based_on_event_sequence >= 0),
  document_json TEXT NOT NULL CHECK (json_valid(document_json))
);

CREATE TABLE checkpoint_campaign_plans (
  checkpoint_id TEXT PRIMARY KEY REFERENCES checkpoints(id),
  source_world_id TEXT NOT NULL REFERENCES worlds(id),
  document_json TEXT NOT NULL CHECK (json_valid(document_json))
);

CREATE TRIGGER validate_checkpoint_campaign_plan_command
BEFORE INSERT ON persistence_commands
WHEN json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  AND json_type(NEW.payload_json, '$.plannerState') IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'invalid campaign planner document')
    WHERE json_type(NEW.payload_json, '$.plannerState') IS NOT 'object'
      OR json_extract(NEW.payload_json, '$.plannerState.schemaVersion') <> 1;
END;

CREATE TRIGGER persist_campaign_plan_on_checkpoint_create
AFTER INSERT ON checkpoints
WHEN EXISTS (
  SELECT 1 FROM persistence_commands command
  WHERE json_extract(command.payload_json, '$.operation') = 'save-checkpoint'
    AND json_extract(command.payload_json, '$.checkpoint.id') = NEW.id
    AND json_type(command.payload_json, '$.plannerState') = 'object'
)
BEGIN
  INSERT INTO checkpoint_campaign_plans (
    checkpoint_id, source_world_id, document_json
  )
  SELECT
    NEW.id,
    NEW.world_id,
    json(json_extract(command.payload_json, '$.plannerState'))
  FROM persistence_commands command
  WHERE json_extract(command.payload_json, '$.operation') = 'save-checkpoint'
    AND json_extract(command.payload_json, '$.checkpoint.id') = NEW.id
  ORDER BY command.row_id DESC
  LIMIT 1;
END;

CREATE TRIGGER checkpoint_campaign_plan_immutable_update
BEFORE UPDATE ON checkpoint_campaign_plans
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;

CREATE TRIGGER checkpoint_campaign_plan_immutable_delete
BEFORE DELETE ON checkpoint_campaign_plans
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
