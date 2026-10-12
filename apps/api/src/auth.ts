import { sign, verify } from "hono/jwt";
import { createMiddleware } from "hono/factory";
import type { Role } from "@prisma/client";
import { env } from "./env";

export type AuthUser = { id: string; role: Role };
export type AppEnv = { Variables: { user: AuthUser } };

export const signToken = (u: AuthUser) =>
  sign(
    {
      sub: u.id,
      role: u.role,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
    },
    env.JWT_SECRET,
    "HS256",
  );

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer "))
    return c.json({ error: "Unauthorized" }, 401);
  try {
    const payload = await verify(header.slice(7), env.JWT_SECRET, "HS256");
    c.set("user", { id: payload.sub as string, role: payload.role as Role });
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
  await next();
});

const rank: Record<Role, number> = { VIEWER: 1, RESPONDER: 2, ADMIN: 3 };

export const hasRole = (user: AuthUser, min: Role) =>
  rank[user.role] >= rank[min];
