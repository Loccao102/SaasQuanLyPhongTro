# Habi Brand System

## Product name

**Habi**

The name comes from **habitat** — a place where people live — but is intentionally short, friendly and product-like.

It is broad enough to grow beyond boarding houses into:

- rental homes;
- mini apartments;
- multi-property operations;
- property management workflows.

Vietnamese descriptor:

```text
SaaS vận hành nhà cho thuê
```

Primary tagline:

```text
Nhà gọn. Việc trôi.
```

The tagline should feel practical rather than corporate: the product reduces operational friction so landlords and staff can keep properties, contracts, billing and communication moving.

## Logo concept

The Habi mark is built from:

- two rounded property/room pillars;
- a connecting H-shaped bridge;
- a soft roof/arch;
- an apricot accent dot.

The mark should read as both **H** and **home/habitat** at small sizes.

Canonical assets:

```text
apps/cms/public/habi-mark.svg
apps/cms/public/habi-logo.svg
apps/cms/app/icon.svg
```

## Default palette

Canonical defaults are stored in PostgreSQL `system_settings`.

```text
Indigo     #25355C
Mint       #35C6A8
Apricot    #FFB36B
Background #F7FAF9
Surface    #FFFFFF
```

Meaning:

- Indigo — dependable operations without feeling like a bank;
- Mint — movement, clarity and modern software;
- Apricot — warmth, attention and human-scale rental operations.

The CMS maps `brand_palette` from PostgreSQL to CSS custom properties, so theme changes can be applied through configuration without rebuilding the frontend.

## Display defaults

PostgreSQL seeds reusable display-format settings:

```text
display_locale          vi-VN
display_timezone        Asia/Ho_Chi_Minh
display_currency_code   VND
display_date_format     dd/MM/yyyy
display_datetime_format dd/MM/yyyy HH:mm
display_format_presets  JSON
```

Dashboards, reports and future customer-facing surfaces should consume these settings instead of inventing separate formatting conventions.

## Surface naming

Use:

```text
Habi                product/platform
Habi Control Plane  internal platform operations
Habi Admin          landlord/operator application
Habi Staff          staff/PWA application
```

Do not expose the internal term “CMS” as the primary customer-facing product name.

## Tone

Habi should feel:

- operationally capable;
- friendly;
- compact;
- clear;
- modern;
- Vietnamese-first without looking provincial.

Avoid:

- overly corporate banking visual language;
- property-industry clichés such as generic skyscraper logos;
- luxury real-estate styling;
- playful visuals that reduce trust in billing/contract workflows.

## Dashboard rule

A dashboard value must be one of:

1. directly queried from source-of-truth tables;
2. deterministically derived from source-of-truth rows;
3. clearly marked unavailable when the relevant domain is not implemented.

Never insert demo values into production dashboards just to make the UI look populated.

Examples:

- occupancy is derived from active rooms and current leases;
- Habi subscription billing exposure comes from SaaS invoices/payments;
- rental revenue must not be shown until the renter-invoice/payment domain exists.
