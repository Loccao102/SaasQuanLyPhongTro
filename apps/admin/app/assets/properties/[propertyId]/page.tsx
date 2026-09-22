import { PropertyDetailClient } from "./property-detail-client";

export default async function PropertyDetailPage({
  params
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  return <PropertyDetailClient propertyId={propertyId} />;
}
