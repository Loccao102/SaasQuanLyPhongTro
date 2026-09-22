import { InvoiceDetailClient } from "./invoice-detail-client";

export default async function InvoiceDetailPage({
  params
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  return <InvoiceDetailClient invoiceId={invoiceId} />;
}
