"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, getToken, setToken, WS_URL } from "@/lib/api";
import type { Me, PulseEvent } from "@/lib/types";

type Listener = (e: PulseEvent) => void;

type AppCtx = {
  me: Me | null;
  ready: boolean;
  connected: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
  subscribe: (fn: Listener) => () => void;
};

const Ctx = createContext<AppCtx | null>(null);

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside <Providers>");
  return v;
}

/** Subscribe to live events for the lifetime of the calling component. */
export function useEvent(fn: Listener) {
  const { subscribe } = useApp();
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<Listener>());

  const loadMe = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setReady(true);
      return;
    }
    try {
      setMe(await api<Me>("/auth/me"));
    } catch {
      setToken(null);
      setMe(null);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    if (ready && !me && pathname !== "/login") router.replace("/login");
  }, [ready, me, pathname, router]);

  const userId = me?.id;
  useEffect(() => {
    if (!userId) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const token = getToken();
      if (!token) return;
      ws = new WebSocket(`${WS_URL}/ws?token=${encodeURIComponent(token)}`);
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
      };
      ws.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data) as PulseEvent;
          if (e.type === "connected") return;
          listeners.current.forEach((fn) => fn(e));
        } catch {
          /* ignore non-JSON frames */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed)
          timer = setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [userId]);

  const login = useCallback(
    async (token: string) => {
      setToken(token);
      await loadMe();
      router.replace("/");
    },
    [loadMe, router],
  );

  const logout = useCallback(() => {
    setToken(null);
    setMe(null);
    router.replace("/login");
  }, [router]);

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  const value = useMemo(
    () => ({ me, ready, connected, login, logout, subscribe }),
    [me, ready, connected, login, logout, subscribe],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
