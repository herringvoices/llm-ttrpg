DROP TRIGGER validate_persistence_command;
DROP TRIGGER apply_persistence_command;
DROP TRIGGER events_checkpoint_immutable_update;
DROP TRIGGER events_checkpoint_immutable_delete;
DROP INDEX events_current_unique;
DROP INDEX events_checkpoint_unique;

ALTER TABLE events RENAME TO legacy_events;
ALTER TABLE worlds ADD COLUMN event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (event_sequence >= 0);
ALTER TABLE checkpoints ADD COLUMN event_sequence INTEGER NOT NULL DEFAULT 0 CHECK (event_sequence >= 0);

CREATE TABLE events (
  row_id INTEGER PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  checkpoint_id TEXT REFERENCES checkpoints(id),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  source_component_json TEXT NOT NULL CHECK (json_valid(source_component_json)),
  occurred_at TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  related_entity_ids_json TEXT NOT NULL CHECK (json_valid(related_entity_ids_json)),
  scope_ids_json TEXT NOT NULL CHECK (json_valid(scope_ids_json)),
  caused_by_event_ids_json TEXT NOT NULL CHECK (json_valid(caused_by_event_ids_json)),
  origin_kind TEXT,
  origin_id TEXT,
  access TEXT NOT NULL CHECK (access IN ('public', 'gm-only')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  canonical_json TEXT NOT NULL CHECK (json_valid(canonical_json))
);

WITH ranked AS (
  SELECT legacy_events.*,
    ROW_NUMBER() OVER (
      PARTITION BY world_id, checkpoint_id
      ORDER BY occurred_at, event_id
    ) AS event_sequence
  FROM legacy_events
)
INSERT INTO events (
  world_id, checkpoint_id, event_id, event_type, schema_version,
  source_component_json, occurred_at, sequence,
  related_entity_ids_json, scope_ids_json, caused_by_event_ids_json,
  origin_kind, origin_id, access, payload_json, canonical_json
)
SELECT ranked.world_id, ranked.checkpoint_id, ranked.event_id,
  ranked.kind, 1,
  json(json_extract(worlds.composition_json, '$.ruleset')),
  ranked.occurred_at, ranked.event_sequence,
  json(COALESCE(json_extract(ranked.payload_json, '$.participantIds'), '[]')),
  json('[]'), json('[]'), NULL, NULL,
  CASE ranked.visibility WHEN 'public' THEN 'public' ELSE 'gm-only' END,
  json(COALESCE(json_extract(ranked.payload_json, '$.details'), '{}')),
  json_object(
    'id', ranked.event_id,
    'type', ranked.kind,
    'schemaVersion', 1,
    'sourceComponent', json(json_extract(worlds.composition_json, '$.ruleset')),
    'occurredAt', ranked.occurred_at,
    'sequence', ranked.event_sequence,
    'relatedEntityIds', json(COALESCE(json_extract(ranked.payload_json, '$.participantIds'), '[]')),
    'scopeIds', json('[]'),
    'causedByEventIds', json('[]'),
    'summary', json_extract(ranked.payload_json, '$.summary'),
    'payload', json(COALESCE(json_extract(ranked.payload_json, '$.details'), '{}')),
    'access', CASE ranked.visibility WHEN 'public' THEN 'public' ELSE 'gm-only' END
  )
FROM ranked JOIN worlds ON worlds.id = ranked.world_id;

UPDATE worlds SET event_sequence = COALESCE((
  SELECT MAX(sequence) FROM events
  WHERE events.world_id = worlds.id AND events.checkpoint_id IS NULL
), 0);
UPDATE checkpoints SET event_sequence = COALESCE((
  SELECT MAX(sequence) FROM events
  WHERE events.checkpoint_id = checkpoints.id
), 0);

DROP TABLE legacy_events;

CREATE UNIQUE INDEX events_current_id_unique ON events(world_id, event_id) WHERE checkpoint_id IS NULL;
CREATE UNIQUE INDEX events_current_sequence_unique ON events(world_id, sequence) WHERE checkpoint_id IS NULL;
CREATE UNIQUE INDEX events_checkpoint_id_unique ON events(checkpoint_id, event_id) WHERE checkpoint_id IS NOT NULL;
CREATE UNIQUE INDEX events_checkpoint_sequence_unique ON events(checkpoint_id, sequence) WHERE checkpoint_id IS NOT NULL;
CREATE INDEX events_current_time_index ON events(world_id, occurred_at, sequence) WHERE checkpoint_id IS NULL;
CREATE INDEX events_current_type_index ON events(world_id, event_type, occurred_at, sequence) WHERE checkpoint_id IS NULL;

CREATE TABLE scheduled_triggers (
  row_id INTEGER PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  checkpoint_id TEXT REFERENCES checkpoints(id),
  trigger_id TEXT NOT NULL,
  due_at TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);
CREATE UNIQUE INDEX scheduled_current_unique ON scheduled_triggers(world_id, trigger_id) WHERE checkpoint_id IS NULL;
CREATE UNIQUE INDEX scheduled_checkpoint_unique ON scheduled_triggers(checkpoint_id, trigger_id) WHERE checkpoint_id IS NOT NULL;

CREATE TABLE simulation_cursors (
  row_id INTEGER PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  checkpoint_id TEXT REFERENCES checkpoints(id),
  scope_id TEXT NOT NULL,
  last_simulated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);
CREATE UNIQUE INDEX cursors_current_unique ON simulation_cursors(world_id, scope_id) WHERE checkpoint_id IS NULL;
CREATE UNIQUE INDEX cursors_checkpoint_unique ON simulation_cursors(checkpoint_id, scope_id) WHERE checkpoint_id IS NOT NULL;

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
  SELECT RAISE(ABORT, 'fictional time cannot move backward')
    WHERE json_extract(NEW.payload_json, '$.operation') = 'commit-world'
      AND EXISTS (
        SELECT 1 FROM worlds
        WHERE id = json_extract(NEW.payload_json, '$.worldId')
          AND fictional_time > json_extract(NEW.payload_json, '$.state.fictionalTime')
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

  SELECT RAISE(ABORT, 'event sequence conflict')
    WHERE json_extract(NEW.payload_json, '$.operation') = 'create-world'
      AND json_array_length(json_extract(NEW.payload_json, '$.initialEvents'))
        <> COALESCE(json_extract(NEW.payload_json, '$.initialEvents[#-1].sequence'), 0);
  SELECT RAISE(ABORT, 'event sequence conflict')
    WHERE json_extract(NEW.payload_json, '$.operation') = 'commit-world'
      AND NOT EXISTS (
        SELECT 1 FROM worlds
        WHERE id = json_extract(NEW.payload_json, '$.worldId')
          AND json_extract(NEW.payload_json, '$.eventSequence') =
            event_sequence + json_array_length(json_extract(NEW.payload_json, '$.events'))
      );
  SELECT RAISE(ABORT, 'event sequence conflict')
    WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world')
      AND EXISTS (
        SELECT 1 FROM json_each(
          CASE json_extract(NEW.payload_json, '$.operation')
            WHEN 'create-world' THEN json_extract(NEW.payload_json, '$.initialEvents')
            ELSE json_extract(NEW.payload_json, '$.events')
          END
        ) AS event
        WHERE json_extract(event.value, '$.sequence') < 1
          OR json_extract(event.value, '$.occurredAt') > json_extract(NEW.payload_json, '$.state.fictionalTime')
      );
  SELECT RAISE(ABORT, 'event sequence conflict')
    WHERE json_extract(NEW.payload_json, '$.operation') = 'create-world'
      AND EXISTS (
        SELECT 1 FROM json_each(json_extract(NEW.payload_json, '$.initialEvents')) event
        WHERE json_extract(event.value, '$.sequence') <> CAST(event.key AS INTEGER) + 1
      );
  SELECT RAISE(ABORT, 'event sequence conflict')
    WHERE json_extract(NEW.payload_json, '$.operation') = 'commit-world'
      AND EXISTS (
        SELECT 1 FROM json_each(json_extract(NEW.payload_json, '$.events')) event
        JOIN worlds ON worlds.id = json_extract(NEW.payload_json, '$.worldId')
        WHERE json_extract(event.value, '$.sequence') <>
          worlds.event_sequence + CAST(event.key AS INTEGER) + 1
      );
  SELECT RAISE(ABORT, 'event occurrence time cannot move backward')
    WHERE json_extract(NEW.payload_json, '$.operation') = 'create-world'
      AND EXISTS (
        SELECT 1 FROM json_each(json_extract(NEW.payload_json, '$.initialEvents')) event
        WHERE CAST(event.key AS INTEGER) > 0
          AND json_extract(event.value, '$.occurredAt') < json_extract(
            NEW.payload_json,
            '$.initialEvents[' || (CAST(event.key AS INTEGER) - 1) || '].occurredAt'
          )
      );
  SELECT RAISE(ABORT, 'event occurrence time cannot move backward')
    WHERE json_extract(NEW.payload_json, '$.operation') = 'commit-world'
      AND EXISTS (
        SELECT 1 FROM json_each(json_extract(NEW.payload_json, '$.events')) event
        WHERE json_extract(event.value, '$.occurredAt') < COALESCE(
          CASE WHEN CAST(event.key AS INTEGER) = 0 THEN (
            SELECT MAX(occurred_at) FROM events
            WHERE world_id = json_extract(NEW.payload_json, '$.worldId')
              AND checkpoint_id IS NULL
          ) ELSE json_extract(
            NEW.payload_json,
            '$.events[' || (CAST(event.key AS INTEGER) - 1) || '].occurredAt'
          ) END,
          json_extract(event.value, '$.occurredAt')
        )
      );
  SELECT RAISE(ABORT, 'event cause must reference prior history')
    WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world')
      AND EXISTS (
        SELECT 1
        FROM json_each(
          CASE json_extract(NEW.payload_json, '$.operation')
            WHEN 'create-world' THEN json_extract(NEW.payload_json, '$.initialEvents')
            ELSE json_extract(NEW.payload_json, '$.events')
          END
        ) event
        JOIN json_each(json_extract(event.value, '$.causedByEventIds')) cause
        WHERE NOT EXISTS (
          SELECT 1 FROM events existing
          WHERE json_extract(NEW.payload_json, '$.operation') = 'commit-world'
            AND existing.world_id = json_extract(NEW.payload_json, '$.worldId')
            AND existing.checkpoint_id IS NULL
            AND existing.event_id = cause.value
            AND existing.sequence < json_extract(event.value, '$.sequence')
        )
        AND NOT EXISTS (
          SELECT 1 FROM json_each(
            CASE json_extract(NEW.payload_json, '$.operation')
              WHEN 'create-world' THEN json_extract(NEW.payload_json, '$.initialEvents')
              ELSE json_extract(NEW.payload_json, '$.events')
            END
          ) prior
          WHERE json_extract(prior.value, '$.id') = cause.value
            AND json_extract(prior.value, '$.sequence') < json_extract(event.value, '$.sequence')
        )
      );

  SELECT RAISE(ABORT, 'simulation cursor cannot exceed world time')
    WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world', 'save-checkpoint')
      AND EXISTS (
        SELECT 1 FROM json_each(json_extract(NEW.payload_json, '$.state.simulationCursors')) AS cursor
        WHERE json_extract(cursor.value, '$.lastSimulatedAt') > json_extract(NEW.payload_json, '$.state.fictionalTime')
      );

  SELECT RAISE(ABORT, 'checkpoint revision conflict')
    WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
      AND NOT EXISTS (
        SELECT 1 FROM worlds
        WHERE id = json_extract(NEW.payload_json, '$.checkpoint.worldId')
          AND revision = json_extract(NEW.payload_json, '$.checkpoint.revision')
          AND event_sequence = json_extract(NEW.payload_json, '$.checkpoint.eventSequence')
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
    id, name, created_at, updated_at, revision, event_sequence,
    composition_json, initialized_from_campaign, fictional_time
  )
  SELECT json_extract(NEW.payload_json, '$.metadata.id'),
    json_extract(NEW.payload_json, '$.metadata.name'),
    json_extract(NEW.payload_json, '$.metadata.createdAt'),
    json_extract(NEW.payload_json, '$.metadata.updatedAt'), 0,
    json_array_length(json_extract(NEW.payload_json, '$.initialEvents')),
    json(json_extract(NEW.payload_json, '$.state.game')),
    json_extract(NEW.payload_json, '$.state.initializedFromCampaign'),
    json_extract(NEW.payload_json, '$.state.fictionalTime')
  WHERE json_extract(NEW.payload_json, '$.operation') = 'create-world';

  UPDATE worlds SET
    updated_at = json_extract(NEW.payload_json, '$.updatedAt'),
    revision = revision + 1,
    event_sequence = json_extract(NEW.payload_json, '$.eventSequence'),
    composition_json = json(json_extract(NEW.payload_json, '$.state.game')),
    initialized_from_campaign = json_extract(NEW.payload_json, '$.state.initializedFromCampaign'),
    fictional_time = json_extract(NEW.payload_json, '$.state.fictionalTime')
  WHERE json_extract(NEW.payload_json, '$.operation') = 'commit-world'
    AND id = json_extract(NEW.payload_json, '$.worldId');

  INSERT INTO checkpoints (
    id, world_id, parent_checkpoint_id, created_at, revision, event_sequence,
    composition_json, initialized_from_campaign, fictional_time
  )
  SELECT json_extract(NEW.payload_json, '$.checkpoint.id'),
    json_extract(NEW.payload_json, '$.checkpoint.worldId'),
    json_extract(NEW.payload_json, '$.checkpoint.parentCheckpointId'),
    json_extract(NEW.payload_json, '$.checkpoint.createdAt'),
    json_extract(NEW.payload_json, '$.checkpoint.revision'),
    json_extract(NEW.payload_json, '$.checkpoint.eventSequence'),
    json(json_extract(NEW.payload_json, '$.state.game')),
    json_extract(NEW.payload_json, '$.state.initializedFromCampaign'),
    json_extract(NEW.payload_json, '$.state.fictionalTime')
  WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint';

  DELETE FROM entities WHERE checkpoint_id IS NULL AND world_id = json_extract(NEW.payload_json, '$.worldId')
    AND json_extract(NEW.payload_json, '$.operation') = 'commit-world';
  DELETE FROM facts WHERE checkpoint_id IS NULL AND world_id = json_extract(NEW.payload_json, '$.worldId')
    AND json_extract(NEW.payload_json, '$.operation') = 'commit-world';
  DELETE FROM beliefs WHERE checkpoint_id IS NULL AND world_id = json_extract(NEW.payload_json, '$.worldId')
    AND json_extract(NEW.payload_json, '$.operation') = 'commit-world';
  DELETE FROM document_sections WHERE checkpoint_id IS NULL AND world_id = json_extract(NEW.payload_json, '$.worldId')
    AND json_extract(NEW.payload_json, '$.operation') = 'commit-world';
  DELETE FROM documents WHERE checkpoint_id IS NULL AND world_id = json_extract(NEW.payload_json, '$.worldId')
    AND json_extract(NEW.payload_json, '$.operation') = 'commit-world';
  DELETE FROM scheduled_triggers WHERE checkpoint_id IS NULL AND world_id = json_extract(NEW.payload_json, '$.worldId')
    AND json_extract(NEW.payload_json, '$.operation') = 'commit-world';
  DELETE FROM simulation_cursors WHERE checkpoint_id IS NULL AND world_id = json_extract(NEW.payload_json, '$.worldId')
    AND json_extract(NEW.payload_json, '$.operation') = 'commit-world';

  INSERT INTO events (
    world_id, checkpoint_id, event_id, event_type, schema_version,
    source_component_json, occurred_at, sequence,
    related_entity_ids_json, scope_ids_json, caused_by_event_ids_json,
    origin_kind, origin_id, access, payload_json, canonical_json
  )
  SELECT
    COALESCE(json_extract(NEW.payload_json, '$.worldId'), json_extract(NEW.payload_json, '$.metadata.id')),
    NULL, json_extract(event.value, '$.id'), json_extract(event.value, '$.type'),
    json_extract(event.value, '$.schemaVersion'),
    json(json_extract(event.value, '$.sourceComponent')),
    json_extract(event.value, '$.occurredAt'), json_extract(event.value, '$.sequence'),
    json(json_extract(event.value, '$.relatedEntityIds')),
    json(json_extract(event.value, '$.scopeIds')),
    json(json_extract(event.value, '$.causedByEventIds')),
    json_extract(event.value, '$.origin.kind'), json_extract(event.value, '$.origin.id'),
    json_extract(event.value, '$.access'), json_quote(json_extract(event.value, '$.payload')),
    json(event.value)
  FROM json_each(
    CASE json_extract(NEW.payload_json, '$.operation')
      WHEN 'create-world' THEN json_extract(NEW.payload_json, '$.initialEvents')
      WHEN 'commit-world' THEN json_extract(NEW.payload_json, '$.events')
      ELSE json('[]')
    END
  ) AS event;

  INSERT INTO events (
    world_id, checkpoint_id, event_id, event_type, schema_version,
    source_component_json, occurred_at, sequence,
    related_entity_ids_json, scope_ids_json, caused_by_event_ids_json,
    origin_kind, origin_id, access, payload_json, canonical_json
  )
  SELECT events.world_id, json_extract(NEW.payload_json, '$.checkpoint.id'),
    event_id, event_type, schema_version, source_component_json, occurred_at,
    sequence, related_entity_ids_json, scope_ids_json, caused_by_event_ids_json,
    origin_kind, origin_id, access, payload_json, canonical_json
  FROM events
  WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
    AND checkpoint_id IS NULL
    AND world_id = json_extract(NEW.payload_json, '$.checkpoint.worldId')
    AND sequence <= json_extract(NEW.payload_json, '$.checkpoint.eventSequence');

  INSERT INTO entities (world_id, checkpoint_id, entity_id, kind, name, summary, data_json, payload_json)
  SELECT scope.world_id, scope.checkpoint_id, json_extract(item.value, '$.id'),
    json_extract(item.value, '$.kind'), json_extract(item.value, '$.name'),
    json_extract(item.value, '$.summary'), json(json_extract(item.value, '$.data')), json(item.value)
  FROM json_each(json_extract(NEW.payload_json, '$.state.entities')) AS item
  JOIN (
    SELECT COALESCE(json_extract(NEW.payload_json, '$.worldId'), json_extract(NEW.payload_json, '$.metadata.id')) world_id, NULL checkpoint_id
      WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world')
    UNION ALL SELECT json_extract(NEW.payload_json, '$.checkpoint.worldId'), json_extract(NEW.payload_json, '$.checkpoint.id')
      WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  ) scope;

  INSERT INTO facts (world_id, checkpoint_id, fact_id, subject_id, predicate, visibility, value_json, tags_json, payload_json)
  SELECT scope.world_id, scope.checkpoint_id, json_extract(item.value, '$.id'),
    json_extract(item.value, '$.subjectId'), json_extract(item.value, '$.predicate'),
    json_extract(item.value, '$.visibility'), json_quote(json_extract(item.value, '$.value')),
    json(json_extract(item.value, '$.tags')), json(item.value)
  FROM json_each(json_extract(NEW.payload_json, '$.state.facts')) item
  JOIN (
    SELECT COALESCE(json_extract(NEW.payload_json, '$.worldId'), json_extract(NEW.payload_json, '$.metadata.id')) world_id, NULL checkpoint_id
      WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world')
    UNION ALL SELECT json_extract(NEW.payload_json, '$.checkpoint.worldId'), json_extract(NEW.payload_json, '$.checkpoint.id')
      WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  ) scope;

  INSERT INTO beliefs (world_id, checkpoint_id, belief_id, holder_kind, holder_id, subject_id, truth_status, confidence, payload_json)
  SELECT scope.world_id, scope.checkpoint_id, json_extract(item.value, '$.id'),
    json_extract(item.value, '$.holder.kind'), json_extract(item.value, '$.holder.id'),
    json_extract(item.value, '$.subjectId'), json_extract(item.value, '$.truthStatus'),
    json_extract(item.value, '$.confidence'), json(item.value)
  FROM json_each(json_extract(NEW.payload_json, '$.state.beliefs')) item
  JOIN (
    SELECT COALESCE(json_extract(NEW.payload_json, '$.worldId'), json_extract(NEW.payload_json, '$.metadata.id')) world_id, NULL checkpoint_id
      WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world')
    UNION ALL SELECT json_extract(NEW.payload_json, '$.checkpoint.worldId'), json_extract(NEW.payload_json, '$.checkpoint.id')
      WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  ) scope;

  INSERT INTO documents (world_id, checkpoint_id, document_id, kind, title, visibility, metadata_json, payload_json)
  SELECT scope.world_id, scope.checkpoint_id, json_extract(item.value, '$.id'),
    json_extract(item.value, '$.metadata.kind'), json_extract(item.value, '$.metadata.title'),
    json_extract(item.value, '$.metadata.visibility'), json(json_extract(item.value, '$.metadata')),
    json_set(json_remove(json(item.value), '$.sections'), '$.sections', json('[]'))
  FROM json_each(json_extract(NEW.payload_json, '$.state.documents')) item
  JOIN (
    SELECT COALESCE(json_extract(NEW.payload_json, '$.worldId'), json_extract(NEW.payload_json, '$.metadata.id')) world_id, NULL checkpoint_id
      WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world')
    UNION ALL SELECT json_extract(NEW.payload_json, '$.checkpoint.worldId'), json_extract(NEW.payload_json, '$.checkpoint.id')
      WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  ) scope;

  INSERT INTO document_sections (world_id, checkpoint_id, document_id, section_id, position, payload_json)
  SELECT scope.world_id, scope.checkpoint_id, json_extract(document.value, '$.id'),
    json_extract(section.value, '$.id'), CAST(section.key AS INTEGER), json(section.value)
  FROM json_each(json_extract(NEW.payload_json, '$.state.documents')) document
  JOIN json_each(json_extract(document.value, '$.sections')) section
  JOIN (
    SELECT COALESCE(json_extract(NEW.payload_json, '$.worldId'), json_extract(NEW.payload_json, '$.metadata.id')) world_id, NULL checkpoint_id
      WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world')
    UNION ALL SELECT json_extract(NEW.payload_json, '$.checkpoint.worldId'), json_extract(NEW.payload_json, '$.checkpoint.id')
      WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  ) scope;

  INSERT INTO scheduled_triggers (world_id, checkpoint_id, trigger_id, due_at, trigger_type, payload_json)
  SELECT scope.world_id, scope.checkpoint_id, json_extract(item.value, '$.id'),
    json_extract(item.value, '$.dueAt'), json_extract(item.value, '$.type'), json(item.value)
  FROM json_each(json_extract(NEW.payload_json, '$.state.scheduledTriggers')) item
  JOIN (
    SELECT COALESCE(json_extract(NEW.payload_json, '$.worldId'), json_extract(NEW.payload_json, '$.metadata.id')) world_id, NULL checkpoint_id
      WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world')
    UNION ALL SELECT json_extract(NEW.payload_json, '$.checkpoint.worldId'), json_extract(NEW.payload_json, '$.checkpoint.id')
      WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  ) scope;

  INSERT INTO simulation_cursors (world_id, checkpoint_id, scope_id, last_simulated_at, payload_json)
  SELECT scope.world_id, scope.checkpoint_id, json_extract(item.value, '$.scopeId'),
    json_extract(item.value, '$.lastSimulatedAt'), json(item.value)
  FROM json_each(json_extract(NEW.payload_json, '$.state.simulationCursors')) item
  JOIN (
    SELECT COALESCE(json_extract(NEW.payload_json, '$.worldId'), json_extract(NEW.payload_json, '$.metadata.id')) world_id, NULL checkpoint_id
      WHERE json_extract(NEW.payload_json, '$.operation') IN ('create-world', 'commit-world')
    UNION ALL SELECT json_extract(NEW.payload_json, '$.checkpoint.worldId'), json_extract(NEW.payload_json, '$.checkpoint.id')
      WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  ) scope;

  INSERT INTO save_slots (id, world_id, name, checkpoint_id, created_at, updated_at)
  SELECT json_extract(NEW.payload_json, '$.slot.id'),
    json_extract(NEW.payload_json, '$.checkpoint.worldId'),
    json_extract(NEW.payload_json, '$.slot.name'),
    json_extract(NEW.payload_json, '$.checkpoint.id'),
    json_extract(NEW.payload_json, '$.slot.createdAt'),
    json_extract(NEW.payload_json, '$.slot.updatedAt')
  WHERE json_extract(NEW.payload_json, '$.operation') = 'save-checkpoint'
  ON CONFLICT(id) DO UPDATE SET checkpoint_id = excluded.checkpoint_id, updated_at = excluded.updated_at;

  DELETE FROM persistence_commands WHERE row_id = NEW.row_id;
END;

CREATE TRIGGER events_immutable_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'event history is immutable'); END;
CREATE TRIGGER events_immutable_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'event history is immutable'); END;
CREATE TRIGGER scheduled_checkpoint_immutable_update BEFORE UPDATE ON scheduled_triggers WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
CREATE TRIGGER scheduled_checkpoint_immutable_delete BEFORE DELETE ON scheduled_triggers WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
CREATE TRIGGER cursors_checkpoint_immutable_update BEFORE UPDATE ON simulation_cursors WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
CREATE TRIGGER cursors_checkpoint_immutable_delete BEFORE DELETE ON simulation_cursors WHEN OLD.checkpoint_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'checkpoint content is immutable'); END;
