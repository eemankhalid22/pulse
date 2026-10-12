import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { db } from "../db";
import { requireAuth, hasRole, type AppEnv } from "../auth";
import { notificationQueue } from "../queue";

export const notificationRoutes = new OpenAPIHono<AppEnv>();
notificationRoutes.use("/notifications", requireAuth);
notificationRoutes.use("/admin/*", requireAuth);

const ok = (d: string) => ({
  description: d,
  content: { "application/json": { schema: z.any() } },
});
const sec = [{ bearerAuth: [] }];

const listMine = createRoute({
  method: "get",
  path: "/notifications",
  tags: ["Notifications"],
  security: sec,
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
  },
  responses: { 200: ok("My notifications") },
});

notificationRoutes.openapi(listMine, async (c) => {
  const { limit } = c.req.valid("query");
  const items = await db.notification.findMany({
    where: { userId: c.get("user").id },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      incident: {
        select: { id: true, title: true, severity: true, status: true },
      },
    },
  });
  return c.json(items, 200);
});

const queueStats = createRoute({
  method: "get",
  path: "/admin/queue",
  tags: ["Admin"],
  security: sec,
  responses: { 200: ok("Queue counts and failed jobs"), 403: ok("Forbidden") },
});

notificationRoutes.openapi(queueStats, async (c) => {
  if (!hasRole(c.get("user"), "ADMIN"))
    return c.json({ error: "Forbidden" }, 403);
  const [counts, failed] = await Promise.all([
    notificationQueue.getJobCounts(),
    notificationQueue.getFailed(0, 49),
  ]);
  return c.json(
    {
      counts,
      failed: failed.map((j) => ({
        id: j.id,
        attemptsMade: j.attemptsMade,
        failedReason: j.failedReason,
        finishedOn: j.finishedOn,
        data: j.data,
      })),
    },
    200,
  );
});

const retryFailed = createRoute({
  method: "post",
  path: "/admin/queue/failed/{id}/retry",
  tags: ["Admin"],
  security: sec,
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: ok("Retried"),
    403: ok("Forbidden"),
    404: ok("Not found"),
    409: ok("Job is not in failed state"),
  },
});

notificationRoutes.openapi(retryFailed, async (c) => {
  if (!hasRole(c.get("user"), "ADMIN"))
    return c.json({ error: "Forbidden" }, 403);
  const { id } = c.req.valid("param");
  const job = await notificationQueue.getJob(id);
  if (!job) return c.json({ error: "Job not found" }, 404);

  const state = await job.getState();
  if (state !== "failed") {
    return c.json(
      { error: `Job is ${state}, only failed jobs can be retried` },
      409,
    );
  }

  await job.retry("failed", { resetAttemptsMade: true });
  return c.json({ retried: id }, 200);
});
