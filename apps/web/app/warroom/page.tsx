"use client";

import "./warroom.css";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useApp, useEvent } from "@/components/Providers";
import type { Severity, Status } from "@/lib/types";

/* ───────────────────────── types & constants ───────────────────────── */

type Win = "1h" | "24h" | "7d" | "30d";
const WINDOWS: Win[] = ["1h", "24h", "7d", "30d"];
const SEVS: Severity[] = ["SEV1", "SEV2", "SEV3", "SEV4"];
const WINDOW_MS: Record<Win, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
};

type Inc = {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  status: Status;
  service: string;
  createdAt: string;
  resolvedAt: string | null;
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
type Tile = { bg: string; fg: string };
const SEV_TILE: Record<string, Tile> = {
  SEV1: { bg: "var(--s1-bg)", fg: "var(--s1-fg)" },
  SEV2: { bg: "var(--s2-bg)", fg: "var(--s2-fg)" },
  SEV3: { bg: "var(--s3-bg)", fg: "var(--s3-fg)" },
  SEV4: { bg: "var(--s4-bg)", fg: "var(--s4-fg)" },
};
const DONE_TILE: Tile = { bg: "var(--ok-bg)", fg: "var(--ok-fg)" };
const AVATAR_TILES: Tile[] = [
  SEV_TILE.SEV3,
  DONE_TILE,
  SEV_TILE.SEV4,
  SEV_TILE.SEV2,
  SEV_TILE.SEV1,
];
const SEV_RANK: Record<string, number> = { SEV1: 1, SEV2: 2, SEV3: 3, SEV4: 4 };
const STATUS_ORDER: Status[] = [
  "OPEN",
  "INVESTIGATING",
  "IDENTIFIED",
  "MONITORING",
  "RESOLVED",
];

const tileFor = (severity: Severity, status?: Status | null): Tile =>
  status === "RESOLVED" ? DONE_TILE : SEV_TILE[severity];

/* ───────────────────────────── icons ───────────────────────────── */

const PATHS = {
  search: "M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.3-4.3",
  refresh: "M20 11a8 8 0 10-2.3 5.7M20 4v7h-7",
  plus: "M12 5v14M5 12h14",
  alert: "M12 3l10 18H2zM12 10v5M12 18h.01",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  check: "M5 12l5 5L20 7",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z",
  target: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8z",
  close: "M6 6l12 12M18 6L6 18",
} as const;
type IconName = keyof typeof PATHS;

const STATUS_ICON: Record<Status, IconName> = {
  OPEN: "alert",
  INVESTIGATING: "activity",
  IDENTIFIED: "target",
  MONITORING: "eye",
  RESOLVED: "check",
};

function Icon({ n, size = 18 }: { n: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[n]} />
    </svg>
  );
}

/* ───────────────────────────── helpers ───────────────────────────── */

const sevLabel = (s: string) => s.replace("SEV", "SEV-");
const shortId = (id: string) => `INC-${id.slice(-4).toUpperCase()}`;
const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const initials = (n: string) =>
  n
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const hhmm = (iso: string | number | Date) =>
  new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const axisLabel = (ms: number, win: Win) =>
  win === "1h" || win === "24h"
    ? hhmm(ms)
    : new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });

function fmtDur(ms: number | null): { v: string; u: string } {
  if (ms === null) return { v: "—", u: "" };
  const s = ms / 1000;
  if (s < 60) return { v: String(Math.round(s)), u: "sec" };
  const m = s / 60;
  if (m < 60)
    return { v: m < 10 ? m.toFixed(1) : String(Math.round(m)), u: "min" };
  const h = m / 60;
  if (h < 24) return { v: h.toFixed(1), u: "h" };
  return { v: (h / 24).toFixed(1), u: "d" };
}

function bucketize(
  items: Inc[],
  pick: (i: Inc) => string | null,
  endMs: number,
  spanMs: number,
  n = 16,
) {
  const out = new Array<number>(n).fill(0);
  const start = endMs - spanMs;
  for (const i of items) {
    const t = pick(i);
    if (!t) continue;
    const ms = new Date(t).getTime();
    if (ms < start || ms > endMs) continue;
    out[Math.min(n - 1, Math.floor(((ms - start) / spanMs) * n))]++;
  }
  return out;
}

function bucketMttr(items: Inc[], endMs: number, spanMs: number, n = 16) {
  const sum = new Array<number>(n).fill(0);
  const cnt = new Array<number>(n).fill(0);
  const start = endMs - spanMs;
  for (const i of items) {
    if (!i.resolvedAt) continue;
    const r = new Date(i.resolvedAt).getTime();
    if (r < start || r > endMs) continue;
    const idx = Math.min(n - 1, Math.floor(((r - start) / spanMs) * n));
    sum[idx] += r - new Date(i.createdAt).getTime();
    cnt[idx]++;
  }
  return sum.map((s, k) => (cnt[k] ? s / cnt[k] : 0));
}

function smooth(pts: [number, number][]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}

/** Ids that appeared after the first load, kept briefly so they can highlight. */
function useFresh(ids: string[], ready: boolean, resetKey: string) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const key = ids.join("|");

  useEffect(() => {
    seen.current = null;
  }, [resetKey]);

  useEffect(() => {
    if (!ready) return;
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const known = seen.current;
    const added = ids.filter((x) => !known.has(x));
    for (const x of ids) known.add(x);
    if (added.length === 0) return;
    setFresh(new Set(added));
    const t = setTimeout(() => setFresh(new Set()), 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  return fresh;
}

/* ─────────────────────────── components ─────────────────────────── */

function Metric({ label, v, u }: { label: string; v: ReactNode; u?: string }) {
  return (
    <div className="m">
      <div className="ml">{label}</div>
      <div className="mv">
        {v}
        {u ? <small>{u}</small> : null}
      </div>
    </div>
  );
}

function Bars({ values }: { values: number[] }) {
  const max = Math.max(0, ...values);
  const top = values.indexOf(max);
  return (
    <div className="bars">
      {values.map((v, k) => (
        <i
          key={k}
          className={v === 0 ? "zero" : k === top ? "peak" : ""}
          style={
            {
              "--h": `${v === 0 ? 3 : 14 + (v / Math.max(1, max)) * 86}%`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function Line({ values }: { values: number[] }) {
  const W = 400;
  const H = 110;
  const pad = 12;
  const max = Math.max(0, ...values);
  const pts = values.map(
    (v, i) =>
      [
        (i / Math.max(1, values.length - 1)) * W,
        H - pad - (v / Math.max(1, max)) * (H - pad * 2),
      ] as [number, number],
  );
  const path = smooth(pts);
  const peak = values.indexOf(max);
  const [px, py] = pts[peak] ?? [0, H];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="line" aria-hidden>
      <path
        d={`${path} L${W},${H} L0,${H} Z`}
        fill="currentColor"
        opacity="0.07"
      />
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {max > 0 && (
        <>
          <line
            x1={px}
            x2={px}
            y1={py}
            y2={H}
            className="dash"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={px} cy={py} r="4" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

function ReportModal({
  services,
  onClose,
  onDone,
}: {
  services: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [service, setService] = useState("");
  const [severity, setSeverity] = useState<Severity>("SEV3");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/incidents", {
        method: "POST",
        json: { title, service, severity, description },
      });
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to report incident",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="m-head">
          <h3>Report an incident</h3>
          <button
            type="button"
            className="m-x"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon n="close" size={16} />
          </button>
        </div>
        <label>
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            minLength={3}
            required
            autoFocus
          />
        </label>
        <div className="m-two">
          <label>
            Service
            <input
              value={service}
              onChange={(e) => setService(e.target.value)}
              list="svc-list"
              placeholder="checkout, payments…"
              required
            />
            <datalist id="svc-list">
              {services.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </label>
          <label>
            Severity
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
            >
              {SEVS.map((s) => (
                <option key={s} value={s}>
                  {sevLabel(s)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          What&apos;s happening?
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </label>
        {error && <div className="m-err">{error}</div>}
        <button className="btn-ink" disabled={busy}>
          {busy ? "Reporting…" : "Report incident"}
        </button>
      </form>
    </div>
  );
}

/* ───────────────────────────── page ───────────────────────────── */

export default function WarRoom() {
  const { me, connected } = useApp();
  const [win, setWin] = useState<Win>("24h");
  const [service, setService] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [query, setQuery] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const resetKey = `${win}|${service}|${severity}`;

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

  const freshInc = useFresh(
    (data?.incidents ?? []).map((i) => `${i.id}:${i.status}`),
    !!data,
    resetKey,
  );
  const freshFeed = useFresh(
    (data?.feed ?? []).map((f) => f.id),
    !!data,
    resetKey,
  );

  if (!data) {
    return error ? (
      <div className="error">{error}</div>
    ) : (
      <div className="wr-loading">Loading…</div>
    );
  }

  const { counts } = data;
  const sev1 = counts.bySeverity.SEV1 ?? 0;
  const sev2 = counts.bySeverity.SEV2 ?? 0;
  const other = Math.max(0, counts.active - sev1 - sev2);

  const active = data.incidents
    .filter((i) => i.status !== "RESOLVED")
    .sort(
      (a, b) =>
        SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  const resolved = data.incidents
    .filter((i) => i.status === "RESOLVED")
    .slice(0, 6);
  const firstSev1 = active.find((i) => i.severity === "SEV1");

  const q = query.trim().toLowerCase();
  const rows = [...active, ...resolved].filter(
    (i) =>
      !q ||
      i.title.toLowerCase().includes(q) ||
      i.service.toLowerCase().includes(q) ||
      shortId(i.id).toLowerCase().includes(q),
  );
  const sel = rows.find((r) => r.id === selId) ?? rows[0] ?? null;
  const latest = sel
    ? data.feed.find((f) => f.incident.id === sel.id)
    : undefined;

  const mine = me ? active.filter((i) => i.assignee?.id === me.id).length : 0;
  const unassigned = active.filter((i) => !i.assignee).length;
  const firstName = (me?.name ?? "there").split(/\s+/)[0];
  const hour = now.getHours();
  const hello =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const mtta = fmtDur(data.mtta);
  const mttr = fmtDur(data.mttr);
  const streak = data.lastSev1At
    ? Math.floor(
        (now.getTime() - new Date(data.lastSev1At).getTime()) / 86_400_000,
      )
    : null;

  const endMs = new Date(data.generatedAt).getTime();
  const span = WINDOW_MS[win];
  const barsCreated = bucketize(
    data.incidents,
    (i) => i.createdAt,
    endMs,
    span,
  );
  const lineMttr = bucketMttr(data.incidents, endMs, span);

  const nodes = data.nodes;
  const svcCritical = nodes.filter(
    (n) => n.worst === "SEV1" || n.worst === "SEV2",
  ).length;
  const svcAffected = nodes.filter((n) => n.active > 0).length;
  const svcDegraded = svcAffected - svcCritical;
  const svcHealthy = nodes.length - svcAffected;

  const responders = [...data.responders].sort(
    (a, b) => b.activeAssigned - a.activeAssigned,
  );
  const canReport = !!me && me.role !== "VIEWER";

  const dow = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow);
  const week = Array.from({ length: 7 }, (_, k) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + k);
    return d;
  });

  return (
    <div className="wr">
      {/* ───────── main column ───────── */}
      <main className="center">
        <div className="toolbar">
          <div className="search">
            <Icon n="search" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search incidents or services"
            />
          </div>
          <div className="seg" role="group" aria-label="Severity">
            <button
              className={severity === "" ? "on" : ""}
              onClick={() => setSeverity("")}
            >
              All
            </button>
            {SEVS.map((s) => (
              <button
                key={s}
                className={severity === s ? "on" : ""}
                onClick={() => setSeverity(severity === s ? "" : s)}
              >
                {sevLabel(s)}
              </button>
            ))}
          </div>
          <select
            className="dd"
            value={service}
            onChange={(e) => setService(e.target.value)}
            aria-label="Service"
          >
            <option value="">All services</option>
            {data.services.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="dd"
            value={win}
            onChange={(e) => setWin(e.target.value as Win)}
            aria-label="Window"
          >
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                {w === "1h"
                  ? "Last hour"
                  : w === "24h"
                    ? "Last 24 hours"
                    : w === "7d"
                      ? "Last 7 days"
                      : "Last 30 days"}
              </option>
            ))}
          </select>
          <button
            className="iconbtn"
            onClick={load}
            aria-label="Refresh"
            title="Refresh"
          >
            <Icon n="refresh" size={16} />
          </button>
        </div>

        <div className="greet">
          <h1 className="hello">
            {hello}, {firstName}
          </h1>
          <p className="hello-sub">
            {counts.active === 0
              ? "All systems are running clean. Nothing needs your attention right now."
              : `${plural(counts.active, "incident")} active${sev1 ? `, including ${plural(sev1, "SEV-1")}` : ""}. ${
                  mine
                    ? `${mine} ${mine === 1 ? "is" : "are"} assigned to you.`
                    : "None are assigned to you."
                }`}
          </p>
        </div>

        {firstSev1 && (
          <Link href={`/incidents/${firstSev1.id}`} className="sev1">
            <i />
            <b>SEV-1 in progress</b>
            <span>
              {firstSev1.service} · {firstSev1.title}
            </span>
            <em>Open →</em>
          </Link>
        )}

        {error && <div className="error">{error}</div>}

        {/* cards */}
        <div className="cards">
          <section
            className="card a"
            style={{ "--c": "var(--clay)" } as CSSProperties}
          >
            <h2>Active incidents</h2>
            <div className="metrics">
              <Metric label="SEV-1 · critical" v={sev1} />
              <Metric label="SEV-2 · major" v={sev2} />
              <Metric label="SEV-3/4 · minor" v={other} />
            </div>
            {barsCreated.some((v) => v > 0) ? (
              <>
                <Bars values={barsCreated} />
                <div className="axis">
                  <span>{axisLabel(endMs - span, win)}</span>
                  <span>Reported · now</span>
                </div>
              </>
            ) : (
              <div className="nodata">
                No new incidents reported in this window.
              </div>
            )}
          </section>
          <section
            className="card b"
            style={{ "--c": "var(--lilac)" } as CSSProperties}
          >
            <h2>Response times</h2>
            <div className="metrics">
              <Metric label="MTTA · first response" v={mtta.v} u={mtta.u} />
              <Metric label="MTTR · to resolve" v={mttr.v} u={mttr.u} />
              <Metric label={`Resolved · ${win}`} v={counts.resolved} />
            </div>
            {lineMttr.some((v) => v > 0) ? (
              <>
                <Line values={lineMttr} />
                <div className="axis">
                  <span>{axisLabel(endMs - span, win)}</span>
                  <span>Time to resolve · now</span>
                </div>
              </>
            ) : (
              <div className="nodata">
                No incidents resolved in this window.
              </div>
            )}
          </section>
          <section
            className="card c"
            style={{ "--c": "var(--sage)" } as CSSProperties}
          >
            <h2>Services</h2>
            <div className="metrics">
              <Metric label="Healthy" v={svcHealthy} />
              <Metric label="Degraded" v={svcDegraded} />
              <Metric label="Critical" v={svcCritical} />
            </div>
          </section>

          <section
            className="card d"
            style={{ "--c": "var(--slate)" } as CSSProperties}
          >
            <h2>Reliability</h2>
            <div className="metrics">
              <Metric
                label="Since last SEV-1"
                v={streak === null ? "—" : streak}
                u={streak === null ? "" : streak === 1 ? "day" : "days"}
              />
              <Metric label={`Reported · ${win}`} v={counts.total} />
              <Metric label="Unassigned" v={unassigned} />
            </div>
          </section>
        </div>

        {/* list + details */}
        <div>
          <div className="lh">
            <h3>Incidents</h3>
            <span className="lh-meta">
              {rows.length} shown · {counts.active} active
            </span>
          </div>

          <div className="lists">
            <div className="rows">
              {rows.length === 0 && (
                <div className="none">No incidents match.</div>
              )}
              {rows.map((i) => {
                const t = tileFor(i.severity, i.status);
                return (
                  <button
                    key={i.id}
                    className={`irow ${sel?.id === i.id ? "sel" : ""} ${freshInc.has(`${i.id}:${i.status}`) ? "fresh" : ""}`}
                    onClick={() => setSelId(i.id)}
                  >
                    <span
                      className="ic"
                      style={{ background: t.bg, color: t.fg }}
                    >
                      <Icon n={STATUS_ICON[i.status]} size={17} />
                    </span>
                    <span className="it">
                      <b>{i.title}</b>
                      <small>
                        {i.service} · {cap(i.status)}
                      </small>
                    </span>
                    <span className="age">{timeAgo(i.createdAt)}</span>
                  </button>
                );
              })}
            </div>

            {sel ? (
              <div
                className="detail"
                style={
                  {
                    "--dc":
                      sel.status === "RESOLVED" ? "var(--sage)" : "var(--clay)",
                  } as CSSProperties
                }
              >
                <div className="d-head">
                  <div>
                    <Link href={`/incidents/${sel.id}`} className="d-title">
                      {sel.title}
                    </Link>
                    <div className="d-meta">
                      {sevLabel(sel.severity)} · {sel.service}
                    </div>
                  </div>
                  <span className="d-id">{shortId(sel.id)}</span>
                </div>
                <div className="d-tags">
                  <span className="tag">{cap(sel.status)}</span>
                  <span className="tag">{sevLabel(sel.severity)}</span>
                  <span className="tag">{sel.service}</span>
                </div>
                <dl className="d-rows">
                  <dt>Assignee</dt>
                  <dd>{sel.assignee ? sel.assignee.name : "Unassigned"}</dd>
                  <dt>Opened</dt>
                  <dd>{timeAgo(sel.createdAt)}</dd>
                  <dt>Progress</dt>
                  <dd>
                    <span className="prog">
                      {STATUS_ORDER.map((s, k) => (
                        <i
                          key={s}
                          className={
                            k <= STATUS_ORDER.indexOf(sel.status) ? "on" : ""
                          }
                        />
                      ))}
                    </span>
                  </dd>
                  <dt>Details</dt>
                  <dd className="clamp">{sel.description}</dd>
                  <dt>Latest</dt>
                  <dd>
                    {latest
                      ? `${latest.message} (${latest.author.name}, ${timeAgo(latest.createdAt)})`
                      : "No updates yet"}
                  </dd>
                </dl>
                <Link href={`/incidents/${sel.id}`} className="btn-ink inline">
                  Open incident →
                </Link>
              </div>
            ) : (
              <div
                className="detail empty"
                style={{ "--dc": "var(--row)" } as CSSProperties}
              >
                Select an incident to see its details.
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ───────── right column ───────── */}
      <aside className="aside">
        <div className="cal">
          <div className="cal-top">
            <span className="month">
              {now.toLocaleDateString([], { month: "long", year: "numeric" })}
            </span>
            <span className={`live ${connected ? "on" : ""}`}>
              <i />
              {connected ? "Live" : "Offline"}
            </span>
          </div>
          <div className="week">
            {week.map((d) => (
              <div
                key={d.toISOString()}
                className={`day ${d.toDateString() === now.toDateString() ? "today" : ""}`}
              >
                <small>
                  {d
                    .toLocaleDateString([], { weekday: "short" })
                    .slice(0, 2)
                    .toUpperCase()}
                </small>
                <span>{d.getDate()}</span>
              </div>
            ))}
          </div>
          {canReport ? (
            <button className="btn-ink" onClick={() => setModal(true)}>
              <Icon n="plus" size={16} /> Report incident
            </button>
          ) : (
            <Link href="/" className="btn-ink">
              View all incidents
            </Link>
          )}
        </div>

        <div className="team">
          <div className="team-h">Responders</div>
          {responders.length === 0 && (
            <div className="none">No responders.</div>
          )}
          {responders.map((r, k) => {
            const t = AVATAR_TILES[k % AVATAR_TILES.length];
            return (
              <div key={r.id} className="member">
                <span className="av" style={{ background: t.bg, color: t.fg }}>
                  {initials(r.name)}
                </span>
                <span className="m-name">
                  {r.name}
                  <small>{cap(r.role)}</small>
                </span>
                <span className={`m-load ${r.activeAssigned ? "busy" : ""}`}>
                  {r.activeAssigned
                    ? `${r.activeAssigned} active`
                    : "Available"}
                </span>
              </div>
            );
          })}
        </div>

        <div className="tl">
          <div className="tl-h">
            <h3>
              {now.toLocaleDateString([], { month: "short", day: "numeric" })}
            </h3>
            <span className="tl-meta">Activity timeline</span>
          </div>
          <div className="tl-list">
            <div className="nowline">
              <span>{hhmm(now)}</span>
            </div>
            {data.feed.length === 0 && (
              <div className="none">No activity yet.</div>
            )}
            {data.feed.map((f) => {
              const t = tileFor(f.incident.severity, f.toStatus);
              return (
                <Link
                  key={f.id}
                  href={`/incidents/${f.incident.id}`}
                  className={`titem ${freshFeed.has(f.id) ? "fresh" : ""}`}
                >
                  <span className="t-time">{hhmm(f.createdAt)}</span>
                  <span className="t-card">
                    <span
                      className="ic sm"
                      style={{ background: t.bg, color: t.fg }}
                    >
                      <Icon
                        n={f.toStatus ? STATUS_ICON[f.toStatus] : "activity"}
                        size={15}
                      />
                    </span>
                    <span className="t-body">
                      <b>{f.message}</b>
                      <small>
                        {f.incident.service}
                        {f.toStatus && f.fromStatus
                          ? ` · ${cap(f.fromStatus)} → ${cap(f.toStatus)}`
                          : ""}
                        {` · ${f.author.name}`}
                      </small>
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </aside>

      {modal && (
        <ReportModal
          services={data.services}
          onClose={() => setModal(false)}
          onDone={() => {
            setModal(false);
            load();
          }}
        />
      )}
    </div>
  );
}
