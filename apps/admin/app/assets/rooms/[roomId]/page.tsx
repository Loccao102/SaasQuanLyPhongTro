import { RoomDetailClient } from "./room-detail-client";

export default async function RoomDetailPage({
  params
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return <RoomDetailClient roomId={roomId} />;
}
