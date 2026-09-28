import type { Metadata } from "next";
import "@propops/ui/styles.css";
import "./styles.css";
import { CmsAuthGate } from "../components/cms-auth-gate";

export const metadata: Metadata = {
  title: "Habi Control Plane",
  description:
    "Habi control plane for rental operations, subscriptions, billing, automation and audit."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body>
        <CmsAuthGate>{children}</CmsAuthGate>
      </body>
    </html>
  );
}
