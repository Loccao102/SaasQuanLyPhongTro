import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { roleHasPermission } from "../../identity/domain/access-control.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";
import type { PropertyImportPayload } from "./excel-property.helper.js";

export type PropertyImportValidationReport = {
  isValid: boolean;
  summary: {
    propertyCode: string;
    propertyName: string;
    propertyType: string;
    locationText: string;
    floorCount: number;
    roomCount: number;
    equipmentCount: number;
  };
  errors: Array<{
    section: "PROPERTY" | "FLOORS" | "ROOMS" | "EQUIPMENTS";
    row?: number;
    itemCode?: string;
    message: string;
  }>;
  warnings: string[];
};

export type PropertyImportResult = {
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  floorCount: number;
  roomCount: number;
  equipmentCount: number;
  administrativeAreaId: string | null;
};

@Injectable()
export class PropertyImportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly commercialPolicy: CommercialPolicyService
  ) {}

  async validate(
    principal: TenantPrincipal,
    payload: PropertyImportPayload
  ): Promise<PropertyImportValidationReport> {
    this.requireWritePermission(principal);

    const errors: PropertyImportValidationReport["errors"] = [];
    const warnings: string[] = [];

    // 1. Property validation
    const prop = payload.property;
    if (!prop) {
      return {
        isValid: false,
        summary: {
          propertyCode: "",
          propertyName: "",
          propertyType: "",
          locationText: "",
          floorCount: 0,
          roomCount: 0,
          equipmentCount: 0
        },
        errors: [{ section: "PROPERTY", message: "Thiếu thông tin cơ sở." }],
        warnings: []
      };
    }

    if (!prop.name || prop.name.trim() === "") {
      errors.push({ section: "PROPERTY", message: "Tên cơ sở không được để trống." });
    }

    if (!prop.code || prop.code.trim() === "") {
      errors.push({ section: "PROPERTY", message: "Mã cơ sở không được để trống." });
    } else {
      // Check if code already exists for this organization
      const existingProp = await this.db.query<QueryResultRow>(
        `SELECT id FROM properties WHERE organization_id = $1::uuid AND code = $2 AND is_active = true LIMIT 1`,
        [principal.organizationId, prop.code.trim()]
      );
      if (existingProp.rows.length > 0) {
        errors.push({
          section: "PROPERTY",
          itemCode: prop.code,
          message: `Mã cơ sở "${prop.code}" đã tồn tại trong tổ chức.`
        });
      }
    }

    // 2. Floors validation
    const floorCodeSet = new Set<string>();
    const floors = payload.floors || [];
    floors.forEach((f, idx) => {
      const code = f.code?.trim();
      if (!code) {
        errors.push({
          section: "FLOORS",
          row: idx + 1,
          message: "Mã tầng không được để trống."
        });
      } else if (floorCodeSet.has(code.toUpperCase())) {
        errors.push({
          section: "FLOORS",
          row: idx + 1,
          itemCode: code,
          message: `Mã tầng "${code}" bị trùng lặp trong file.`
        });
      } else {
        floorCodeSet.add(code.toUpperCase());
      }
    });

    // 3. Rooms validation
    const roomCodeSet = new Set<string>();
    const rooms = payload.rooms || [];
    if (rooms.length === 0) {
      warnings.push("File import chưa có danh sách phòng nào.");
    }

    rooms.forEach((r, idx) => {
      const code = r.code?.trim();
      if (!code) {
        errors.push({
          section: "ROOMS",
          row: idx + 1,
          message: "Mã phòng không được để trống."
        });
      } else if (roomCodeSet.has(code.toUpperCase())) {
        errors.push({
          section: "ROOMS",
          row: idx + 1,
          itemCode: code,
          message: `Mã phòng "${code}" bị trùng lặp trong file.`
        });
      } else {
        roomCodeSet.add(code.toUpperCase());
      }

      if (!r.name || r.name.trim() === "") {
        errors.push({
          section: "ROOMS",
          row: idx + 1,
          itemCode: code,
          message: `Phòng "${code || idx + 1}" thiếu tên hiển thị.`
        });
      }

      if (r.floorCode && r.floorCode.trim() !== "") {
        const floorUpper = r.floorCode.trim().toUpperCase();
        if (floorCodeSet.size > 0 && !floorCodeSet.has(floorUpper)) {
          warnings.push(
            `Phòng "${code}" gán mã tầng "${r.floorCode}" không nằm trong danh sách tầng khai báo.`
          );
        }
      }
    });

    // 4. Equipment validation
    const equipments = payload.equipments || [];
    equipments.forEach((eq, idx) => {
      if (!eq.roomCode || eq.roomCode.trim() === "") {
        errors.push({
          section: "EQUIPMENTS",
          row: idx + 1,
          message: "Trang thiết bị thiếu mã phòng gắn kèm."
        });
      } else if (!roomCodeSet.has(eq.roomCode.trim().toUpperCase())) {
        errors.push({
          section: "EQUIPMENTS",
          row: idx + 1,
          itemCode: eq.roomCode,
          message: `Thiết bị "${eq.name || 'chưa đặt tên'}" gán vào mã phòng "${eq.roomCode}" không tồn tại trong danh sách phòng.`
        });
      }

      if (!eq.name || eq.name.trim() === "") {
        errors.push({
          section: "EQUIPMENTS",
          row: idx + 1,
          message: "Tên trang thiết bị không được để trống."
        });
      }

      if (eq.quantity !== undefined && eq.quantity < 1) {
        errors.push({
          section: "EQUIPMENTS",
          row: idx + 1,
          message: `Số lượng thiết bị "${eq.name}" phải lớn hơn hoặc bằng 1.`
        });
      }

      if (eq.compensationValueVnd !== undefined && eq.compensationValueVnd < 0) {
        errors.push({
          section: "EQUIPMENTS",
          row: idx + 1,
          message: `Giá trị bồi hoàn của "${eq.name}" không thể là số âm.`
        });
      }
    });

    const locationParts = [prop.wardName, prop.districtName, prop.provinceName]
      .filter((p) => Boolean(p && p.trim()))
      .join(" - ");

    return {
      isValid: errors.length === 0,
      summary: {
        propertyCode: prop.code?.trim() || "",
        propertyName: prop.name?.trim() || "",
        propertyType: prop.propertyType || "BOARDING_HOUSE",
        locationText: locationParts || prop.addressText || "Chưa xác định",
        floorCount: floors.length,
        roomCount: rooms.length,
        equipmentCount: equipments.length
      },
      errors,
      warnings
    };
  }

  async execute(
    principal: TenantPrincipal,
    payload: PropertyImportPayload
  ): Promise<PropertyImportResult> {
    const report = await this.validate(principal, payload);
    if (!report.isValid) {
      throw new BadRequestException({
        message: "Dữ liệu import không hợp lệ.",
        errors: report.errors
      });
    }

    return this.db.withTransaction(async (client) => {
      await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      // 1. Resolve administrative area hierarchy (Province -> District -> Ward)
      const administrativeAreaId = await this.resolveAdministrativeArea(
        client,
        payload.property.provinceName,
        payload.property.districtName,
        payload.property.wardName
      );

      // 2. Insert Property
      const propResult = await client.query<{ id: string }>(
        `INSERT INTO properties (
           organization_id, administrative_area_id, code, name, property_type, address_text, is_active
         ) VALUES ($1::uuid, $2, $3, $4, $5, $6, true)
         RETURNING id::text`,
        [
          principal.organizationId,
          administrativeAreaId,
          payload.property.code.trim(),
          payload.property.name.trim(),
          payload.property.propertyType,
          payload.property.addressText?.trim() || null
        ]
      );

      const propertyId = propResult.rows[0]!.id;

      // 3. Insert Floors
      const floorIdMap = new Map<string, string>();
      for (const floor of payload.floors || []) {
        const floorCode = floor.code.trim();
        const fRes = await client.query<{ id: string }>(
          `INSERT INTO floors (
             organization_id, property_id, code, name, sort_order, is_active
           ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, true)
           RETURNING id::text`,
          [
            principal.organizationId,
            propertyId,
            floorCode,
            floor.name?.trim() || floorCode,
            floor.sortOrder ?? 0
          ]
        );
        floorIdMap.set(floorCode.toUpperCase(), fRes.rows[0]!.id);
      }

      // 4. Insert Rooms
      const roomIdMap = new Map<string, string>();
      for (const room of payload.rooms || []) {
        const roomCode = room.code.trim();
        const floorId = room.floorCode
          ? floorIdMap.get(room.floorCode.trim().toUpperCase()) ?? null
          : null;

        const rRes = await client.query<{ id: string }>(
          `INSERT INTO rooms (
             organization_id, property_id, floor_id, code, name, sort_order, is_active
           ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, true)
           RETURNING id::text`,
          [
            principal.organizationId,
            propertyId,
            floorId,
            roomCode,
            room.name?.trim() || roomCode,
            room.sortOrder ?? 0
          ]
        );
        roomIdMap.set(roomCode.toUpperCase(), rRes.rows[0]!.id);
      }

      // 5. Insert Equipment
      for (const eq of payload.equipments || []) {
        const roomId = roomIdMap.get(eq.roomCode.trim().toUpperCase());
        if (!roomId) continue;

        await client.query(
          `INSERT INTO room_equipment (
             organization_id, property_id, room_id, name, brand, model_or_serial,
             quantity, condition_status, compensation_value_vnd, note
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10
           )`,
          [
            principal.organizationId,
            propertyId,
            roomId,
            eq.name.trim(),
            eq.brand?.trim() || null,
            eq.modelOrSerial?.trim() || null,
            eq.quantity ?? 1,
            eq.conditionStatus ?? "GOOD",
            eq.compensationValueVnd ?? 0,
            eq.note?.trim() || null
          ]
        );
      }

      return {
        propertyId,
        propertyCode: payload.property.code.trim(),
        propertyName: payload.property.name.trim(),
        floorCount: (payload.floors || []).length,
        roomCount: (payload.rooms || []).length,
        equipmentCount: (payload.equipments || []).length,
        administrativeAreaId
      };
    });
  }

  private async resolveAdministrativeArea(
    client: PoolClient,
    provinceName?: string,
    districtName?: string,
    wardName?: string
  ): Promise<string | null> {
    const prov = provinceName?.trim();
    const dist = districtName?.trim();
    const ward = wardName?.trim();

    if (!prov && !dist && !ward) {
      return null;
    }

    let provinceId: string | null = null;
    if (prov) {
      const pCode = `PROV-${this.slugify(prov)}`;
      const pRes = await client.query<{ id: string }>(
        `INSERT INTO administrative_areas (code, name, area_type, level, is_active)
         VALUES ($1, $2, 'PROVINCE', 0, true)
         ON CONFLICT (area_type, code) WHERE code IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name
         RETURNING id::text`,
        [pCode, prov]
      );
      provinceId = pRes.rows[0]?.id ?? null;
    }

    let districtId: string | null = null;
    if (dist) {
      const dCode = `DIST-${this.slugify(prov || "VN")}-${this.slugify(dist)}`;
      const dRes = await client.query<{ id: string }>(
        `INSERT INTO administrative_areas (parent_id, code, name, area_type, level, is_active)
         VALUES ($1, $2, $3, 'DISTRICT', 1, true)
         ON CONFLICT (area_type, code) WHERE code IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id
         RETURNING id::text`,
        [provinceId, dCode, dist]
      );
      districtId = dRes.rows[0]?.id ?? null;
    }

    if (ward) {
      const wCode = `WARD-${this.slugify(dist || "DIST")}-${this.slugify(ward)}`;
      const wRes = await client.query<{ id: string }>(
        `INSERT INTO administrative_areas (parent_id, code, name, area_type, level, is_active)
         VALUES ($1, $2, $3, 'WARD', 2, true)
         ON CONFLICT (area_type, code) WHERE code IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id
         RETURNING id::text`,
        [districtId ?? provinceId, wCode, ward]
      );
      return wRes.rows[0]?.id ?? districtId ?? provinceId;
    }

    return districtId ?? provinceId;
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  }

  private requireWritePermission(principal: TenantPrincipal): void {
    if (!roleHasPermission(principal.role, "property.manage")) {
      throw new ForbiddenException("Không có quyền tạo hoặc chỉnh sửa cơ sở.");
    }
  }
}
