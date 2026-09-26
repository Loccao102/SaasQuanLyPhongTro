import { LeasePrintClient } from "./lease-print-client";

export default async function LeasePrintPage({
  params
}: {
  params: Promise<{ leaseId: string }>;
}) {
  const { leaseId } = await params;
  return <LeasePrintClient leaseId={leaseId} />;
}
