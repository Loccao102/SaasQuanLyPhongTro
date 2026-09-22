"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { StatusBadge } from "@propops/ui";
import {
  cmsGlobalSearchApi,
  type CmsGlobalSearchItem,
  type CmsGlobalSearchResult
} from "../../lib/cms-global-search-api";

function tone(status: string) {
  if (["ACTIVE", "PAID", "ALLOCATED", "SENT", "HEALTHY"].includes(status)) {
    return "success" as const;
  }
  if (
    [
      "OPEN",
      "PARTIALLY_PAID",
      "UNALLOCATED",
      "REVIEW_REQUIRED",
      "QUEUED",
      "RUNNING",
      "RETRY_WAIT",
      "MANUAL_REVIEW"
    ].includes(status)
  ) {
    return "warning" as const;
  }
  if (["FAILED", "VOID", "SUSPENDED", "CANCELLED"].includes(status)) {
    return "danger" as const;
  }
  return "neutral" as const;
}

function kindLabel(kind: CmsGlobalSearchItem["kind"]): string {
  switch (kind) {
    case "ORGANIZATION":
      return "Organization";
    case "PROVIDER_PAYMENT":
      return "Provider payment";
    case "SAAS_INVOICE":
      return "SaaS invoice";
    case "NOTIFICATION_JOB":
      return "Notification job";
  }
}

function money(value: unknown): string | null {
  if (typeof value !== "number") return null;
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(value);
}

function metadataSummary(item: CmsGlobalSearchItem): string {
  if (item.kind === "PROVIDER_PAYMENT") {
    const amount = money(item.metadata.amountVnd);
    return [
      typeof item.metadata.provider === "string"
        ? item.metadata.provider
        : null,
      amount,
      typeof item.metadata.paymentStatus === "string"
        ? item.metadata.paymentStatus
        : null
    ]
      .filter(Boolean)
      .join(" · ");
  }

  if (item.kind === "SAAS_INVOICE") {
    const amount = money(item.metadata.amountVnd);
    const dueAt =
      typeof item.metadata.dueAt === "string"
        ? new Date(item.metadata.dueAt).toLocaleString("vi-VN")
        : null;
    return [amount, dueAt ? "due " + dueAt : null]
      .filter(Boolean)
      .join(" · ");
  }

  if (item.kind === "NOTIFICATION_JOB") {
    return [
      typeof item.metadata.provider === "string"
        ? item.metadata.provider
        : null,
      typeof item.metadata.verificationState === "string"
        ? item.metadata.verificationState
        : null
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return item.reference;
}

export function GlobalSearchClient({
  initialQuery
}: {
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<CmsGlobalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const search = useCallback(async (value: string) => {
    const normalized = value.trim();
    if (normalized.length < 2) {
      setResult(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setResult(await cmsGlobalSearchApi.search(normalized));
    } catch (searchError) {
      setError(
        searchError instanceof Error
          ? searchError.message
          : "Không thể thực hiện global search."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialQuery.trim().length >= 2) {
      void search(initialQuery);
    }
  }, [initialQuery, search]);

  const counts = useMemo(() => {
    const map = new Map<CmsGlobalSearchItem["kind"], number>();
    for (const item of result?.items ?? []) {
      map.set(item.kind, (map.get(item.kind) ?? 0) + 1);
    }
    return map;
  }, [result]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized.length < 2) return;
    window.history.replaceState(
      null,
      "",
      "/search?q=" + encodeURIComponent(normalized)
    );
    void search(normalized);
  }

  async function copyId(item: CmsGlobalSearchItem) {
    try {
      await navigator.clipboard.writeText(item.id);
      setCopyNotice(kindLabel(item.kind) + " ID đã copy.");
    } catch {
      setCopyNotice("Browser không cho phép copy tự động.");
    }
  }

  return (
    <main className="directory-shell">
      <header className="directory-header">
        <div>
          <a className="directory-back" href="/">
            ← Control Plane
          </a>
          <span className="cms-eyebrow">CMS · GLOBAL SEARCH</span>
          <h1>Find operational objects</h1>
          <p>
            Tìm organization, provider payment, SaaS invoice hoặc notification
            job theo quyền hiện tại. Exact ID/reference được ưu tiên trước.
          </p>
        </div>
      </header>

      <section className="cms-panel">
        <form className="global-search-form" onSubmit={submit}>
          <label>
            ID / reference / operational identifier
            <input
              autoFocus
              value={query}
              minLength={2}
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="UUID, payment reference, provider transaction, slug, recipient…"
            />
          </label>
          <button
            className="primary-button"
            type="submit"
            disabled={query.trim().length < 2 || loading}
          >
            {loading ? "Đang tìm…" : "Search"}
          </button>
        </form>

        {result ? (
          <div className="global-search-scope">
            <span className="cms-note">
              Scopes theo quyền:
            </span>
            <StatusBadge tone={result.scopes.organizations ? "success" : "neutral"}>
              Organizations {result.scopes.organizations ? "ON" : "OFF"}
            </StatusBadge>
            <StatusBadge tone={result.scopes.billing ? "success" : "neutral"}>
              Billing {result.scopes.billing ? "ON" : "OFF"}
            </StatusBadge>
            <StatusBadge tone={result.scopes.jobs ? "success" : "neutral"}>
              Jobs {result.scopes.jobs ? "ON" : "OFF"}
            </StatusBadge>
          </div>
        ) : null}

        {copyNotice ? (
          <p className="cms-note" role="status" aria-live="polite">
            {copyNotice}
          </p>
        ) : null}

        {error ? (
          <div className="cms-state cms-state--error">
            <strong>Global search thất bại.</strong>
            <span>{error}</span>
          </div>
        ) : loading ? (
          <div className="cms-state">Đang tìm trên các operational scope…</div>
        ) : !result ? (
          <div className="cms-state">
            <strong>Nhập ít nhất 2 ký tự.</strong>
            <span>
              Có thể dùng UUID, organization slug/name, payment reference,
              provider transaction ID, campaign/job ID hoặc recipient key.
            </span>
          </div>
        ) : result.items.length === 0 ? (
          <div className="empty-state">
            Không tìm thấy object phù hợp trong các scope mà role hiện tại có
            quyền đọc.
          </div>
        ) : (
          <>
            <div className="global-search-counts">
              {(
                [
                  "ORGANIZATION",
                  "PROVIDER_PAYMENT",
                  "SAAS_INVOICE",
                  "NOTIFICATION_JOB"
                ] as const
              ).map((kind) => (
                <span className="cms-note" key={kind}>
                  {kindLabel(kind)}: {counts.get(kind) ?? 0}
                </span>
              ))}
            </div>

            <div className="cms-table-wrap">
              <table className="cms-table global-search-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Result</th>
                    <th>Status</th>
                    <th>Organization</th>
                    <th>Operational context</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => {
                    const directHref =
                      item.kind === "ORGANIZATION"
                        ? "/organizations/" + item.id
                        : item.kind === "SAAS_INVOICE"
                          ? "/billing/invoices/" + item.id
                          : null;

                    return (
                      <tr key={item.kind + ":" + item.id}>
                        <td>
                          <StatusBadge>{kindLabel(item.kind)}</StatusBadge>
                        </td>
                        <td>
                          <strong>{item.title}</strong>
                          <small>{item.reference}</small>
                          <small>{item.id}</small>
                        </td>
                        <td>
                          <StatusBadge tone={tone(item.status)}>
                            {item.status}
                          </StatusBadge>
                        </td>
                        <td>
                          {item.organization ? (
                            <>
                              <strong>{item.organization.name}</strong>
                              <small>{item.organization.id}</small>
                            </>
                          ) : (
                            "Unassigned"
                          )}
                        </td>
                        <td>{metadataSummary(item) || "—"}</td>
                        <td>
                          <div className="table-actions">
                            {directHref ? (
                              <a className="text-button" href={directHref}>
                                Mở
                              </a>
                            ) : null}
                            {item.organization &&
                            result.scopes.organizations &&
                            item.kind !== "ORGANIZATION" ? (
                              <a
                                className="text-button"
                                href={
                                  "/organizations/" +
                                  item.organization.id
                                }
                              >
                                Organization
                              </a>
                            ) : null}
                            <button
                              className="text-button"
                              type="button"
                              onClick={() => void copyId(item)}
                            >
                              Copy ID
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
