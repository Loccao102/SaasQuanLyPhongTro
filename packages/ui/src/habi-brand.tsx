import type { CSSProperties } from "react";

export function HabiMark({
  size = 40,
  className,
  style
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      style={style}
    >
      <rect width="48" height="48" rx="14" fill="#20365F" />
      <path
        d="M11.5 21.2 22.1 11.6a2.8 2.8 0 0 1 3.8 0l10.6 9.6v7.1L24 17 11.5 28.3v-7.1Z"
        fill="#4AA3BE"
      />
      <path
        d="M13.2 19.8h7.1v7.1h7.4v-7.1h7.1v17h-7.1v-6.5h-7.4v6.5h-7.1v-17Z"
        fill="#fff"
      />
    </svg>
  );
}

export function HabiBrand({
  compact = false,
  className
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={className ?? "habi-brand"}>
      <HabiMark size={compact ? 34 : 42} />
      <div className="habi-brand__copy">
        <strong>Habi</strong>
        {!compact ? <span>Nhà gọn. Việc trôi.</span> : null}
      </div>
    </div>
  );
}
