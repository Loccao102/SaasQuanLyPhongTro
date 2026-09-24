import type { Metadata } from "next";
import "@propops/ui/styles.css";
import "./styles.css";
import { AdminAuthProvider } from "../components/admin-auth-provider";

export const metadata: Metadata = {
  title: "Habi Admin",
  description: "Vận hành tài sản, hợp đồng, hóa đơn và dòng tiền."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <AdminAuthProvider>{children}</AdminAuthProvider>
      </body>
    </html>
  );
}
