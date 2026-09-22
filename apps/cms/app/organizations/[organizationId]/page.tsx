import { OrganizationDetailClient } from "./organization-detail-client";

export default async function OrganizationDetailPage({
  params
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  return <OrganizationDetailClient organizationId={organizationId} />;
}
