"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { fmtDate, timeAgo } from "@/lib/format";
import { useApp, useEvent } from "@/components/Providers";
import { Badge } from "@/components/Badge";
import { STATUSES, type IncidentDetail, type Status } from "@/lib/types";

export default function IncidentPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useApp();
  const [inc, setInc] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status | "">("");
  const [assignMe, setAssignMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInc(await api<IncidentDetail>(`/incidents/${id}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load incident");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEvent((e) => {
    if (e.type.startsWith("incident.") && e.data?.incident?.id === id) load();
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    setBusy(true);
    setFormError(null);
    try {
      await api(`/incidents/${id}/updates`, {
        method: "POST",
        json: {
          message,
          ...(status ? { status } : {}),
          ...(assignMe ? { assigneeId: me.id } : {}),
        },
      });
      setMessage("");
      setStatus("");
      setAssignMe(false);
      await load();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Failed to post update",
      );
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!inc) return <div className="muted">Loading…</div>;

  const canWrite = me && me.role !== "VIEWER";

  return (
    <>
      <p>
        <Link href="/" className="muted">
          ← All incidents
        </Link>
      </p>

      <div className="card">
        <div className="head">
          <Badge kind="sev" value={inc.severity} />{" "}
          <Badge kind="st" value={inc.status} />
          <span className="muted">{inc.service}</span>
        </div>
        <h1>{inc.title}</h1>
        <p>{inc.description}</p>
        <div className="muted small">
          Reported by {inc.reporter?.name ?? "—"} · {timeAgo(inc.createdAt)} ·
          Assignee: {inc.assignee?.name ?? "Unassigned"}
          {inc.resolvedAt && <> · Resolved {fmtDate(inc.resolvedAt)}</>}
        </div>
      </div>

      <div
        className="grid cols-2"
        style={{ marginTop: 16, alignItems: "start" }}
      >
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Timeline</h3>
          <div className="timeline">
            {[...inc.updates].reverse().map((u) => (
              <div key={u.id} className="tl-item">
                <div className="small">
                  <strong>{u.author?.name ?? "Unknown"}</strong>{" "}
                  <span className="muted">· {timeAgo(u.createdAt)}</span>
                </div>
                {u.toStatus && (
                  <div style={{ margin: "4px 0" }}>
                    {u.fromStatus && (
                      <>
                        <Badge kind="st" value={u.fromStatus} /> →{" "}
                      </>
                    )}
                    <Badge kind="st" value={u.toStatus} />
                  </div>
                )}
                <div>{u.message}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Post an update</h3>
          {canWrite ? (
            <form className="grid" onSubmit={submit}>
              <div>
                <label>Message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                />
              </div>
              <div>
                <label>Change status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as Status | "")}
                >
                  <option value="">No status change</option>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={assignMe}
                  onChange={(e) => setAssignMe(e.target.checked)}
                />
                Assign to me
              </label>
              {formError && <div className="error">{formError}</div>}
              <div>
                <button className="btn" disabled={busy}>
                  {busy ? "Posting…" : "Post update"}
                </button>
              </div>
            </form>
          ) : (
            <p className="muted">Viewers have read-only access.</p>
          )}
        </div>
      </div>
    </>
  );
}
