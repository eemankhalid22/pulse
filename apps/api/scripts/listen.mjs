import WebSocket from "ws";

const email = process.argv[2] ?? "admin@pulse.dev";

const res = await fetch("http://localhost:3001/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password: "password123" }),
});
const { token } = await res.json();

const ws = new WebSocket(`ws://localhost:3001/ws?token=${token}`);
ws.on("open", () => console.log("connected as", email));
ws.on("message", (d) => console.log(d.toString()));
ws.on("close", () => console.log("closed"));
ws.on("error", (e) => console.error("error:", e.message));
