import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}

export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral"
}: {
  label: string;
  value: string;
  detail: string;
  tone?: Tone;
}) {
  return (
    <article className="metric-card">
      <div className={`metric-card__dot metric-card__dot--${tone}`} aria-hidden="true" />
      <p className="metric-card__label">{label}</p>
      <strong className="metric-card__value">{value}</strong>
      <p className="metric-card__detail">{detail}</p>
    </article>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__copy">
        {eyebrow ? <span className="page-header__eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="page-header__action">{action}</div> : null}
    </header>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const percentage = max === 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="progress-block">
      <div className="progress-block__meta">
        <span>{label}</span>
        <strong>{percentage}%</strong>
      </div>
      <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
        <span style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

export function MoneyDisplay({ amountVnd }: { amountVnd: number }) {
  return <>{new Intl.NumberFormat("vi-VN").format(amountVnd)}đ</>;
}
