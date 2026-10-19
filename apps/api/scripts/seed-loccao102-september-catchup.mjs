/**
 * September 2026 catch-up billing demo, strictly scoped to Habi staging.
 * Requires HABI_QA_SEPTEMBER_STAGING_ONLY=1, passed by the staging VM deploy.
 *
 * The three October demo leases START on October 1, so add separate
 * terminated September DEMO leases for the same demo residents / rooms.
 * September 30 readings ALREADY exist (seed-loccao102-qa.mjs); add August 31
 * baselines so September usage can be calculated. No invoice is generated,
 * finalized, sent, or paid here; the September cycle remains OPEN.
 *
 * All reading_date values represent simulated physical measurement dates.
 * The database's created_at audit time reflects when the QA fixtures were
 * actually inserted. This is NOT a license to bill October 19 usage as September.
 */
import pg from "pg";

const { Client } = pg;
const EMAIL = "loccao102@gmail.com";
const PROPERTY_CODE = "HABI-LOC102-QA-1026";
const OCT_KEY = "LOC102-QA-202610";
const SEP_KEY = "LOC102-QA-202609";
const CYCLE_CODE = SEP_KEY + "-T09";
const PHONE = "0359224828";
const ROOM_DATA = [
  { code: "D101", rent: 3200000, electricity: [1120, 1230], water: [51, 56] },
  { code: "D102", rent: 3600000, electricity: [765, 850], water: [28, 32] },
  { code: "D201", rent: 4200000, electricity: [1820, 1990], water: [71, 78] }
];

if (process.env.HABI_QA_SEPTEMBER_STAGING_ONLY !== "1") {
  throw new Error("Refusing to run outside an explicit Habi staging QA deployment");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const db = new Client({ connectionString: process.env.DATABASE_URL });
async function rows(sql, params=[]) { return (await db.query(sql,params)).rows; }
async function one(sql, params=[]) { return (await rows(sql,params))[0]; }

async function seed() {
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [SEP_KEY]);
    const users = await rows(
      `SELECT u.id, u.organization_id FROM public.users u
       JOIN public.organizations o ON o.id=u.organization_id
       WHERE lower(u.email)=lower($1) AND u.account_type='TENANT'
         AND u.status='ACTIVE' AND o.status='ACTIVE'
         AND EXISTS (SELECT 1 FROM public.organization_memberships m
           WHERE m.user_id=u.id AND m.organization_id=u.organization_id
             AND m.status='ACTIVE' AND m.role IN ('OWNER','ADMIN','MANAGER'))`,
      [EMAIL]
    );
    if (users.length!==1) throw new Error("Target staging account not found uniquely");
    const { id: userId, organization_id: orgId } = users[0];

    const property = await one(
      `SELECT id, name FROM public.properties
       WHERE organization_id=$1 AND code=$2`, [orgId, PROPERTY_CODE]
    );
    if (!property || property.name!=="[DEMO] Nhà trọ trải nghiệm Habi") {
      throw new Error("Existing October demo property missing/mismatched");
    }

    const policyName = "[DEMO] Biểu giá tháng 9 - chốt muộn";
    let policy = await one(
      `SELECT id, effective_from::text, effective_to::text
         FROM public.pricing_policies
        WHERE organization_id=$1 AND property_id=$2 AND name=$3`,
      [orgId,property.id,policyName]
    );
    if (!policy) {
      policy = await one(
        `INSERT INTO public.pricing_policies
           (id,organization_id,property_id,name,effective_from,effective_to,created_by_user_id)
         VALUES (gen_random_uuid(),$1,$2,$3,'2026-09-01','2026-09-30',$4)
         RETURNING id, effective_from::text, effective_to::text`,
        [orgId,property.id,policyName,userId]
      );
    }
    if (policy.effective_from!=="2026-09-01" || policy.effective_to!=="2026-09-30") {
      throw new Error("September demo pricing policy has unexpected effective dates");
    }
    for (const [type,label,price,sort] of [
      ["ELECTRICITY_PER_KWH","Điện theo kWh (Demo T9)",3500,1],
      ["WATER_PER_M3","Nước theo m³ (Demo T9)",30000,2],
      ["INTERNET","Internet hàng tháng (Demo T9)",120000,3],
      ["TRASH","Phí rác (Demo T9)",30000,4]
    ]) {
      const existing = await one(
        `SELECT unit_price_vnd::text FROM public.pricing_policy_items
         WHERE organization_id=$1 AND policy_id=$2 AND item_type=$3`,
        [orgId,policy.id,type]
      );
      if (existing && Number(existing.unit_price_vnd)!==price) {
        throw new Error("Existing September pricing item mismatch: "+type);
      }
      if (!existing) await db.query(
        `INSERT INTO public.pricing_policy_items
           (id,organization_id,policy_id,item_type,description,unit_price_vnd,sort_order)
         VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6)`,
        [orgId,policy.id,type,label,price,sort]
      );
    }

    for (const roomData of ROOM_DATA) {
      const room = await one(
        `SELECT id FROM public.rooms
          WHERE organization_id=$1 AND property_id=$2 AND code=$3`,
        [orgId,property.id,roomData.code]
      );
      if (!room) throw new Error("October demo room missing: "+roomData.code);

      const resident = await one(
        `SELECT id,phone FROM public.residents
         WHERE organization_id=$1 AND notes=$2`,
        [orgId,OCT_KEY+":"+roomData.code]
      );
      if (!resident || resident.phone!==PHONE) {
        throw new Error("October demo resident missing/mismatched: "+roomData.code);
      }
      const leaseCode = SEP_KEY+"-"+roomData.code;
      const conflicts = await rows(
        `SELECT lease_code FROM public.leases
         WHERE organization_id=$1 AND room_id=$2
           AND start_date <= '2026-09-30'
           AND COALESCE(termination_effective_date,planned_end_date,'infinity'::date)
               >= '2026-09-01'
           AND lease_code<>$3`,
        [orgId,room.id,leaseCode]
      );
      if (conflicts.length) throw new Error("Other September lease exists for "+roomData.code);
      await db.query(
        `INSERT INTO public.leases
          (organization_id,room_id,lease_code,status,start_date,planned_end_date,
           signed_at,activated_at,termination_effective_date,terminated_at,
           termination_reason,base_rent_vnd,deposit_required_vnd,billing_day,
           created_by_user_id)
         VALUES ($1,$2,$3,'TERMINATED','2026-09-01','2026-09-30',
                 '2026-08-31 12:00:00+07','2026-09-01 00:00:00+07',
                 '2026-09-30','2026-10-01 00:00:00+07',
                 '[DEMO] Kết thúc hợp đồng tháng 9', $4,0,5,$5)
         ON CONFLICT (organization_id,lease_code) DO NOTHING`,
        [orgId,room.id,leaseCode,roomData.rent,userId]
      );
      const lease=await one(
        `SELECT id,room_id,start_date::text,termination_effective_date::text,status,
                base_rent_vnd::text FROM public.leases
         WHERE organization_id=$1 AND lease_code=$2`,[orgId,leaseCode]
      );
      if (!lease || lease.room_id!==room.id || lease.start_date!=="2026-09-01" ||
          lease.termination_effective_date!=="2026-09-30" ||
          lease.status!=="TERMINATED" || Number(lease.base_rent_vnd)!==roomData.rent) {
        throw new Error("September lease mismatch for "+roomData.code);
      }
      await db.query(
        `INSERT INTO public.lease_residents
           (organization_id,lease_id,resident_id,party_role,joined_on)
         VALUES ($1,$2,$3,'PRIMARY_TENANT','2026-09-01')
         ON CONFLICT (organization_id,lease_id,resident_id) DO NOTHING`,
        [orgId,lease.id,resident.id]
      );

      for (const [type,values] of [
        ["ELECTRICITY",roomData.electricity],["WATER",roomData.water]
      ]) {
        const meter=await one(
          `SELECT id FROM public.meters
           WHERE organization_id=$1 AND room_id=$2 AND meter_type=$3 AND is_active=true`,
          [orgId,room.id,type]
        );
        if (!meter) throw new Error("October demo meter missing: "+roomData.code+" "+type);
        const ending=await one(
          `SELECT reading_value::text FROM public.meter_readings
           WHERE organization_id=$1 AND meter_id=$2 AND reading_date='2026-09-30'`,
          [orgId,meter.id]
        );
        if (!ending || Number(ending.reading_value)!==values[1]) {
          throw new Error("September 30 reading mismatch: "+roomData.code+" "+type);
        }
        await db.query(
          `INSERT INTO public.meter_readings
             (id,organization_id,meter_id,reading_date,reading_value,source,created_by_user_id)
           VALUES (gen_random_uuid(),$1,$2,'2026-08-31',$3,'ADMIN',$4)
           ON CONFLICT (organization_id,meter_id,reading_date) DO NOTHING`,
          [orgId,meter.id,values[0],userId]
        );
        const baseline=await one(
          `SELECT reading_value::text FROM public.meter_readings
           WHERE organization_id=$1 AND meter_id=$2 AND reading_date='2026-08-31'`,
          [orgId,meter.id]
        );
        if (!baseline || Number(baseline.reading_value)!==values[0]) {
          throw new Error("August 31 baseline mismatch: "+roomData.code+" "+type);
        }
      }
    }

    await db.query(
      `INSERT INTO public.renter_billing_cycles
        (organization_id,property_id,cycle_code,period_start,period_end,due_date,status,created_by_user_id)
       VALUES ($1,$2,$3,'2026-09-01','2026-09-30','2026-10-25','OPEN',$4)
       ON CONFLICT (organization_id,cycle_code) DO NOTHING`,
      [orgId,property.id,CYCLE_CODE,userId]
    );
    const cycle=await one(
      `SELECT id,status,property_id,period_start::text,period_end::text,
              due_date::text FROM public.renter_billing_cycles
       WHERE organization_id=$1 AND cycle_code=$2`,[orgId,CYCLE_CODE]
    );
    if (!cycle || cycle.property_id!==property.id ||
        cycle.period_start!=="2026-09-01" || cycle.period_end!=="2026-09-30") {
      throw new Error("September cycle mismatch");
    }
    const summary=await one(
      `SELECT
        (SELECT count(*)::int FROM public.leases WHERE organization_id=$1
          AND lease_code LIKE $2) AS september_leases,
        (SELECT count(*)::int FROM public.meter_readings mr
          JOIN public.meters m ON m.id=mr.meter_id AND m.organization_id=mr.organization_id
          JOIN public.rooms r ON r.id=m.room_id AND r.organization_id=m.organization_id
          WHERE mr.organization_id=$1 AND r.property_id=$3 AND mr.reading_date='2026-08-31')
          AS august_baselines,
        (SELECT count(*)::int FROM public.meter_readings mr
          JOIN public.meters m ON m.id=mr.meter_id AND m.organization_id=mr.organization_id
          JOIN public.rooms r ON r.id=m.room_id AND r.organization_id=m.organization_id
          WHERE mr.organization_id=$1 AND r.property_id=$3 AND mr.reading_date='2026-09-30')
          AS september_ending_readings`,
      [orgId,SEP_KEY+"-%",property.id]
    );
    if (summary.september_leases!==3 || summary.august_baselines!==6 ||
        summary.september_ending_readings!==6) throw new Error("QA fixture verification failed");
    await db.query("COMMIT");
    console.log(JSON.stringify({
      result:"SEPTEMBER_CATCHUP_READY",account:EMAIL,
      property_code:PROPERTY_CODE,cycle_code:CYCLE_CODE,cycle_status:cycle.status,
      period_start:cycle.period_start,period_end:cycle.period_end,
      due_date:cycle.due_date,...summary,
      note:"No invoice was issued. Calculate drafts then finalize manually in Admin."
    }));
  } catch(error) {
    try { await db.query("ROLLBACK"); } catch {}
    throw error;
  } finally { await db.end(); }
}
seed().catch(error=>{console.error("[habi September catch-up QA] "+error.message);process.exitCode=1;});
