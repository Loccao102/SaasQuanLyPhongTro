import { PublicInvoiceClient } from "./public-invoice-client";

export default async function PublicInvoiceTokenPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicInvoiceClient token={token} />;
}
