import { ForbiddenException, Injectable } from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service.js";
import type { PlatformPrincipal } from "./cms.types.js";
import { normalizeGlobalSearchInput } from "./domain/global-search-query.js";
import {
  platformRoleHasPermission
} from "./domain/platform-access.js";

type OrganizationSearchRow = QueryResultRow & {
  id: string;
  name: string;
  slug: string;
  status: string;
  rank: number;
};

type ProviderPaymentSearchRow = QueryResultRow & {
  id: string;
  organization_id: string | null;
  organization_name: string | null;
  provider: string | null;
  provider_transaction_id: string | null;
  payment_reference: string | null;
  status: string;
  reconciliation_status: string;
  amount_vnd: string;
  occurred_at: Date;
  rank: number;
};

type InvoiceSearchRow = QueryResultRow & {
  id: string;
  organization_id: string;
  organization_name: string;
  payment_reference: string;
  status: string;
  amount_vnd: string;
  due_at: Date;
  rank: number;
};

type JobSearchRow = QueryResultRow & {
  id: string;
  organization_id: string;
  organization_name: string;
  campaign_id: string;
  recipient_key: string;
  recipient_display_name: string | null;
  provider: string;
  status: string;
  verification_state: string;
  created_at: Date;
  rank: number;
};

type RankedSearchItem = {
  rank: number;
  kind: "ORGANIZATION" | "PROVIDER_PAYMENT" | "SAAS_INVOICE" | "NOTIFICATION_JOB";
  id: string;
  title: string;
  reference: string;
  status: string;
  organization: {
    id: string;
    name: string;
  } | null;
  metadata: Readonly<Record<string, string | number | null>>;
};

@Injectable()
export class CmsGlobalSearchService {
  constructor(private readonly db: DatabaseService) {}

  async search(
    principal: PlatformPrincipal,
    input: { query?: string; limit?: string }
  ) {
    if (!platformRoleHasPermission(principal.role, "platform.cms.read")) {
      throw new ForbiddenException("Platform permission denied.");
    }

    const normalized = normalizeGlobalSearchInput(input);
    const canOrganizations = platformRoleHasPermission(
      principal.role,
      "platform.organizations.inspect"
    );
    const canBilling = platformRoleHasPermission(
      principal.role,
      "platform.billing.read"
    );
    const canJobs = platformRoleHasPermission(
      principal.role,
      "platform.jobs.read"
    );

    const [organizations, payments, invoices, jobs] = await Promise.all([
      canOrganizations
        ? this.searchOrganizations(normalized.query, normalized.limit)
        : Promise.resolve([]),
      canBilling
        ? this.searchProviderPayments(normalized.query, normalized.limit)
        : Promise.resolve([]),
      canBilling
        ? this.searchInvoices(normalized.query, normalized.limit)
        : Promise.resolve([]),
      canJobs
        ? this.searchJobs(normalized.query, normalized.limit)
        : Promise.resolve([])
    ]);

    const items = [
      ...organizations,
      ...payments,
      ...invoices,
      ...jobs
    ].sort(
      (left, right) =>
        left.rank - right.rank ||
        left.kind.localeCompare(right.kind) ||
        left.title.localeCompare(right.title)
    );

    return {
      query: normalized.query,
      scopes: {
        organizations: canOrganizations,
        billing: canBilling,
        jobs: canJobs
      },
      items: items.map(({ rank: _rank, ...item }) => item)
    };
  }

  private async searchOrganizations(
    query: string,
    limit: number
  ): Promise<RankedSearchItem[]> {
    const result = await this.db.query<OrganizationSearchRow>(
      `SELECT
         o.id::text,
         o.name,
         o.slug,
         o.status,
         CASE
           WHEN lower(o.id::text) = lower($1)
             OR lower(o.slug) = lower($1)
             THEN 0
           WHEN lower(o.slug) LIKE lower($1) || '%'
             OR lower(o.name) LIKE lower($1) || '%'
             THEN 1
           ELSE 2
         END AS rank
       FROM organizations o
       WHERE lower(o.id::text) = lower($1)
          OR o.slug ILIKE '%' || $1 || '%'
          OR o.name ILIKE '%' || $1 || '%'
       ORDER BY rank, o.name, o.id
       LIMIT $2`,
      [query, limit]
    );

    return result.rows.map((row) => ({
      rank: row.rank,
      kind: "ORGANIZATION",
      id: row.id,
      title: row.name,
      reference: row.slug,
      status: row.status,
      organization: {
        id: row.id,
        name: row.name
      },
      metadata: {}
    }));
  }

  private async searchProviderPayments(
    query: string,
    limit: number
  ): Promise<RankedSearchItem[]> {
    const result = await this.db.query<ProviderPaymentSearchRow>(
      `SELECT
         p.id::text,
         p.organization_id::text,
         o.name AS organization_name,
         p.provider,
         p.provider_transaction_id,
         p.metadata ->> 'paymentReference' AS payment_reference,
         p.status,
         p.reconciliation_status,
         p.amount_vnd::text,
         p.occurred_at,
         CASE
           WHEN lower(p.id::text) = lower($1)
             OR lower(COALESCE(p.provider_transaction_id, '')) = lower($1)
             OR lower(COALESCE(p.metadata ->> 'paymentReference', '')) = lower($1)
             THEN 0
           WHEN lower(COALESCE(p.provider_transaction_id, ''))
                  LIKE lower($1) || '%'
             OR lower(COALESCE(p.metadata ->> 'paymentReference', ''))
                  LIKE lower($1) || '%'
             THEN 1
           ELSE 2
         END AS rank
       FROM saas_subscription_payments p
       LEFT JOIN organizations o ON o.id = p.organization_id
       WHERE p.source = 'PROVIDER'
         AND (
           lower(p.id::text) = lower($1)
           OR COALESCE(p.provider_transaction_id, '') ILIKE '%' || $1 || '%'
           OR COALESCE(p.metadata ->> 'paymentReference', '') ILIKE '%' || $1 || '%'
         )
       ORDER BY rank, p.occurred_at DESC, p.id DESC
       LIMIT $2`,
      [query, limit]
    );

    return result.rows.map((row) => ({
      rank: row.rank,
      kind: "PROVIDER_PAYMENT",
      id: row.id,
      title:
        row.provider_transaction_id ??
        row.payment_reference ??
        row.id,
      reference: row.payment_reference ?? row.id,
      status: row.reconciliation_status,
      organization:
        row.organization_id && row.organization_name
          ? {
              id: row.organization_id,
              name: row.organization_name
            }
          : null,
      metadata: {
        provider: row.provider,
        paymentStatus: row.status,
        amountVnd: Number(row.amount_vnd),
        occurredAt: row.occurred_at.toISOString()
      }
    }));
  }

  private async searchInvoices(
    query: string,
    limit: number
  ): Promise<RankedSearchItem[]> {
    const result = await this.db.query<InvoiceSearchRow>(
      `SELECT
         i.id::text,
         i.organization_id::text,
         o.name AS organization_name,
         i.payment_reference,
         i.status,
         i.amount_vnd::text,
         i.due_at,
         CASE
           WHEN lower(i.id::text) = lower($1)
             OR lower(i.payment_reference) = lower($1)
             THEN 0
           WHEN lower(i.payment_reference) LIKE lower($1) || '%'
             THEN 1
           ELSE 2
         END AS rank
       FROM saas_subscription_invoices i
       JOIN organizations o ON o.id = i.organization_id
       WHERE lower(i.id::text) = lower($1)
          OR i.payment_reference ILIKE '%' || $1 || '%'
       ORDER BY rank, i.issued_at DESC, i.id DESC
       LIMIT $2`,
      [query, limit]
    );

    return result.rows.map((row) => ({
      rank: row.rank,
      kind: "SAAS_INVOICE",
      id: row.id,
      title: row.payment_reference,
      reference: row.id,
      status: row.status,
      organization: {
        id: row.organization_id,
        name: row.organization_name
      },
      metadata: {
        amountVnd: Number(row.amount_vnd),
        dueAt: row.due_at.toISOString()
      }
    }));
  }

  private async searchJobs(
    query: string,
    limit: number
  ): Promise<RankedSearchItem[]> {
    const result = await this.db.query<JobSearchRow>(
      `SELECT
         j.id::text,
         j.organization_id::text,
         o.name AS organization_name,
         j.campaign_id::text,
         j.recipient_key,
         j.recipient_display_name,
         j.provider,
         j.status,
         j.verification_state,
         j.created_at,
         CASE
           WHEN lower(j.id::text) = lower($1)
             OR lower(j.campaign_id::text) = lower($1)
             OR lower(j.recipient_key) = lower($1)
             THEN 0
           WHEN lower(j.recipient_key) LIKE lower($1) || '%'
             OR lower(COALESCE(j.recipient_display_name, ''))
                  LIKE lower($1) || '%'
             THEN 1
           ELSE 2
         END AS rank
       FROM notification_jobs j
       JOIN organizations o ON o.id = j.organization_id
       WHERE lower(j.id::text) = lower($1)
          OR lower(j.campaign_id::text) = lower($1)
          OR j.recipient_key ILIKE '%' || $1 || '%'
          OR COALESCE(j.recipient_display_name, '') ILIKE '%' || $1 || '%'
       ORDER BY rank, j.created_at DESC, j.id DESC
       LIMIT $2`,
      [query, limit]
    );

    return result.rows.map((row) => ({
      rank: row.rank,
      kind: "NOTIFICATION_JOB",
      id: row.id,
      title: row.recipient_display_name ?? row.recipient_key,
      reference: row.id,
      status: row.status,
      organization: {
        id: row.organization_id,
        name: row.organization_name
      },
      metadata: {
        campaignId: row.campaign_id,
        recipientKey: row.recipient_key,
        provider: row.provider,
        verificationState: row.verification_state,
        createdAt: row.created_at.toISOString()
      }
    }));
  }
}
