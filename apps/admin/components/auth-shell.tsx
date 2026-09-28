import type { ReactNode } from "react";
import {
  ApartmentOutlined,
  FileProtectOutlined,
  LineChartOutlined
} from "@ant-design/icons";
import { HabiBrand } from "@propops/ui/habi-brand";

export function AuthShell({
  eyebrow,
  title,
  description,
  children
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-page">
      <div className="auth-layout">
        <aside className="auth-story" aria-label="Giới thiệu Habi">
          <HabiBrand className="habi-brand habi-brand--hero" />
          <div className="auth-story__copy">
            <span className="auth-story__eyebrow">HABI RENTAL OPERATIONS</span>
            <h2>Quản lý nhà trọ gọn hơn, từ một nơi.</h2>
            <p>
              Tài sản, hợp đồng, hóa đơn và dòng tiền được gom về một workspace
              dành cho chủ nhà và đội ngũ vận hành.
            </p>
          </div>
          <div className="auth-story__features">
            <div>
              <span className="auth-story__icon"><ApartmentOutlined /></span>
              <span><strong>Một workspace</strong><small>Quản lý cơ sở và phòng theo tenant.</small></span>
            </div>
            <div>
              <span className="auth-story__icon"><FileProtectOutlined /></span>
              <span><strong>Phân quyền rõ ràng</strong><small>OWNER kiểm soát đội ngũ và phạm vi truy cập.</small></span>
            </div>
            <div>
              <span className="auth-story__icon"><LineChartOutlined /></span>
              <span><strong>Theo dõi vận hành</strong><small>Nắm hợp đồng, hóa đơn và dòng tiền theo thời gian thực.</small></span>
            </div>
          </div>
          <p className="auth-story__note">
            Habi · Nhà gọn. Việc trôi.
          </p>
        </aside>

        <section className="auth-card">
          <HabiBrand className="habi-brand auth-card__brand" />
          <div className="login-heading">
            <span className="eyebrow">{eyebrow}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {children}
        </section>
      </div>
    </main>
  );
}
