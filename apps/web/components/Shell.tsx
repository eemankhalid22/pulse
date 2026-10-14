"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { NotificationItem } from "@/lib/types";
import { useApp, useEvent } from "./Providers";

type Toast = { id: number; text: string };
type Theme = "dark" | "light";

function Ico({ children }: { children: ReactNode }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const BellIcon = () => (
  <Ico>
    <path d="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 003.4 0" />
  </Ico>
);
const SunIcon = () => (
  <Ico>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Ico>
);
const MoonIcon = () => (
  <Ico>
    <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
  </Ico>
);

export function Shell({ children }: { children: ReactNode }) {
  const { me, ready, connected, logout } = useApp();
  const pathname = usePathname();
  const [notifs, setNotifs] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("pulse_theme", next);
    } catch {
      /* storage unavailable */
    }
    setTheme(next);
  }

  useEffect(() => {
    if (!me) return;
    api<NotificationItem[]>("/notifications?limit=15").then(setNotifs).catch(() => {});
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
          <Link href="/warroom" className={pathname === "/warroom" ? "active" : ""}>
            War Room
          </Link>
          {me.role === "ADMIN" && (
            <Link href="/admin" className={pathname === "/admin" ? "active" : ""}>
              Admin
            </Link>
          )}
        </nav>
        <div className="spacer" />
        <span className={`conn ${connected ? "on" : "off"}`}>{connected ? "● Live" : "● Reconnecting"}</span>

        <button
          className="btn ghost icon"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>

        <div className="bell-wrap">
          <button
            className="btn ghost icon"
            aria-label="Notifications"
            onClick={() => {
              setOpen((o) => !o);
              setUnread(0);
            }}
          >
            <BellIcon />
            {unread > 0 && <span className="badge-count">{unread}</span>}
          </button>
          {open && (
            <div className="dropdown">
              {notifs.length === 0 && <div className="muted pad">No notifications yet</div>}
              {notifs.map((n) => (
                <Link key={n.id} href={`/incidents/${n.incidentId}`} onClick={() => setOpen(false)}>
                  <div className="dd-item">
                    <div>{n.message}</div>
                    {n.createdAt && <div className="muted small">{timeAgo(n.createdAt)}</div>}
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

      <main className={pathname === "/warroom" ? "container wide" : "container"}>{children}</main>

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