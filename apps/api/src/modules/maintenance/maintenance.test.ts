import assert from "node:assert/strict";
import test from "node:test";
import {
  maintenanceTicketCategories,
  maintenanceTicketPriorities,
  maintenanceTicketStatuses,
  type CreateMaintenanceTicketInput,
  type MaintenanceTicketCategory,
  type MaintenanceTicketPriority
} from "./maintenance.types.js";

function validateTicketCreationInput(input: CreateMaintenanceTicketInput): {
  title: string;
  description: string;
  residentName: string;
  category: MaintenanceTicketCategory;
  priority: MaintenanceTicketPriority;
} {
  const title = input.title?.trim();
  if (!title) {
    throw new Error("Tiêu đề báo hỏng không được để trống.");
  }
  const description = input.description?.trim();
  if (!description) {
    throw new Error("Mô tả chi tiết sự cố không được để trống.");
  }
  const residentName = input.residentName?.trim();
  if (!residentName) {
    throw new Error("Tên người báo không được để trống.");
  }
  const category = input.category && maintenanceTicketCategories.includes(input.category)
    ? input.category
    : "OTHER";
  const priority = input.priority && maintenanceTicketPriorities.includes(input.priority)
    ? input.priority
    : "NORMAL";

  return { title, description, residentName, category, priority };
}

test("maintenance: valid ticket creation input passes", () => {
  const result = validateTicketCreationInput({
    propertyId: "11111111-1111-4111-8111-111111111111",
    title: "Vỡ vòi nước bồn rửa chén",
    description: "Nước rỉ mạnh dưới bồn rửa, cần thợ xử lý gấp",
    residentName: "Nguyễn Văn A",
    category: "PLUMBING",
    priority: "URGENT"
  });

  assert.equal(result.title, "Vỡ vòi nước bồn rửa chén");
  assert.equal(result.category, "PLUMBING");
  assert.equal(result.priority, "URGENT");
});

test("maintenance: rejects empty title or description", () => {
  assert.throws(
    () =>
      validateTicketCreationInput({
        propertyId: "11111111-1111-4111-8111-111111111111",
        title: "",
        description: "mô tả",
        residentName: "Nguyễn Văn A"
      }),
    /Tiêu đề báo hỏng không được để trống/
  );

  assert.throws(
    () =>
      validateTicketCreationInput({
        propertyId: "11111111-1111-4111-8111-111111111111",
        title: "Báo hỏng",
        description: "   ",
        residentName: "Nguyễn Văn A"
      }),
    /Mô tả chi tiết sự cố không được để trống/
  );
});

test("maintenance: fallback invalid category and priority to OTHER and NORMAL", () => {
  const result = validateTicketCreationInput({
    propertyId: "11111111-1111-4111-8111-111111111111",
    title: "Cháy bóng đèn",
    description: "Bóng đèn hành lang bị cháy",
    residentName: "Lê Thị B",
    category: "UNKNOWN_CAT" as any,
    priority: "SUPER_HIGH" as any
  });

  assert.equal(result.category, "OTHER");
  assert.equal(result.priority, "NORMAL");
});

test("maintenance: verifies all defined categories, priorities, and statuses", () => {
  assert.equal(maintenanceTicketCategories.length, 6);
  assert.ok(maintenanceTicketCategories.includes("ELECTRICITY"));
  assert.ok(maintenanceTicketCategories.includes("PLUMBING"));
  assert.ok(maintenanceTicketCategories.includes("APPLIANCE"));

  assert.equal(maintenanceTicketPriorities.length, 4);
  assert.ok(maintenanceTicketPriorities.includes("URGENT"));

  assert.equal(maintenanceTicketStatuses.length, 5);
  assert.ok(maintenanceTicketStatuses.includes("OPEN"));
  assert.ok(maintenanceTicketStatuses.includes("RESOLVED"));
});
