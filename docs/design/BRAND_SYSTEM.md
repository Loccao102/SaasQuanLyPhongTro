# PropOps Brand System

## Product name

**PropOps**

Meaning:

- **Prop** — Property;
- **Ops** — Operations.

The name is intentionally broader than “nhà trọ” so the product can expand from boarding-house management into mini apartments, rental properties and professional property operations without rebranding.

Vietnamese descriptor:

```text
SaaS Quản lý Phòng Trọ
```

Primary tagline:

```text
Vận hành hiệu quả · Kiến tạo giá trị bền vững
```

## Logo concept

The PropOps mark combines:

- a house/property outline;
- ascending operational/data bars;
- a forward/upward swoosh;
- an amber sun/accent.

The mark should communicate property operations, measurable performance and growth without looking like a banking or pure accounting product.

Canonical assets:

```text
apps/cms/public/propops-mark.svg
apps/cms/public/propops-logo.svg
apps/cms/app/icon.svg
```

## Default palette

The canonical defaults are stored in PostgreSQL `system_settings` by migration `0009_brand_dashboard_defaults.sql`.

```text
Navy       #0F2D4A
Teal       #14B8A6
Amber      #F59E0B
Background #F8FAFC
Surface    #FFFFFF
```

Meaning:

- Navy — trust, stability, operations;
- Teal — efficiency, growth, modern SaaS;
- Amber — warning/accent/human warmth.

The CMS reads `brand_palette` from the database and maps it to CSS custom properties, so changing the palette through configuration does not require a code change.

## Display defaults

PostgreSQL also seeds reusable display-format settings:

```text
display_locale          vi-VN
display_timezone        Asia/Ho_Chi_Minh
display_currency_code   VND
display_date_format     dd/MM/yyyy
display_datetime_format dd/MM/yyyy HH:mm
display_format_presets  JSON
```

Dashboard/business formatting should consume these settings rather than inventing a different currency/date convention in each frontend.

## Surface naming

Use:

```text
PropOps                product/platform
PropOps Control Plane  internal platform CMS
PropOps Admin          landlord/operator application (future apps/web)
PropOps Staff          staff/PWA surface (future)
```

Do not call the Control Plane simply “CMS” in customer-facing branding.

## Dashboard rule

A dashboard number must be one of:

1. directly queried from source-of-truth tables;
2. deterministically derived from source-of-truth rows;
3. clearly marked unavailable when the domain is not implemented.

Never insert demo values into a production dashboard to make the UI look populated.

For example:

- room occupancy can be derived from active rooms and current leases;
- SaaS billing exposure comes from subscription invoices/payments;
- rental revenue must **not** be shown until the renter-invoice/payment domain exists.
