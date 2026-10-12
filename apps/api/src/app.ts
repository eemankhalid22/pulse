import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authRoutes } from "./routes/auth";
import { incidentRoutes } from "./routes/incidents";
import type { AppEnv } from "./auth";
import { notificationRoutes } from "./routes/notifications";

export const app = new OpenAPIHono<AppEnv>();

app.use("*", logger());
app.use("*", cors({ origin: ["http://localhost:3000"], credentials: true }));

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/", authRoutes);
app.route("/", incidentRoutes);
app.route("/", notificationRoutes);

app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});

app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "Pulse API",
    version: "1.0.0",
    description: "Real-time incident management",
  },
});

app.get("/docs", Scalar({ url: "/openapi.json" }));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});
