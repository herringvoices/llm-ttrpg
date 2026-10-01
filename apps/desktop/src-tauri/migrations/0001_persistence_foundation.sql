PRAGMA foreign_keys = ON;

CREATE TABLE worlds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  composition_json TEXT NOT NULL CHECK (json_valid(composition_json)),
  initialized_from_campaign TEXT NOT NULL,
  fictional_time TEXT NOT NULL
);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  parent_checkpoint_id TEXT REFERENCES checkpoints(id),
  created_at TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  composition_json TEXT NOT NULL CHECK (json_valid(composition_json)),
  initialized_from_campaign TEXT NOT NULL,
  fictional_time TEXT NOT NULL
);

CREATE TABLE save_slots (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (world_id, name)
);

CREATE TABLE entities (
  row_id INTEGER PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  checkpoint_id TEXT REFERENCES checkpoints(id),
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  data_json TEXT NOT NULL CHECK (json_valid(data_json)),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE TABLE facts (
  row_id INTEGER PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  checkpoint_id TEXT REFERENCES checkpoints(id),
  fact_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  visibility TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE TABLE events (
  row_id INTEGER PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  checkpoint_id TEXT REFERENCES checkpoints(id),
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  visibility TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE TABLE beliefs (
  row_id INTEGER PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  checkpoint_id TEXT REFERENCES checkpoints(id),
  belief_id TEXT NOT NULL,
  holder_kind TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  truth_status TEXT NOT NULL,
  confidence REAL NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE TABLE documents (
  row_id INTEGER PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  checkpoint_id TEXT REFERENCES checkpoints(id),
  document_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  visibility TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE TABLE document_sections (
  row_id INTEGER PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  checkpoint_id TEXT REFERENCES checkpoints(id),
  document_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE UNIQUE INDEX entities_current_unique ON entities(world_id, entity_id) WHERE checkpoint_id IS NULL;
CREATE UNIQUE INDEX entities_checkpoint_unique ON entities(checkpoint_id, entity_id) WHERE checkpoint_id IS NOT NULL;
CREATE UNIQUE INDEX facts_current_unique ON facts(world_id, fact_id) WHERE checkpoint_id IS NULL;
CREATE UNIQUE INDEX facts_checkpoint_unique ON facts(checkpoint_id, fact_id) WHERE checkpoint_id IS NOT NULL;
CREATE UNIQUE INDEX events_current_unique ON events(world_id, event_id) WHERE checkpoint_id IS NULL;
CREATE UNIQUE INDEX events_checkpoint_unique ON events(checkpoint_id, event_id) WHERE checkpoint_id IS NOT NULL;
CREATE UNIQUE INDEX beliefs_current_unique ON beliefs(world_id, belief_id) WHERE checkpoint_id IS NULL;
CREATE UNIQUE INDEX beliefs_checkpoint_unique ON beliefs(checkpoint_id, belief_id) WHERE checkpoint_id IS NOT NULL;
CREATE UNIQUE INDEX documents_current_unique ON documents(world_id, document_id) WHERE checkpoint_id IS NULL;
CREATE UNIQUE INDEX documents_checkpoint_unique ON documents(checkpoint_id, document_id) WHERE checkpoint_id IS NOT NULL;
CREATE UNIQUE INDEX sections_current_unique ON document_sections(world_id, document_id, section_id) WHERE checkpoint_id IS NULL;
CREATE UNIQUE INDEX sections_checkpoint_unique ON document_sections(checkpoint_id, document_id, section_id) WHERE checkpoint_id IS NOT NULL;

-- The official plugin does not expose a connection-bound transaction callback.
-- One insert into this private command inbox is therefore the atomic write unit;
-- this trigger expands it into the relational model inside the same statement.
CREATE TABLE persistence_commands (
  row_id INTEGER PRIMARY KEY,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);

CREATE TRIGGER validate_persistence_command
BEFORE INSERT ON persistence_commands
BEGIN
  SELECT RAISE(ABORT, 'unknown persistence operation')
    WHERE json_extract(NEW.payload_json, '$.operation') NOT IN
      ('create-world', 'commit-world', 'save-checkpoint');
  SELECT RAISE(ABORT, 'world revision conflict')
    WHERE json_extract(NEW.payload_json, '$.operation') = 'commit-world'
      AND NOT EXISTS (
        SELECT 1 FROM worlds
        WHERE id = json_extract(NEW.payload_json, '$.worldId')
          AND revision = json_extract(NEW.payload_json, '$.expectedRevision')
      );
  SELECT RAISE(ABORT, 'world composition conflict')
    WHERE json_extract(NEW.payload_json, '$.operation') = 'create-world'
      AND json(json_extract(NEW.payload_json, '$.metadata.game'))
        <> json(json_extract(NEW.payload_json, '$.state.game'));
  SELECT RAISE(ABORT, 'world composition conflict')
    WHERE json_extract(NEW.payload_json, '$.operation') = 'commit-world'
      AND NOT EXISTS (
        SELECT 1 FROM worlds
        WHERE id = json_extract(NEW.payload_json, '$.worldId')
          AND composition_json = json(json_extract(NEW.payload_json, '$.state.game'))
      );
  SELECT RAISE(ABORT, 'checkpoint revision conflict')
    WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
      AND NOT EXISTS (
        SELECT 1 FROM worlds
        WHERE id = json_extract(NEW.payload_json, '$.checkpoint.worldId')
          AND revision = json_extract(NEW.payload_json, '$.checkpoint.revision')
          AND composition_json = json(json_extract(NEW.payload_json, '$.checkpoint.game'))
      );
  SELECT RAISE(ABORT, 'checkpoint composition conflict')
    WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
      AND json(json_extract(NEW.payload_json, '$.checkpoint.game'))
        <> json(json_extract(NEW.payload_json, '$.state.game'));
  SELECT RAISE(ABORT, 'save slot identity conflict')
    WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
      AND EXISTS (
        SELECT 1 FROM save_slots
        WHERE (id = json_extract(NEW.payload_json, '$.slot.id')
          AND (world_id <> json_extract(NEW.payload_json, '$.checkpoint.worldId')
            OR name <> json_extract(NEW.payload_json, '$.slot.name')))
          OR (world_id = json_extract(NEW.payload_json, '$.checkpoint.worldId')
            AND name = json_extract(NEW.payload_json, '$.slot.name')
            AND id <> json_extract(NEW.payload_json, '$.slot.id'))
      );
END;

CREATE TRIGGER apply_persistence_command
AFTER INSERT ON persistence_commands
BEGIN
  INSERT INTO worlds (
    id, name, created_at, updated_at, revision, composition_json,
    initialized_from_campaign, fictional_time
  )
  SELECT
    json_extract(NEW.payload_json, '$.metadata.id'),
    json_extract(NEW.payload_json, '$.metadata.name'),
    json_extract(NEW.payload_json, '$.metadata.createdAt'),
    json_extract(NEW.payload_json, '$.metadata.updatedAt'),
    0,
    json(json_extract(NEW.payload_json, '$.state.game')),
    json_extract(NEW.payload_json, '$.state.initializedFromCampaign'),
    json_extract(NEW.payload_json, '$.state.fictionalTime')
  WHERE json_extract(NEW.payload_json, '$.operation') = 'create-world';

  UPDATE worlds SET
    updated_at = json_extract(NEW.payload_json, '$.updatedAt'),
    revision = revision + 1,
    composition_json = json(json_extract(NEW.payload_json, '$.state.game')),
    initialized_from_campaign = json_extract(NEW.payload_json, '$.state.initializedFromCampaign'),
    fictional_time = json_extract(NEW.payload_json, '$.state.fictionalTime')
  WHERE json_extract(NEW.payload_json, '$.operation') = 'commit-world'
    AND id = json_extract(NEW.payload_json, '$.worldId');

  INSERT INTO checkpoints (
    id, world_id, parent_checkpoint_id, created_at, revision,
    composition_json, initialized_from_campaign, fictional_time
  )
  SELECT
    json_extract(NEW.payload_json, '$.checkpoint.id'),
    json_extract(NEW.payload_json, '$.checkpoint.worldId'),
    json_extract(NEW.payload_json, '$.checkpoint.parentCheckpointId'),
    json_extract(NEW.payload_json, '$.checkpoint.createdAt'),
    json_extract(NEW.payload_json, '$.checkpoint.revision'),
    json(json_extract(NEW.payload_json, '$.state.game')),
    json_extract(NEW.payload_json, '$.state.initializedFromCampaign'),
    json_extract(NEW.payload_json, '$.state.fictionalTime')
  WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint';

  DELETE FROM entities WHERE checkpoint_id IS NULL AND world_id = json_extract(NEW.payload_json, '$.worldId')
    AND json_extract(NEW.payload_json, '$.operation') = 'commit-world';
  DELETE FROM facts WHERE checkpoint_id IS NULL AND world_id = json_extract(NEW.payload_json, '$.worldId')
    AND json_extract(NEW.payload_json, '$.operation') = 'commit-world';
  DELETE FROM events WHERE checkpoint_id IS NULL AND world_id = json_extract(NEW.payload_json, '$.worldId')
    AND json_extract(NEW.payload_json, '$.operation') = 'commit-world';
  DELETE FROM beliefs WHERE checkpoint_id IS NULL AND world_id = json_extract(NEW.payload_json, '$.worldId')
    AND json_extract(NEW.payload_json, '$.operation') = 'commit-world';
  DELETE FROM document_sections WHERE checkpoint_id IS NULL AND world_id = json_extract(NEW.payload_json, '$.worldId')
    AND json_extract(NEW.payload_json, '$.operation') = 'commit-world';
  DELETE FROM documents WHERE checkpoint_id IS NULL AND world_id = json_extract(NEW.payload_json, '$.worldId')
    AND json_extract(NEW.payload_json, '$.operation') = 'commit-world';

  INSERT INTO entities (world_id, checkpoint_id, entity_id, kind, name, summary, data_json, payload_json)
  SELECT scope.world_id, scope.checkpoint_id, json_extract(item.value, '$.id'),
    json_extract(item.value, '$.kind'), json_extract(item.value, '$.name'),
    json_extract(item.value, '$.summary'), json(json_extract(item.value, '$.data')), json(item.value)
  FROM json_each(json_extract(NEW.payload_json, '$.state.entities')) AS item
  JOIN (
    SELECT COALESCE(json_extract(NEW.payload_json, '$.worldId'), json_extract(NEW.payload_json, '$.metadata.id')) AS world_id, NULL AS checkpoint_id
      WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world')
    UNION ALL
    SELECT json_extract(NEW.payload_json, '$.checkpoint.worldId'), json_extract(NEW.payload_json, '$.checkpoint.id')
      WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  ) AS scope;

  INSERT INTO facts (world_id, checkpoint_id, fact_id, subject_id, predicate, visibility, value_json, tags_json, payload_json)
  SELECT scope.world_id, scope.checkpoint_id, json_extract(item.value, '$.id'),
    json_extract(item.value, '$.subjectId'), json_extract(item.value, '$.predicate'),
    json_extract(item.value, '$.visibility'), json_quote(json_extract(item.value, '$.value')),
    json(json_extract(item.value, '$.tags')), json(item.value)
  FROM json_each(json_extract(NEW.payload_json, '$.state.facts')) AS item
  JOIN (
    SELECT COALESCE(json_extract(NEW.payload_json, '$.worldId'), json_extract(NEW.payload_json, '$.metadata.id')) AS world_id, NULL AS checkpoint_id
      WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world')
    UNION ALL SELECT json_extract(NEW.payload_json, '$.checkpoint.worldId'), json_extract(NEW.payload_json, '$.checkpoint.id')
      WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  ) AS scope;

  INSERT INTO events (world_id, checkpoint_id, event_id, kind, occurred_at, visibility, details_json, payload_json)
  SELECT scope.world_id, scope.checkpoint_id, json_extract(item.value, '$.id'),
    json_extract(item.value, '$.kind'), json_extract(item.value, '$.occurredAt'),
    json_extract(item.value, '$.visibility'), json(json_extract(item.value, '$.details')), json(item.value)
  FROM json_each(json_extract(NEW.payload_json, '$.state.events')) AS item
  JOIN (
    SELECT COALESCE(json_extract(NEW.payload_json, '$.worldId'), json_extract(NEW.payload_json, '$.metadata.id')) AS world_id, NULL AS checkpoint_id
      WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world')
    UNION ALL SELECT json_extract(NEW.payload_json, '$.checkpoint.worldId'), json_extract(NEW.payload_json, '$.checkpoint.id')
      WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  ) AS scope;

  INSERT INTO beliefs (world_id, checkpoint_id, belief_id, holder_kind, holder_id, subject_id, truth_status, confidence, payload_json)
  SELECT scope.world_id, scope.checkpoint_id, json_extract(item.value, '$.id'),
    json_extract(item.value, '$.holder.kind'), json_extract(item.value, '$.holder.id'),
    json_extract(item.value, '$.subjectId'), json_extract(item.value, '$.truthStatus'),
    json_extract(item.value, '$.confidence'), json(item.value)
  FROM json_each(json_extract(NEW.payload_json, '$.state.beliefs')) AS item
  JOIN (
    SELECT COALESCE(json_extract(NEW.payload_json, '$.worldId'), json_extract(NEW.payload_json, '$.metadata.id')) AS world_id, NULL AS checkpoint_id
      WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world')
    UNION ALL SELECT json_extract(NEW.payload_json, '$.checkpoint.worldId'), json_extract(NEW.payload_json, '$.checkpoint.id')
      WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  ) AS scope;

  INSERT INTO documents (world_id, checkpoint_id, document_id, kind, title, visibility, metadata_json, payload_json)
  SELECT scope.world_id, scope.checkpoint_id, json_extract(item.value, '$.id'),
    json_extract(item.value, '$.metadata.kind'), json_extract(item.value, '$.metadata.title'),
    json_extract(item.value, '$.metadata.visibility'), json(json_extract(item.value, '$.metadata')),
    json_set(json_remove(json(item.value), '$.sections'), '$.sections', json('[]'))
  FROM json_each(json_extract(NEW.payload_json, '$.state.documents')) AS item
  JOIN (
    SELECT COALESCE(json_extract(NEW.payload_json, '$.worldId'), json_extract(NEW.payload_json, '$.metadata.id')) AS world_id, NULL AS checkpoint_id
      WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world')
    UNION ALL SELECT json_extract(NEW.payload_json, '$.checkpoint.worldId'), json_extract(NEW.payload_json, '$.checkpoint.id')
      WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  ) AS scope;

  INSERT INTO document_sections (world_id, checkpoint_id, document_id, section_id, position, payload_json)
  SELECT scope.world_id, scope.checkpoint_id, json_extract(document.value, '$.id'),
    json_extract(section.value, '$.id'), CAST(section.key AS INTEGER), json(section.value)
  FROM json_each(json_extract(NEW.payload_json, '$.state.documents')) AS document
  JOIN json_each(json_extract(document.value, '$.sections')) AS section
  JOIN (
    SELECT COALESCE(json_extract(NEW.payload_json, '$.worldId'), json_extract(NEW.payload_json, '$.metadata.id')) AS world_id, NULL AS checkpoint_id
      WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world')
    UNION ALL SELECT json_extract(NEW.payload_json, '$.checkpoint.worldId'), json_extract(NEW.payload_json, '$.checkpoint.id')
      WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  ) AS scope;

  INSERT INTO save_slots (id, world_id, name, checkpoint_id, created_at, updated_at)
  SELECT json_extract(NEW.payload_json, '$.slot.id'),
    json_extract(NEW.payload_json, '$.checkpoint.worldId'),
    json_extract(NEW.payload_json, '$.slot.name'),
    json_extract(NEW.payload_json, '$.checkpoint.id'),
    json_extract(NEW.payload_json, '$.slot.createdAt'),
    json_extract(NEW.payload_json, '$.slot.updatedAt')
  WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  ON CONFLICT(id) DO UPDATE SET
    checkpoint_id = excluded.checkpoint_id,
    updated_at = excluded.updated_at;

  DELETE FROM persistence_commands WHERE row_id = NEW.row_id;
END;

CREATE TRIGGER checkpoints_immutable_update BEFORE UPDATE ON checkpoints
BEGIN SELECT RAISE(ABORT, 'checkpoints are immutable'); END;
CREATE TRIGGER checkpoints_immutable_delete BEFORE DELETE ON checkpoints
BEGIN SELECT RAISE(ABORT, 'checkpoints are immutable'); END;
CREATE TRIGGER entities_checkpoint_immutable_update BEFORE UPDATE ON entities WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
CREATE TRIGGER entities_checkpoint_immutable_delete BEFORE DELETE ON entities WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
CREATE TRIGGER facts_checkpoint_immutable_update BEFORE UPDATE ON facts WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
CREATE TRIGGER facts_checkpoint_immutable_delete BEFORE DELETE ON facts WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
CREATE TRIGGER events_checkpoint_immutable_update BEFORE UPDATE ON events WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
CREATE TRIGGER events_checkpoint_immutable_delete BEFORE DELETE ON events WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
CREATE TRIGGER beliefs_checkpoint_immutable_update BEFORE UPDATE ON beliefs WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
CREATE TRIGGER beliefs_checkpoint_immutable_delete BEFORE DELETE ON beliefs WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
CREATE TRIGGER documents_checkpoint_immutable_update BEFORE UPDATE ON documents WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
CREATE TRIGGER documents_checkpoint_immutable_delete BEFORE DELETE ON documents WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
CREATE TRIGGER sections_checkpoint_immutable_update BEFORE UPDATE ON document_sections WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
CREATE TRIGGER sections_checkpoint_immutable_delete BEFORE DELETE ON document_sections WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
