import assert from "node:assert/strict";
import test from "node:test";
import type { ReservationStatus } from "./room-reservation.service.js";

function validateReservationDates(reservedFrom: string, reservedUntil: string): boolean {
  return reservedUntil >= reservedFrom;
}

function validateReservationDeposit(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount > 0;
}

function canTransitionReservation(
  current: ReservationStatus,
  target: ReservationStatus
): boolean {
  if (current !== "ACTIVE") return false;
  return [
    "CONVERTED_TO_LEASE",
    "CANCELLED_REFUNDED",
    "CANCELLED_FORFEITED",
    "EXPIRED"
  ].includes(target);
}

test("room reservation: validates positive deposit amount", () => {
  assert.equal(validateReservationDeposit(1000000), true);
  assert.equal(validateReservationDeposit(500000), true);
  assert.equal(validateReservationDeposit(0), false);
  assert.equal(validateReservationDeposit(-500000), false);
  assert.equal(validateReservationDeposit(NaN), false);
});

test("room reservation: validates reservedUntil must be on or after reservedFrom", () => {
  assert.equal(validateReservationDates("2026-10-01", "2026-10-10"), true);
  assert.equal(validateReservationDates("2026-10-10", "2026-10-10"), true);
  assert.equal(validateReservationDates("2026-10-15", "2026-10-10"), false);
});

test("room reservation: allows valid lifecycle transitions from ACTIVE", () => {
  assert.equal(canTransitionReservation("ACTIVE", "CONVERTED_TO_LEASE"), true);
  assert.equal(canTransitionReservation("ACTIVE", "CANCELLED_REFUNDED"), true);
  assert.equal(canTransitionReservation("ACTIVE", "CANCELLED_FORFEITED"), true);
  assert.equal(canTransitionReservation("ACTIVE", "EXPIRED"), true);
});

test("room reservation: rejects lifecycle transitions when not ACTIVE", () => {
  assert.equal(canTransitionReservation("CONVERTED_TO_LEASE", "CANCELLED_REFUNDED"), false);
  assert.equal(canTransitionReservation("CANCELLED_REFUNDED", "CONVERTED_TO_LEASE"), false);
  assert.equal(canTransitionReservation("CANCELLED_FORFEITED", "ACTIVE"), false);
});
