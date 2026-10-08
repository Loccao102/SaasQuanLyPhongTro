import { Pool } from "pg";
import { hashPassword } from "../src/modules/identity/auth/password.js";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://propops:propops@localhost:5432/propops";

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

async function seed(): Promise<void> {
  const client = await pool.connect();
  console.log("[seed] Connected to database:", databaseUrl.replace(/:[^:@]+@/, ":***@"));

  try {
    await client.query("BEGIN");

    // 1. Organization
    console.log("[seed] 1. Creating demo organization...");
    const orgRes = await client.query<{ id: string }>(
      `INSERT INTO organizations (slug, name, organization_type)
       VALUES ('habi-living', 'Habi Demo Living', 'COMPANY')
       ON CONFLICT (slug) DO UPDATE
         SET name = EXCLUDED.name,
             updated_at = now()
       RETURNING id::text`
    );
    const orgId = orgRes.rows[0]!.id;

    // Active PRO plan subscription
    const planRes = await client.query<{ id: string; version_id: string }>(
      `SELECT p.id, v.id AS version_id
       FROM saas_plans p
       JOIN saas_plan_versions v ON p.id = v.plan_id
       WHERE p.code = 'PRO' AND p.status = 'ACTIVE'
       ORDER BY v.version DESC LIMIT 1`
    );
    if (planRes.rows[0]) {
      const now = new Date();
      const nextYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      await client.query(
        `INSERT INTO organization_subscriptions (
           organization_id, plan_id, plan_version_id, status,
           current_period_start, current_period_end
         )
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5)
         ON CONFLICT (organization_id) DO UPDATE
           SET status = 'ACTIVE',
               current_period_end = EXCLUDED.current_period_end,
               updated_at = now()`,
        [orgId, planRes.rows[0].id, planRes.rows[0].version_id, now, nextYear]
      );
    }

    const defaultPassword = "Habi12345678@";
    const credential = await hashPassword(defaultPassword);

    // 2. Admin / Owner Account
    console.log("[seed] 2. Creating Admin account (admin@habi.vn)...");
    const adminUserRes = await client.query<{ id: string }>(
      `INSERT INTO users (
         organization_id, account_type, email, display_name, status, email_verified_at
       )
       VALUES ($1, 'TENANT', 'admin@habi.vn', 'Admin Quản Lý', 'ACTIVE', now())
       ON CONFLICT (lower(email)) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             organization_id = EXCLUDED.organization_id,
             status = 'ACTIVE',
             email_verified_at = now(),
             updated_at = now()
       RETURNING id::text`,
      [orgId]
    );
    const adminUserId = adminUserRes.rows[0]!.id;

    const adminMemberRes = await client.query<{ id: string }>(
      `INSERT INTO organization_memberships (
         organization_id, user_id, role, status
       ) VALUES ($1, $2, 'ADMIN', 'ACTIVE')
       ON CONFLICT (organization_id, user_id) DO UPDATE
         SET role = 'ADMIN', status = 'ACTIVE', updated_at = now()
       RETURNING id::text`,
      [orgId, adminUserId]
    );
    await client.query(
      `INSERT INTO membership_scopes (organization_id, membership_id, scope_type)
       VALUES ($1, $2, 'ORGANIZATION')
       ON CONFLICT DO NOTHING`,
      [orgId, adminMemberRes.rows[0]!.id]
    );

    await client.query(
      `INSERT INTO user_password_credentials (
         user_id, password_hash, password_salt, scrypt_n, scrypt_r, scrypt_p
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             password_salt = EXCLUDED.password_salt,
             updated_at = now()`,
      [
        adminUserId,
        credential.hash,
        credential.salt,
        credential.n,
        credential.r,
        credential.p
      ]
    );

    // 2b. Owner Account (for testing MFA onboarding)
    console.log("[seed] 2b. Creating Owner account (owner@habi.vn)...");
    const ownerUserRes = await client.query<{ id: string }>(
      `INSERT INTO users (
         organization_id, account_type, email, display_name, status, email_verified_at
       )
       VALUES ($1, 'TENANT', 'owner@habi.vn', 'Chủ Chuỗi Nhà Trọ', 'ACTIVE', now())
       ON CONFLICT (lower(email)) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             organization_id = EXCLUDED.organization_id,
             status = 'ACTIVE',
             email_verified_at = now(),
             updated_at = now()
       RETURNING id::text`,
      [orgId]
    );
    const ownerUserId = ownerUserRes.rows[0]!.id;

    const ownerMemberRes = await client.query<{ id: string }>(
      `INSERT INTO organization_memberships (
         organization_id, user_id, role, status
       ) VALUES ($1, $2, 'OWNER', 'ACTIVE')
       ON CONFLICT (organization_id, user_id) DO UPDATE
         SET role = 'OWNER', status = 'ACTIVE', updated_at = now()
       RETURNING id::text`,
      [orgId, ownerUserId]
    );
    await client.query(
      `INSERT INTO membership_scopes (organization_id, membership_id, scope_type)
       VALUES ($1, $2, 'ORGANIZATION')
       ON CONFLICT DO NOTHING`,
      [orgId, ownerMemberRes.rows[0]!.id]
    );

    await client.query(
      `INSERT INTO user_password_credentials (
         user_id, password_hash, password_salt, scrypt_n, scrypt_r, scrypt_p
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             password_salt = EXCLUDED.password_salt,
             updated_at = now()`,
      [
        ownerUserId,
        credential.hash,
        credential.salt,
        credential.n,
        credential.r,
        credential.p
      ]
    );

    // 3. Staff Account
    console.log("[seed] 3. Creating Staff account (staff@habi.vn)...");
    const staffUserRes = await client.query<{ id: string }>(
      `INSERT INTO users (
         organization_id, account_type, email, display_name, status, email_verified_at
       )
       VALUES ($1, 'TENANT', 'staff@habi.vn', 'Nguyễn Văn Vận Hành', 'ACTIVE', now())
       ON CONFLICT (lower(email)) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             organization_id = EXCLUDED.organization_id,
             status = 'ACTIVE',
             email_verified_at = now(),
             updated_at = now()
       RETURNING id::text`,
      [orgId]
    );
    const staffUserId = staffUserRes.rows[0]!.id;

    const staffMemberRes = await client.query<{ id: string }>(
      `INSERT INTO organization_memberships (
         organization_id, user_id, role, status
       ) VALUES ($1, $2, 'STAFF', 'ACTIVE')
       ON CONFLICT (organization_id, user_id) DO UPDATE
         SET role = 'STAFF', status = 'ACTIVE', updated_at = now()
       RETURNING id::text`,
      [orgId, staffUserId]
    );
    await client.query(
      `INSERT INTO membership_scopes (organization_id, membership_id, scope_type)
       VALUES ($1, $2, 'ORGANIZATION')
       ON CONFLICT DO NOTHING`,
      [orgId, staffMemberRes.rows[0]!.id]
    );

    await client.query(
      `INSERT INTO user_password_credentials (
         user_id, password_hash, password_salt, scrypt_n, scrypt_r, scrypt_p
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             password_salt = EXCLUDED.password_salt,
             updated_at = now()`,
      [
        staffUserId,
        credential.hash,
        credential.salt,
        credential.n,
        credential.r,
        credential.p
      ]
    );

    // 4. Platform Operator (CMS)
    console.log("[seed] 4. Ensuring Platform Operator (cms-dev@local.invalid)...");
    const cmsUserRes = await client.query<{ id: string }>(
      `INSERT INTO users (
         id, account_type, organization_id, email, display_name, status, email_verified_at
       )
       VALUES (
         '00000000-0000-0000-0000-000000000901',
         'PLATFORM',
         NULL,
         'cms-dev@local.invalid',
         'CMS Dev Operator',
         'ACTIVE',
         now()
       )
       ON CONFLICT (id) DO UPDATE
         SET account_type = 'PLATFORM',
             organization_id = NULL,
             status = 'ACTIVE',
             email_verified_at = now(),
             display_name = EXCLUDED.display_name
       RETURNING id::text`
    );
    const cmsUserId = cmsUserRes.rows[0]!.id;

    await client.query(
      `INSERT INTO platform_operators (user_id, role, status)
       VALUES ($1, 'PLATFORM_ADMIN', 'ACTIVE')
       ON CONFLICT (user_id) DO UPDATE
         SET role = 'PLATFORM_ADMIN', status = 'ACTIVE', updated_at = now()`,
      [cmsUserId]
    );

    await client.query(
      `INSERT INTO user_password_credentials (
         user_id, password_hash, password_salt, scrypt_n, scrypt_r, scrypt_p
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             password_salt = EXCLUDED.password_salt,
             updated_at = now()`,
      [
        cmsUserId,
        credential.hash,
        credential.salt,
        credential.n,
        credential.r,
        credential.p
      ]
    );

    // 5. Property
    console.log("[seed] 5. Creating demo property (HN-CG-01)...");
    const propertyRes = await client.query<{ id: string }>(
      `INSERT INTO properties (
         organization_id, code, name, property_type, address_text, is_active
       )
       VALUES ($1, 'HN-CG-01', 'Nhà trọ Habi Cầu Giấy', 'BOARDING_HOUSE', 'Số 12 Ngõ 68 Cầu Giấy, Hà Nội', true)
       ON CONFLICT (organization_id, code) DO UPDATE
         SET name = EXCLUDED.name,
             address_text = EXCLUDED.address_text,
             is_active = true,
             updated_at = now()
       RETURNING id::text`,
      [orgId]
    );
    const propertyId = propertyRes.rows[0]!.id;

    // 6. Pricing Policy (Per kWh electricity, Per m3 water)
    console.log("[seed] 6. Creating pricing policy...");
    const policyIdRes = await client.query<{ id: string }>(
      `SELECT id FROM pricing_policies
       WHERE organization_id = $1 AND property_id = $2
       LIMIT 1`,
      [orgId, propertyId]
    );
    let policyId = policyIdRes.rows[0]?.id;

    if (!policyId) {
      const newPolicy = await client.query<{ id: string }>(
        `INSERT INTO pricing_policies (
           id, organization_id, property_id, name, effective_from
         )
         VALUES (gen_random_uuid(), $1, $2, 'Biểu giá tiêu chuẩn 2026', '2026-01-01')
         RETURNING id::text`,
        [orgId, propertyId]
      );
      policyId = newPolicy.rows[0]!.id;

      await client.query(
        `INSERT INTO pricing_policy_items (
           id, organization_id, policy_id, item_type, description, unit_price_vnd, sort_order
         )
         VALUES
           (gen_random_uuid(), $1, $2, 'ELECTRICITY_PER_KWH', 'Tiền điện công tơ', 3500, 1),
           (gen_random_uuid(), $1, $2, 'WATER_PER_M3', 'Tiền nước sinh hoạt', 30000, 2)`,
        [orgId, policyId]
      );
    }

    // 7. Floors & Rooms
    console.log("[seed] 7. Creating floors and rooms...");
    const floor1Res = await client.query<{ id: string }>(
      `INSERT INTO floors (organization_id, property_id, code, name, sort_order, is_active)
       VALUES ($1, $2, 'T1', 'Tầng 1', 1, true)
       ON CONFLICT (organization_id, property_id, code) DO UPDATE
         SET name = EXCLUDED.name, is_active = true
       RETURNING id::text`,
      [orgId, propertyId]
    );
    const floor1Id = floor1Res.rows[0]!.id;

    const floor2Res = await client.query<{ id: string }>(
      `INSERT INTO floors (organization_id, property_id, code, name, sort_order, is_active)
       VALUES ($1, $2, 'T2', 'Tầng 2', 2, true)
       ON CONFLICT (organization_id, property_id, code) DO UPDATE
         SET name = EXCLUDED.name, is_active = true
       RETURNING id::text`,
      [orgId, propertyId]
    );
    const floor2Id = floor2Res.rows[0]!.id;

    const demoRooms = [
      { code: "101", name: "Phòng 101", floorId: floor1Id, sort: 101, elecBase: 1250, waterBase: 45 },
      { code: "102", name: "Phòng 102", floorId: floor1Id, sort: 102, elecBase: 980, waterBase: 32 },
      { code: "201", name: "Phòng 201", floorId: floor2Id, sort: 201, elecBase: 2100, waterBase: 78 },
      { code: "202", name: "Phòng 202", floorId: floor2Id, sort: 202, elecBase: 1540, waterBase: 50 },
    ];

    for (const r of demoRooms) {
      const roomRes = await client.query<{ id: string }>(
        `INSERT INTO rooms (organization_id, property_id, floor_id, code, name, sort_order, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, true)
         ON CONFLICT (organization_id, property_id, code) DO UPDATE
           SET name = EXCLUDED.name, floor_id = EXCLUDED.floor_id, is_active = true
         RETURNING id::text`,
        [orgId, propertyId, r.floorId, r.code, r.name, r.sort]
      );
      const roomId = roomRes.rows[0]!.id;

      // Electricity meter (query existing or insert)
      const existingElec = await client.query<{ id: string }>(
        `SELECT id FROM meters WHERE organization_id = $1 AND room_id = $2 AND meter_type = 'ELECTRICITY'`,
        [orgId, roomId]
      );
      let elecMeterId = existingElec.rows[0]?.id;
      if (!elecMeterId) {
        const elecMeterRes = await client.query<{ id: string }>(
          `INSERT INTO meters (id, organization_id, room_id, meter_type, unit, label, is_active)
           VALUES (gen_random_uuid(), $1, $2, 'ELECTRICITY', 'KWH', 'Công tơ điện ' || $3, true)
           RETURNING id::text`,
          [orgId, roomId, r.code]
        );
        elecMeterId = elecMeterRes.rows[0]!.id;
      }

      // Water meter (query existing or insert)
      const existingWater = await client.query<{ id: string }>(
        `SELECT id FROM meters WHERE organization_id = $1 AND room_id = $2 AND meter_type = 'WATER'`,
        [orgId, roomId]
      );
      let waterMeterId = existingWater.rows[0]?.id;
      if (!waterMeterId) {
        const waterMeterRes = await client.query<{ id: string }>(
          `INSERT INTO meters (id, organization_id, room_id, meter_type, unit, label, is_active)
           VALUES (gen_random_uuid(), $1, $2, 'WATER', 'M3', 'Đồng hồ nước ' || $3, true)
           RETURNING id::text`,
          [orgId, roomId, r.code]
        );
        waterMeterId = waterMeterRes.rows[0]!.id;
      }

      // Previous readings (baseline) on 2026-09-01
      await client.query(
        `INSERT INTO meter_readings (
           id, organization_id, meter_id, reading_date, reading_value, source
         )
         VALUES (gen_random_uuid(), $1, $2, '2026-09-01', $3, 'ADMIN')
         ON CONFLICT (organization_id, meter_id, reading_date) DO NOTHING`,
        [orgId, elecMeterId, r.elecBase]
      );

      await client.query(
        `INSERT INTO meter_readings (
           id, organization_id, meter_id, reading_date, reading_value, source
         )
         VALUES (gen_random_uuid(), $1, $2, '2026-09-01', $3, 'ADMIN')
         ON CONFLICT (organization_id, meter_id, reading_date) DO NOTHING`,
        [orgId, waterMeterId, r.waterBase]
      );
    }

    // 8. Active Billing Cycle (T10/2026)
    console.log("[seed] 8. Creating active billing cycle T10/2026...");
    await client.query(
      `INSERT INTO renter_billing_cycles (
         organization_id, property_id, cycle_code, period_start, period_end, due_date, status
       )
       VALUES ($1, $2, 'T10/2026', '2026-10-01', '2026-10-31', '2026-11-05', 'OPEN')
       ON CONFLICT (organization_id, cycle_code) DO UPDATE
         SET status = 'OPEN'`,
      [orgId, propertyId]
    );

    // 9. Sample Maintenance Tickets
    console.log("[seed] 9. Creating sample maintenance tickets...");
    const p101 = await client.query<{ id: string }>(
      "SELECT id FROM rooms WHERE organization_id = $1 AND property_id = $2 AND code = '101'",
      [orgId, propertyId]
    );
    const p202 = await client.query<{ id: string }>(
      "SELECT id FROM rooms WHERE organization_id = $1 AND property_id = $2 AND code = '202'",
      [orgId, propertyId]
    );

    if (p101.rows[0]) {
      await client.query(
        `INSERT INTO maintenance_tickets (
           organization_id, property_id, room_id, title, category, priority, status,
           description, resident_name, resident_phone
         )
         VALUES ($1, $2, $3, 'Bóng đèn nhà tắm bị cháy', 'ELECTRICITY', 'NORMAL', 'OPEN',
                 'Đèn trần nhà vệ sinh chớp nháy rồi tắt hẳn, cần thay bóng mới.',
                 'Nguyễn Văn An', '0912345678')
         ON CONFLICT DO NOTHING`,
        [orgId, propertyId, p101.rows[0].id]
      );
    }

    if (p202.rows[0]) {
      await client.query(
        `INSERT INTO maintenance_tickets (
           organization_id, property_id, room_id, title, category, priority, status,
           description, resident_name, resident_phone
         )
         VALUES ($1, $2, $3, 'Vòi sen tắm bị rỉ nước liên tục', 'PLUMBING', 'HIGH', 'IN_PROGRESS',
                 'Dây nối vòi sen bị nứt van ron cao su, nước nhỏ giọt cả ngày gây hao phí.',
                 'Trần Thị Mai', '0987654321')
         ON CONFLICT DO NOTHING`,
        [orgId, propertyId, p202.rows[0].id]
      );
    }

    await client.query("COMMIT");
    console.log("\n=======================================================");
    console.log("  DEMO DATA SEEDED SUCCESSFULLY!");
    console.log("=======================================================");
    console.log("Organization : Habi Demo Living (ID: " + orgId + ")");
    console.log("Property     : Nhà trọ Habi Cầu Giấy (HN-CG-01) - 4 phòng");
    console.log("Active Cycle : T10/2026 (01/10/2026 - 31/10/2026)");
    console.log("-------------------------------------------------------");
    console.log("TEST ACCOUNTS (Mật khẩu chung: Habi12345678@)");
    console.log("1. Admin / Owner  : admin@habi.vn");
    console.log("2. Staff          : staff@habi.vn");
    console.log("3. Platform CMS   : cms-dev@local.invalid");
    console.log("=======================================================\n");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[seed] Seed failed:", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
