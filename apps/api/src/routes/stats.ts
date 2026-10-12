import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { requireAuth, type AppEnv } from "../auth";

export const statsRoutes = new OpenAPIHono<AppEnv>();
statsRoutes.use("/stats", requireAuth);

const WINDOWS = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
} as const;

const rank: Record<string, number> = { SEV1: 1, SEV2: 2, SEV3: 3, SEV4: 4 };

const avg = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

const route = createRoute({
  method: "get",
  path: "/stats",
  tags: ["Stats"],
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      window: z.enum(["1h", "24h", "7d", "30d"]).default("24h"),
      service: z.string().optional(),
      severity: z.enum(["SEV1", "SEV2", "SEV3", "SEV4"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "War room stats",
      content: { "application/json": { schema: z.any() } },
    },
  },
});

statsRoutes.openapi(route, async (c) => {
  const { window: win, service, severity } = c.req.valid("query");
  const since = new Date(Date.now() - WINDOWS[win]);

  const base: Prisma.IncidentWhereInput = {
    ...(service && { service }),
    ...(severity && { severity }),
  };

  const [incidents, serviceRows, lastSev1, responders, assignedRows, feed] =
    await Promise.all([
      db.incident.findMany({
        where: {
          ...base,
          OR: [{ createdAt: { gte: since } }, { status: { not: "RESOLVED" } }],
        },
        orderBy: { createdAt: "desc" },
        take: 300,
        include: { assignee: { select: { id: true, name: true } } },
      }),
      db.incident.findMany({
        distinct: ["service"],
        select: { service: true },
        orderBy: { service: "asc" },
      }),
      db.incident.findFirst({
        where: { severity: "SEV1" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      db.user.findMany({
        where: { role: { in: ["RESPONDER", "ADMIN"] } },
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" },
      }),
      db.incident.findMany({
        where: { status: { not: "RESOLVED" }, assigneeId: { not: null } },
        select: { assigneeId: true },
      }),
      db.incidentUpdate.findMany({
        where: { incident: base },
        orderBy: { createdAt: "desc" },
        take: 25,
        include: {
          author: { select: { name: true } },
          incident: {
            select: { id: true, title: true, severity: true, service: true },
          },
        },
      }),
    ]);

  const services = serviceRows.map((r) => r.service);
  const active = incidents.filter((i) => i.status !== "RESOLVED");
  const inWindow = incidents.filter((i) => i.createdAt >= since);

  // MTTA: time from creation to the first status change away from OPEN
  const firstChanges = inWindow.length
    ? await db.incidentUpdate.findMany({
        where: {
          incidentId: { in: inWindow.map((i) => i.id) },
          fromStatus: "OPEN",
        },
        orderBy: { createdAt: "asc" },
        select: { incidentId: true, createdAt: true },
      })
    : [];
  const firstMap = new Map<string, Date>();
  for (const u of firstChanges)
    if (!firstMap.has(u.incidentId)) firstMap.set(u.incidentId, u.createdAt);
  const mtta = avg(
    inWindow
      .filter((i) => firstMap.has(i.id))
      .map((i) => firstMap.get(i.id)!.getTime() - i.createdAt.getTime()),
  );

  // MTTR: creation to resolution, for incidents resolved inside the window
  const resolved = incidents.filter(
    (i) => i.resolvedAt && i.resolvedAt >= since,
  );
  const mttr = avg(
    resolved.map((i) => i.resolvedAt!.getTime() - i.createdAt.getTime()),
  );

  const bySeverity: Record<string, number> = {
    SEV1: 0,
    SEV2: 0,
    SEV3: 0,
    SEV4: 0,
  };
  for (const i of active) bySeverity[i.severity]++;

  // One node per service for the health map
  const nodeMap = new Map<
    string,
    { service: string; active: number; total: number; worst: string | null }
  >();
  for (const s of services) {
    if (!service || s === service)
      nodeMap.set(s, { service: s, active: 0, total: 0, worst: null });
  }
  for (const i of incidents) {
    const n = nodeMap.get(i.service) ?? {
      service: i.service,
      active: 0,
      total: 0,
      worst: null,
    };
    if (i.createdAt >= since) n.total++;
    if (i.status !== "RESOLVED") {
      n.active++;
      if (!n.worst || rank[i.severity] < rank[n.worst]) n.worst = i.severity;
    }
    nodeMap.set(i.service, n);
  }

  const assignedCount = new Map<string, number>();
  for (const r of assignedRows) {
    if (r.assigneeId)
      assignedCount.set(
        r.assigneeId,
        (assignedCount.get(r.assigneeId) ?? 0) + 1,
      );
  }

  return c.json(
    {
      generatedAt: new Date().toISOString(),
      window: win,
      counts: {
        active: active.length,
        bySeverity,
        resolved: resolved.length,
        total: inWindow.length,
      },
      mtta,
      mttr,
      lastSev1At: lastSev1?.createdAt ?? null,
      services,
      nodes: [...nodeMap.values()],
      incidents: incidents.slice(0, 100),
      responders: responders.map((r) => ({
        ...r,
        activeAssigned: assignedCount.get(r.id) ?? 0,
      })),
      feed,
    },
    200,
  );
});
