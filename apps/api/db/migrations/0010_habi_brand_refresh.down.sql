BEGIN;

UPDATE system_settings
SET value = '"PropOps"'::jsonb
WHERE key = 'brand_product_name';

UPDATE system_settings
SET value = '"SaaS Quản lý Phòng Trọ"'::jsonb
WHERE key = 'brand_product_descriptor';

UPDATE system_settings
SET value = '"Vận hành hiệu quả · Kiến tạo giá trị bền vững"'::jsonb
WHERE key = 'brand_tagline';

UPDATE system_settings
SET value = '{"navy":"#0F2D4A","teal":"#14B8A6","amber":"#F59E0B","background":"#F8FAFC","surface":"#FFFFFF"}'::jsonb
WHERE key = 'brand_palette';

COMMIT;
