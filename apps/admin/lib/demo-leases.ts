export type DemoLeaseStatus =
  | "DRAFT"
  | "ACTIVE"
  | "TERMINATION_SCHEDULED"
  | "TERMINATED";

export interface DemoLease {
  id: string;
  code: string;
  property: string;
  room: string;
  primaryTenant: string;
  phone: string;
  status: DemoLeaseStatus;
  startDate: string;
  plannedEndDate: string | null;
  baseRentVnd: number;
  depositRequiredVnd: number;
  billingDay: number;
}

export const demoLeases: readonly DemoLease[] = [
  {
    id: "lease-demo-001",
    code: "HD-2026-0917",
    property: "Nguyễn Trãi 1",
    room: "P201",
    primaryTenant: "Nguyễn Văn Minh",
    phone: "09•• ••• 321",
    status: "ACTIVE",
    startDate: "01/06/2026",
    plannedEndDate: "31/05/2027",
    baseRentVnd: 3500000,
    depositRequiredVnd: 3500000,
    billingDay: 5
  },
  {
    id: "lease-demo-002",
    code: "HD-2025-1182",
    property: "Nguyễn Trãi 1",
    room: "P305",
    primaryTenant: "Trần Thu Hà",
    phone: "09•• ••• 772",
    status: "TERMINATION_SCHEDULED",
    startDate: "15/10/2025",
    plannedEndDate: "14/10/2026",
    baseRentVnd: 3900000,
    depositRequiredVnd: 3900000,
    billingDay: 5
  },
  {
    id: "lease-demo-003",
    code: "HD-2026-0441",
    property: "Hà Đông 2",
    room: "A106",
    primaryTenant: "Lê Hoàng Long",
    phone: "08•• ••• 145",
    status: "ACTIVE",
    startDate: "01/01/2026",
    plannedEndDate: "30/09/2026",
    baseRentVnd: 3200000,
    depositRequiredVnd: 3200000,
    billingDay: 3
  },
  {
    id: "lease-demo-004",
    code: "HD-DRAFT-022",
    property: "Bắc Ninh 4",
    room: "B402",
    primaryTenant: "Phạm Ngọc Anh",
    phone: "03•• ••• 908",
    status: "DRAFT",
    startDate: "01/10/2026",
    plannedEndDate: "30/09/2027",
    baseRentVnd: 2800000,
    depositRequiredVnd: 2800000,
    billingDay: 5
  }
];

export function findDemoLease(leaseId: string): DemoLease | undefined {
  return demoLeases.find((lease) => lease.id === leaseId);
}
