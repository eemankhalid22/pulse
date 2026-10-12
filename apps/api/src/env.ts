import { z } from "@hono/zod-openapi";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3001),
  SIMULATE_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
  WEBHOOK_URL: z.string().url().optional(),
});

export const env = schema.parse(process.env);
