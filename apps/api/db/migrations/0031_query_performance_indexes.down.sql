-- Migration down: 0031_query_performance_indexes.down.sql
DROP INDEX IF EXISTS meters_org_active_idx;
DROP INDEX IF EXISTS lease_vehicles_org_active_idx;
DROP INDEX IF EXISTS renter_invoices_org_status_idx;
DROP INDEX IF EXISTS lease_residents_occupancy_lookup_idx;
