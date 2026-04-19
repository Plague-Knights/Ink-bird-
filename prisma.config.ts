import path from "node:path";
import { defineConfig } from "prisma/config";
import "dotenv/config";

// Prisma 7 moved the datasource URL out of the schema. It now lives here
// (for Migrate) and must also be wired into the PrismaClient constructor via
// a driver adapter (see src/lib/prisma.ts).
// https://pris.ly/d/prisma7-client-config
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
