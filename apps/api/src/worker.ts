import { Worker, type Job } from "bullmq";
import type { Notification } from "@prisma/client";
import { db } from "./db";
import { env } from "./env";
import { bullConnection } from "./redis";
import { publishEvent } from "./events";
import { NOTIFY_QUEUE, type NotifyJob } from "./queue";

async function deliver(n: Notification) {
  if (Math.random() < env.SIMULATE_FAILURE_RATE) {
    throw new Error("Simulated delivery failure");
  }
  if (env.WEBHOOK_URL) {
    const res = await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        notificationId: n.id,
        userId: n.userId,
        incidentId: n.incidentId,
        type: n.type,
        message: n.message,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
  }
}

async function processor(job: Job<NotifyJob>) {
  const d = job.data;

  const incident = await db.incident.findUnique({
    where: { id: d.incidentId },
    select: { assigneeId: true },
  });

  const recipients = await db.user.findMany({
    where: {
      id: { not: d.actorId },
      OR: [
        { role: { in: ["RESPONDER", "ADMIN"] } },
        ...(incident?.assigneeId ? [{ id: incident.assigneeId }] : []),
      ],
    },
    select: { id: true },
  });

  let failures = 0;

  for (const r of recipients) {
    // dedupeKey makes retries idempotent: already-sent notifications are skipped
    const dedupeKey = `${job.id}:${r.id}`;
    const n = await db.notification.upsert({
      where: { dedupeKey },
      update: {},
      create: {
        dedupeKey,
        userId: r.id,
        incidentId: d.incidentId,
        type: d.type,
        message: d.message,
      },
    });
    if (n.status === "SENT") continue;

    try {
      await deliver(n);
      const sent = await db.notification.update({
        where: { id: n.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          attempts: { increment: 1 },
          error: null,
        },
      });
      await publishEvent({
        type: "notification.created",
        userId: r.id,
        data: {
          id: sent.id,
          incidentId: sent.incidentId,
          type: sent.type,
          message: sent.message,
        },
      });
    } catch (err) {
      failures++;
      await db.notification.update({
        where: { id: n.id },
        data: {
          attempts: { increment: 1 },
          error: String(err instanceof Error ? err.message : err),
        },
      });
    }
  }

  if (failures > 0)
    throw new Error(`${failures} of ${recipients.length} deliveries failed`);
}

const worker = new Worker<NotifyJob>(NOTIFY_QUEUE, processor, {
  connection: bullConnection,
  concurrency: 5,
});

worker.on("completed", (job) =>
  console.log(`[worker] job ${job.id} completed`),
);

worker.on("failed", async (job, err) => {
  if (!job) return;
  const max = job.opts.attempts ?? 1;
  console.error(
    `[worker] job ${job.id} attempt ${job.attemptsMade}/${max} failed: ${err.message}`,
  );

  // Out of retries: mark leftovers FAILED and leave a permanent audit trail
  if (job.attemptsMade >= max) {
    await db.notification.updateMany({
      where: { dedupeKey: { startsWith: `${job.id}:` }, status: "PENDING" },
      data: { status: "FAILED" },
    });
    await db.auditLog.create({
      data: {
        action: "notification.job_failed",
        entityType: "Incident",
        entityId: job.data.incidentId,
        metadata: {
          jobId: job.id ?? null,
          error: err.message,
          attempts: job.attemptsMade,
        },
      },
    });
  }
});

worker.on("error", (err) => console.error("[worker] error:", err.message));

async function shutdown() {
  await worker.close();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("Pulse worker listening on queue:", NOTIFY_QUEUE);
