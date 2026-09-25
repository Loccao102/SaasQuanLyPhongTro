import type { Pool, QueryResultRow } from "pg";

export const REQUIRED_SEPAY_PRODUCTION_MIGRATIONS = [
  "0011_system_worker_observability.sql",
  "0014_renter_payment_allocation.sql",
  "0015_renter_payment_provider_inbox.sql",
  "0016_public_invoice_vietqr.sql",
  "0019_renter_provider_transaction_identity.sql",
  "0020_renter_payment_reconciliation_cursor.sql"
] as const;

export const REQUIRED_SEPAY_PRODUCTION_TABLES = [
  "system_worker_heartbeats",
  "renter_invoices",
  "organization_payment_profiles",
  "renter_payment_webhook_events",
  "renter_provider_transaction_identities",
  "renter_payment_reconciliation_cursors"
] as const;

type RequiredTable = (typeof REQUIRED_SEPAY_PRODUCTION_TABLES)[number];

export type SePayPreflightStatus = "PASS" | "WARN" | "FAIL";

export type SePayPreflightCheck = {
  id: string;
  status: SePayPreflightStatus;
  message: string;
};

export type SePayPreflightDatabaseSnapshot = {
  schemaMigrationsTablePresent: boolean;
  appliedMigrations: string[];
  tables: Record<RequiredTable, boolean>;
  activePaymentProfiles: number;
  outstandingOrganizationsWithoutActivePaymentProfile: number;
  providerReviewRequired: number;
  invalidSignature24h: number;
  worker: {
    status: string;
    lastSeenAgeSeconds: number;
    staleAfterSeconds: number;
  } | null;
  reconciliation: {
    initialized: boolean;
    lastSuccessAgeSeconds: number;
  } | null;
};

export type SePayPreflightReport = {
  ready: boolean;
  checks: SePayPreflightCheck[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
};

type TablePresenceRow = QueryResultRow & {
  schema_migrations: boolean;
  system_worker_heartbeats: boolean;
  renter_invoices: boolean;
  organization_payment_profiles: boolean;
  renter_payment_webhook_events: boolean;
  renter_provider_transaction_identities: boolean;
  renter_payment_reconciliation_cursors: boolean;
};

function positiveInteger(raw: string | undefined, fallback: number): number | null {
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function add(
  checks: SePayPreflightCheck[],
  id: string,
  status: SePayPreflightStatus,
  message: string
): void {
  checks.push({ id, status, message });
}

function tableLabel(table: RequiredTable): string {
  return table.replace(/_/g, " ");
}

export function evaluateSePayProductionPreflight(
  env: NodeJS.ProcessEnv,
  database: SePayPreflightDatabaseSnapshot
): SePayPreflightReport {
  const checks: SePayPreflightCheck[] = [];

  const currentSecret = env.SEPAY_RENTER_WEBHOOK_SECRET?.trim() ?? "";
  const previousSecret =
    env.SEPAY_RENTER_WEBHOOK_SECRET_PREVIOUS?.trim() ?? "";

  if (currentSecret.length < 16) {
    add(
      checks,
      "webhook-current-secret",
      "FAIL",
      "Current SePay webhook HMAC secret is missing or too short."
    );
  } else {
    add(
      checks,
      "webhook-current-secret",
      "PASS",
      "Current SePay webhook HMAC secret is configured."
    );
  }

  if (!previousSecret) {
    add(
      checks,
      "webhook-previous-secret",
      "PASS",
      "No previous webhook secret overlap is active."
    );
  } else if (previousSecret.length < 16) {
    add(
      checks,
      "webhook-previous-secret",
      "FAIL",
      "Previous webhook secret is configured but too short."
    );
  } else if (previousSecret === currentSecret) {
    add(
      checks,
      "webhook-previous-secret",
      "FAIL",
      "Previous webhook secret must differ from the current secret."
    );
  } else {
    add(
      checks,
      "webhook-previous-secret",
      "WARN",
      "Webhook secret overlap is active; remove the previous secret after cutover."
    );
  }

  const rawReconciliationEnabled =
    env.SEPAY_RECONCILIATION_ENABLED?.trim().toLowerCase() ?? "";
  const reconciliationFlagValid =
    rawReconciliationEnabled === "" ||
    rawReconciliationEnabled === "true" ||
    rawReconciliationEnabled === "false";
  const reconciliationEnabled = rawReconciliationEnabled === "true";

  if (!reconciliationFlagValid) {
    add(
      checks,
      "reconciliation-enabled",
      "FAIL",
      "SEPAY_RECONCILIATION_ENABLED must be true or false."
    );
  } else if (reconciliationEnabled) {
    add(
      checks,
      "reconciliation-enabled",
      "PASS",
      "Periodic SePay reconciliation is enabled."
    );
  } else {
    add(
      checks,
      "reconciliation-enabled",
      "WARN",
      "Periodic SePay reconciliation is disabled; missed webhook recovery will not run automatically."
    );
  }

  const reconciliationIntervalMs = positiveInteger(
    env.SEPAY_RECONCILIATION_INTERVAL_MS,
    900000
  );

  if (reconciliationEnabled) {
    const apiToken = env.SEPAY_API_TOKEN?.trim() ?? "";
    if (apiToken.length < 16) {
      add(
        checks,
        "reconciliation-api-token",
        "FAIL",
        "SePay API bearer token is missing or too short."
      );
    } else {
      add(
        checks,
        "reconciliation-api-token",
        "PASS",
        "SePay API bearer token is configured."
      );
    }

    const apiBaseUrl =
      env.SEPAY_API_BASE_URL?.trim() || "https://userapi.sepay.vn/v2";
    try {
      const parsed = new URL(apiBaseUrl);
      if (parsed.protocol !== "https:") {
        add(
          checks,
          "reconciliation-api-base-url",
          "FAIL",
          "SePay API base URL must use HTTPS for production cutover."
        );
      } else {
        add(
          checks,
          "reconciliation-api-base-url",
          "PASS",
          "SePay API base URL uses HTTPS."
        );
      }
    } catch {
      add(
        checks,
        "reconciliation-api-base-url",
        "FAIL",
        "SePay API base URL is not a valid URL."
      );
    }

    const scopeKey =
      env.SEPAY_RECONCILIATION_SCOPE_KEY?.trim() || "default";
    if (scopeKey === "default") {
      add(
        checks,
        "reconciliation-scope",
        "WARN",
        "Reconciliation scope still uses the generic default value."
      );
    } else {
      add(
        checks,
        "reconciliation-scope",
        "PASS",
        "Reconciliation scope is explicitly named."
      );
    }

    if (reconciliationIntervalMs === null) {
      add(
        checks,
        "reconciliation-interval",
        "FAIL",
        "Reconciliation interval must be a positive integer."
      );
    } else if (reconciliationIntervalMs < 60000) {
      add(
        checks,
        "reconciliation-interval",
        "FAIL",
        "Production reconciliation interval must be at least 60 seconds."
      );
    } else {
      add(
        checks,
        "reconciliation-interval",
        "PASS",
        "Reconciliation interval is production-safe."
      );
    }

    const lookbackHours = positiveInteger(
      env.SEPAY_RECONCILIATION_INITIAL_LOOKBACK_HOURS,
      24
    );
    if (lookbackHours === null) {
      add(
        checks,
        "reconciliation-lookback",
        "FAIL",
        "Initial reconciliation lookback must be a positive integer number of hours."
      );
    } else if (lookbackHours > 168) {
      add(
        checks,
        "reconciliation-lookback",
        "WARN",
        "Initial reconciliation lookback exceeds 7 days; confirm the larger bootstrap window is intentional."
      );
    } else {
      add(
        checks,
        "reconciliation-lookback",
        "PASS",
        "Initial reconciliation lookback is bounded."
      );
    }
  }

  if (!database.schemaMigrationsTablePresent) {
    add(
      checks,
      "schema-migrations-ledger",
      "FAIL",
      "schema_migrations is missing; production database setup was not completed through the supported migration path."
    );
  } else {
    add(
      checks,
      "schema-migrations-ledger",
      "PASS",
      "Migration ledger is present."
    );
  }

  for (const migration of REQUIRED_SEPAY_PRODUCTION_MIGRATIONS) {
    if (database.appliedMigrations.includes(migration)) {
      add(
        checks,
        "migration-" + migration.slice(0, 4),
        "PASS",
        migration + " is recorded as applied."
      );
    } else {
      add(
        checks,
        "migration-" + migration.slice(0, 4),
        "FAIL",
        migration + " is not recorded as applied."
      );
    }
  }

  for (const table of REQUIRED_SEPAY_PRODUCTION_TABLES) {
    add(
      checks,
      "table-" + table,
      database.tables[table] ? "PASS" : "FAIL",
      database.tables[table]
        ? tableLabel(table) + " table is present."
        : tableLabel(table) + " table is missing."
    );
  }

  if (
    database.tables.renter_invoices &&
    database.tables.organization_payment_profiles
  ) {
    if (database.outstandingOrganizationsWithoutActivePaymentProfile > 0) {
      add(
        checks,
        "payment-profile-coverage",
        "FAIL",
        String(database.outstandingOrganizationsWithoutActivePaymentProfile) +
          " organization(s) have outstanding ISSUED invoices without an active payment profile."
      );
    } else {
      add(
        checks,
        "payment-profile-coverage",
        "PASS",
        "Every organization with outstanding ISSUED invoices has an active payment profile."
      );
    }

    if (database.activePaymentProfiles === 0) {
      add(
        checks,
        "active-payment-profiles",
        "WARN",
        "No active organization payment profile exists yet."
      );
    } else {
      add(
        checks,
        "active-payment-profiles",
        "PASS",
        String(database.activePaymentProfiles) +
          " active organization payment profile(s) are configured."
      );
    }
  }

  if (database.tables.renter_payment_webhook_events) {
    if (database.providerReviewRequired > 0) {
      add(
        checks,
        "provider-review-backlog",
        "WARN",
        String(database.providerReviewRequired) +
          " SePay provider event(s) currently require manual review."
      );
    } else {
      add(
        checks,
        "provider-review-backlog",
        "PASS",
        "No SePay provider event is waiting for manual review."
      );
    }

    if (database.invalidSignature24h > 0) {
      add(
        checks,
        "invalid-signatures",
        "WARN",
        String(database.invalidSignature24h) +
          " invalid SePay webhook signature delivery/deliveries were observed in the last 24 hours."
      );
    } else {
      add(
        checks,
        "invalid-signatures",
        "PASS",
        "No invalid SePay webhook signature was observed in the last 24 hours."
      );
    }
  }

  if (database.tables.system_worker_heartbeats) {
    if (!database.worker) {
      add(
        checks,
        "renter-payment-worker",
        "WARN",
        "No SePay renter-payment worker heartbeat has been observed yet."
      );
    } else if (
      database.worker.status !== "HEALTHY" ||
      database.worker.lastSeenAgeSeconds > database.worker.staleAfterSeconds
    ) {
      add(
        checks,
        "renter-payment-worker",
        "WARN",
        "Latest SePay renter-payment worker heartbeat is not healthy/current."
      );
    } else {
      add(
        checks,
        "renter-payment-worker",
        "PASS",
        "SePay renter-payment worker heartbeat is healthy."
      );
    }
  }

  if (
    reconciliationEnabled &&
    database.tables.renter_payment_reconciliation_cursors
  ) {
    if (!database.reconciliation) {
      add(
        checks,
        "reconciliation-cursor",
        "WARN",
        "Configured reconciliation scope has not created a durable cursor yet."
      );
    } else if (!database.reconciliation.initialized) {
      add(
        checks,
        "reconciliation-cursor",
        "WARN",
        "Reconciliation cursor exists but has not completed a successful advance yet."
      );
    } else if (
      reconciliationIntervalMs !== null &&
      database.reconciliation.lastSuccessAgeSeconds >
        (reconciliationIntervalMs / 1000) * 2
    ) {
      add(
        checks,
        "reconciliation-cursor",
        "WARN",
        "Reconciliation last-success age exceeds twice the configured interval."
      );
    } else {
      add(
        checks,
        "reconciliation-cursor",
        "PASS",
        "Reconciliation cursor has advanced recently."
      );
    }
  }

  const summary = {
    pass: checks.filter((check) => check.status === "PASS").length,
    warn: checks.filter((check) => check.status === "WARN").length,
    fail: checks.filter((check) => check.status === "FAIL").length
  };

  return {
    ready: summary.fail === 0,
    checks,
    summary
  };
}

export async function collectSePayPreflightDatabaseSnapshot(
  pool: Pool,
  scopeKey: string
): Promise<SePayPreflightDatabaseSnapshot> {
  const presenceResult = await pool.query<TablePresenceRow>(`
    SELECT
      to_regclass('public.schema_migrations') IS NOT NULL AS schema_migrations,
      to_regclass('public.system_worker_heartbeats') IS NOT NULL AS system_worker_heartbeats,
      to_regclass('public.renter_invoices') IS NOT NULL AS renter_invoices,
      to_regclass('public.organization_payment_profiles') IS NOT NULL AS organization_payment_profiles,
      to_regclass('public.renter_payment_webhook_events') IS NOT NULL AS renter_payment_webhook_events,
      to_regclass('public.renter_provider_transaction_identities') IS NOT NULL AS renter_provider_transaction_identities,
      to_regclass('public.renter_payment_reconciliation_cursors') IS NOT NULL AS renter_payment_reconciliation_cursors
  `);
  const row = presenceResult.rows[0];
  if (!row) {
    throw new Error("Unable to inspect database schema.");
  }

  const tables: Record<RequiredTable, boolean> = {
    system_worker_heartbeats: row.system_worker_heartbeats,
    renter_invoices: row.renter_invoices,
    organization_payment_profiles: row.organization_payment_profiles,
    renter_payment_webhook_events: row.renter_payment_webhook_events,
    renter_provider_transaction_identities:
      row.renter_provider_transaction_identities,
    renter_payment_reconciliation_cursors:
      row.renter_payment_reconciliation_cursors
  };

  let appliedMigrations: string[] = [];
  if (row.schema_migrations) {
    const migrationResult = await pool.query<{ version: string }>(
      `SELECT version
       FROM schema_migrations
       WHERE version = ANY($1::text[])
       ORDER BY version`,
      [REQUIRED_SEPAY_PRODUCTION_MIGRATIONS]
    );
    appliedMigrations = migrationResult.rows.map((item) => item.version);
  }

  let activePaymentProfiles = 0;
  let outstandingOrganizationsWithoutActivePaymentProfile = 0;
  if (tables.renter_invoices && tables.organization_payment_profiles) {
    const profileResult = await pool.query<{
      active_profiles: number;
      uncovered_organizations: number;
    }>(`
      SELECT
        (
          SELECT count(*)::int
          FROM organization_payment_profiles
          WHERE is_active = true
        ) AS active_profiles,
        (
          SELECT count(*)::int
          FROM (
            SELECT DISTINCT invoice.organization_id
            FROM renter_invoices invoice
            LEFT JOIN organization_payment_profiles profile
              ON profile.organization_id = invoice.organization_id
             AND profile.is_active = true
            WHERE invoice.status = 'ISSUED'
              AND invoice.remaining_vnd > 0
              AND profile.organization_id IS NULL
          ) uncovered
        ) AS uncovered_organizations
    `);
    activePaymentProfiles = profileResult.rows[0]?.active_profiles ?? 0;
    outstandingOrganizationsWithoutActivePaymentProfile =
      profileResult.rows[0]?.uncovered_organizations ?? 0;
  }

  let providerReviewRequired = 0;
  let invalidSignature24h = 0;
  if (tables.renter_payment_webhook_events) {
    const providerResult = await pool.query<{
      review_required: number;
      invalid_signature_24h: number;
    }>(`
      SELECT
        count(*) FILTER (
          WHERE provider = 'SEPAY'
            AND processing_status = 'REVIEW_REQUIRED'
        )::int AS review_required,
        count(*) FILTER (
          WHERE provider = 'SEPAY'
            AND signature_status = 'INVALID'
            AND received_at >= now() - interval '24 hours'
        )::int AS invalid_signature_24h
      FROM renter_payment_webhook_events
    `);
    providerReviewRequired = providerResult.rows[0]?.review_required ?? 0;
    invalidSignature24h = providerResult.rows[0]?.invalid_signature_24h ?? 0;
  }

  let worker: SePayPreflightDatabaseSnapshot["worker"] = null;
  if (tables.system_worker_heartbeats) {
    const workerResult = await pool.query<{
      status: string;
      last_seen_age_seconds: number;
      stale_after_seconds: number;
    }>(`
      SELECT
        status,
        EXTRACT(
          EPOCH FROM GREATEST(now() - last_seen_at, interval '0 seconds')
        )::double precision AS last_seen_age_seconds,
        stale_after_seconds
      FROM system_worker_heartbeats
      WHERE role = 'RENTER_PAYMENT_WEBHOOK'
        AND provider = 'SEPAY'
      ORDER BY last_seen_at DESC, worker_id
      LIMIT 1
    `);
    const workerRow = workerResult.rows[0];
    if (workerRow) {
      worker = {
        status: workerRow.status,
        lastSeenAgeSeconds: Math.max(
          0,
          Number(workerRow.last_seen_age_seconds ?? 0)
        ),
        staleAfterSeconds: Number(workerRow.stale_after_seconds)
      };
    }
  }

  let reconciliation: SePayPreflightDatabaseSnapshot["reconciliation"] = null;
  if (
    tables.renter_payment_reconciliation_cursors &&
    scopeKey.trim().length > 0
  ) {
    const cursorResult = await pool.query<{
      initialized: boolean;
      last_success_age_seconds: number;
    }>(`
      SELECT
        last_success_at IS NOT NULL AS initialized,
        EXTRACT(
          EPOCH FROM GREATEST(
            now() - COALESCE(last_success_at, created_at),
            interval '0 seconds'
          )
        )::double precision AS last_success_age_seconds
      FROM renter_payment_reconciliation_cursors
      WHERE provider = 'SEPAY'
        AND scope_key = $1
    `, [scopeKey.trim()]);
    const cursorRow = cursorResult.rows[0];
    if (cursorRow) {
      reconciliation = {
        initialized: cursorRow.initialized,
        lastSuccessAgeSeconds: Math.max(
          0,
          Number(cursorRow.last_success_age_seconds ?? 0)
        )
      };
    }
  }

  return {
    schemaMigrationsTablePresent: row.schema_migrations,
    appliedMigrations,
    tables,
    activePaymentProfiles,
    outstandingOrganizationsWithoutActivePaymentProfile,
    providerReviewRequired,
    invalidSignature24h,
    worker,
    reconciliation
  };
}
