import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { requireAuth, hasRole, type AppEnv } from "../auth";
import { writeAudit } from "../audit";
import { dispatchIncidentChange } from "../dispatch";

export const incidentRoutes = new OpenAPIHono<AppEnv>();
incidentRoutes.use("/incidents/*", requireAuth);
incidentRoutes.use("/incidents", requireAuth);
incidentRoutes.use("/audit-logs", requireAuth);

const Severity = z.enum(["SEV1", "SEV2", "SEV3", "SEV4"]);
const Status = z.enum([
  "OPEN",
  "INVESTIGATING",
  "IDENTIFIED",
  "MONITORING",
  "RESOLVED",
]);
const ok = (d: string) => ({
  description: d,
  content: { "application/json": { schema: z.any() } },
});
const sec = [{ bearerAuth: [] }];

// ---------- Create ----------
const createIncident = createRoute({
  method: "post",
  path: "/incidents",
  tags: ["Incidents"],
  security: sec,
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            title: z.string().min(3).max(200),
            description: z.string().min(1).max(5000),
            severity: Severity,
            service: z.string().min(1).max(100),
          }),
        },
      },
    },
  },
  responses: { 201: ok("Created"), 403: ok("Forbidden") },
});

incidentRoutes.openapi(createIncident, async (c) => {
  const user = c.get("user");
  if (!hasRole(user, "RESPONDER")) return c.json({ error: "Forbidden" }, 403);
  const body = c.req.valid("json");

  const incident = await db.$transaction(async (tx) => {
    const created = await tx.incident.create({
      data: { ...body, reporterId: user.id },
    });
    await tx.incidentUpdate.create({
      data: {
        incidentId: created.id,
        authorId: user.id,
        message: "Incident reported",
        toStatus: "OPEN",
      },
    });
    await writeAudit(tx, {
      actorId: user.id,
      action: "incident.created",
      entityType: "Incident",
      entityId: created.id,
      metadata: { severity: body.severity, service: body.service },
    });
    return created;
  });

  await dispatchIncidentChange({
    type: "incident.created",
    incident,
    actorId: user.id,
    message: "Incident reported",
  });

  return c.json(incident, 201);
});

// ---------- List ----------
const listIncidents = createRoute({
  method: "get",
  path: "/incidents",
  tags: ["Incidents"],
  security: sec,
  request: {
    query: z.object({
      status: Status.optional(),
      severity: Severity.optional(),
      service: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      cursor: z.string().optional(),
    }),
  },
  responses: { 200: ok("List") },
});

incidentRoutes.openapi(listIncidents, async (c) => {
  const { status, severity, service, limit, cursor } = c.req.valid("query");
  const where: Prisma.IncidentWhereInput = {
    ...(status && { status }),
    ...(severity && { severity }),
    ...(service && { service }),
  };
  const rows = await db.incident.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    include: {
      reporter: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
    },
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return c.json(
    { items, nextCursor: hasMore ? items[items.length - 1].id : null },
    200,
  );
});

// ---------- Get one ----------
const getIncident = createRoute({
  method: "get",
  path: "/incidents/{id}",
  tags: ["Incidents"],
  security: sec,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: ok("Incident"), 404: ok("Not found") },
});

incidentRoutes.openapi(getIncident, async (c) => {
  const { id } = c.req.valid("param");
  const incident = await db.incident.findUnique({
    where: { id },
    include: {
      reporter: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      updates: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true } } },
      },
    },
  });
  if (!incident) return c.json({ error: "Not found" }, 404);
  return c.json(incident, 200);
});

// ---------- Post update / change status / assign ----------
const postUpdate = createRoute({
  method: "post",
  path: "/incidents/{id}/updates",
  tags: ["Incidents"],
  security: sec,
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            message: z.string().min(1).max(2000),
            status: Status.optional(),
            assigneeId: z.string().nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: ok("Update created"),
    403: ok("Forbidden"),
    404: ok("Not found"),
  },
});

incidentRoutes.openapi(postUpdate, async (c) => {
  const user = c.get("user");
  if (!hasRole(user, "RESPONDER")) return c.json({ error: "Forbidden" }, 403);
  const { id } = c.req.valid("param");
  const { message, status, assigneeId } = c.req.valid("json");

  const current = await db.incident.findUnique({ where: { id } });
  if (!current) return c.json({ error: "Not found" }, 404);

  const statusChanged = !!status && status !== current.status;

  const result = await db.$transaction(async (tx) => {
    const incident = await tx.incident.update({
      where: { id },
      data: {
        ...(statusChanged && {
          status,
          resolvedAt: status === "RESOLVED" ? new Date() : null,
        }),
        ...(assigneeId !== undefined && { assigneeId }),
      },
    });
    const update = await tx.incidentUpdate.create({
      data: {
        incidentId: id,
        authorId: user.id,
        message,
        fromStatus: statusChanged ? current.status : null,
        toStatus: statusChanged ? status : null,
      },
    });
    await writeAudit(tx, {
      actorId: user.id,
      action: statusChanged ? "incident.status_changed" : "incident.updated",
      entityType: "Incident",
      entityId: id,
      metadata: {
        ...(statusChanged && { from: current.status, to: status }),
        ...(assigneeId !== undefined && { assigneeId }),
      },
    });
    return { incident, update };
  });

  await dispatchIncidentChange({
    type: statusChanged ? "incident.status_changed" : "incident.updated",
    incident: result.incident,
    actorId: user.id,
    message,
    update: result.update,
  });

  return c.json(result, 201);
});

// ---------- Audit logs (admin) ----------
const listAudit = createRoute({
  method: "get",
  path: "/audit-logs",
  tags: ["Audit"],
  security: sec,
  request: {
    query: z.object({
      entityType: z.string().optional(),
      entityId: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  },
  responses: { 200: ok("Audit logs"), 403: ok("Forbidden") },
});

incidentRoutes.openapi(listAudit, async (c) => {
  if (!hasRole(c.get("user"), "ADMIN"))
    return c.json({ error: "Forbidden" }, 403);
  const { entityType, entityId, limit } = c.req.valid("query");
  const logs = await db.auditLog.findMany({
    where: { ...(entityType && { entityType }), ...(entityId && { entityId }) },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: { select: { id: true, name: true, email: true } } },
  });
  return c.json(logs, 200);
});
