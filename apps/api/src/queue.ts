import { Queue } from "bullmq";
import { bullConnection } from "./redis";

export const NOTIFY_QUEUE = "notifications";

export type ChangeType =
  | "incident.created"
  | "incident.updated"
  | "incident.status_changed";

export type NotifyJob = {
  incidentId: string;
  type: ChangeType;
  title: string;
  severity: string;
  status: string;
  message: string;
  actorId: string;
};

export const notificationQueue = new Queue<NotifyJob>(NOTIFY_QUEUE, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 500 },
    removeOnFail: false,
  },
});
