import { RenterInvoicePrintClient } from "./renter-invoice-print-client";

export default async function RenterInvoicePrintPage({
  params,
  searchParams
}: {
  params: Promise<{ cycleId: string }>;
  searchParams: Promise<{ invoiceId?: string }>;
}) {
  const { cycleId } = await params;
  const { invoiceId } = await searchParams;
  return (
    <RenterInvoicePrintClient
      cycleId={cycleId}
      initialInvoiceId={invoiceId ?? null}
    />
  );
}
