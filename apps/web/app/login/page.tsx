"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useApp } from "@/components/Providers";

const DEMO = [
  { label: "Admin", email: "admin@pulse.dev" },
  { label: "Responder", email: "responder@pulse.dev" },
  { label: "Viewer", email: "viewer@pulse.dev" },
];

export default function LoginPage() {
  const { me, ready, login } = useApp();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && me) router.replace("/");
  }, [ready, me, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string }>(
        mode === "login" ? "/auth/login" : "/auth/register",
        {
          method: "POST",
          json:
            mode === "login" ? { email, password } : { email, password, name },
        },
      );
      await login(res.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card auth" onSubmit={submit}>
        <h1 className="brand">
          <span className="pulse-dot" /> Pulse
        </h1>
        <p className="muted">
          {mode === "login" ? "Sign in to continue" : "Create a viewer account"}
        </p>

        {mode === "register" && (
          <div>
            <label>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
        )}
        <div>
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>

        {error && <div className="error">{error}</div>}

        <button className="btn" disabled={busy}>
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Register"}
        </button>

        {mode === "login" && (
          <div className="demo">
            <span className="muted small">Demo accounts (password123):</span>
            <div className="demo-btns">
              {DEMO.map((d) => (
                <button
                  type="button"
                  key={d.email}
                  className="btn ghost sm"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword("password123");
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login"
            ? "Need an account? Register"
            : "Have an account? Sign in"}
        </button>
      </form>
    </div>
  );
}
