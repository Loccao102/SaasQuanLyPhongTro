import { ContractDocumentClient } from "./contract-document-client";

export default async function LeaseContractPage({
  params
}: {
  params: Promise<{ leaseId: string }>;
}) {
  const { leaseId } = await params;
  return <ContractDocumentClient leaseId={leaseId} />;
}
