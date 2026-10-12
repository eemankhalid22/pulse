"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useApp } from "@/components/Providers";
import type { AuditEntry, QueueInfo } from "@/lib/types";

const msg = (e: unknown) =>
  e instanceof ApiError ? e.message : "Request failed";

export default function AdminPage() {
  const { me } = useApp();
  const isAdmin = me?.role === "ADMIN";
  const [tab, setTab] = useState<"queue" | "audit">("queue");
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [queue, setQueue] = useState<QueueInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAudit = useCallback(async () => {
    try {
      setAudit(await api<AuditEntry[]>("/audit-logs?limit=100"));
      setError(null);
    } catch (e) {
      setError(msg(e));
    }
  }, []);

  const loadQueue = useCallback(async () => {
    try {
      setQueue(await api<QueueInfo>("/admin/queue"));
      setError(null);
    } catch (e) {
      setError(msg(e));
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    loadAudit();
    loadQueue();
    const t = setInterval(() => {
      loadQueue();
      loadAudit();
    }, 5000);
    return () => clearInterval(t);
  }, [isAdmin, loadAudit, loadQueue]);

  async function retry(id: string) {
    try {
      await api(`/admin/queue/failed/${id}/retry`, { method: "POST" });
      await loadQueue();
    } catch (e) {
      setError(msg(e));
    }
  }

  if (!isAdmin) return <div className="error">Admins only.</div>;

  return (
    <>
      <div className="toolbar" style={{ marginTop: 0 }}>
        <button
          className={`btn ${tab === "queue" ? "" : "ghost"}`}
          onClick={() => setTab("queue")}
        >
          Job queue
        </button>
        <button
          className={`btn ${tab === "audit" ? "" : "ghost"}`}
          onClick={() => setTab("audit")}
        >
          Audit log
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {tab === "queue" && queue && (
        <>
          <div className="grid cols-4">
            {["waiting", "active", "completed", "failed"].map((k) => (
              <div key={k} className="card stat">
                <div className="n">{queue.counts[k] ?? 0}</div>
                <div className="l">{k}</div>
              </div>
            ))}
          </div>
          <div className="card" style={{ marginTop: 16, overflowX: "auto" }}>
            <h3 style={{ marginTop: 0 }}>Failed jobs</h3>
            {queue.failed.length === 0 ? (
              <div className="muted">No failed jobs 🎉</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Incident</th>
                    <th>Attempts</th>
                    <th>Error</th>
                    <th>Failed at</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {queue.failed.map((j) => (
                    <tr key={j.id}>
                      <td>#{j.id}</td>
                      <td>
                        <Link href={`/incidents/${j.data.incidentId}`}>
                          {j.data.title}
                        </Link>
                      </td>
                      <td>{j.attemptsMade}</td>
                      <td className="muted">{j.failedReason}</td>
                      <td className="muted">
                        {j.finishedOn
                          ? fmtDate(new Date(j.finishedOn).toISOString())
                          : "—"}
                      </td>
                      <td>
                        <button className="btn sm" onClick={() => retry(j.id)}>
                          Retry
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === "audit" && (
        <div className="card" style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="muted">{fmtDate(a.createdAt)}</td>
                  <td>{a.actor?.name ?? "system"}</td>
                  <td>
                    <code>{a.action}</code>
                  </td>
                  <td>
                    {a.entityType === "Incident" ? (
                      <Link href={`/incidents/${a.entityId}`}>Incident</Link>
                    ) : (
                      a.entityType
                    )}
                  </td>
                  <td className="muted small">
                    {a.metadata ? JSON.stringify(a.metadata) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
