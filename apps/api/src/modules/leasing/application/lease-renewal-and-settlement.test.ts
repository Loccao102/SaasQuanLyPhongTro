import assert from "node:assert/strict";
import test from "node:test";
import { ConflictException } from "@nestjs/common";

/**
 * Domain & Application rule tests for Lease Renewal & Financial Settlement
 */

function deriveFinancialReadiness(invoices: Array<{
  status: "DRAFT" | "ISSUED" | "VOID";
  collectionStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  remainingVnd: number;
}>): "READY" | "PENDING" {
  const hasDraft = invoices.some((inv) => inv.status === "DRAFT");
  const hasOutstandingDebt = invoices.some(
    (inv) => inv.status === "ISSUED" && inv.remainingVnd > 0
  );
  if (hasDraft || hasOutstandingDebt) {
    return "PENDING";
  }
  return "READY";
}

test("financial readiness: READY when no invoices exist", () => {
  const readiness = deriveFinancialReadiness([]);
  assert.equal(readiness, "READY");
});

test("financial readiness: READY when all invoices are fully PAID or VOID", () => {
  const readiness = deriveFinancialReadiness([
    { status: "ISSUED", collectionStatus: "PAID", remainingVnd: 0 },
    { status: "VOID", collectionStatus: "UNPAID", remainingVnd: 500000 }
  ]);
  assert.equal(readiness, "READY");
});

test("financial readiness: PENDING when there is outstanding debt", () => {
  const readiness = deriveFinancialReadiness([
    { status: "ISSUED", collectionStatus: "PARTIALLY_PAID", remainingVnd: 150000 },
    { status: "ISSUED", collectionStatus: "PAID", remainingVnd: 0 }
  ]);
  assert.equal(readiness, "PENDING");
});

test("financial readiness: PENDING when there are unissued DRAFT invoices", () => {
  const readiness = deriveFinancialReadiness([
    { status: "DRAFT", collectionStatus: "UNPAID", remainingVnd: 3500000 }
  ]);
  assert.equal(readiness, "PENDING");
});

function validateRenewalPreconditions(lease: {
  status: string;
  startDate: string;
  plannedEndDate: string | null;
}, input: {
  startDate: string;
  plannedEndDate?: string | null;
  rolloverDeposit?: boolean;
}, heldDepositVnd: number): void {
  if (lease.status !== "ACTIVE") {
    throw new ConflictException("Only ACTIVE leases can be renewed.");
  }
  if (input.startDate < lease.startDate) {
    throw new ConflictException("Renewal start date cannot be before original lease start date.");
  }
  if (input.rolloverDeposit && heldDepositVnd <= 0) {
    throw new ConflictException("Cannot rollover deposit when no deposit is currently held.");
  }
}

test("lease renewal: succeeds for ACTIVE lease with valid dates", () => {
  assert.doesNotThrow(() => {
    validateRenewalPreconditions(
      {
        status: "ACTIVE",
        startDate: "2025-01-01",
        plannedEndDate: "2025-12-31"
      },
      {
        startDate: "2026-01-01",
        plannedEndDate: "2026-12-31",
        rolloverDeposit: true
      },
      5000000
    );
  });
});

test("lease renewal: rejects non-ACTIVE lease", () => {
  assert.throws(
    () => {
      validateRenewalPreconditions(
        {
          status: "TERMINATED",
          startDate: "2025-01-01",
          plannedEndDate: "2025-12-31"
        },
        {
          startDate: "2026-01-01"
        },
        0
      );
    },
    ConflictException
  );
});

test("lease renewal: rejects start date preceding original lease start", () => {
  assert.throws(
    () => {
      validateRenewalPreconditions(
        {
          status: "ACTIVE",
          startDate: "2025-06-01",
          plannedEndDate: "2026-05-31"
        },
        {
          startDate: "2025-05-01"
        },
        0
      );
    },
    ConflictException
  );
});

test("lease renewal: rejects rolloverDeposit when held deposit is zero", () => {
  assert.throws(
    () => {
      validateRenewalPreconditions(
        {
          status: "ACTIVE",
          startDate: "2025-01-01",
          plannedEndDate: "2025-12-31"
        },
        {
          startDate: "2026-01-01",
          rolloverDeposit: true
        },
        0
      );
    },
    ConflictException
  );
});

function validateAmendmentPreconditions(
  leaseStatus: string,
  input: { amendmentNumber: string; effectiveDate: string; changesSummary: string; adjustedPlannedEndDate?: string },
  leaseStartDate: string
) {
  if (leaseStatus !== "ACTIVE" && leaseStatus !== "TERMINATION_SCHEDULED") {
    throw new ConflictException("Only ACTIVE or TERMINATION_SCHEDULED leases can be amended.");
  }
  if (!input.amendmentNumber.trim()) throw new ConflictException("amendmentNumber is required");
  if (!input.changesSummary.trim()) throw new ConflictException("changesSummary is required");
  if (input.adjustedPlannedEndDate && input.adjustedPlannedEndDate < leaseStartDate) {
    throw new ConflictException("Adjusted planned end date cannot precede lease start date.");
  }
}

test("lease amendment: valid for ACTIVE lease with rent adjustment", () => {
  assert.doesNotThrow(() => {
    validateAmendmentPreconditions(
      "ACTIVE",
      {
        amendmentNumber: "PL-01",
        effectiveDate: "2026-06-01",
        changesSummary: "Tăng giá phòng thêm 200.000đ/tháng"
      },
      "2026-01-01"
    );
  });
});

test("lease amendment: rejects DRAFT or TERMINATED lease", () => {
  assert.throws(() => {
    validateAmendmentPreconditions(
      "DRAFT",
      {
        amendmentNumber: "PL-01",
        effectiveDate: "2026-06-01",
        changesSummary: "Thay đổi giá"
      },
      "2026-01-01"
    );
  }, ConflictException);
});

test("lease amendment: rejects planned end date earlier than lease start date", () => {
  assert.throws(() => {
    validateAmendmentPreconditions(
      "ACTIVE",
      {
        amendmentNumber: "PL-01",
        effectiveDate: "2026-06-01",
        changesSummary: "Rút ngắn kỳ hạn",
        adjustedPlannedEndDate: "2025-12-31"
      },
      "2026-01-01"
    );
  }, ConflictException);
});

function generateOccupantPlaceholders(
  occupantCount: number | null | undefined,
  startDate: string
) {
  const count = occupantCount
    ? Math.max(1, Math.min(20, Math.floor(Number(occupantCount))))
    : 1;
  const occupants: Array<{ fullName: string; role: string; joinedOn: string }> = [];
  if (count > 1) {
    for (let i = 2; i <= count; i++) {
      occupants.push({
        fullName: `Khách ở cùng ${i} (Chờ cập nhật)`,
        role: "OCCUPANT",
        joinedOn: startDate
      });
    }
  }
  return occupants;
}

test("multi-occupant draft: auto-creates (occupantCount - 1) placeholder occupants for 3 guests", () => {
  const placeholders = generateOccupantPlaceholders(3, "2026-02-01");
  assert.equal(placeholders.length, 2);
  assert.equal(placeholders[0]!.fullName, "Khách ở cùng 2 (Chờ cập nhật)");
  assert.equal(placeholders[0]!.role, "OCCUPANT");
  assert.equal(placeholders[0]!.joinedOn, "2026-02-01");
  assert.equal(placeholders[1]!.fullName, "Khách ở cùng 3 (Chờ cập nhật)");
  assert.equal(placeholders[1]!.role, "OCCUPANT");
  assert.equal(placeholders[1]!.joinedOn, "2026-02-01");
});

test("multi-occupant draft: creates 0 placeholders when occupantCount is 1 or null", () => {
  assert.equal(generateOccupantPlaceholders(1, "2026-02-01").length, 0);
  assert.equal(generateOccupantPlaceholders(null, "2026-02-01").length, 0);
  assert.equal(generateOccupantPlaceholders(undefined, "2026-02-01").length, 0);
});

test("multi-occupant draft: bounds occupantCount between 1 and 20", () => {
  const zeroPlaceholders = generateOccupantPlaceholders(0, "2026-02-01");
  assert.equal(zeroPlaceholders.length, 0);

  const maxPlaceholders = generateOccupantPlaceholders(50, "2026-02-01");
  assert.equal(maxPlaceholders.length, 19); // 2 to 20 -> 19 occupants + 1 primary
});

test("party update: validates required non-empty fullName", () => {
  function validatePartyUpdate(input: { fullName: string }) {
    if (!input.fullName || input.fullName.trim().length === 0) {
      throw new ConflictException("fullName is required.");
    }
  }

  assert.doesNotThrow(() => validatePartyUpdate({ fullName: "Trần Thị B" }));
  assert.throws(() => validatePartyUpdate({ fullName: "   " }), ConflictException);
});


