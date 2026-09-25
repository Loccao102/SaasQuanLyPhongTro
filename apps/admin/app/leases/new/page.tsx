import { Suspense } from "react";
import { LeaseCreateClient } from "./lease-create-client";

export default function NewLeasePage() {
  return (
    <Suspense fallback={<div className="admin-state">Đang tải trang tạo hợp đồng…</div>}>
      <LeaseCreateClient />
    </Suspense>
  );
}

