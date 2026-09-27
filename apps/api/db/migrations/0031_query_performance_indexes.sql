-- Migration: 0031_query_performance_indexes.sql
-- Description: Composite performance indexes for high-frequency queries in multi-tenant SaaS:
--              lease resident occupancy counting, cross-property invoice queries, and active vehicle tracking.

CREATE INDEX IF NOT EXISTS lease_residents_occupancy_lookup_idx
  ON lease_residents (organization_id, lease_id, joined_on, left_on);

CREATE INDEX IF NOT EXISTS renter_invoices_org_status_idx
  ON renter_invoices (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS lease_vehicles_org_active_idx
  ON lease_vehicles (organization_id, is_active, registered_at);

CREATE INDEX IF NOT EXISTS meters_org_active_idx
  ON meters (organization_id, is_active, room_id);
