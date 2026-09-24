import type { Metadata } from "next";
import "@propops/ui/styles.css";
import "./styles.css";
import { StaffAuthProvider } from "../components/staff-auth-provider";
import { ServiceWorkerRegistration } from "./service-worker-registration";

export const metadata: Metadata = {
  title: "Habi Staff",
  description: "Chốt chỉ số điện nước offline-first cho nhân viên vận hành.",
  applicationName: "Habi Staff",
  appleWebApp: {
    capable: true,
    title: "Habi Staff"
  }
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <ServiceWorkerRegistration />
        <StaffAuthProvider>{children}</StaffAuthProvider>
      </body>
    </html>
  );
}
