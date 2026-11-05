-- 0011: separate live version pointer from the latest saved draft.
-- NULL keeps legacy bots compatible; successful publication fills this pointer.
ALTER TABLE bots ADD COLUMN published_version INTEGER;
