import { TerminateLeaseClient } from "./terminate-lease-client";

export default async function TerminateLeasePage({
  params
}: {
  params: Promise<{ leaseId: string }>;
}) {
  const { leaseId } = await params;
  return <TerminateLeaseClient leaseId={leaseId} />;
}
