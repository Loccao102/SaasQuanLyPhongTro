-- Per-tenant Zalo sending hold: a platform restriction must never pause other tenants.
-- Created only when Zalo explicitly reports a sending restriction or when
-- an OWNER/ADMIN manually pauses sending. No automatic unpause on a timer.
CREATE TABLE IF NOT EXISTS zalo_personal_delivery_pauses (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  reason text NOT NULL,
  paused_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT zalo_delivery_pause_reason_len CHECK (char_length(reason) BETWEEN 1 AND 300)
);
