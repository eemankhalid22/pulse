import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { signToken, requireAuth, type AppEnv } from "../auth";
import { writeAudit } from "../audit";

export const authRoutes = new OpenAPIHono<AppEnv>();

const registerRoute = createRoute({
  method: "post",
  path: "/auth/register",
  tags: ["Auth"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            email: z.string().email(),
            name: z.string().min(1).max(100),
            password: z.string().min(8).max(100),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Registered",
      content: { "application/json": { schema: z.any() } },
    },
    409: {
      description: "Email taken",
      content: { "application/json": { schema: z.any() } },
    },
  },
});

authRoutes.openapi(registerRoute, async (c) => {
  const { email, name, password } = c.req.valid("json");
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return c.json({ error: "Email already registered" }, 409);

  const user = await db.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { email, name, passwordHash: await bcrypt.hash(password, 10) },
    });
    await writeAudit(tx, {
      actorId: u.id,
      action: "user.registered",
      entityType: "User",
      entityId: u.id,
    });
    return u;
  });

  const token = await signToken({ id: user.id, role: user.role });
  return c.json(
    {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
    201,
  );
});

const loginRoute = createRoute({
  method: "post",
  path: "/auth/login",
  tags: ["Auth"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            email: z.string().email(),
            password: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Logged in",
      content: { "application/json": { schema: z.any() } },
    },
    401: {
      description: "Bad credentials",
      content: { "application/json": { schema: z.any() } },
    },
  },
});

authRoutes.openapi(loginRoute, async (c) => {
  const { email, password } = c.req.valid("json");
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return c.json({ error: "Invalid credentials" }, 401);
  }
  const token = await signToken({ id: user.id, role: user.role });
  return c.json(
    {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
    200,
  );
});

authRoutes.use("/auth/me", requireAuth);

const meRoute = createRoute({
  method: "get",
  path: "/auth/me",
  tags: ["Auth"],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: "Current user",
      content: { "application/json": { schema: z.any() } },
    },
  },
});

authRoutes.openapi(meRoute, async (c) => {
  const { id } = c.get("user");
  const user = await db.user.findUniqueOrThrow({
    where: { id },
    select: { id: true, email: true, name: true, role: true },
  });
  return c.json(user, 200);
});
