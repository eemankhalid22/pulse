import { serve } from "@hono/node-server";
import { app } from "./app";
import { injectWebSocket } from "./ws";
import { env } from "./env";

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(
    `Pulse API on http://localhost:${info.port}  (docs: /docs, ws: /ws)`,
  );
});

injectWebSocket(server);
