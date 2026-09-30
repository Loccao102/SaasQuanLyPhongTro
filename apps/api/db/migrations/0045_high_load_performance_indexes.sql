BEGIN;

-- 1. Accelerates room-specific invoice history queries (Resident Portal, prior debt carry-forward, lease settlement)
CREATE INDEX IF NOT EXISTS renter_invoices_room_history_idx
  ON renter_invoices (organization_id, room_id, status, period_end DESC);

-- 2. Accelerates billing cycle invoice listing, sorting, and Excel export
CREATE INDEX IF NOT EXISTS renter_invoices_cycle_room_code_idx
  ON renter_invoices (organization_id, billing_cycle_id, room_code_snapshot, id);

-- 3. High-efficiency partial index for unpaid/partially paid collection queries and reminder campaigns
CREATE INDEX IF NOT EXISTS renter_invoices_unpaid_cycle_idx
  ON renter_invoices (organization_id, billing_cycle_id)
  WHERE status = 'ISSUED' AND remaining_vnd > 0;

-- 4. Accelerates invoice lines breakdown by service type (electricity, water, rent)
CREATE INDEX IF NOT EXISTS renter_invoice_lines_org_type_idx
  ON renter_invoice_lines (organization_id, line_type, invoice_id);

-- 5. Accelerates room equipment inventory lookups
CREATE INDEX IF NOT EXISTS room_equipment_org_room_name_idx
  ON room_equipment (organization_id, room_id, name);

-- 6. Accelerates audit events lookup by resource
CREATE INDEX IF NOT EXISTS audit_events_org_resource_idx
  ON audit_events (organization_id, resource_id, created_at DESC);

COMMIT;
