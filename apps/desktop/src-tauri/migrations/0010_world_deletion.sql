-- Campaign deletion is a privileged lifecycle command. The authorization row
-- exists only while this one command trigger is deleting the selected world.
CREATE TABLE world_deletion_commands (
  row_id INTEGER PRIMARY KEY,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE TABLE world_deletion_authorizations (
  world_id TEXT PRIMARY KEY
);

CREATE TRIGGER validate_world_deletion_command
BEFORE INSERT ON world_deletion_commands
BEGIN
  SELECT RAISE(ABORT, 'unknown world deletion operation')
    WHERE json_extract(NEW.payload_json, '$.operation') IS NOT 'delete-world';
  SELECT RAISE(ABORT, 'world deletion requires a world ID')
    WHERE json_type(NEW.payload_json, '$.worldId') IS NOT 'text'
      OR trim(json_extract(NEW.payload_json, '$.worldId')) = '';
  SELECT RAISE(ABORT, 'world not found')
    WHERE NOT EXISTS (
      SELECT 1 FROM worlds WHERE id = json_extract(NEW.payload_json, '$.worldId')
    );
END;

CREATE TRIGGER protect_world_deletion_authorization
BEFORE INSERT ON world_deletion_authorizations
WHEN NOT EXISTS (
  SELECT 1 FROM world_deletion_commands
  WHERE json_extract(payload_json, '$.operation') = 'delete-world'
    AND json_extract(payload_json, '$.worldId') = NEW.world_id
)
BEGIN
  SELECT RAISE(ABORT, 'world deletion authorization is private');
END;

DROP TRIGGER IF EXISTS checkpoints_immutable_delete;
CREATE TRIGGER checkpoints_immutable_delete
BEFORE DELETE ON checkpoints
WHEN NOT EXISTS (
  SELECT 1 FROM world_deletion_authorizations WHERE world_id = OLD.world_id
)
BEGIN SELECT RAISE(ABORT, 'checkpoints are immutable'); END;

DROP TRIGGER IF EXISTS entities_checkpoint_immutable_delete;
CREATE TRIGGER entities_checkpoint_immutable_delete
BEFORE DELETE ON entities
WHEN OLD.checkpoint_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM world_deletion_authorizations WHERE world_id = OLD.world_id
)
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;

DROP TRIGGER IF EXISTS facts_checkpoint_immutable_delete;
CREATE TRIGGER facts_checkpoint_immutable_delete
BEFORE DELETE ON facts
WHEN OLD.checkpoint_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM world_deletion_authorizations WHERE world_id = OLD.world_id
)
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;

DROP TRIGGER IF EXISTS beliefs_checkpoint_immutable_delete;
CREATE TRIGGER beliefs_checkpoint_immutable_delete
BEFORE DELETE ON beliefs
WHEN OLD.checkpoint_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM world_deletion_authorizations WHERE world_id = OLD.world_id
)
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;

DROP TRIGGER IF EXISTS documents_checkpoint_immutable_delete;
CREATE TRIGGER documents_checkpoint_immutable_delete
BEFORE DELETE ON documents
WHEN OLD.checkpoint_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM world_deletion_authorizations WHERE world_id = OLD.world_id
)
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;

DROP TRIGGER IF EXISTS sections_checkpoint_immutable_delete;
CREATE TRIGGER sections_checkpoint_immutable_delete
BEFORE DELETE ON document_sections
WHEN OLD.checkpoint_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM world_deletion_authorizations WHERE world_id = OLD.world_id
)
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;

DROP TRIGGER IF EXISTS events_immutable_delete;
CREATE TRIGGER events_immutable_delete
BEFORE DELETE ON events
WHEN NOT EXISTS (
  SELECT 1 FROM world_deletion_authorizations WHERE world_id = OLD.world_id
)
BEGIN SELECT RAISE(ABORT, 'event history is immutable'); END;

DROP TRIGGER IF EXISTS scheduled_checkpoint_immutable_delete;
CREATE TRIGGER scheduled_checkpoint_immutable_delete
BEFORE DELETE ON scheduled_triggers
WHEN OLD.checkpoint_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM world_deletion_authorizations WHERE world_id = OLD.world_id
)
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;

DROP TRIGGER IF EXISTS cursors_checkpoint_immutable_delete;
CREATE TRIGGER cursors_checkpoint_immutable_delete
BEFORE DELETE ON simulation_cursors
WHEN OLD.checkpoint_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM world_deletion_authorizations WHERE world_id = OLD.world_id
)
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;

DROP TRIGGER IF EXISTS action_pressure_checkpoint_immutable_delete;
CREATE TRIGGER action_pressure_checkpoint_immutable_delete
BEFORE DELETE ON action_pressure_states
WHEN OLD.checkpoint_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM world_deletion_authorizations WHERE world_id = OLD.world_id
)
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;

DROP TRIGGER IF EXISTS randomness_checkpoint_immutable_delete;
CREATE TRIGGER randomness_checkpoint_immutable_delete
BEFORE DELETE ON randomness_states
WHEN OLD.checkpoint_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM world_deletion_authorizations WHERE world_id = OLD.world_id
)
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;

DROP TRIGGER IF EXISTS extended_checkpoint_immutable_delete;
CREATE TRIGGER extended_checkpoint_immutable_delete
BEFORE DELETE ON extended_world_states
WHEN OLD.checkpoint_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM world_deletion_authorizations WHERE world_id = OLD.world_id
)
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;

DROP TRIGGER IF EXISTS checkpoint_campaign_plan_immutable_delete;
CREATE TRIGGER checkpoint_campaign_plan_immutable_delete
BEFORE DELETE ON checkpoint_campaign_plans
WHEN NOT EXISTS (
  SELECT 1 FROM world_deletion_authorizations WHERE world_id = OLD.source_world_id
)
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;

CREATE TRIGGER apply_world_deletion_command
AFTER INSERT ON world_deletion_commands
BEGIN
  INSERT INTO world_deletion_authorizations(world_id)
  VALUES (json_extract(NEW.payload_json, '$.worldId'));

  DELETE FROM checkpoint_campaign_plans
    WHERE source_world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM desktop_play_sessions
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM campaign_plans
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM action_runs
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM extended_world_states
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM action_pressure_states
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM randomness_states
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM simulation_cursors
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM scheduled_triggers
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM document_sections
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM documents
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM beliefs
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM facts
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM entities
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM events
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM save_slots
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM checkpoints
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM worlds
    WHERE id = json_extract(NEW.payload_json, '$.worldId');

  DELETE FROM world_deletion_authorizations
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId');
  DELETE FROM world_deletion_commands WHERE row_id = NEW.row_id;
END;
