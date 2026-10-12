"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useApp, useEvent } from "@/components/Providers";
import { Badge } from "@/components/Badge";
import {
  SEVERITIES,
  STATUSES,
  type Incident,
  type Severity,
  type Status,
} from "@/lib/types";

function NewIncidentForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Severity>("SEV3");
  const [service, setService] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/incidents", {
        method: "POST",
        json: { title, description, severity, service },
      });
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create incident",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card grid" onSubmit={submit} style={{ marginTop: 12 }}>
      <div className="grid cols-2">
        <div>
          <label>Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            minLength={3}
            required
          />
        </div>
        <div>
          <label>Service</label>
          <input
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="payments, checkout, auth…"
            required
          />
        </div>
      </div>
      <div>
        <label>Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>
      <div>
        <label>Severity</label>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity)}
        >
          {SEVERITIES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {error && <div className="error">{error}</div>}
      <div>
        <button className="btn" disabled={busy}>
          {busy ? "Reporting…" : "Report incident"}
        </button>
      </div>
    </form>
  );
}

export default function Dashboard() {
  const { me } = useApp();
  const [items, setItems] = useState<Incident[]>([]);
  const [status, setStatus] = useState<Status | "">("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ limit: "50" });
    if (status) qs.set("status", status);
    if (severity) qs.set("severity", severity);
    try {
      const res = await api<{ items: Incident[]; nextCursor: string | null }>(
        `/incidents?${qs}`,
      );
      setItems(res.items);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load incidents");
    } finally {
      setLoading(false);
    }
  }, [status, severity]);

  useEffect(() => {
    load();
  }, [load]);

  useEvent((e) => {
    if (!e.type.startsWith("incident.")) return;
    const id = e.data?.incident?.id as string | undefined;
    if (id) {
      setFlash(id);
      setTimeout(() => setFlash((f) => (f === id ? null : f)), 2500);
    }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(load, 250);
  });

  const active = items.filter((i) => i.status !== "RESOLVED");
  const stats = [
    { l: "Active incidents", n: active.length },
    { l: "Active SEV1", n: active.filter((i) => i.severity === "SEV1").length },
    {
      l: "Investigating",
      n: items.filter((i) => i.status === "INVESTIGATING").length,
    },
    { l: "Resolved", n: items.filter((i) => i.status === "RESOLVED").length },
  ];
  const canWrite = me && me.role !== "VIEWER";

  return (
    <>
      <div className="grid cols-4">
        {stats.map((s) => (
          <div key={s.l} className="card stat">
            <div className="n">{s.n}</div>
            <div className="l">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as Status | "")}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity | "")}
        >
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <div className="spacer" />
        {canWrite && (
          <button className="btn" onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Cancel" : "+ Report incident"}
          </button>
        )}
      </div>

      {showForm && (
        <NewIncidentForm
          onDone={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading…</div>}
      {!loading && items.length === 0 && (
        <div className="muted">No incidents match.</div>
      )}

      <div className="list" style={{ marginTop: 12 }}>
        {items.map((i) => (
          <Link
            key={i.id}
            href={`/incidents/${i.id}`}
            className={`row ${flash === i.id ? "flash" : ""}`}
          >
            <Badge kind="sev" value={i.severity} />
            <Badge kind="st" value={i.status} />
            <div>
              <div className="title">{i.title}</div>
              <div className="muted small">
                {i.service} · reported by {i.reporter?.name ?? "—"}
              </div>
            </div>
            <div className="muted small">
              {i.assignee ? `→ ${i.assignee.name}` : "Unassigned"}
            </div>
            <div className="muted small">{timeAgo(i.createdAt)}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
