import type { Metadata } from "next";
import "@propops/ui/styles.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "PropOps Control Plane",
  description:
    "PropOps SaaS control plane for operations, subscriptions, billing, automation and audit."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
