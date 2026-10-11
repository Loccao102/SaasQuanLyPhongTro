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
  ): Promise<void> {
    const match = await this.db.query<QueryResultRow>(
      `SELECT id FROM notification_jobs
       WHERE organization_id = $1::uuid
         AND campaign_id = $2::uuid
         AND id = $3::uuid
       LIMIT 1`,
      [principal.organizationId, campaignId, jobId]
    );
    if (!match.rowCount) throw new NotFoundException("Notification job was not found.");
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
    // Bound memory even if viewers abandon sessions without an explicit stop.
    for (const k of this.viewers.keys()) this.activeViewer(k);
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
  ): Promise<{ watching: boolean; frame: MonitorFrame | null }> {
    this.requireAdmin(principal);
    await this.assertTenantJob(principal, campaignId, jobId);
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
    return { watching: watcher !== null, frame };
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
      !/^data:image\\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image)
    )) return { ok: false };

    const previous = this.frames.get(key);
    this.frames.set(key, {
      stage: input.stage,
      errorCode: input.errorCode || null,
      image: image || previous?.image || null,
      attemptNumber: input.attemptNumber,
      capturedAt: new Date().toISOString(),
      expiresAt: Date.now() + this.frameTtlMs
    });
    return { ok: true };
  }
}
