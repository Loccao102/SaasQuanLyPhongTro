-- Support bounded per-organization sliding-window counts in the Zalo job claim.
CREATE INDEX IF NOT EXISTS notification_attempts_zalo_pace_idx
  ON notification_attempts (organization_id, started_at DESC)
  WHERE provider IN ('PLAYWRIGHT_ZALO', 'ZALO_PLAYWRIGHT');
