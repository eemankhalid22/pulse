const API = "http://localhost:3001";

async function login(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password123" }),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(`login failed for ${email}: ${JSON.stringify(data)}`);
  return data;
}

const responder = await login("responder@pulse.dev");
const admin = await login("admin@pulse.dev");

async function post(path, token, json) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(json),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(data)}`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const scenarios = [
  {
    title: "Cache warm pool restarting",
    description: "Error rate climbing after deploy",
    severity: "SEV3",
    service: "search-svc",
    steps: [
      ["Acknowledged, checking deploy diff", "INVESTIGATING", true],
      ["Pinned deploy marker #4471", null, false],
    ],
  },
  {
    title: "Elevated p99 latency",
    description: "p99 above 2s on image fetches",
    severity: "SEV3",
    service: "image-cdn",
    steps: [
      ["Looking at origin shield", "INVESTIGATING", true],
      ["Cache rules misconfigured", "IDENTIFIED", false],
    ],
  },
  {
    title: "Queue backlog growing",
    description: "Notification queue depth > 10k",
    severity: "SEV3",
    service: "notify-svc",
    steps: [["Scaled workers to 8", "MONITORING", true]],
  },
  {
    title: "Checkout 500s",
    description: "Intermittent 500 on /checkout",
    severity: "SEV1",
    service: "checkout",
    steps: [
      ["Rolling back release", "INVESTIGATING", true],
      ["Rollback complete", "MONITORING", false],
      ["Error rate normal", "RESOLVED", false],
    ],
  },
  {
    title: "Payment provider timeouts",
    description: "Upstream gateway timing out",
    severity: "SEV2",
    service: "payments",
    steps: [["Failing over to backup provider", "INVESTIGATING", true]],
  },
  {
    title: "Login failures for SSO users",
    description: "OIDC callback erroring",
    severity: "SEV2",
    service: "auth",
    steps: [
      ["Cert rotation suspected", "INVESTIGATING", false],
      ["Cert renewed", "RESOLVED", false],
    ],
  },
  {
    title: "Inventory sync lag",
    description: "Stock counts 15 min stale",
    severity: "SEV4",
    service: "inventory",
    steps: [],
  },
];

for (const s of scenarios) {
  const inc = await post("/incidents", responder.token, {
    title: s.title,
    description: s.description,
    severity: s.severity,
    service: s.service,
  });
  await sleep(1200);
  for (const [message, status, assign] of s.steps) {
    await post(`/incidents/${inc.id}/updates`, admin.token, {
      message,
      ...(status ? { status } : {}),
      ...(assign ? { assigneeId: responder.user.id } : {}),
    });
    await sleep(900);
  }
  console.log("created:", s.service, "-", s.title);
}
console.log("Done.");
