import { execSync } from "node:child_process";

export default function setup() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("pulse_test")) {
    throw new Error(
      "Refusing to reset a database that is not pulse_test: " + url,
    );
  }
  execSync(
    "pnpm exec prisma db push --skip-generate --force-reset --accept-data-loss",
    {
      stdio: "inherit",
      env: process.env,
    },
  );
}
