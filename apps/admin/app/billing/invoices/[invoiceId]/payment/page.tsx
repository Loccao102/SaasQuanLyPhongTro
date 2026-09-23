import { ManualPaymentAllocationClient } from "./manual-payment-allocation-client";

export default async function ManualPaymentPage({
  params
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  return <ManualPaymentAllocationClient invoiceId={invoiceId} />;
}
