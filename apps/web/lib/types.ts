export type Role = "VIEWER" | "RESPONDER" | "ADMIN";
export type Severity = "SEV1" | "SEV2" | "SEV3" | "SEV4";
export type Status =
  | "OPEN"
  | "INVESTIGATING"
  | "IDENTIFIED"
  | "MONITORING"
  | "RESOLVED";

export const SEVERITIES: Severity[] = ["SEV1", "SEV2", "SEV3", "SEV4"];
export const STATUSES: Status[] = [
  "OPEN",
  "INVESTIGATING",
  "IDENTIFIED",
  "MONITORING",
  "RESOLVED",
];

export type Me = { id: string; email: string; name: string; role: Role };
export type PersonRef = { id: string; name: string } | null;

export type Incident = {
  id: string;
  title: string;
  description: string;
  severity: Severity;
  status: Status;
  service: string;
  reporterId: string;
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  reporter?: PersonRef;
  assignee?: PersonRef;
};

export type IncidentUpdate = {
  id: string;
  incidentId: string;
  authorId: string;
  message: string;
  fromStatus: Status | null;
  toStatus: Status | null;
  createdAt: string;
  author?: { id: string; name: string };
};

export type IncidentDetail = Incident & { updates: IncidentUpdate[] };

export type NotificationItem = {
  id: string;
  incidentId: string;
  type: string;
  message: string;
  createdAt?: string;
};

export type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
};

export type QueueInfo = {
  counts: Record<string, number>;
  failed: {
    id: string;
    attemptsMade: number;
    failedReason: string;
    finishedOn: number | null;
    data: { incidentId: string; title: string; message: string };
  }[];
};

export type PulseEvent = {
  type: string;
  userId?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  ts: string;
};
