CREATE TABLE randomness_states (
  row_id INTEGER PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  checkpoint_id TEXT REFERENCES checkpoints(id),
  algorithm TEXT NOT NULL CHECK (algorithm = 'mulberry32-v1'),
  root_seed INTEGER NOT NULL CHECK (root_seed BETWEEN 0 AND 4294967295),
  next_stream INTEGER NOT NULL CHECK (
    next_stream BETWEEN 0 AND 9007199254740991
  )
);

CREATE UNIQUE INDEX randomness_current_unique
  ON randomness_states(world_id) WHERE checkpoint_id IS NULL;
CREATE UNIQUE INDEX randomness_checkpoint_unique
  ON randomness_states(checkpoint_id) WHERE checkpoint_id IS NOT NULL;

-- Pre-#8 saves had no authoritative RNG progression. Seed 0 / stream 0 starts
-- a documented deterministic future sequence without fabricating past draws.
INSERT INTO randomness_states (
  world_id, checkpoint_id, algorithm, root_seed, next_stream
)
SELECT id, NULL, 'mulberry32-v1', 0, 0 FROM worlds;

INSERT INTO randomness_states (
  world_id, checkpoint_id, algorithm, root_seed, next_stream
)
SELECT world_id, id, 'mulberry32-v1', 0, 0 FROM checkpoints;

CREATE TRIGGER validate_randomness_command
BEFORE INSERT ON persistence_commands
BEGIN
  SELECT RAISE(ABORT, 'invalid randomness state')
    WHERE json_extract(NEW.payload_json, '$.operation') IN
      ('create-world', 'commit-world', 'save-checkpoint')
      AND (
        json_type(NEW.payload_json, '$.state.randomness') IS NOT 'object'
        OR json_extract(NEW.payload_json, '$.state.randomness.algorithm') <> 'mulberry32-v1'
        OR json_type(NEW.payload_json, '$.state.randomness.rootSeed') IS NOT 'integer'
        OR json_extract(NEW.payload_json, '$.state.randomness.rootSeed') NOT BETWEEN 0 AND 4294967295
        OR json_type(NEW.payload_json, '$.state.randomness.nextStream') IS NOT 'integer'
        OR json_extract(NEW.payload_json, '$.state.randomness.nextStream') NOT BETWEEN 0 AND 9007199254740991
      );
END;

CREATE TRIGGER persist_randomness_on_world_create
AFTER INSERT ON worlds
BEGIN
  INSERT INTO randomness_states (
    world_id, checkpoint_id, algorithm, root_seed, next_stream
  )
  SELECT
    NEW.id,
    NULL,
    json_extract(command.payload_json, '$.state.randomness.algorithm'),
    json_extract(command.payload_json, '$.state.randomness.rootSeed'),
    json_extract(command.payload_json, '$.state.randomness.nextStream')
  FROM persistence_commands command
  WHERE json_extract(command.payload_json, '$.operation') = 'create-world'
    AND json_extract(command.payload_json, '$.metadata.id') = NEW.id
  ORDER BY command.row_id DESC
  LIMIT 1;
END;

CREATE TRIGGER persist_randomness_on_world_commit
AFTER UPDATE OF revision ON worlds
WHEN EXISTS (
  SELECT 1 FROM persistence_commands command
  WHERE json_extract(command.payload_json, '$.operation') = 'commit-world'
    AND json_extract(command.payload_json, '$.worldId') = NEW.id
)
BEGIN
  UPDATE randomness_states
  SET
    algorithm = (
      SELECT json_extract(command.payload_json, '$.state.randomness.algorithm')
      FROM persistence_commands command
      WHERE json_extract(command.payload_json, '$.operation') = 'commit-world'
        AND json_extract(command.payload_json, '$.worldId') = NEW.id
      ORDER BY command.row_id DESC LIMIT 1
    ),
    root_seed = (
      SELECT json_extract(command.payload_json, '$.state.randomness.rootSeed')
      FROM persistence_commands command
      WHERE json_extract(command.payload_json, '$.operation') = 'commit-world'
        AND json_extract(command.payload_json, '$.worldId') = NEW.id
      ORDER BY command.row_id DESC LIMIT 1
    ),
    next_stream = (
      SELECT json_extract(command.payload_json, '$.state.randomness.nextStream')
      FROM persistence_commands command
      WHERE json_extract(command.payload_json, '$.operation') = 'commit-world'
        AND json_extract(command.payload_json, '$.worldId') = NEW.id
      ORDER BY command.row_id DESC LIMIT 1
    )
  WHERE world_id = NEW.id AND checkpoint_id IS NULL;
END;

CREATE TRIGGER persist_randomness_on_checkpoint_create
AFTER INSERT ON checkpoints
BEGIN
  INSERT INTO randomness_states (
    world_id, checkpoint_id, algorithm, root_seed, next_stream
  )
  SELECT
    NEW.world_id,
    NEW.id,
    json_extract(command.payload_json, '$.state.randomness.algorithm'),
    json_extract(command.payload_json, '$.state.randomness.rootSeed'),
    json_extract(command.payload_json, '$.state.randomness.nextStream')
  FROM persistence_commands command
  WHERE json_extract(command.payload_json, '$.operation') = 'save-checkpoint'
    AND json_extract(command.payload_json, '$.checkpoint.id') = NEW.id
  ORDER BY command.row_id DESC
  LIMIT 1;
END;

CREATE TRIGGER randomness_checkpoint_immutable_update
BEFORE UPDATE ON randomness_states
WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;

CREATE TRIGGER randomness_checkpoint_immutable_delete
BEFORE DELETE ON randomness_states
WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
