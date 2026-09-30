BEGIN;

CREATE TABLE renter_invoice_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL,
  reminder_tier text NOT NULL
    CHECK (reminder_tier IN ('UPCOMING', 'DUE_TODAY', 'OVERDUE_STAGE_1', 'OVERDUE_STAGE_2', 'OVERDUE_STAGE_3', 'MANUAL')),
  recipient_phone text NOT NULL,
  recipient_name text,
  remaining_vnd bigint NOT NULL CHECK (remaining_vnd >= 0),
  due_date date NOT NULL,
  channel text NOT NULL DEFAULT 'ZALO',
  notification_job_id uuid REFERENCES notification_jobs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'SKIPPED')),
  message_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES renter_invoices (organization_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX renter_invoice_reminders_tier_per_day_uidx
  ON renter_invoice_reminders (organization_id, invoice_id, reminder_tier, (created_at::date));

CREATE INDEX renter_invoice_reminders_invoice_idx
  ON renter_invoice_reminders (organization_id, invoice_id, created_at DESC);

CREATE INDEX renter_invoice_reminders_org_created_idx
  ON renter_invoice_reminders (organization_id, created_at DESC);

COMMIT;
