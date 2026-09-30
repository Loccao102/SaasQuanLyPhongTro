BEGIN;

DROP INDEX IF EXISTS renter_invoices_room_history_idx;
DROP INDEX IF EXISTS renter_invoices_cycle_room_code_idx;
DROP INDEX IF EXISTS renter_invoices_unpaid_cycle_idx;
DROP INDEX IF EXISTS renter_invoice_lines_org_type_idx;
DROP INDEX IF EXISTS room_equipment_org_room_name_idx;
DROP INDEX IF EXISTS audit_events_org_resource_idx;

COMMIT;
