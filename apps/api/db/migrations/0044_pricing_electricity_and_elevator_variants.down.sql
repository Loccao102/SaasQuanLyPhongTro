-- Migration: 0044_pricing_electricity_and_elevator_variants.down.sql

ALTER TABLE pricing_policy_items
  DROP CONSTRAINT IF EXISTS pricing_policy_items_item_type_check;

ALTER TABLE pricing_policy_items
  ADD CONSTRAINT pricing_policy_items_item_type_check
  CHECK (item_type IN (
    'ELECTRICITY_PER_KWH',
    'WATER_PER_M3',
    'WATER_PER_PERSON',
    'WATER_PER_ROOM',
    'VEHICLE_PARKING',
    'SERVICE_PER_PERSON',
    'INTERNET',
    'PARKING',
    'TRASH',
    'CUSTOM'
  ));
