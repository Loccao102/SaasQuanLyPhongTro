-- Migration down: 0030_diversified_pricing_and_vehicles.down.sql
DROP TABLE IF EXISTS renter_invoice_adjustments CASCADE;
DROP TABLE IF EXISTS lease_vehicles CASCADE;
