"use client";

import "./warroom.css";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useApp, useEvent } from "@/components/Providers";
import type { Severity, Status } from "@/lib/types";

type Win = "1h" | "24h" | "7d" | "30d";
const WINDOWS: Win[] = ["1h", "24h", "7d", "30d"];
const SEVS: Severity[] = ["SEV1", "SEV2", "SEV3", "SEV4"];

type Inc = {
  id: string;
  title: string;
  severity: Severity;
  status: Status;
  service: string;
  createdAt: string;
  assignee: { id: string; name: string } | null;
};
type MapNode = {
  service: string;
  active: number;
  total: number;
  worst: Severity | null;
};
type FeedItem = {
  id: string;
  message: string;
  fromStatus: Status | null;
  toStatus: Status | null;
  createdAt: string;
  author: { name: string };
  incident: { id: string; title: string; severity: Severity; service: string };
};
type Stats = {
  generatedAt: string;
  counts: {
    active: number;
    bySeverity: Record<string, number>;
    resolved: number;
    total: number;
  };
  mtta: number | null;
  mttr: number | null;
  lastSev1At: string | null;
  services: string[];
  nodes: MapNode[];
  incidents: Inc[];
  responders: {
    id: string;
    name: string;
    role: string;
    activeAssigned: number;
  }[];
  feed: FeedItem[];
};

const SEV_COLOR: Record<string, string> = {
  SEV1: "#ef4444",
  SEV2: "#f97316",
  SEV3: "#eab308",
  SEV4: "#3b82f6",
  OK: "#22c55e",
};
const STATUS_COLOR: Record<Status, string> = {
  OPEN: "#ef4444",
  INVESTIGATING: "#f97316",
  IDENTIFIED: "#a855f7",
  MONITORING: "#3b82f6",
  RESOLVED: "#22c55e",
};

const sevLabel = (s: string) => s.replace("SEV", "SEV-");
const shortId = (id: string) => `INC-${id.slice(-4).toUpperCase()}`;
const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function fmtDur(ms: number | null) {
  if (ms === null) return { v: "—", u: "" };
  const s = ms / 1000;
  if (s < 60) return { v: String(Math.round(s)), u: "s" };
  const m = s / 60;
  if (m < 60)
    return { v: m < 10 ? m.toFixed(1) : String(Math.round(m)), u: "m" };
  const h = m / 60;
  if (h < 24) return { v: h.toFixed(1), u: "h" };
  return { v: (h / 24).toFixed(1), u: "d" };
}

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

function ServiceMap({
  nodes,
  selected,
  onSelect,
  onHover,
}: {
  nodes: MapNode[];
  selected: string;
  onSelect: (s: string) => void;
  onHover: (n: MapNode | null) => void;
}) {
  const W = 640;
  const H = 360;
  const n = nodes.length;
  if (n === 0)
    return (
      <div className="muted pad">
        No services yet. Report an incident to see it here.
      </div>
    );

  const cols = Math.min(n, Math.max(2, Math.ceil(Math.sqrt((n * W) / H))));
  const rows = Math.ceil(n / cols);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="map-svg"
      role="img"
      aria-label="Service health map"
    >
      {nodes.map((node, idx) => {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        const inRow = r === rows - 1 ? n - r * cols : cols;
        const x = ((c + 0.5) * W) / inRow;
        const y = ((r + 0.5) * H) / rows;
        const color = SEV_COLOR[node.worst ?? "OK"];
        const hot = node.worst === "SEV1" || node.worst === "SEV2";
        return (
          <g
            key={node.service}
            className={`map-node ${selected === node.service ? "sel" : ""}`}
            transform={`translate(${x} ${y})`}
            onMouseEnter={() => onHover(node)}
            onMouseLeave={() => onHover(null)}
            onClick={() =>
              onSelect(selected === node.service ? "" : node.service)
            }
          >
            {hot && (
              <circle r="30" className="ring" stroke={color} fill="none" />
            )}
            <circle
              r="26"
              fill={color}
              fillOpacity="0.12"
              stroke={color}
              strokeWidth="2"
            />
            <text textAnchor="middle" dy="5" className="map-count" fill={color}>
              {node.active > 0 ? node.active : "✓"}
            </text>
            <text textAnchor="middle" y="46" className="map-label">
              {node.service.length > 14
                ? node.service.slice(0, 13) + "…"
                : node.service}
            </text>
            <text textAnchor="middle" y="60" className="map-sub">
              {node.total} in window
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function WarRoom() {
  const { connected } = useApp();
  const [win, setWin] = useState<Win>("24h");
  const [service, setService] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [hover, setHover] = useState<MapNode | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ window: win });
    if (service) qs.set("service", service);
    if (severity) qs.set("severity", severity);
    try {
      setData(await api<Stats>(`/stats?${qs}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load stats");
    }
  }, [win, service, severity]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEvent((e) => {
    if (!e.type.startsWith("incident.")) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(load, 250);
  });

  if (!data) {
    return error ? (
      <div className="error">{error}</div>
    ) : (
      <div className="muted">Loading war room…</div>
    );
  }

  const { counts } = data;
  const sev1 = counts.bySeverity.SEV1 ?? 0;
  const sev2 = counts.bySeverity.SEV2 ?? 0;
  const critical = sev1 + sev2;
  const mtta = fmtDur(data.mtta);
  const mttr = fmtDur(data.mttr);
  const streak = data.lastSev1At
    ? Math.floor(
        (now.getTime() - new Date(data.lastSev1At).getTime()) / 86_400_000,
      )
    : null;

  const breakdown = SEVS.filter((s) => (counts.bySeverity[s] ?? 0) > 0)
    .map((s) => `${counts.bySeverity[s]} ${sevLabel(s)}`)
    .join(" · ");

  const groups: { status: Status; label: string }[] = [
    { status: "OPEN", label: "Triggered" },
    { status: "INVESTIGATING", label: "Investigating" },
    { status: "IDENTIFIED", label: "Identified" },
    { status: "MONITORING", label: "Monitoring" },
    { status: "RESOLVED", label: "Resolved" },
  ];

  return (
    <div className="wr">
      {/* Header */}
      <div className="wr-head">
        <div>
          <h1>Incident War Room</h1>
          <div className="eyebrow">LIVE · INCIDENT &amp; RESPONSE</div>
        </div>
        <div className={`pill ${critical === 0 ? "ok" : "bad"}`}>
          <span className="dot" />
          {critical === 0
            ? `All systems nominal · ${sev1} ${sevLabel("SEV1")}`
            : `${counts.active} active · ${sev1} ${sevLabel("SEV1")} · ${sev2} ${sevLabel("SEV2")}`}
        </div>
        <div className="spacer" />
        <div className="clock">
          {now.toISOString().slice(11, 19)} <span className="muted">UTC</span>
        </div>
      </div>

      {/* Filters */}
      <div className="filters">
        <div className="group">
          <span className="eyebrow">FILTER</span>
          <button
            className={`chip ${service === "" ? "on" : ""}`}
            onClick={() => setService("")}
          >
            All services
          </button>
          {data.services.map((s) => (
            <button
              key={s}
              className={`chip ${service === s ? "on" : ""}`}
              onClick={() => setService(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="group">
          <span className="eyebrow">SEVERITY</span>
          {SEVS.map((s) => (
            <button
              key={s}
              className={`chip ${severity === s ? "on" : ""}`}
              onClick={() => setSeverity(severity === s ? "" : s)}
            >
              {sevLabel(s)}
            </button>
          ))}
        </div>
        <div className="group right">
          <span className="eyebrow">WINDOW</span>
          <div className="seg">
            {WINDOWS.map((w) => (
              <button
                key={w}
                className={win === w ? "on" : ""}
                onClick={() => setWin(w)}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {/* Stat cards */}
      <div className="stats">
        <div className="panel stat-card">
          <div className="eyebrow">ACTIVE INCIDENTS</div>
          <div
            className="big"
            style={{ color: counts.active ? SEV_COLOR.SEV2 : SEV_COLOR.OK }}
          >
            {counts.active}
          </div>
          <div className="sub">{breakdown || "All clear"}</div>
        </div>
        <div className="panel stat-card">
          <div className="eyebrow">MTTA</div>
          <div className="big">
            {mtta.v}
            <span className="unit">{mtta.u}</span>
          </div>
          <div className="sub">time to first response</div>
        </div>
        <div className="panel stat-card">
          <div className="eyebrow">MTTR</div>
          <div className="big">
            {mttr.v}
            <span className="unit">{mttr.u}</span>
          </div>
          <div className="sub">time to resolve · {win}</div>
        </div>
        <div className="panel stat-card">
          <div className="eyebrow">RESOLVED</div>
          <div className="big" style={{ color: SEV_COLOR.OK }}>
            {counts.resolved}
          </div>
          <div className="sub">
            of {counts.total} reported · {win}
          </div>
        </div>
        <div className="panel stat-card">
          <div className="eyebrow">RELIABILITY STREAK</div>
          <div className="big">
            {streak ?? "—"}
            <span className="unit">{streak === null ? "" : "d"}</span>
          </div>
          <div className="sub">
            {streak === null ? "no SEV-1 on record" : "since last SEV-1"}
          </div>
        </div>
      </div>

      {/* Responders */}
      <div className="panel">
        <div className="panel-head">
          <span className="eyebrow strong">RESPONDERS</span>
          <span className="live-tag">● ASSIGNED LOAD</span>
        </div>
        <div className="responders">
          {data.responders.map((r) => (
            <div key={r.id} className="responder">
              <div className="avatar">{initials(r.name)}</div>
              <div>
                <div className="name">{r.name}</div>
                <div className="muted small">
                  {r.role.toLowerCase()} ·{" "}
                  <span
                    style={{
                      color: r.activeAssigned ? SEV_COLOR.SEV2 : SEV_COLOR.OK,
                    }}
                  >
                    {r.activeAssigned
                      ? `${r.activeAssigned} active`
                      : "available"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main grid */}
      <div className="main-grid">
        {/* Incident board */}
        <div className="panel board">
          <div className="panel-head">
            <span className="eyebrow strong">LIVE INCIDENT BOARD</span>
            <span className="muted small">{counts.active} open</span>
          </div>
          {groups.map((g) => {
            const list = data.incidents
              .filter((i) => i.status === g.status)
              .slice(0, g.status === "RESOLVED" ? 5 : 20);
            return (
              <div key={g.status} className="group-block">
                <div className="eyebrow">{g.label.toUpperCase()}</div>
                {list.length === 0 && (
                  <div className="muted small empty">Nothing here</div>
                )}
                {list.map((i) => (
                  <Link
                    key={i.id}
                    href={`/incidents/${i.id}`}
                    className="inc-card"
                    style={{ borderLeftColor: SEV_COLOR[i.severity] }}
                  >
                    <div className="inc-top">
                      <span
                        className="sev-tag"
                        style={{
                          color: SEV_COLOR[i.severity],
                          borderColor: SEV_COLOR[i.severity],
                        }}
                      >
                        {sevLabel(i.severity)}
                      </span>
                      <span className="muted small mono">{shortId(i.id)}</span>
                      <span
                        className="status-tag"
                        style={{ color: STATUS_COLOR[i.status] }}
                      >
                        {i.status}
                      </span>
                    </div>
                    <div className="inc-title">
                      {i.service} · {i.title}
                    </div>
                    <div className="inc-foot muted small">
                      {i.assignee ? (
                        <>
                          <span className="avatar xs">
                            {initials(i.assignee.name)}
                          </span>{" "}
                          {i.assignee.name}
                        </>
                      ) : (
                        "Unassigned"
                      )}
                      <span className="spacer" />
                      {timeAgo(i.createdAt)}
                    </div>
                  </Link>
                ))}
              </div>
            );
          })}
        </div>

        {/* Service map */}
        <div className="panel map">
          <div className="panel-head">
            <span className="eyebrow strong">SERVICE HEALTH MAP</span>
            <span className="muted small">
              {data.nodes.length} services ·{" "}
              {data.nodes.filter((n) => n.active > 0).length} affected
            </span>
          </div>
          <div className="map-hint">
            {hover
              ? `${hover.service}: ${hover.active} active · ${hover.total} in window${hover.worst ? ` · worst ${sevLabel(hover.worst)}` : ""}`
              : "Hover a node for details · click to filter by service"}
          </div>
          <ServiceMap
            nodes={data.nodes}
            selected={service}
            onSelect={setService}
            onHover={setHover}
          />
          <div className="legend">
            {["OK", "SEV4", "SEV3", "SEV2", "SEV1"].map((k) => (
              <span key={k}>
                <i style={{ background: SEV_COLOR[k] }} />{" "}
                {k === "OK" ? "Healthy" : sevLabel(k)}
              </span>
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div className="panel timeline-panel">
          <div className="panel-head">
            <span className="eyebrow strong">INCIDENT TIMELINE</span>
            <span className={`live-tag ${connected ? "" : "off"}`}>
              {connected ? "● STREAMING" : "● RECONNECTING"}
            </span>
          </div>
          <div className="feed">
            {data.feed.length === 0 && (
              <div className="muted small">No activity yet.</div>
            )}
            {data.feed.map((f) => {
              const kind =
                f.message === "Incident reported"
                  ? "NEW"
                  : f.toStatus
                    ? "STATUS"
                    : "UPDATE";
              const color = f.toStatus
                ? STATUS_COLOR[f.toStatus]
                : SEV_COLOR[f.incident.severity];
              return (
                <Link
                  key={f.id}
                  href={`/incidents/${f.incident.id}`}
                  className="feed-item"
                >
                  <span className="feed-time mono">{hhmm(f.createdAt)}</span>
                  <span className="feed-dot" style={{ background: color }} />
                  <div className="feed-body">
                    <div className="feed-kind" style={{ color }}>
                      {kind}
                      {f.toStatus && f.fromStatus
                        ? ` · ${f.fromStatus} → ${f.toStatus}`
                        : ""}
                    </div>
                    <div className="feed-msg">{f.message}</div>
                    <div className="muted small">
                      {f.incident.service} · {f.author.name}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
