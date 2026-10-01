import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional
} from "@nestjs/common";
import type { PoolClient, QueryResultRow } from "pg";
import { CommercialPolicyService } from "../../commercial/application/commercial-policy.service.js";
import { DatabaseService } from "../../database/database.service.js";
import { AccessControlService } from "../../identity/access-control.service.js";
import { roleHasPermission } from "../../identity/domain/access-control.js";
import type { TenantPrincipal } from "../../identity/tenant-principal.js";
import {
  generatePropertyImportTemplateWorkbook,
  type PropertyImportPayload,
  type PropertyImportTemplateContext
} from "./excel-property.helper.js";

export type PropertyImportValidationReport = {
  isValid: boolean;
  summary: {
    isExistingProperty?: boolean;
    propertyCode: string;
    propertyName: string;
    propertyType: string;
    locationText: string;
    floorCount: number;
    roomCount: number;
    newRoomCount?: number;
    existingRoomCount?: number;
    autoCreateMeters?: boolean;
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
  newRoomCount?: number;
  existingRoomCount?: number;
  metersCreatedCount?: number;
  equipmentCount: number;
  administrativeAreaId: string | null;
};

@Injectable()
export class PropertyImportService {
  private readonly accessControl: AccessControlService;

  constructor(
    private readonly db: DatabaseService,
    private readonly commercialPolicy: CommercialPolicyService,
    @Optional() accessControl?: AccessControlService
  ) {
    this.accessControl = accessControl ?? new AccessControlService();
  }

  async generateTemplate(
    principal: TenantPrincipal,
    propertyId?: string
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (!propertyId) {
      const buffer = generatePropertyImportTemplateWorkbook();
      return {
        buffer,
        filename: "Mau_Nhap_Co_So_Phong_Tai_San.xlsx"
      };
    }

    await this.requirePropertyPermission(this.db, principal, propertyId);

    const propRes = await this.db.query<{
      code: string;
      name: string;
      property_type: string;
      address_text: string | null;
    }>(
      `SELECT code, name, property_type, address_text
       FROM properties
       WHERE organization_id = $1::uuid AND id = $2::uuid AND is_active = true
       LIMIT 1`,
      [principal.organizationId, propertyId]
    );

    const prop = propRes.rows[0];
    if (!prop) {
      throw new NotFoundException("Cơ sở không tồn tại hoặc đã ngừng hoạt động.");
    }

    const floorsRes = await this.db.query<{
      code: string;
      name: string;
      sort_order: number;
    }>(
      `SELECT code, name, sort_order
       FROM floors
       WHERE organization_id = $1::uuid AND property_id = $2::uuid AND is_active = true
       ORDER BY sort_order ASC, code ASC`,
      [principal.organizationId, propertyId]
    );

    const context: PropertyImportTemplateContext = {
      propertyCode: prop.code,
      propertyName: prop.name,
      propertyType: prop.property_type,
      addressText: prop.address_text || undefined,
      floors: floorsRes.rows.map((f) => ({
        code: f.code,
        name: f.name,
        sortOrder: f.sort_order
      }))
    };

    const buffer = generatePropertyImportTemplateWorkbook(context);
    const safeCode = prop.code.replace(/[^a-zA-Z0-9_-]/g, "_");
    return {
      buffer,
      filename: `Mau_Nhap_Phong_${safeCode}.xlsx`
    };
  }

  async validate(
    principal: TenantPrincipal,
    payload: PropertyImportPayload
  ): Promise<PropertyImportValidationReport> {
    const isExistingMode = Boolean(payload.targetPropertyId);
    await this.requireWritePermission(principal, payload.targetPropertyId);

    const errors: PropertyImportValidationReport["errors"] = [];
    const warnings: string[] = [];

    let targetPropCode = "";
    let targetPropName = "";
    let targetPropType = "BOARDING_HOUSE";
    let targetLocation = "";

    const existingFloorCodes = new Set<string>();
    const existingRoomCodes = new Set<string>();

    if (isExistingMode && payload.targetPropertyId) {
      const pRes = await this.db.query<{
        id: string;
        code: string;
        name: string;
        property_type: string;
        address_text: string | null;
      }>(
        `SELECT id::text, code, name, property_type, address_text
         FROM properties
         WHERE organization_id = $1::uuid AND id = $2::uuid AND is_active = true
         LIMIT 1`,
        [principal.organizationId, payload.targetPropertyId]
      );

      const targetProp = pRes.rows[0];
      if (!targetProp) {
        errors.push({
          section: "PROPERTY",
          message: "Cơ sở được chọn để nhập phòng không tồn tại hoặc đã bị khóa."
        });
      } else {
        targetPropCode = targetProp.code;
        targetPropName = targetProp.name;
        targetPropType = targetProp.property_type;
        targetLocation = targetProp.address_text || "Chưa xác định";

        // Load existing floors
        const fRes = await this.db.query<{ code: string }>(
          `SELECT code FROM floors WHERE organization_id = $1::uuid AND property_id = $2::uuid AND is_active = true`,
          [principal.organizationId, payload.targetPropertyId]
        );
        for (const row of fRes.rows) {
          existingFloorCodes.add(row.code.trim().toUpperCase());
        }

        // Load existing rooms
        const rRes = await this.db.query<{ code: string }>(
          `SELECT code FROM rooms WHERE organization_id = $1::uuid AND property_id = $2::uuid AND is_active = true`,
          [principal.organizationId, payload.targetPropertyId]
        );
        for (const row of rRes.rows) {
          existingRoomCodes.add(row.code.trim().toUpperCase());
        }
      }
    } else {
      // 1. Property validation for brand new property
      const prop = payload.property;
      if (!prop) {
        return {
          isValid: false,
          summary: {
            isExistingProperty: false,
            propertyCode: "",
            propertyName: "",
            propertyType: "",
            locationText: "",
            floorCount: 0,
            roomCount: 0,
            newRoomCount: 0,
            existingRoomCount: 0,
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

      targetPropCode = prop.code?.trim() || "";
      targetPropName = prop.name?.trim() || "";
      targetPropType = prop.propertyType || "BOARDING_HOUSE";
      const locationParts = [prop.wardName, prop.districtName, prop.provinceName]
        .filter((p) => Boolean(p && p.trim()))
        .join(" - ");
      targetLocation = locationParts || prop.addressText || "Chưa xác định";
    }

    // 2. Floors validation
    const payloadFloorCodeSet = new Set<string>();
    const floors = payload.floors || [];
    floors.forEach((f, idx) => {
      const code = f.code?.trim();
      if (!code) {
        errors.push({
          section: "FLOORS",
          row: idx + 1,
          message: "Mã tầng không được để trống."
        });
      } else if (payloadFloorCodeSet.has(code.toUpperCase())) {
        errors.push({
          section: "FLOORS",
          row: idx + 1,
          itemCode: code,
          message: `Mã tầng "${code}" bị trùng lặp trong file.`
        });
      } else {
        payloadFloorCodeSet.add(code.toUpperCase());
      }
    });

    // Valid floor codes available for rooms
    const allValidFloorCodes = new Set<string>([
      ...existingFloorCodes,
      ...payloadFloorCodeSet
    ]);

    // 3. Rooms validation
    const payloadRoomCodeSet = new Set<string>();
    const rooms = payload.rooms || [];
    if (rooms.length === 0 && !isExistingMode) {
      warnings.push("File import chưa có danh sách phòng nào.");
    }

    let newRoomsCount = 0;
    let existingRoomsCount = 0;

    rooms.forEach((r, idx) => {
      const code = r.code?.trim();
      if (!code) {
        errors.push({
          section: "ROOMS",
          row: idx + 1,
          message: "Mã phòng không được để trống."
        });
      } else if (payloadRoomCodeSet.has(code.toUpperCase())) {
        errors.push({
          section: "ROOMS",
          row: idx + 1,
          itemCode: code,
          message: `Mã phòng "${code}" bị trùng lặp trong file.`
        });
      } else {
        payloadRoomCodeSet.add(code.toUpperCase());
        if (existingRoomCodes.has(code.toUpperCase())) {
          existingRoomsCount++;
        } else {
          newRoomsCount++;
        }
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
        if (allValidFloorCodes.size > 0 && !allValidFloorCodes.has(floorUpper)) {
          warnings.push(
            `Phòng "${code}" gán mã tầng "${r.floorCode}" không nằm trong danh sách tầng đã có hoặc khai báo.`
          );
        }
      }
    });

    if (existingRoomsCount > 0) {
      warnings.push(
        `${existingRoomsCount} phòng đã có sẵn trong cơ sở và sẽ được cập nhật thông tin.`
      );
    }

    // Commercial Room Limit Check for new rooms
    if (newRoomsCount > 0) {
      try {
        const usageResult = await this.db.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM rooms WHERE organization_id = $1::uuid AND is_active = true`,
          [principal.organizationId]
        );
        const currentActiveRooms = usageResult.rows[0]?.count ?? 0;
        const policy = await this.commercialPolicy.loadPolicy(
          this.db,
          principal.organizationId
        );
        this.commercialPolicy.assertResourceIncreaseAllowed(
          policy,
          "ROOM",
          currentActiveRooms,
          newRoomsCount
        );
      } catch (limitErr) {
        errors.push({
          section: "ROOMS",
          message:
            limitErr instanceof Error
              ? limitErr.message
              : `Vượt quá giới hạn số phòng của gói đăng ký hiện tại khi thêm ${newRoomsCount} phòng.`
        });
      }
    }

    // 4. Equipment validation
    const allValidRoomCodes = new Set<string>([
      ...existingRoomCodes,
      ...payloadRoomCodeSet
    ]);

    const equipments = payload.equipments || [];
    equipments.forEach((eq, idx) => {
      if (!eq.roomCode || eq.roomCode.trim() === "") {
        errors.push({
          section: "EQUIPMENTS",
          row: idx + 1,
          message: "Trang thiết bị thiếu mã phòng gắn kèm."
        });
      } else if (!allValidRoomCodes.has(eq.roomCode.trim().toUpperCase())) {
        errors.push({
          section: "EQUIPMENTS",
          row: idx + 1,
          itemCode: eq.roomCode,
          message: `Thiết bị "${eq.name || "chưa đặt tên"}" gán vào mã phòng "${eq.roomCode}" không tồn tại trong danh sách phòng.`
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

    return {
      isValid: errors.length === 0,
      summary: {
        isExistingProperty: isExistingMode,
        propertyCode: targetPropCode,
        propertyName: targetPropName,
        propertyType: targetPropType,
        locationText: targetLocation,
        floorCount: floors.length,
        roomCount: rooms.length,
        newRoomCount: newRoomsCount,
        existingRoomCount: existingRoomsCount,
        autoCreateMeters: payload.autoCreateMeters !== false,
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

    const isExistingMode = Boolean(payload.targetPropertyId);

    return this.db.withTransaction(async (client) => {
      const policy = await this.commercialPolicy.assertTenantWriteAllowed(
        client,
        principal.organizationId
      );

      let propertyId = payload.targetPropertyId;
      let propertyCode = "";
      let propertyName = "";
      let administrativeAreaId: string | null = null;

      if (isExistingMode && propertyId) {
        await this.requirePropertyPermission(client, principal, propertyId);
        const propRes = await client.query<{
          code: string;
          name: string;
          administrative_area_id: string | null;
        }>(
          `SELECT code, name, administrative_area_id
           FROM properties
           WHERE organization_id = $1::uuid AND id = $2::uuid AND is_active = true
           LIMIT 1`,
          [principal.organizationId, propertyId]
        );
        const row = propRes.rows[0]!;
        propertyCode = row.code;
        propertyName = row.name;
        administrativeAreaId = row.administrative_area_id;
      } else {
        const prop = payload.property;
        if (!prop) {
          throw new BadRequestException("Thiếu thông tin cơ sở.");
        }

        // Resolve administrative area hierarchy
        administrativeAreaId = await this.resolveAdministrativeArea(
          client,
          prop.provinceName,
          prop.districtName,
          prop.wardName
        );

        // Insert Property
        propertyCode = prop.code.trim();
        propertyName = prop.name.trim();

        const propResult = await client.query<{ id: string }>(
          `INSERT INTO properties (
             organization_id, administrative_area_id, code, name, property_type, address_text, is_active
           ) VALUES ($1::uuid, $2, $3, $4, $5, $6, true)
           RETURNING id::text`,
          [
            principal.organizationId,
            administrativeAreaId,
            propertyCode,
            propertyName,
            prop.propertyType,
            prop.addressText?.trim() || null
          ]
        );
        propertyId = propResult.rows[0]!.id;
      }

      // Upsert Floors
      const floorIdMap = new Map<string, string>();

      // Preload any existing floors for this property
      const existingFloorsRes = await client.query<{ id: string; code: string }>(
        `SELECT id::text, code FROM floors WHERE organization_id = $1::uuid AND property_id = $2::uuid AND is_active = true`,
        [principal.organizationId, propertyId]
      );
      for (const ef of existingFloorsRes.rows) {
        floorIdMap.set(ef.code.toUpperCase(), ef.id);
      }

      for (const floor of payload.floors || []) {
        const floorCode = floor.code.trim();
        const fRes = await client.query<{ id: string }>(
          `INSERT INTO floors (
             organization_id, property_id, code, name, sort_order, is_active
           ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, true)
           ON CONFLICT (organization_id, property_id, code)
           DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, is_active = true
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

      // Preload existing rooms for existing property
      const existingRoomsMap = new Map<string, string>();
      if (isExistingMode) {
        const existingRoomsRes = await client.query<{ id: string; code: string }>(
          `SELECT id::text, code FROM rooms WHERE organization_id = $1::uuid AND property_id = $2::uuid AND is_active = true`,
          [principal.organizationId, propertyId]
        );
        for (const er of existingRoomsRes.rows) {
          existingRoomsMap.set(er.code.toUpperCase(), er.id);
        }
      }

      // Insert / Update Rooms
      const roomIdMap = new Map<string, string>();
      const newlyCreatedRooms: { id: string; code: string }[] = [];

      for (const room of payload.rooms || []) {
        const roomCode = room.code.trim();
        const floorId = room.floorCode
          ? floorIdMap.get(room.floorCode.trim().toUpperCase()) ?? null
          : null;

        const isNew = !existingRoomsMap.has(roomCode.toUpperCase());

        const rRes = await client.query<{ id: string }>(
          `INSERT INTO rooms (
             organization_id, property_id, floor_id, code, name, sort_order, is_active
           ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, true)
           ON CONFLICT (organization_id, property_id, code)
           DO UPDATE SET name = EXCLUDED.name,
                         floor_id = COALESCE(EXCLUDED.floor_id, rooms.floor_id),
                         sort_order = EXCLUDED.sort_order,
                         is_active = true
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
        const roomId = rRes.rows[0]!.id;
        roomIdMap.set(roomCode.toUpperCase(), roomId);

        if (isNew) {
          newlyCreatedRooms.push({ id: roomId, code: roomCode });
        }
      }

      // Also copy over existing rooms to roomIdMap so equipment can link to existing rooms
      for (const [code, id] of existingRoomsMap.entries()) {
        if (!roomIdMap.has(code)) {
          roomIdMap.set(code, id);
        }
      }

      // Auto-provision active ELECTRICITY & WATER meters for newly created rooms
      let metersCreatedCount = 0;
      if (payload.autoCreateMeters !== false && newlyCreatedRooms.length > 0) {
        for (const r of newlyCreatedRooms) {
          // Electricity Meter
          await client.query(
            `INSERT INTO meters (
               id, organization_id, room_id, meter_type, unit, label, is_active, created_by_user_id
             ) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'ELECTRICITY', 'KWH', $3, true, $4::uuid)
             ON CONFLICT (organization_id, room_id, meter_type) WHERE is_active = true DO NOTHING`,
            [
              principal.organizationId,
              r.id,
              `Đồng hồ điện ${r.code}`,
              principal.userId
            ]
          );

          // Water Meter
          await client.query(
            `INSERT INTO meters (
               id, organization_id, room_id, meter_type, unit, label, is_active, created_by_user_id
             ) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'WATER', 'M3', $3, true, $4::uuid)
             ON CONFLICT (organization_id, room_id, meter_type) WHERE is_active = true DO NOTHING`,
            [
              principal.organizationId,
              r.id,
              `Đồng hồ nước ${r.code}`,
              principal.userId
            ]
          );

          metersCreatedCount += 2;
        }
      }

      // Insert Equipment
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

      // Audit Log
      const auditAction = isExistingMode
        ? "PROPERTY_ROOMS_BULK_IMPORTED"
        : "PROPERTY_IMPORTED";

      await client.query(
        `INSERT INTO audit_events (
           organization_id, actor_user_id, action, resource_type, resource_id, metadata
         ) VALUES ($1, $2, $3, 'PROPERTY', $4, $5::jsonb)`,
        [
          principal.organizationId,
          principal.userId,
          auditAction,
          propertyId,
          JSON.stringify({
            propertyId,
            propertyCode,
            floorCount: (payload.floors || []).length,
            roomCount: (payload.rooms || []).length,
            newRoomCount: newlyCreatedRooms.length,
            metersCreatedCount,
            equipmentCount: (payload.equipments || []).length,
            planVersionId: policy.planVersionId
          })
        ]
      );

      return {
        propertyId,
        propertyCode,
        propertyName,
        floorCount: (payload.floors || []).length,
        roomCount: (payload.rooms || []).length,
        newRoomCount: newlyCreatedRooms.length,
        existingRoomCount: (payload.rooms || []).length - newlyCreatedRooms.length,
        metersCreatedCount,
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

  private async requireWritePermission(
    principal: TenantPrincipal,
    targetPropertyId?: string
  ): Promise<void> {
    if (targetPropertyId) {
      await this.requirePropertyPermission(this.db, principal, targetPropertyId);
    } else {
      const allowed =
        this.accessControl.can(principal.membership, "property.manage", {
          organizationId: principal.organizationId
        }) || roleHasPermission(principal.role, "property.manage");

      if (!allowed) {
        throw new ForbiddenException("Không có quyền tạo hoặc chỉnh sửa cơ sở.");
      }
    }
  }

  private async requirePropertyPermission(
    dbOrClient: { query: DatabaseService["query"] },
    principal: TenantPrincipal,
    propertyId: string
  ): Promise<void> {
    const groups = await dbOrClient.query<QueryResultRow & { id: string }>(
      `SELECT operational_group_id::text AS id
       FROM property_operational_groups
       WHERE organization_id = $1::uuid AND property_id = $2::uuid`,
      [principal.organizationId, propertyId]
    );

    const allowed =
      this.accessControl.can(principal.membership, "property.manage", {
        organizationId: principal.organizationId,
        propertyId,
        operationalGroupIds: groups.rows.map((row) => row.id)
      }) || roleHasPermission(principal.role, "property.manage");

    if (!allowed) {
      throw new ForbiddenException("Không có quyền quản lý cơ sở này.");
    }
  }
}
