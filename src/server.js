import app from "./app.js";
import { prisma } from "./config/prisma.js";
import { config } from "./config/index.js";

const server = app.listen(config.port, () => {
  console.log(
    `🚀 Rivalry API running on http://localhost:${config.port} [${config.nodeEnv}]`,
  );
});

async function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
