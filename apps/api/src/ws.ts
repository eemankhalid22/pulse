import { createNodeWebSocket } from "@hono/node-ws";
import { createMiddleware } from "hono/factory";
import { verify } from "hono/jwt";
import type { WSContext } from "hono/ws";
import { app } from "./app";
import { env } from "./env";
import { EVENTS_CHANNEL, createRedis } from "./redis";
import type { AppEnv } from "./auth";

export const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({
  app,
});

type Client = { ws: WSContext; userId: string };
const clients = new Map<unknown, Client>();

// Browsers can't set headers on WebSocket, so the JWT comes as ?token=
const wsAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = c.req.query("token");
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  try {
    const payload = await verify(token, env.JWT_SECRET, "HS256");
    c.set("user", { id: payload.sub as string, role: payload.role as any });
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
  await next();
});

app.get(
  "/ws",
  wsAuth,
  upgradeWebSocket((c) => {
    const userId = (c.get("user") as { id: string }).id;
    return {
      onOpen(_evt, ws) {
        clients.set(ws.raw, { ws, userId });
        ws.send(
          JSON.stringify({ type: "connected", ts: new Date().toISOString() }),
        );
      },
      onMessage(evt, ws) {
        if (String(evt.data) === "ping") ws.send("pong");
      },
      onClose(_evt, ws) {
        clients.delete(ws.raw);
      },
      onError(_evt, ws) {
        clients.delete(ws.raw);
      },
    };
  }),
);

// One Redis subscriber per API process fans events out to local sockets
const sub = createRedis();
sub.on("error", (err) => console.error("[redis:sub]", err.message));
sub.subscribe(EVENTS_CHANNEL).catch((err) => console.error("[redis:sub]", err));

sub.on("message", (_channel, raw) => {
  let evt: { userId?: string };
  try {
    evt = JSON.parse(raw);
  } catch {
    return;
  }
  for (const { ws, userId } of clients.values()) {
    if (evt.userId && evt.userId !== userId) continue;
    try {
      ws.send(raw);
    } catch {
      /* socket already gone */
    }
  }
});
