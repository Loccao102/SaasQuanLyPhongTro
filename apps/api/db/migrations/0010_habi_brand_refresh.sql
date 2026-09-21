BEGIN;

UPDATE system_settings
SET value = '"Habi"'::jsonb
WHERE key = 'brand_product_name';

UPDATE system_settings
SET value = '"SaaS vận hành nhà cho thuê"'::jsonb
WHERE key = 'brand_product_descriptor';

UPDATE system_settings
SET value = '"Nhà gọn. Việc trôi."'::jsonb
WHERE key = 'brand_tagline';

UPDATE system_settings
SET value = '{"navy":"#25355C","teal":"#35C6A8","amber":"#FFB36B","background":"#F7FAF9","surface":"#FFFFFF"}'::jsonb
WHERE key = 'brand_palette';

COMMIT;
