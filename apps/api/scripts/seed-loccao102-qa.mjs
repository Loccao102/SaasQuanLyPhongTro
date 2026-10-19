/**
 * One-time, tenant-scoped Habi staging QA data for loccao102@gmail.com.
 *
 * Run inside the staging API container (inherits DATABASE_URL):
 *   node scripts/seed-loccao102-qa.mjs
 *
 * Strictly INSERT-only, idempotent for the designated demo property/code.
 * No notification, SMS, Zalo or invoice is issued by this script.
 */
import pg from "pg";

const { Client } = pg;
const EMAIL = "loccao102@gmail.com";
const PHONE = "0359224828";
const KEY = "LOC102-QA-202610";
const PROPERTY_CODE = "HABI-LOC102-QA-1026";
const PROPERTY_NAME = "[DEMO] Nhà trọ trải nghiệm Habi";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required; do not use a local fallback");
}
const db = new Client({ connectionString: process.env.DATABASE_URL });

async function rows(sql, params = []) {
  return (await db.query(sql, params)).rows;
}
async function one(sql, params = []) {
  return (await rows(sql, params))[0];
}

const demos = [
  {
    code: "D101", floor: "T1", name: "[Demo] Phòng D101",
    guest: "Nguyễn Minh An (Demo)", rent: 3200000, deposit: 3200000,
    electricity: 1230, water: 56, maintenance: "Đèn nhà tắm chập chờn [DEMO]",
    category: "ELECTRICITY", priority: "NORMAL", status: "OPEN",
    assets: [
      ["Điều hòa", "Daikin", "EXCELLENT", 7000000],
      ["Giường gỗ", "Nội thất Demo", "GOOD", 2000000],
      ["Bình nóng lạnh", "Ariston", "NEEDS_REPAIR", 2000000],
    ],
  },
  {
    code: "D102", floor: "T1", name: "[Demo] Phòng D102",
    guest: "Trần Ngọc Bình (Demo)", rent: 3600000, deposit: 3600000,
    electricity: 850, water: 32, maintenance: "Vòi sen rò rỉ [DEMO]",
    category: "PLUMBING", priority: "HIGH", status: "IN_PROGRESS",
    assets: [
      ["Máy giặt", "LG", "GOOD", 4500000],
      ["Tủ quần áo", "Nội thất Demo", "FAIR", 1800000],
      ["Tivi", "Samsung", "GOOD", 5500000],
    ],
  },
  {
    code: "D201", floor: "T2", name: "[Demo] Phòng D201",
    guest: "Lê Gia Chi (Demo)", rent: 4200000, deposit: 4200000,
    electricity: 1990, water: 78, maintenance: "Đã thay ổ khóa cửa [DEMO]",
    category: "OTHER", priority: "LOW", status: "RESOLVED",
    assets: [
      ["Điều hòa inverter", "Panasonic", "EXCELLENT", 8200000],
      ["Sofa", "Nội thất Demo", "GOOD", 3000000],
      ["Bếp điện", "Sunhouse", "FAIR", 1500000],
    ],
  },
];

async function seed() {
  await db.connect();
  try {
    await db.query("BEGIN");
    // Prevent two concurrent seed jobs from both inserting non-uniquely keyed rows.
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [KEY]);

    const users = await rows(
      `SELECT u.id, u.organization_id
         FROM public.users u JOIN public.organizations o ON o.id = u.organization_id
        WHERE lower(u.email) = lower($1)
          AND u.account_type = 'TENANT' AND u.status = 'ACTIVE'
          AND o.status = 'ACTIVE'
          AND EXISTS (
            SELECT 1 FROM public.organization_memberships m
             WHERE m.user_id = u.id AND m.organization_id = u.organization_id
               AND m.status = 'ACTIVE' AND m.role IN ('OWNER', 'ADMIN', 'MANAGER')
          )`,
      [EMAIL]
    );
    if (users.length !== 1) {
      throw new Error("Target tenant owner/admin account was not uniquely found: " + EMAIL);
    }
    const userId = users[0].id;
    const orgId = users[0].organization_id;

    await db.query(
      `INSERT INTO public.properties
          (organization_id, code, name, property_type, address_text, is_active)
        VALUES ($1, $2, $3, 'BOARDING_HOUSE',
          'Địa chỉ giả lập - Hà Nội (chỉ dùng thử nghiệm)', true)
        ON CONFLICT (organization_id, code) DO NOTHING`,
      [orgId, PROPERTY_CODE, PROPERTY_NAME]
    );
    const property = await one(
      "SELECT id, name FROM public.properties WHERE organization_id=$1 AND code=$2",
      [orgId, PROPERTY_CODE]
    );
    if (!property || property.name !== PROPERTY_NAME) {
      throw new Error("Demo property code collision; refused to touch existing property");
    }
    const propertyId = property.id;

    const floors = {};
    for (const [code, name, sort] of [["T1", "Tầng 1", 1], ["T2", "Tầng 2", 2]]) {
      await db.query(
        `INSERT INTO public.floors
          (organization_id, property_id, code, name, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (organization_id, property_id, code) DO NOTHING`,
        [orgId, propertyId, code, name, sort]
      );
      const floor = await one(
        "SELECT id FROM public.floors WHERE organization_id=$1 AND property_id=$2 AND code=$3",
        [orgId, propertyId, code]
      );
      floors[code] = floor.id;
    }

    const policy = await one(
      `SELECT id FROM public.pricing_policies
        WHERE organization_id=$1 AND property_id=$2 AND name=$3 LIMIT 1`,
      [orgId, propertyId, "[DEMO] Biểu giá phòng trọ"]
    );
    let policyId = policy?.id;
    if (!policyId) {
      const created = await one(
        `INSERT INTO public.pricing_policies
           (id, organization_id, property_id, name, effective_from)
         VALUES (gen_random_uuid(), $1, $2, '[DEMO] Biểu giá phòng trọ', '2026-10-01')
         RETURNING id`,
        [orgId, propertyId]
      );
      policyId = created.id;
    }
    for (const [type, label, price, sort] of [
      ["ELECTRICITY_PER_KWH", "Điện theo kWh", 3500, 1],
      ["WATER_PER_M3", "Nước theo m³", 30000, 2],
      ["INTERNET", "Internet hàng tháng", 120000, 3],
      ["TRASH", "Phí rác", 30000, 4],
    ]) {
      if (!(await one(
        "SELECT id FROM public.pricing_policy_items WHERE organization_id=$1 AND policy_id=$2 AND item_type=$3",
        [orgId, policyId, type]
      ))) {
        await db.query(
          `INSERT INTO public.pricing_policy_items
            (id, organization_id, policy_id, item_type, description, unit_price_vnd, sort_order)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
          [orgId, policyId, type, label, price, sort]
        );
      }
    }

    for (const demo of demos) {
      await db.query(
        `INSERT INTO public.rooms
          (organization_id, property_id, floor_id, code, name, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (organization_id, property_id, code) DO NOTHING`,
        [orgId, propertyId, floors[demo.floor], demo.code, demo.name, Number(demo.code.slice(1))]
      );
      const room = await one(
        "SELECT id, name FROM public.rooms WHERE organization_id=$1 AND property_id=$2 AND code=$3",
        [orgId, propertyId, demo.code]
      );
      if (!room || room.name !== demo.name) throw new Error("Room code collision: " + demo.code);

      const leaseCode = KEY + "-" + demo.code;
      const conflictingLease = await one(
        `SELECT lease_code FROM public.leases WHERE organization_id=$1 AND room_id=$2
             AND status IN ('ACTIVE','TERMINATION_SCHEDULED') AND lease_code <> $3 LIMIT 1`,
        [orgId, room.id, leaseCode]
      );
      if (conflictingLease) throw new Error("Room already has another active lease: " + demo.code);
      await db.query(
        `INSERT INTO public.leases
          (organization_id, room_id, lease_code, status, start_date, planned_end_date,
           signed_at, activated_at, base_rent_vnd, deposit_required_vnd, billing_day,
           created_by_user_id)
         VALUES ($1, $2, $3, 'ACTIVE', '2026-10-01', '2027-09-30',
           '2026-09-30 12:00:00+07', '2026-10-01 00:00:00+07', $4, $5, 5, $6)
         ON CONFLICT (organization_id, lease_code) DO NOTHING`,
        [orgId, room.id, leaseCode, demo.rent, demo.deposit, userId]
      );
      const lease = await one(
        "SELECT id, room_id FROM public.leases WHERE organization_id=$1 AND lease_code=$2",
        [orgId, leaseCode]
      );
      if (!lease || lease.room_id !== room.id) throw new Error("Lease code collision: " + leaseCode);

      const tag = KEY + ":" + demo.code;
      let resident = await one(
        "SELECT id FROM public.residents WHERE organization_id=$1 AND notes=$2",
        [orgId, tag]
      );
      if (!resident) {
        resident = await one(
          `INSERT INTO public.residents
            (organization_id, full_name, phone, notes)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [orgId, demo.guest, PHONE, tag]
        );
      }
      // Ensure a distinct named primary tenant per lease; all three phones are identical.
      await db.query(
        `INSERT INTO public.lease_residents
           (organization_id, lease_id, resident_id, party_role, joined_on)
         VALUES ($1, $2, $3, 'PRIMARY_TENANT', '2026-10-01')
         ON CONFLICT (organization_id, lease_id, resident_id) DO NOTHING`,
        [orgId, lease.id, resident.id]
      );

      if (!(await one(
        "SELECT id FROM public.lease_deposit_entries WHERE organization_id=$1 AND lease_id=$2 AND note=$3",
        [orgId, lease.id, tag + ":DEPOSIT"]
      ))) {
        await db.query(
          `INSERT INTO public.lease_deposit_entries
            (organization_id, lease_id, entry_type, amount_vnd, occurred_at, note, created_by_user_id)
           VALUES ($1, $2, 'COLLECTION', $3, '2026-09-30 12:00:00+07', $4, $5)`,
          [orgId, lease.id, demo.deposit, tag + ":DEPOSIT", userId]
        );
      }

      for (const [type, unit, baseValue] of [
        ["ELECTRICITY", "KWH", demo.electricity],
        ["WATER", "M3", demo.water],
      ]) {
        let meter = await one(
          "SELECT id FROM public.meters WHERE organization_id=$1 AND room_id=$2 AND meter_type=$3 LIMIT 1",
          [orgId, room.id, type]
        );
        if (!meter) {
          meter = await one(
            `INSERT INTO public.meters (id, organization_id, room_id, meter_type, unit, label)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING id`,
            [orgId, room.id, type, unit, "[DEMO] " + type + " " + demo.code]
          );
        }
        await db.query(
          `INSERT INTO public.meter_readings
            (id, organization_id, meter_id, reading_date, reading_value, source)
           VALUES (gen_random_uuid(), $1, $2, '2026-09-30', $3, 'ADMIN')
           ON CONFLICT (organization_id, meter_id, reading_date) DO NOTHING`,
          [orgId, meter.id, baseValue]
        );
      }

      for (const [assetName, brand, condition, value] of demo.assets) {
        const note = tag + ":ASSET:" + assetName;
        if (!(await one(
          "SELECT id FROM public.room_equipment WHERE organization_id=$1 AND room_id=$2 AND note=$3",
          [orgId, room.id, note]
        ))) {
          await db.query(
            `INSERT INTO public.room_equipment
              (organization_id, property_id, room_id, name, brand, quantity,
               condition_status, compensation_value_vnd, note, installed_at)
             VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, '2026-09-30')`,
            [orgId, propertyId, room.id, assetName, brand, condition, value, note]
          );
        }
      }

      const issueDescription = tag + ":MAINTENANCE - Dữ liệu giả lập để thử quy trình bảo trì.";
      if (!(await one(
        "SELECT id FROM public.maintenance_tickets WHERE organization_id=$1 AND room_id=$2 AND description=$3",
        [orgId, room.id, issueDescription]
      ))) {
        await db.query(
          `INSERT INTO public.maintenance_tickets
            (organization_id, property_id, room_id, lease_id, title, category,
             priority, status, description, resident_name, resident_phone,
             resolved_at, resolution_note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             CASE WHEN $8='RESOLVED' THEN '2026-10-15 10:00:00+07'::timestamptz ELSE NULL END,
             CASE WHEN $8='RESOLVED' THEN 'Đã xử lý (demo)' ELSE NULL END)`,
          [orgId, propertyId, room.id, lease.id, demo.maintenance, demo.category,
           demo.priority, demo.status, issueDescription, demo.guest, PHONE]
        );
      }
    }

    await db.query(
      `INSERT INTO public.renter_billing_cycles
        (organization_id, property_id, cycle_code, period_start, period_end, due_date, status)
       VALUES ($1, $2, $3, '2026-10-01', '2026-10-31', '2026-11-05', 'OPEN')
       ON CONFLICT (organization_id, cycle_code) DO NOTHING`,
      [orgId, propertyId, KEY + "-T10"]
    );
    const summary = await one(
      `SELECT
         (SELECT count(*)::int FROM public.rooms WHERE organization_id=$1 AND property_id=$2) AS rooms,
         (SELECT count(*)::int FROM public.leases l JOIN public.rooms r ON r.id=l.room_id
           WHERE l.organization_id=$1 AND r.property_id=$2 AND l.lease_code LIKE $3) AS leases,
         (SELECT count(*)::int FROM public.lease_residents lr JOIN public.leases l
           ON l.id=lr.lease_id AND l.organization_id=lr.organization_id
           JOIN public.residents res ON res.id=lr.resident_id AND res.organization_id=lr.organization_id
           WHERE lr.organization_id=$1 AND l.lease_code LIKE $3
             AND lr.party_role='PRIMARY_TENANT' AND res.phone=$4) AS guests_matching_phone,
         (SELECT count(*)::int FROM public.room_equipment WHERE organization_id=$1 AND property_id=$2) AS assets,
         (SELECT count(*)::int FROM public.meters m JOIN public.rooms r ON r.id=m.room_id
            WHERE m.organization_id=$1 AND r.property_id=$2) AS meters`,
      [orgId, propertyId, KEY + "-%", PHONE]
    );
    if (summary.rooms !== 3 || summary.leases !== 3 ||
        summary.guests_matching_phone !== 3 || summary.assets !== 9 || summary.meters !== 6) {
      throw new Error("QA fixture count mismatch: " + JSON.stringify(summary));
    }
    await db.query("COMMIT");
    console.log(JSON.stringify({
      result: "SEEDED_AND_VERIFIED", account: EMAIL, phone_for_all_guests: PHONE,
      property_code: PROPERTY_CODE, ...summary
    }));
  } catch (error) {
    try { await db.query("ROLLBACK"); } catch { /* connection might already be closed */ }
    throw error;
  } finally {
    await db.end();
  }
}
seed().catch((error) => {
  console.error("[habi demo seed] " + error.message);
  process.exitCode = 1;
});
