ALTER TABLE travel_documents
  ADD COLUMN leg_id TEXT NOT NULL DEFAULT '';

ALTER TABLE travel_documents
  ADD COLUMN sha256 TEXT;

ALTER TABLE travel_documents
  ADD COLUMN label TEXT;

ALTER TABLE travel_documents
  ADD COLUMN offline_available INTEGER NOT NULL DEFAULT 0;

ALTER TABLE travel_documents
  ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';

CREATE UNIQUE INDEX IF NOT EXISTS travel_documents_import_identity_idx
  ON travel_documents(activity_id, leg_id, filename, sha256)
  WHERE sha256 IS NOT NULL;
