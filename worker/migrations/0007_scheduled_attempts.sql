-- 0007: retries for delayed sends (cron no longer drops a job on the first error)
ALTER TABLE scheduled_sends ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
