import { createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { AutomationQuotaService } from "../../commercial/application/automation-quota.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { MembershipAccess } from "../../identity/domain/access-control.js";

export interface NotificationActor {
  userId: string;
  membership: MembershipAccess;
}

export interface NotificationRecipientInput {
  recipientKey: string;
  recipientDisplayName?: string | null;
}

export interface NotificationCampaignSummary {
  id: string;
  organizationId: string;
  channel: string;
  provider: string;
  status: string;
  totalRecipients: number;
  queued: number;
  running: number;
  retryWaiting: number;
  sent: number;
  failed: number;
  manualReview: number;
  cancelled: number;
  quotaReservationId: string;
  createdAt: string;
  updatedAt: string;
}

type CampaignSummaryRow = QueryResultRow & {
  id: string;
  organization_id: string;
  channel: string;
  provider: string;
  status: string;
  total_recipients: number;
  quota_reservation_id: string;
  queued: number;
  running: number;
  retry_waiting: number;
  sent: number;
  failed: number;
  manual_review: number;
  cancelled: number;
  created_at: Date;
  updated_at: Date;
};

export class NotificationCampaignAuthorizationError extends Error {
  constructor() {
    super("Principal is not authorized to send organization notifications.");
    this.name = "NotificationCampaignAuthorizationError";
  }
}

export class NotificationCampaignIdempotencyConflictError extends Error {
  constructor() {
    super("Campaign idempotency key was reused with different input.");
    this.name = "NotificationCampaignIdempotencyConflictError";
  }
}

export class InvalidNotificationCampaignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidNotificationCampaignError";
  }
}

@Injectable()
export class NotificationCampaignService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly quota: AutomationQuotaService
  ) {}

  async create(input: {
    actor: NotificationActor;
    organizationId: string;
    idempotencyKey: string;
    channel?: string;
    provider?: string;
    messageBody: string;
    recipients: readonly NotificationRecipientInput[];
  }): Promise<NotificationCampaignSummary> {
    if (
      !this.accessControl.can(input.actor.membership, "notification.send", {
        organizationId: input.organizationId
      })
    ) {
      throw new NotificationCampaignAuthorizationError();
    }

    const idempotencyKey = input.idempotencyKey.trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new InvalidNotificationCampaignError(
        "idempotencyKey must be between 8 and 200 characters."
      );
    }

    const channel = input.channel?.trim() || "ZALO";
    const provider = input.provider?.trim() || "PLAYWRIGHT_ZALO";
    const messageBody = input.messageBody.trim();
    if (messageBody.length === 0 || messageBody.length > 4000) {
      throw new InvalidNotificationCampaignError(
        "messageBody must be between 1 and 4000 characters."
      );
    }

    const recipients = this.normalizeRecipients(input.recipients);
    if (recipients.length === 0 || recipients.length > 5000) {
      throw new InvalidNotificationCampaignError(
        "Campaign must contain between 1 and 5000 unique recipients."
      );
    }

    const requestFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          channel,
          provider,
          messageBody,
          recipients
        })
      )
      .digest("hex");

    return this.database.withTransaction(async (client) => {
      const organization = await client.query(
        "SELECT id FROM organizations WHERE id = $1 FOR UPDATE",
        [input.organizationId]
      );
      if (organization.rowCount !== 1) {
        throw new InvalidNotificationCampaignError(
          "Organization was not found."
        );
      }

      const existing = await client.query<
        QueryResultRow & { id: string; request_fingerprint: string }
      >(
        `SELECT id::text, request_fingerprint
         FROM notification_campaigns
         WHERE organization_id = $1
           AND idempotency_key = $2`,
        [input.organizationId, idempotencyKey]
      );
      const current = existing.rows[0];
      if (current) {
        if (current.request_fingerprint !== requestFingerprint) {
          throw new NotificationCampaignIdempotencyConflictError();
        }
        return this.getSummary(client, input.organizationId, current.id);
      }

      const campaignId = randomUUID();
      const quotaKey =
        "notify:" +
        createHash("sha256")
          .update(input.organizationId + ":" + idempotencyKey)
          .digest("hex")
          .slice(0, 48);

      const reservation = await this.quota.reserveInTransaction(client, {
        organizationId: input.organizationId,
        idempotencyKey: quotaKey,
        sourceType: "NOTIFICATION_CAMPAIGN",
        sourceId: campaignId,
        requestedActions: recipients.length,
        metadata: { channel, provider }
      });

      await client.query(
        `INSERT INTO notification_campaigns (
           id,
           organization_id,
           quota_reservation_id,
           idempotency_key,
           request_fingerprint,
           channel,
           provider,
           message_body,
           status,
           total_recipients,
           created_by_user_id
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, 'QUEUED', $9, $10
         )`,
        [
          campaignId,
          input.organizationId,
          reservation.id,
          idempotencyKey,
          requestFingerprint,
          channel,
          provider,
          messageBody,
          recipients.length,
          input.actor.userId
        ]
      );

      for (let index = 0; index < recipients.length; index += 1) {
        const recipient = recipients[index]!;
        await client.query(
          `INSERT INTO notification_jobs (
             id,
             organization_id,
             campaign_id,
             recipient_key,
             recipient_display_name,
             provider,
             idempotency_key
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            randomUUID(),
            input.organizationId,
            campaignId,
            recipient.recipientKey,
            recipient.recipientDisplayName,
            provider,
            campaignId + ":" + String(index + 1)
          ]
        );
      }

      await client.query(
        `INSERT INTO audit_events (
           organization_id,
           actor_user_id,
           action,
           resource_type,
           resource_id,
           metadata
         )
         VALUES ($1, $2, 'NOTIFICATION_CAMPAIGN_CREATED', 'NOTIFICATION_CAMPAIGN', $3, $4::jsonb)`,
        [
          input.organizationId,
          input.actor.userId,
          campaignId,
          JSON.stringify({
            channel,
            provider,
            totalRecipients: recipients.length,
            quotaReservationId: reservation.id
          })
        ]
      );

      return this.getSummary(client, input.organizationId, campaignId);
    });
  }

  private normalizeRecipients(
    input: readonly NotificationRecipientInput[]
  ): Array<{ recipientKey: string; recipientDisplayName: string | null }> {
    const seen = new Set<string>();
    const recipients = input.map((recipient) => {
      const recipientKey = recipient.recipientKey.trim();
      if (recipientKey.length === 0 || recipientKey.length > 200) {
        throw new InvalidNotificationCampaignError(
          "recipientKey must be between 1 and 200 characters."
        );
      }
      if (seen.has(recipientKey)) {
        throw new InvalidNotificationCampaignError(
          "Duplicate recipientKey in campaign."
        );
      }
      seen.add(recipientKey);
      const displayName = recipient.recipientDisplayName?.trim() || null;
      return {
        recipientKey,
        recipientDisplayName: displayName
      };
    });

    recipients.sort((a, b) => a.recipientKey.localeCompare(b.recipientKey));
    return recipients;
  }

  private async getSummary(
    client: PoolClient,
    organizationId: string,
    campaignId: string
  ): Promise<NotificationCampaignSummary> {
    const result = await client.query<CampaignSummaryRow>(
      `SELECT
         c.id::text,
         c.organization_id::text,
         c.channel,
         c.provider,
         c.status,
         c.total_recipients,
         c.quota_reservation_id::text,
         count(*) FILTER (WHERE j.status = 'QUEUED')::int AS queued,
         count(*) FILTER (WHERE j.status = 'RUNNING')::int AS running,
         count(*) FILTER (WHERE j.status = 'RETRY_WAIT')::int AS retry_waiting,
         count(*) FILTER (WHERE j.status = 'SENT')::int AS sent,
         count(*) FILTER (WHERE j.status = 'FAILED')::int AS failed,
         count(*) FILTER (WHERE j.status = 'MANUAL_REVIEW')::int AS manual_review,
         count(*) FILTER (WHERE j.status = 'CANCELLED')::int AS cancelled,
         c.created_at,
         c.updated_at
       FROM notification_campaigns c
       JOIN notification_jobs j
         ON j.organization_id = c.organization_id
        AND j.campaign_id = c.id
       WHERE c.organization_id = $1
         AND c.id = $2
       GROUP BY c.id`,
      [organizationId, campaignId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new InvalidNotificationCampaignError("Campaign was not found.");
    }

    return {
      id: row.id,
      organizationId: row.organization_id,
      channel: row.channel,
      provider: row.provider,
      status: row.status,
      totalRecipients: row.total_recipients,
      queued: row.queued,
      running: row.running,
      retryWaiting: row.retry_waiting,
      sent: row.sent,
      failed: row.failed,
      manualReview: row.manual_review,
      cancelled: row.cancelled,
      quotaReservationId: row.quota_reservation_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };
  }
}
