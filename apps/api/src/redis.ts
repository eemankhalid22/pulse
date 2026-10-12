import { Redis } from "ioredis";
import { env } from "./env";

export const EVENTS_CHANNEL = "pulse:events";

export const pub = new Redis(env.REDIS_URL);
pub.on("error", (err) => console.error("[redis:pub]", err.message));

const u = new URL(env.REDIS_URL);

export const bullConnection = {
  host: u.hostname,
  port: Number(u.port || 6379),
  username: u.username ? decodeURIComponent(u.username) : undefined,
  password: u.password ? decodeURIComponent(u.password) : undefined,
  maxRetriesPerRequest: null as null,
};
