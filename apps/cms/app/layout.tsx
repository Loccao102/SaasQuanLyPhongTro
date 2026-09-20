import type { Metadata } from "next";
import "@propops/ui/styles.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "PropOps CMS",
  description: "Internal control surface for SaaS settings, operations and audit."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
