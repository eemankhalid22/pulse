import { z } from "@hono/zod-openapi";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3001),
});
export const env = schema.parse(process.env);
