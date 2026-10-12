import type { Incident } from "@prisma/client";
import { publishEvent } from "./events";
import { notificationQueue, type ChangeType } from "./queue";

export async function dispatchIncidentChange(args: {
  type: ChangeType;
  incident: Incident;
  actorId: string;
  message: string;
  update?: unknown;
}) {
  const { type, incident, actorId, message, update } = args;

  const text =
    type === "incident.created"
      ? `New ${incident.severity} incident: ${incident.title}`
      : type === "incident.status_changed"
        ? `${incident.title} is now ${incident.status}`
        : `${incident.title}: ${message}`;

  const results = await Promise.allSettled([
    publishEvent({ type, data: { incident, update } }),
    notificationQueue.add("incident-notify", {
      incidentId: incident.id,
      type,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      message: text.slice(0, 200),
      actorId,
    }),
  ]);

  for (const r of results) {
    if (r.status === "rejected") console.error("[dispatch] failed:", r.reason);
  }
}
