BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_ci_uidx ON users (lower(email));

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  organization_type text NOT NULL
    CHECK (organization_type IN ('INDIVIDUAL', 'HOUSEHOLD_BUSINESS', 'COMPANY')),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL
    CHECK (role IN ('OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'ACCOUNTANT', 'VIEWER')),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id),
  UNIQUE (organization_id, id)
);

CREATE INDEX organization_memberships_user_idx
  ON organization_memberships (user_id, status);

CREATE TABLE administrative_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES administrative_areas(id) ON DELETE RESTRICT,
  code text,
  name text NOT NULL,
  area_type text NOT NULL,
  level smallint NOT NULL CHECK (level >= 0),
  effective_from date,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX administrative_areas_type_code_uidx
  ON administrative_areas (area_type, code)
  WHERE code IS NOT NULL;

CREATE INDEX administrative_areas_parent_idx
  ON administrative_areas (parent_id, is_active);

CREATE TABLE operational_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);

CREATE TABLE properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  administrative_area_id uuid REFERENCES administrative_areas(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  property_type text NOT NULL DEFAULT 'BOARDING_HOUSE'
    CHECK (property_type IN ('BOARDING_HOUSE', 'MINI_APARTMENT', 'APARTMENT', 'OTHER')),
  address_text text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)
);

CREATE INDEX properties_area_idx
  ON properties (organization_id, administrative_area_id, is_active);

CREATE TABLE floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  property_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, property_id)
    REFERENCES properties (organization_id, id)
    ON DELETE CASCADE,
  UNIQUE (organization_id, property_id, code),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, property_id, id)
);

CREATE INDEX floors_property_order_idx
  ON floors (organization_id, property_id, sort_order, id);

CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  property_id uuid NOT NULL,
  floor_id uuid,
  code text NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, property_id)
    REFERENCES properties (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, property_id, floor_id)
    REFERENCES floors (organization_id, property_id, id)
    ON DELETE RESTRICT,
  UNIQUE (organization_id, property_id, code),
  UNIQUE (organization_id, id)
);

CREATE INDEX rooms_property_floor_order_idx
  ON rooms (organization_id, property_id, floor_id, sort_order, id);

CREATE TABLE property_operational_groups (
  organization_id uuid NOT NULL,
  property_id uuid NOT NULL,
  operational_group_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, property_id, operational_group_id),
  FOREIGN KEY (organization_id, property_id)
    REFERENCES properties (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, operational_group_id)
    REFERENCES operational_groups (organization_id, id)
    ON DELETE CASCADE
);

CREATE INDEX property_operational_groups_group_idx
  ON property_operational_groups (organization_id, operational_group_id, property_id);

CREATE TABLE membership_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  scope_type text NOT NULL
    CHECK (scope_type IN ('ORGANIZATION', 'OPERATIONAL_GROUP', 'PROPERTY')),
  operational_group_id uuid,
  property_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, membership_id)
    REFERENCES organization_memberships (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, operational_group_id)
    REFERENCES operational_groups (organization_id, id)
    ON DELETE CASCADE,
  FOREIGN KEY (organization_id, property_id)
    REFERENCES properties (organization_id, id)
    ON DELETE CASCADE,
  CHECK (
    (scope_type = 'ORGANIZATION' AND operational_group_id IS NULL AND property_id IS NULL)
    OR
    (scope_type = 'OPERATIONAL_GROUP' AND operational_group_id IS NOT NULL AND property_id IS NULL)
    OR
    (scope_type = 'PROPERTY' AND operational_group_id IS NULL AND property_id IS NOT NULL)
  ),
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX membership_scopes_identity_uidx
  ON membership_scopes (
    membership_id,
    scope_type,
    COALESCE(operational_group_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX membership_scopes_membership_idx
  ON membership_scopes (organization_id, membership_id, scope_type);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_org_time_idx
  ON audit_events (organization_id, occurred_at DESC, id);

CREATE INDEX audit_events_resource_idx
  ON audit_events (organization_id, resource_type, resource_id, occurred_at DESC);

COMMIT;
