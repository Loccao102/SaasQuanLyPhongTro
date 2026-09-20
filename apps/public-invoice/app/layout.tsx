import type { Metadata } from "next";
import "@propops/ui/styles.css";
import "./styles.css";
export const metadata: Metadata = { title: "Hóa đơn phòng | PropOps", description: "Xem và thanh toán hóa đơn phòng." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
