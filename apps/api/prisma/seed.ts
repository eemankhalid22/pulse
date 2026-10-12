import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const db = new PrismaClient();

async function main() {
  const users = [
    { email: "admin@pulse.dev", name: "Admin", role: "ADMIN" as const },
    {
      email: "responder@pulse.dev",
      name: "Responder",
      role: "RESPONDER" as const,
    },
    { email: "viewer@pulse.dev", name: "Viewer", role: "VIEWER" as const },
  ];

  const passwordHash = await bcrypt.hash("password123", 10);
  for (const u of users) {
    await db.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash },
    });
  }
  console.log("seeeded users(password:password123");
}

main().finally(() => db.$disconnect());
