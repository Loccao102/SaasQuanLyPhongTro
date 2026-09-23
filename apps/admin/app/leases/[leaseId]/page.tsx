import { LeaseDetailClient } from "./lease-detail-client";

export default async function LeaseDetailPage({
  params
}: {
  params: Promise<{ leaseId: string }>;
}) {
  const { leaseId } = await params;
  return <LeaseDetailClient leaseId={leaseId} />;
}
