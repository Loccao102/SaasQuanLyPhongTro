import { ResidentsClient } from "./residents-client";

export const metadata = {
  title: "Cư dân | Habi Admin",
  description: "Quản lý hồ sơ cư dân, lịch sử hợp đồng và thông tin liên lạc."
};

export default function ResidentsPage() {
  return <ResidentsClient />;
}
