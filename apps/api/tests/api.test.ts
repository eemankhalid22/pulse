import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Redis/BullMQ are mocked so the suite only needs Postgres.
vi.mock("../src/dispatch", () => ({
  dispatchIncidentChange: vi.fn(async () => {}),
}));
vi.mock("../src/queue", () => ({
  NOTIFY_QUEUE: "notifications",
  notificationQueue: {
    getJobCounts: vi.fn(async () => ({
      waiting: 0,
      active: 0,
      completed: 3,
      failed: 1,
    })),
    getFailed: vi.fn(async () => []),
    getJob: vi.fn(),
  },
}));

import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { app } from "../src/app";
import { db } from "../src/db";
import { signToken } from "../src/auth";
import { dispatchIncidentChange } from "../src/dispatch";
import { notificationQueue } from "../src/queue";

async function call(
  path: string,
  opts: { method?: string; token?: string; json?: unknown } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.json !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(path, {
    method: opts.method ?? "GET",
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = await res.json().catch(() => null);
  return { status: res.status, body };
}

const sample = (over: Record<string, unknown> = {}) => ({
  title: "Checkout API 500s",
  description: "Spike in 500s since 14:02",
  severity: "SEV1",
  service: "checkout",
  ...over,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Actor = { id: string; token: string };
let admin: Actor;
let responder: Actor;
let viewer: Actor;

async function makeUser(role: Role): Promise<Actor> {
  const u = await db.user.create({
    data: {
      email: `${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.dev`,
      name: role,
      passwordHash: await bcrypt.hash("password123", 4),
      role,
    },
  });
  return { id: u.id, token: await signToken({ id: u.id, role }) };
}

beforeAll(async () => {
  admin = await makeUser("ADMIN");
  responder = await makeUser("RESPONDER");
  viewer = await makeUser("VIEWER");
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("health", () => {
  it("returns ok", async () => {
    const r = await call("/health");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: "ok" });
  });
});

describe("auth", () => {
  const email = `new-${Date.now()}@test.dev`;

  it("registers a viewer, rejects duplicates, and logs in", async () => {
    const reg = await call("/auth/register", {
      method: "POST",
      json: { email, name: "New User", password: "password123" },
    });
    expect(reg.status).toBe(201);
    expect(reg.body.user.role).toBe("VIEWER");
    expect(reg.body.token).toBeTruthy();

    const dup = await call("/auth/register", {
      method: "POST",
      json: { email, name: "New User", password: "password123" },
    });
    expect(dup.status).toBe(409);

    const login = await call("/auth/login", {
      method: "POST",
      json: { email, password: "password123" },
    });
    expect(login.status).toBe(200);

    const me = await call("/auth/me", { token: login.body.token });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
  });

  it("rejects wrong password with 401", async () => {
    const r = await call("/auth/login", {
      method: "POST",
      json: { email, password: "wrong-password" },
    });
    expect(r.status).toBe(401);
  });

  it("validates input", async () => {
    const r = await call("/auth/register", {
      method: "POST",
      json: { email: "not-an-email", name: "x", password: "short" },
    });
    expect(r.status).toBe(400);
  });

  it("requires a valid token", async () => {
    expect((await call("/incidents")).status).toBe(401);
    expect((await call("/incidents", { token: "garbage" })).status).toBe(401);
  });
});

describe("incidents + RBAC", () => {
  it("viewers cannot create, responders can", async () => {
    const denied = await call("/incidents", {
      method: "POST",
      token: viewer.token,
      json: sample(),
    });
    expect(denied.status).toBe(403);

    const ok = await call("/incidents", {
      method: "POST",
      token: responder.token,
      json: sample(),
    });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe("OPEN");
    expect(ok.body.reporterId).toBe(responder.id);
  });

  it("viewers can read", async () => {
    const r = await call("/incidents", { token: viewer.token });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.items)).toBe(true);
  });

  it("validates incident payloads", async () => {
    const r = await call("/incidents", {
      method: "POST",
      token: responder.token,
      json: sample({ severity: "SEV9" }),
    });
    expect(r.status).toBe(400);
  });

  it("dispatches an event and job on create", async () => {
    const r = await call("/incidents", {
      method: "POST",
      token: responder.token,
      json: sample(),
    });
    expect(dispatchIncidentChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "incident.created",
        actorId: responder.id,
      }),
    );
    const audit = await db.auditLog.findFirst({
      where: { entityId: r.body.id, action: "incident.created" },
    });
    expect(audit).not.toBeNull();
  });

  it("returns 404 for unknown incidents", async () => {
    expect(
      (await call("/incidents/does-not-exist", { token: viewer.token })).status,
    ).toBe(404);
    const r = await call("/incidents/does-not-exist/updates", {
      method: "POST",
      token: responder.token,
      json: { message: "hello" },
    });
    expect(r.status).toBe(404);
  });

  it("tracks status changes, history, resolvedAt and audit logs", async () => {
    const created = await call("/incidents", {
      method: "POST",
      token: responder.token,
      json: sample(),
    });
    const id = created.body.id;

    const inv = await call(`/incidents/${id}/updates`, {
      method: "POST",
      token: responder.token,
      json: {
        message: "Rolling back deploy",
        status: "INVESTIGATING",
        assigneeId: responder.id,
      },
    });
    expect(inv.status).toBe(201);
    expect(inv.body.incident.status).toBe("INVESTIGATING");
    expect(inv.body.incident.assigneeId).toBe(responder.id);
    expect(inv.body.update).toMatchObject({
      fromStatus: "OPEN",
      toStatus: "INVESTIGATING",
    });
    expect(dispatchIncidentChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "incident.status_changed" }),
    );

    const note = await call(`/incidents/${id}/updates`, {
      method: "POST",
      token: responder.token,
      json: { message: "Still digging" },
    });
    expect(note.body.update.fromStatus).toBeNull();
    expect(dispatchIncidentChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "incident.updated" }),
    );

    const done = await call(`/incidents/${id}/updates`, {
      method: "POST",
      token: responder.token,
      json: { message: "Fixed", status: "RESOLVED" },
    });
    expect(done.body.incident.resolvedAt).not.toBeNull();

    const detail = await call(`/incidents/${id}`, { token: viewer.token });
    expect(detail.body.updates).toHaveLength(4); // reported, investigating, note, resolved

    const actions = (
      await db.auditLog.findMany({ where: { entityId: id } })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "incident.created",
        "incident.status_changed",
        "incident.updated",
      ]),
    );
  });

  it("viewers cannot post updates", async () => {
    const created = await call("/incidents", {
      method: "POST",
      token: responder.token,
      json: sample(),
    });
    const r = await call(`/incidents/${created.body.id}/updates`, {
      method: "POST",
      token: viewer.token,
      json: { message: "nope" },
    });
    expect(r.status).toBe(403);
  });

  it("paginates with a cursor and filters by status", async () => {
    const service = `svc-${Date.now()}`;
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await call("/incidents", {
        method: "POST",
        token: responder.token,
        json: sample({ service, title: `Pagination ${i}` }),
      });
      ids.push(r.body.id);
      await sleep(15);
    }

    const p1 = await call(`/incidents?service=${service}&limit=2`, {
      token: viewer.token,
    });
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).toBeTruthy();

    const p2 = await call(
      `/incidents?service=${service}&limit=2&cursor=${p1.body.nextCursor}`,
      {
        token: viewer.token,
      },
    );
    expect(p2.body.items).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();

    const seen = new Set(
      [...p1.body.items, ...p2.body.items].map((i: { id: string }) => i.id),
    );
    expect(seen.size).toBe(3);

    await call(`/incidents/${ids[0]}/updates`, {
      method: "POST",
      token: responder.token,
      json: { message: "Fixed", status: "RESOLVED" },
    });
    const resolved = await call(
      `/incidents?service=${service}&status=RESOLVED`,
      { token: viewer.token },
    );
    expect(resolved.body.items).toHaveLength(1);
    expect(resolved.body.items[0].id).toBe(ids[0]);
  });
});

describe("audit logs", () => {
  it("is admin-only", async () => {
    expect((await call("/audit-logs", { token: responder.token })).status).toBe(
      403,
    );
    expect((await call("/audit-logs", { token: viewer.token })).status).toBe(
      403,
    );

    const created = await call("/incidents", {
      method: "POST",
      token: responder.token,
      json: sample(),
    });
    const r = await call(
      `/audit-logs?entityType=Incident&entityId=${created.body.id}`,
      { token: admin.token },
    );
    expect(r.status).toBe(200);
    expect(r.body.map((a: { action: string }) => a.action)).toContain(
      "incident.created",
    );
  });
});

describe("admin queue", () => {
  const retryUrl = "/admin/queue/failed/7/retry";

  it("is admin-only", async () => {
    expect(
      (await call("/admin/queue", { token: responder.token })).status,
    ).toBe(403);
    expect(
      (await call(retryUrl, { method: "POST", token: responder.token })).status,
    ).toBe(403);
  });

  it("returns counts", async () => {
    const r = await call("/admin/queue", { token: admin.token });
    expect(r.status).toBe(200);
    expect(r.body.counts.failed).toBe(1);
  });

  it("retry: 404 when missing, 409 when not failed, 200 when failed", async () => {
    const getJob = vi.mocked(notificationQueue.getJob);

    getJob.mockResolvedValueOnce(undefined);
    expect(
      (await call(retryUrl, { method: "POST", token: admin.token })).status,
    ).toBe(404);

    const notFailed = {
      getState: vi.fn(async () => "completed"),
      retry: vi.fn(),
    };
    getJob.mockResolvedValueOnce(notFailed as never);
    expect(
      (await call(retryUrl, { method: "POST", token: admin.token })).status,
    ).toBe(409);
    expect(notFailed.retry).not.toHaveBeenCalled();

    const failed = {
      getState: vi.fn(async () => "failed"),
      retry: vi.fn(async () => {}),
    };
    getJob.mockResolvedValueOnce(failed as never);
    const ok = await call(retryUrl, { method: "POST", token: admin.token });
    expect(ok.status).toBe(200);
    expect(failed.retry).toHaveBeenCalledWith("failed", {
      resetAttemptsMade: true,
    });
  });
});
