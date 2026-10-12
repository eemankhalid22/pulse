"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { NotificationItem } from "@/lib/types";
import { useApp, useEvent } from "./Providers";

type Toast = { id: number; text: string };

export function Shell({ children }: { children: React.ReactNode }) {
  const { me, ready, connected, logout } = useApp();
  const pathname = usePathname();
  const [notifs, setNotifs] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    if (!me) return;
    api<NotificationItem[]>("/notifications?limit=15")
      .then(setNotifs)
      .catch(() => {});
  }, [me]);

  useEvent((e) => {
    if (e.type !== "notification.created") return;
    const n = e.data as NotificationItem;
    setNotifs((prev) => [{ ...n, createdAt: e.ts }, ...prev].slice(0, 15));
    setUnread((u) => u + 1);
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text: n.message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  });

  if (pathname === "/login") return <>{children}</>;
  if (!ready || !me) return <div className="center muted">Loading…</div>;

  return (
    <>
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="pulse-dot" /> Pulse
        </Link>
        <nav>
          <Link href="/" className={pathname === "/" ? "active" : ""}>
            Incidents
          </Link>
          {me.role === "ADMIN" && (
            <Link
              href="/admin"
              className={pathname === "/admin" ? "active" : ""}
            >
              Admin
            </Link>
          )}
        </nav>
        <div className="spacer" />
        <span className={`conn ${connected ? "on" : "off"}`}>
          {connected ? "● Live" : "● Reconnecting"}
        </span>
        <div className="bell-wrap">
          <button
            className="btn ghost"
            onClick={() => {
              setOpen((o) => !o);
              setUnread(0);
            }}
          >
            🔔{unread > 0 && <span className="badge-count">{unread}</span>}
          </button>
          {open && (
            <div className="dropdown">
              {notifs.length === 0 && (
                <div className="muted pad">No notifications yet</div>
              )}
              {notifs.map((n) => (
                <Link
                  key={n.id}
                  href={`/incidents/${n.incidentId}`}
                  onClick={() => setOpen(false)}
                >
                  <div className="dd-item">
                    <div>{n.message}</div>
                    {n.createdAt && (
                      <div className="muted small">{timeAgo(n.createdAt)}</div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
        <span className="muted">
          {me.name} · {me.role}
        </span>
        <button className="btn ghost" onClick={logout}>
          Sign out
        </button>
      </header>
      <main className="container">{children}</main>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}
