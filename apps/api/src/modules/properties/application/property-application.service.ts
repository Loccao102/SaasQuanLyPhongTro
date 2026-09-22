import { Injectable } from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import type { MembershipAccess } from "../../identity/domain/access-control.js";
import type { Property, PropertyType } from "../domain/property-model.js";

export interface PropertyActor {
  userId: string;
  membership: MembershipAccess;
}

export interface CreatePropertyInput {
  actor: PropertyActor;
  organizationId: string;
  propertyId: string;
  code: string;
  name: string;
  propertyType: PropertyType;
  addressText?: string | null;
}

type PropertyRow = QueryResultRow & {
  id: string;
  organization_id: string;
  administrative_area_id: string | null;
  code: string;
  name: string;
  property_type: PropertyType;
  address_text: string | null;
  is_active: boolean;
};

export class PropertyCreateAuthorizationError extends Error {
  constructor() {
    super("Principal is not authorized to create properties for this organization.");
    this.name = "PropertyCreateAuthorizationError";
  }
}

export class PropertyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PropertyInputError";
  }
}

export class PropertyIdentityConflictError extends Error {
  constructor() {
    super("Property id was already used with different property data.");
    this.name = "PropertyIdentityConflictError";
  }
}

export class PropertyCodeConflictError extends Error {
  constructor() {
    super("Property code already exists in this organization.");
    this.name = "PropertyCodeConflictError";
  }
}

function mapProperty(row: PropertyRow): Property {
  return {
    id: row.id,
    organizationId: row.organization_id,
    administrativeAreaId: row.administrative_area_id,
    code: row.code,
    name: row.name,
    propertyType: row.property_type,
    addressText: row.address_text,
    isActive: row.is_active
  };
}

@Injectable()
export class PropertyApplicationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accessControl: AccessControlService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async create(input: CreatePropertyInput): Promise<Property> {
    const code = input.code.trim();
    const name = input.name.trim();
    const addressText = input.addressText?.trim() || null;

    if (!code || !name) {
      throw new PropertyInputError("Property code and name are required.");
    }
    if (code.length > 64 || name.length > 200) {
      throw new PropertyInputError("Property code or name is too long.");
    }
    if (addressText && addressText.length > 500) {
      throw new PropertyInputError("Property address is too long.");
    }

    if (
      !this.accessControl.can(input.actor.membership, "property.manage", {
        organizationId: input.organizationId
      })
    ) {
      throw new PropertyCreateAuthorizationError();
    }

    return this.database.withTransaction(async (client) => {
      await this.commercialPolicy.lockOrganizationForMutation(
        client,
        input.organizationId
      );
      const policy = await this.commercialPolicy.loadPolicy(
        client,
        input.organizationId
      );

      const existing = await this.findProperty(
        client,
        input.organizationId,
        input.propertyId
      );
      if (existing) {
        if (
          existing.code !== code ||
          existing.name !== name ||
          existing.property_type !== input.propertyType ||
          existing.address_text !== addressText ||
          !existing.is_active
        ) {
          throw new PropertyIdentityConflictError();
        }
        return mapProperty(existing);
      }

      this.commercialPolicy.assertWriteAllowed(policy);

      const codeConflict = await client.query(
        `SELECT id
         FROM properties
         WHERE organization_id = $1
           AND code = $2`,
        [input.organizationId, code]
      );
      if ((codeConflict.rowCount ?? 0) > 0) {
        throw new PropertyCodeConflictError();
      }

      const inserted = await client.query<PropertyRow>(
        `INSERT INTO properties (
           id,
           organization_id,
           code,
           name,
           property_type,
           address_text
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING
           id::text,
           organization_id::text,
           administrative_area_id::text,
           code,
           name,
           property_type,
           address_text,
           is_active`,
        [
          input.propertyId,
          input.organizationId,
          code,
          name,
          input.propertyType,
          addressText
        ]
      );

      await client.query(
        `INSERT INTO audit_events (
           organization_id,
           actor_user_id,
           action,
           resource_type,
           resource_id,
           metadata
         )
         VALUES ($1, $2, 'PROPERTY_CREATED', 'PROPERTY', $3, $4::jsonb)`,
        [
          input.organizationId,
          input.actor.userId,
          input.propertyId,
          JSON.stringify({
            code,
            propertyType: input.propertyType,
            planVersionId: policy.planVersionId
          })
        ]
      );

      return mapProperty(inserted.rows[0]!);
    });
  }

  private async findProperty(
    client: PoolClient,
    organizationId: string,
    propertyId: string
  ): Promise<PropertyRow | undefined> {
    const result = await client.query<PropertyRow>(
      `SELECT
         id::text,
         organization_id::text,
         administrative_area_id::text,
         code,
         name,
         property_type,
         address_text,
         is_active
       FROM properties
       WHERE organization_id = $1
         AND id = $2`,
      [organizationId, propertyId]
    );
    return result.rows[0];
  }
}
