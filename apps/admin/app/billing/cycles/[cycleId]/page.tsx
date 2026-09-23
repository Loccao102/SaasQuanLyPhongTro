import { RenterBillingCycleClient } from "./renter-billing-cycle-client";

export default async function RenterBillingCyclePage({
  params
}: {
  params: Promise<{ cycleId: string }>;
}) {
  const { cycleId } = await params;
  return <RenterBillingCycleClient cycleId={cycleId} />;
}
