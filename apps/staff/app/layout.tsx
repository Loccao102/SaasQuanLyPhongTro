import type { Metadata } from "next";
import "@propops/ui/styles.css";
import "./styles.css";
export const metadata: Metadata = { title: "PropOps Staff", description: "Ứng dụng hiện trường cho nhân viên vận hành." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
