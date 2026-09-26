import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { roleHasPermission } from "../../identity/domain/access-control.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";

export type LeaseVehicleType =
  | "MOTORBIKE"
  | "ELECTRIC_BIKE"
  | "BICYCLE"
  | "CAR"
  | "OTHER";

export interface CreateVehicleInput {
  vehicleType?: LeaseVehicleType;
  licensePlate: string;
  brandModel?: string;
  ownerName?: string;
  registeredAt?: string;
}

export interface UpdateVehicleInput {
  vehicleType?: LeaseVehicleType;
  licensePlate?: string;
  brandModel?: string;
  ownerName?: string;
  isActive?: boolean;
  unregisteredAt?: string | null;
}

@Injectable()
export class LeaseVehiclesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async listVehicles(principal: TenantPrincipal, leaseId: string) {
    if (!roleHasPermission(principal.role, "lease.read")) {
      throw new ForbiddenException("Lease read permission denied.");
    }

    const lease = await this.db.query(
      `SELECT id FROM leases WHERE organization_id = $1::uuid AND id = $2::uuid`,
      [principal.organizationId, leaseId]
    );
    if (lease.rowCount === 0) {
      throw new NotFoundException("Lease not found.");
    }

    const result = await this.db.query<{
      id: string;
      lease_id: string;
      vehicle_type: LeaseVehicleType;
      license_plate: string;
      brand_model: string | null;
      owner_name: string | null;
      is_active: boolean;
      registered_at: Date | string;
      unregistered_at: Date | string | null;
      created_at: Date | string;
    }>(
      `SELECT
         id::text,
         lease_id::text,
         vehicle_type,
         license_plate,
         brand_model,
         owner_name,
         is_active,
         registered_at,
         unregistered_at,
         created_at
       FROM lease_vehicles
       WHERE organization_id = $1::uuid
         AND lease_id = $2::uuid
       ORDER BY is_active DESC, registered_at DESC, created_at DESC`,
      [principal.organizationId, leaseId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      leaseId: row.lease_id,
      vehicleType: row.vehicle_type,
      licensePlate: row.license_plate,
      brandModel: row.brand_model,
      ownerName: row.owner_name,
      isActive: row.is_active,
      registeredAt:
        typeof row.registered_at === "string"
          ? row.registered_at.slice(0, 10)
          : row.registered_at.toISOString().slice(0, 10),
      unregisteredAt: row.unregistered_at
        ? typeof row.unregistered_at === "string"
          ? row.unregistered_at.slice(0, 10)
          : row.unregistered_at.toISOString().slice(0, 10)
        : null,
      createdAt: row.created_at
    }));
  }

  async addVehicle(
    principal: TenantPrincipal,
    leaseId: string,
    input: CreateVehicleInput
  ) {
    if (!roleHasPermission(principal.role, "lease.manage")) {
      throw new ForbiddenException("Lease manage permission denied.");
    }
    const licensePlate = input.licensePlate?.trim();
    if (!licensePlate) {
      throw new BadRequestException("Biển số xe không được để trống.");
    }

    return this.db.withTransaction(async (client) => {
      const lease = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM leases WHERE organization_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
        [principal.organizationId, leaseId]
      );
      if (lease.rowCount === 0 || !lease.rows[0]) {
        throw new NotFoundException("Lease not found.");
      }
      if (["TERMINATED", "CANCELLED"].includes(lease.rows[0].status)) {
        throw new ConflictException(
          "Không thể đăng ký xe cho hợp đồng đã kết thúc hoặc hủy."
        );
      }

      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const vehicleId = crypto.randomUUID();
      const vehicleType = input.vehicleType ?? "MOTORBIKE";
      const registeredAt =
        input.registeredAt ?? new Date().toISOString().slice(0, 10);

      await client.query(
        `INSERT INTO lease_vehicles (
           id, organization_id, lease_id, vehicle_type, license_plate,
           brand_model, owner_name, is_active, registered_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8::date)`,
        [
          vehicleId,
          principal.organizationId,
          leaseId,
          vehicleType,
          licensePlate.toUpperCase(),
          input.brandModel?.trim() || null,
          input.ownerName?.trim() || null,
          registeredAt
        ]
      );

      await client.query(
        `INSERT INTO audit_events (
           organization_id, actor_user_id, action, resource_type, resource_id, metadata
         )
         VALUES ($1, $2, 'LEASE_VEHICLE_ADDED', 'LEASE_VEHICLE', $3, $4::jsonb)`,
        [
          principal.organizationId,
          principal.userId,
          vehicleId,
          JSON.stringify({
            leaseId,
            vehicleType,
            licensePlate: licensePlate.toUpperCase()
          })
        ]
      );

      return {
        id: vehicleId,
        leaseId,
        vehicleType,
        licensePlate: licensePlate.toUpperCase(),
        brandModel: input.brandModel?.trim() || null,
        ownerName: input.ownerName?.trim() || null,
        isActive: true,
        registeredAt
      };
    });
  }

  async updateVehicle(
    principal: TenantPrincipal,
    leaseId: string,
    vehicleId: string,
    input: UpdateVehicleInput
  ) {
    if (!roleHasPermission(principal.role, "lease.manage")) {
      throw new ForbiddenException("Lease manage permission denied.");
    }

    return this.db.withTransaction(async (client) => {
      const existing = await client.query<{
        id: string;
        is_active: boolean;
      }>(
        `SELECT id, is_active FROM lease_vehicles
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid
           AND id = $3::uuid
         FOR UPDATE`,
        [principal.organizationId, leaseId, vehicleId]
      );
      if (existing.rowCount === 0 || !existing.rows[0]) {
        throw new NotFoundException("Vehicle not found.");
      }

      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      const isActive =
        input.isActive !== undefined ? input.isActive : existing.rows[0].is_active;
      const unregisteredAt =
        isActive === false
          ? input.unregisteredAt ?? new Date().toISOString().slice(0, 10)
          : null;

      await client.query(
        `UPDATE lease_vehicles
         SET vehicle_type = COALESCE($4, vehicle_type),
             license_plate = COALESCE($5, license_plate),
             brand_model = COALESCE($6, brand_model),
             owner_name = COALESCE($7, owner_name),
             is_active = $8,
             unregistered_at = $9,
             updated_at = now()
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid
           AND id = $3::uuid`,
        [
          principal.organizationId,
          leaseId,
          vehicleId,
          input.vehicleType ?? null,
          input.licensePlate ? input.licensePlate.trim().toUpperCase() : null,
          input.brandModel !== undefined ? input.brandModel.trim() || null : null,
          input.ownerName !== undefined ? input.ownerName.trim() || null : null,
          isActive,
          unregisteredAt
        ]
      );

      await client.query(
        `INSERT INTO audit_events (
           organization_id, actor_user_id, action, resource_type, resource_id, metadata
         )
         VALUES ($1, $2, 'LEASE_VEHICLE_UPDATED', 'LEASE_VEHICLE', $3, $4::jsonb)`,
        [
          principal.organizationId,
          principal.userId,
          vehicleId,
          JSON.stringify({ leaseId, isActive, ...input })
        ]
      );

      return { success: true, vehicleId, isActive };
    });
  }

  async removeVehicle(
    principal: TenantPrincipal,
    leaseId: string,
    vehicleId: string
  ) {
    if (!roleHasPermission(principal.role, "lease.manage")) {
      throw new ForbiddenException("Lease manage permission denied.");
    }

    return this.db.withTransaction(async (client) => {
      const existing = await client.query(
        `SELECT id FROM lease_vehicles
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid
           AND id = $3::uuid`,
        [principal.organizationId, leaseId, vehicleId]
      );
      if (existing.rowCount === 0) {
        throw new NotFoundException("Vehicle not found.");
      }

      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      await client.query(
        `DELETE FROM lease_vehicles
         WHERE organization_id = $1::uuid
           AND lease_id = $2::uuid
           AND id = $3::uuid`,
        [principal.organizationId, leaseId, vehicleId]
      );

      await client.query(
        `INSERT INTO audit_events (
           organization_id, actor_user_id, action, resource_type, resource_id, metadata
         )
         VALUES ($1, $2, 'LEASE_VEHICLE_REMOVED', 'LEASE_VEHICLE', $3, $4::jsonb)`,
        [
          principal.organizationId,
          principal.userId,
          vehicleId,
          JSON.stringify({ leaseId })
        ]
      );

      return { success: true };
    });
  }
}
