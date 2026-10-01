CREATE TABLE action_pressure_states (
  row_id INTEGER PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  checkpoint_id TEXT REFERENCES checkpoints(id),
  level INTEGER CHECK (level BETWEEN 1 AND 9)
);

CREATE UNIQUE INDEX action_pressure_current_unique
  ON action_pressure_states(world_id) WHERE checkpoint_id IS NULL;
CREATE UNIQUE INDEX action_pressure_checkpoint_unique
  ON action_pressure_states(checkpoint_id) WHERE checkpoint_id IS NOT NULL;

-- Existing pre-#7 state has no justified assessment. Preserve that uncertainty.
INSERT INTO action_pressure_states (world_id, checkpoint_id, level)
SELECT id, NULL, NULL FROM worlds;

INSERT INTO action_pressure_states (world_id, checkpoint_id, level)
SELECT world_id, id, NULL FROM checkpoints;

CREATE TRIGGER validate_action_pressure_command
BEFORE INSERT ON persistence_commands
BEGIN
  SELECT RAISE(ABORT, 'invalid action pressure state')
    WHERE json_extract(NEW.payload_json, '$.operation') IN
      ('create-world', 'commit-world', 'save-checkpoint')
      AND (
        json_type(NEW.payload_json, '$.state.actionPressure') IS NOT 'object'
        OR json_extract(NEW.payload_json, '$.state.actionPressure.status') IS NULL
        OR json_extract(NEW.payload_json, '$.state.actionPressure.status') NOT IN
          ('unassessed', 'assessed')
        OR (
          json_extract(NEW.payload_json, '$.state.actionPressure.status') = 'unassessed'
          AND json_type(NEW.payload_json, '$.state.actionPressure.level') IS NOT NULL
        )
        OR (
          json_extract(NEW.payload_json, '$.state.actionPressure.status') = 'assessed'
          AND (
            json_type(NEW.payload_json, '$.state.actionPressure.level') IS NOT 'integer'
            OR json_extract(NEW.payload_json, '$.state.actionPressure.level') NOT BETWEEN 1 AND 9
          )
        )
      );
END;

-- These triggers run inside the existing persistence-command statement. The
-- command row is still visible while migration 0002's apply trigger writes the
-- world/checkpoint rows, so pressure participates in the same atomic commit.
CREATE TRIGGER persist_action_pressure_on_world_create
AFTER INSERT ON worlds
BEGIN
  INSERT INTO action_pressure_states (world_id, checkpoint_id, level)
  VALUES (
    NEW.id,
    NULL,
    (
      SELECT json_extract(command.payload_json, '$.state.actionPressure.level')
      FROM persistence_commands command
      WHERE json_extract(command.payload_json, '$.operation') = 'create-world'
        AND json_extract(command.payload_json, '$.metadata.id') = NEW.id
      ORDER BY command.row_id DESC
      LIMIT 1
    )
  );
END;

CREATE TRIGGER persist_action_pressure_on_world_commit
AFTER UPDATE OF revision ON worlds
WHEN EXISTS (
  SELECT 1 FROM persistence_commands command
  WHERE json_extract(command.payload_json, '$.operation') = 'commit-world'
    AND json_extract(command.payload_json, '$.worldId') = NEW.id
)
BEGIN
  UPDATE action_pressure_states
  SET level = (
    SELECT json_extract(command.payload_json, '$.state.actionPressure.level')
    FROM persistence_commands command
    WHERE json_extract(command.payload_json, '$.operation') = 'commit-world'
      AND json_extract(command.payload_json, '$.worldId') = NEW.id
    ORDER BY command.row_id DESC
    LIMIT 1
  )
  WHERE world_id = NEW.id AND checkpoint_id IS NULL;
END;

CREATE TRIGGER persist_action_pressure_on_checkpoint_create
AFTER INSERT ON checkpoints
BEGIN
  INSERT INTO action_pressure_states (world_id, checkpoint_id, level)
  VALUES (
    NEW.world_id,
    NEW.id,
    (
      SELECT json_extract(command.payload_json, '$.state.actionPressure.level')
      FROM persistence_commands command
      WHERE json_extract(command.payload_json, '$.operation') = 'save-checkpoint'
        AND json_extract(command.payload_json, '$.checkpoint.id') = NEW.id
      ORDER BY command.row_id DESC
      LIMIT 1
    )
  );
END;

CREATE TRIGGER action_pressure_checkpoint_immutable_update
BEFORE UPDATE ON action_pressure_states
WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;

CREATE TRIGGER action_pressure_checkpoint_immutable_delete
BEFORE DELETE ON action_pressure_states
WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
