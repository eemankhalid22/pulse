import { Redis, type RedisOptions } from "ioredis";
import { env } from "./env";

export const EVENTS_CHANNEL = "pulse:events";

// family: 0 lets ioredis resolve both IPv4 and IPv6, which Railway's private network needs
export const createRedis = (opts: RedisOptions = {}) =>
  new Redis(env.REDIS_URL, { family: 0, ...opts });

export const pub = createRedis();
pub.on("error", (err) => console.error("[redis:pub]", err.message));

const u = new URL(env.REDIS_URL);
export const bullConnection = {
  host: u.hostname,
  port: Number(u.port || 6379),
  username: u.username ? decodeURIComponent(u.username) : undefined,
  password: u.password ? decodeURIComponent(u.password) : undefined,
  family: 0,
  ...(u.protocol === "rediss:" ? { tls: {} } : {}),
  maxRetriesPerRequest: null as null,
};
