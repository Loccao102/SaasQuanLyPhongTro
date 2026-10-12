-- Reusable message drafts scoped to the current organization.
-- Saved drafts are never sent automatically. Campaigns snapshot rendered text.
CREATE TABLE IF NOT EXISTS notification_message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'GENERAL',
  body text NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT notification_template_name_length CHECK (char_length(btrim(name)) BETWEEN 2 AND 100),
  CONSTRAINT notification_template_body_length CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  CONSTRAINT notification_template_category CHECK (
    category IN ('RENT', 'PAYMENT', 'UTILITY', 'MAINTENANCE', 'GENERAL')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_message_templates_unique_name
  ON notification_message_templates (organization_id, lower(btrim(name)))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS notification_message_templates_active_idx
  ON notification_message_templates (organization_id, category, updated_at DESC)
  WHERE deleted_at IS NULL;
