CREATE TABLE action_runs (
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  declaration TEXT NOT NULL,
  run_json TEXT NOT NULL CHECK (json_valid(run_json)),
  PRIMARY KEY (world_id, action_id)
);

CREATE TRIGGER validate_action_run_world_commit
BEFORE INSERT ON persistence_commands
WHEN json_extract(NEW.payload_json, '$.operation') = 'commit-world'
 AND json_type(NEW.payload_json, '$.actionRun') = 'object'
BEGIN
  SELECT CASE WHEN json_extract(NEW.payload_json, '$.actionRun.worldId') != json_extract(NEW.payload_json, '$.worldId')
    THEN RAISE(ABORT, 'Action run world does not match commit world') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM action_runs
    WHERE world_id = json_extract(NEW.payload_json, '$.worldId')
      AND action_id = json_extract(NEW.payload_json, '$.actionRun.id')
      AND (actor_id != json_extract(NEW.payload_json, '$.actionRun.actorId')
        OR declaration != json_extract(NEW.payload_json, '$.actionRun.declaration'))
  ) THEN RAISE(ABORT, 'Action run identity conflict') END;
END;

CREATE TRIGGER persist_action_run_world_commit
AFTER INSERT ON persistence_commands
WHEN json_extract(NEW.payload_json, '$.operation') = 'commit-world'
 AND json_type(NEW.payload_json, '$.actionRun') = 'object'
BEGIN
  INSERT INTO action_runs(world_id, action_id, actor_id, declaration, run_json)
  VALUES (
    json_extract(NEW.payload_json, '$.worldId'),
    json_extract(NEW.payload_json, '$.actionRun.id'),
    json_extract(NEW.payload_json, '$.actionRun.actorId'),
    json_extract(NEW.payload_json, '$.actionRun.declaration'),
    json_extract(NEW.payload_json, '$.actionRun')
  )
  ON CONFLICT(world_id, action_id) DO UPDATE SET run_json = excluded.run_json;
END;
