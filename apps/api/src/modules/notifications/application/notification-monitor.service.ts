import {
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import type { QueryResultRow } from "pg";
import { DatabaseService } from "../../database/database.service.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";

type MonitorFrame = {
  stage: string;
  errorCode: string | null;
  image: string | null;
  attemptNumber: number;
  capturedAt: string;
};

type Viewer = {
  organizationId: string;
  campaignId: string;
  expiresAt: number;
};

// Ephemeral, tenant-scoped diagnostic frames for the SINGLE staging API process.
// Never persist Zalo screenshots to Neon, application logs or audit events.
@Injectable()
export class NotificationMonitorService {
  private readonly viewers = new Map<string, Viewer>();
  private readonly frames = new Map<string, MonitorFrame & { expiresAt: number }>();
  private readonly viewerTtlMs = 15_000;
  private readonly frameTtlMs = 180_000;

  constructor(private readonly db: DatabaseService) {}

  private requireAdmin(principal: TenantPrincipal): void {
    if (principal.role !== "OWNER" && principal.role !== "ADMIN") {
      throw new ForbiddenException("Only organization admins may view Zalo browser diagnostics.");
    }
  }

  private async assertTenantJob(
    principal: TenantPrincipal,
    campaignId: string,
    jobId: string
  ): Promise<{
    status: string;
    last_error_code: string | null;
    last_error_message: string | null;
    provider_status: string;
    provider_reason: string | null;
    evidence: unknown;
  }> {
    const match = await this.db.query<QueryResultRow & {
      status: string;
      last_error_code: string | null;
      last_error_message: string | null;
      provider_status: string;
      provider_reason: string | null;
      evidence: unknown;
    }>(
      `SELECT j.status, j.last_error_code, j.last_error_message, j.evidence,
              COALESCE(pc.status, 'ACTIVE') AS provider_status,
              pc.reason AS provider_reason
       FROM notification_jobs j
       LEFT JOIN notification_provider_controls pc ON pc.provider = j.provider
       WHERE j.organization_id = $1::uuid
         AND j.campaign_id = $2::uuid
         AND j.id = $3::uuid
       LIMIT 1`,
      [principal.organizationId, campaignId, jobId]
    );
    const row = match.rows[0];
    if (!row) throw new NotFoundException("Notification job was not found.");
    return row;
  }

  private key(organizationId: string, jobId: string): string {
    return organizationId + ":" + jobId;
  }

  private activeViewer(key: string): Viewer | null {
    const viewer = this.viewers.get(key);
    if (!viewer) return null;
    if (viewer.expiresAt <= Date.now()) {
      this.viewers.delete(key);
      return null;
    }
    return viewer;
  }

  async setWatching(
    principal: TenantPrincipal,
    campaignId: string,
    jobId: string,
    enabled: boolean
  ): Promise<{ watching: boolean }> {
    this.requireAdmin(principal);
    await this.assertTenantJob(principal, campaignId, jobId);
    const key = this.key(principal.organizationId, jobId);
    if (!enabled) {
      this.viewers.delete(key);
      this.frames.delete(key);
      return { watching: false };
    }
    // Bound memory and discard expired screenshot frames after disconnects.
    for (const k of this.viewers.keys()) this.activeViewer(k);
    for (const [k, frame] of this.frames) {
      if (frame.expiresAt <= Date.now()) this.frames.delete(k);
    }
    if (!this.activeViewer(key)) this.frames.delete(key);
    if (this.viewers.size >= 25 && !this.viewers.has(key)) {
      throw new ForbiddenException("Too many concurrent Zalo debug viewers.");
    }
    this.viewers.set(key, {
      organizationId: principal.organizationId,
      campaignId,
      expiresAt: Date.now() + this.viewerTtlMs
    });
    return { watching: true };
  }

  async get(
    principal: TenantPrincipal,
    campaignId: string,
    jobId: string
  ): Promise<{
    watching: boolean;
    frame: MonitorFrame | null;
    provider: { status: string; reason: string | null };
    job: { status: string; lastErrorCode: string | null; lastErrorMessage: string | null };
    diagnostics: { pageHost: string | null; inputHints: Array<Record<string, string>> };
  }> {
    this.requireAdmin(principal);
    const job = await this.assertTenantJob(principal, campaignId, jobId);
    const key = this.key(principal.organizationId, jobId);
    const watcher = this.activeViewer(key);
    const current = this.frames.get(key);
    const frame = current && current.expiresAt > Date.now()
      ? {
        stage: current.stage,
        errorCode: current.errorCode,
        image: watcher ? current.image : null,
        attemptNumber: current.attemptNumber,
        capturedAt: current.capturedAt
      }
      : null;
    if (current && !frame) this.frames.delete(key);
    const evidence = typeof job.evidence === "object" && job.evidence !== null &&
      !Array.isArray(job.evidence)
      ? job.evidence as Record<string, unknown>
      : {};
    const inputHints = Array.isArray(evidence.inputHints) ? evidence.inputHints : [];
    const safeHints = inputHints.slice(0, 12).filter(
      (hint): hint is Record<string, unknown> =>
        typeof hint === "object" && hint !== null && !Array.isArray(hint)
    ).map((hint) => {
      const result: Record<string, string> = {};
      for (const field of ["tag", "type", "id", "placeholder", "ariaLabel"]) {
        if (typeof hint[field] === "string") result[field] = hint[field].slice(0, 80);
      }
      return result;
    });
    return {
      watching: watcher !== null,
      frame,
      provider: { status: job.provider_status, reason: job.provider_reason },
      diagnostics: {
        pageHost: typeof evidence.pageHost === "string" ? evidence.pageHost.slice(0, 100) : null,
        inputHints: safeHints
      },
      job: {
        status: job.status,
        lastErrorCode: job.last_error_code,
        lastErrorMessage: job.last_error_message
      }
    };
  }

  active(
    organizationId: string,
    jobId: string,
    attemptNumber: number
  ): { watching: boolean } {
    const watcher = this.activeViewer(this.key(organizationId, jobId));
    return {
      watching: Boolean(watcher && Number.isInteger(attemptNumber) && attemptNumber > 0)
    };
  }

  async publish(
    organizationId: string,
    jobId: string,
    input: {
      attemptNumber: number;
      stage: string;
      errorCode?: string | null;
      image?: string | null;
    }
  ): Promise<{ ok: boolean }> {
    const key = this.key(organizationId, jobId);
    const watcher = this.activeViewer(key);
    if (!watcher) return { ok: false };
    if (!Number.isInteger(input.attemptNumber) || input.attemptNumber < 1 ||
        !/^[A-Z_]{3,60}$/.test(input.stage) ||
        (input.errorCode && !/^[A-Z_]{3,80}$/.test(input.errorCode))) {
      return { ok: false };
    }

    const result = await this.db.query<QueryResultRow>(
      `SELECT id FROM notification_jobs
       WHERE id = $1::uuid
         AND organization_id = $2::uuid
         AND campaign_id = $3::uuid
         AND attempt_count = $4
         AND status = 'RUNNING'`,
      [jobId, organizationId, watcher.campaignId, input.attemptNumber]
    );
    if (!result.rowCount || !this.activeViewer(key)) return { ok: false };

    const image = input.image ?? null;
    if (image && (
      image.length > 200_000 ||
      !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image)
    )) return { ok: false };

    const previous = this.frames.get(key);
    this.frames.set(key, {
      stage: input.stage,
      errorCode: input.errorCode || null,
      image: image || (previous?.attemptNumber === input.attemptNumber ? previous.image : null) || null,
      attemptNumber: input.attemptNumber,
      capturedAt: new Date().toISOString(),
      expiresAt: Date.now() + this.frameTtlMs
    });
    return { ok: true };
  }
}
