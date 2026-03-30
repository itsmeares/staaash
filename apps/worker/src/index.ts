import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";

const envSchema = z.object({
  FILES_ROOT: z.string().trim().min(1),
});

const env = envSchema.parse(process.env);
const filesRoot = path.resolve(process.cwd(), env.FILES_ROOT);
const tmpRoot = path.resolve(filesRoot, "tmp");
const heartbeatPath = path.resolve(tmpRoot, "worker-heartbeat.json");

const writeHeartbeat = async () => {
  await mkdir(tmpRoot, { recursive: true });
  await writeFile(
    heartbeatPath,
    JSON.stringify({
      timestamp: new Date().toISOString(),
    }),
    "utf8",
  );
};

const main = async () => {
  await writeHeartbeat();
  setInterval(() => {
    void writeHeartbeat();
  }, 30_000);
};

void main();
