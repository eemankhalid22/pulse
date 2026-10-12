import type { Prisma } from "@prisma/client";

export function writeAudit(
  tx: Prisma.TransactionClient,
  entry: {
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Prisma.InputJsonValue;
  },
) {
  return tx.auditLog.create({ data: entry });
}
