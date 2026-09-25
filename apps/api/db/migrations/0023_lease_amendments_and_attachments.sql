BEGIN;

CREATE TABLE lease_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL,
  amendment_number text NOT NULL,
  amendment_type text NOT NULL CHECK (amendment_type IN ('RENT_ADJUSTMENT', 'TERM_EXTENSION', 'RESIDENT_CHANGE', 'TERMS_UPDATE', 'OTHER')),
  title text NOT NULL,
  effective_date date NOT NULL,
  description text,
  new_base_rent_vnd bigint CHECK (new_base_rent_vnd IS NULL OR new_base_rent_vnd >= 0),
  new_planned_end_date date,
  status text NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('DRAFT', 'APPLIED', 'CANCELLED')),
  applied_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, lease_id)
    REFERENCES leases (organization_id, id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, lease_id, amendment_number)
);

CREATE INDEX lease_amendments_lease_idx
  ON lease_amendments (organization_id, lease_id, effective_date DESC, id);

CREATE TABLE lease_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL,
  attachment_type text NOT NULL CHECK (attachment_type IN ('ID_CARD', 'SIGNED_CONTRACT', 'HANDOVER_MINUTES', 'ROOM_CONDITION', 'OTHER')),
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size_bytes bigint NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0),
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  description text,
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, lease_id)
    REFERENCES leases (organization_id, id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, id)
);

CREATE INDEX lease_attachments_lease_idx
  ON lease_attachments (organization_id, lease_id, created_at DESC, id);

COMMIT;
