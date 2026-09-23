import type { Metadata } from "next";
import "@propops/ui/styles.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "Habi Admin",
  description: "Vận hành tài sản, hợp đồng, hóa đơn và dòng tiền."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
