import type { Metadata } from "next";
import "@propops/ui/styles.css";
import "./styles.css";
import { AdminAuthProvider } from "../components/admin-auth-provider";

export const metadata: Metadata = {
  title: "Habi Workspace",
  description: "Không gian vận hành nhà trọ: tài sản, hợp đồng, hóa đơn và dòng tiền."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body>
        <AdminAuthProvider>{children}</AdminAuthProvider>
      </body>
    </html>
  );
}
