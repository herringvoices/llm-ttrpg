CREATE TABLE extended_world_states (
  owner_key TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  checkpoint_id TEXT REFERENCES checkpoints(id),
  actor_social_json TEXT NOT NULL CHECK (json_valid(actor_social_json)),
  mechanical_realizations_json TEXT NOT NULL CHECK (json_valid(mechanical_realizations_json)),
  generation_record_json TEXT CHECK (
    generation_record_json IS NULL OR json_valid(generation_record_json)
  )
);

CREATE UNIQUE INDEX extended_world_checkpoint_unique
  ON extended_world_states(checkpoint_id) WHERE checkpoint_id IS NOT NULL;

INSERT INTO extended_world_states (
  owner_key, world_id, checkpoint_id, actor_social_json,
  mechanical_realizations_json, generation_record_json
)
SELECT 'world:' || id, id, NULL, '[]', '[]', NULL
FROM worlds;

INSERT INTO extended_world_states (
  owner_key, world_id, checkpoint_id, actor_social_json,
  mechanical_realizations_json, generation_record_json
)
SELECT 'checkpoint:' || id, world_id, id, '[]', '[]', NULL
FROM checkpoints;

CREATE TRIGGER validate_extended_world_state_command
BEFORE INSERT ON persistence_commands
WHEN json_extract(NEW.payload_json, '$.operation') IN
  ('create-world', 'commit-world', 'save-checkpoint')
BEGIN
  SELECT RAISE(ABORT, 'invalid actor social state collection')
    WHERE json_type(NEW.payload_json, '$.state.actorSocialStates') IS NOT 'array';
  SELECT RAISE(ABORT, 'invalid mechanical realization collection')
    WHERE json_type(NEW.payload_json, '$.state.mechanicalRealizations') IS NOT 'array';
  SELECT RAISE(ABORT, 'invalid generation record')
    WHERE json_type(NEW.payload_json, '$.state.generationRecord') IS NOT NULL
      AND json_type(NEW.payload_json, '$.state.generationRecord') IS NOT 'object';
END;

CREATE TRIGGER persist_extended_state_on_world_create
AFTER INSERT ON worlds
BEGIN
  INSERT INTO extended_world_states (
    owner_key, world_id, checkpoint_id, actor_social_json,
    mechanical_realizations_json, generation_record_json
  )
  SELECT
    'world:' || NEW.id,
    NEW.id,
    NULL,
    json_extract(command.payload_json, '$.state.actorSocialStates'),
    json_extract(command.payload_json, '$.state.mechanicalRealizations'),
    json_extract(command.payload_json, '$.state.generationRecord')
  FROM persistence_commands command
  WHERE json_extract(command.payload_json, '$.operation') = 'create-world'
    AND json_extract(command.payload_json, '$.metadata.id') = NEW.id
  ORDER BY command.row_id DESC
  LIMIT 1;
END;

CREATE TRIGGER persist_extended_state_on_world_commit
AFTER UPDATE OF revision ON worlds
WHEN EXISTS (
  SELECT 1 FROM persistence_commands command
  WHERE json_extract(command.payload_json, '$.operation') = 'commit-world'
    AND json_extract(command.payload_json, '$.worldId') = NEW.id
)
BEGIN
  INSERT INTO extended_world_states (
    owner_key, world_id, checkpoint_id, actor_social_json,
    mechanical_realizations_json, generation_record_json
  )
  SELECT
    'world:' || NEW.id,
    NEW.id,
    NULL,
    json_extract(command.payload_json, '$.state.actorSocialStates'),
    json_extract(command.payload_json, '$.state.mechanicalRealizations'),
    json_extract(command.payload_json, '$.state.generationRecord')
  FROM persistence_commands command
  WHERE json_extract(command.payload_json, '$.operation') = 'commit-world'
    AND json_extract(command.payload_json, '$.worldId') = NEW.id
  ORDER BY command.row_id DESC
  LIMIT 1
  ON CONFLICT(owner_key) DO UPDATE SET
    actor_social_json = excluded.actor_social_json,
    mechanical_realizations_json = excluded.mechanical_realizations_json,
    generation_record_json = excluded.generation_record_json;
END;

CREATE TRIGGER persist_extended_state_on_checkpoint_create
AFTER INSERT ON checkpoints
BEGIN
  INSERT INTO extended_world_states (
    owner_key, world_id, checkpoint_id, actor_social_json,
    mechanical_realizations_json, generation_record_json
  )
  SELECT
    'checkpoint:' || NEW.id,
    NEW.world_id,
    NEW.id,
    json_extract(command.payload_json, '$.state.actorSocialStates'),
    json_extract(command.payload_json, '$.state.mechanicalRealizations'),
    json_extract(command.payload_json, '$.state.generationRecord')
  FROM persistence_commands command
  WHERE json_extract(command.payload_json, '$.operation') = 'save-checkpoint'
    AND json_extract(command.payload_json, '$.checkpoint.id') = NEW.id
  ORDER BY command.row_id DESC
  LIMIT 1;
END;

CREATE TRIGGER extended_checkpoint_immutable_update
BEFORE UPDATE ON extended_world_states
WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;

CREATE TRIGGER extended_checkpoint_immutable_delete
BEFORE DELETE ON extended_world_states
WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
