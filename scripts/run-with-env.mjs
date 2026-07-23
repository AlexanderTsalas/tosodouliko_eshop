#!/usr/bin/env node
/**
 * Run a command with environment variables loaded from a dotenv file.
 *
 * Why this exists: `node --env-file=X next dev` fails in Node 20+ because
 * Next.js spawns its webpack/turbopack worker as a child process, and
 * Node propagates the parent's CLI flags via NODE_OPTIONS, but
 * `--env-file` is explicitly disallowed inside NODE_OPTIONS. So the
 * worker crashes with: "--env-file= is not allowed in NODE_OPTIONS".
 *
 * This wrapper sidesteps the problem by parsing the file in pure JS and
 * setting process.env BEFORE spawning the command. The child process
 * inherits those env vars normally — no --env-file in NODE_OPTIONS, no
 * crash.
 *
 * Usage:
 *   node scripts/run-with-env.mjs <env-file> <command> [args...]
 *
 * Example (from package.json):
 *   "dev:localstack": "node scripts/run-with-env.mjs .env.localstack node node_modules/next/dist/bin/next dev"
 *
 * Parser scope: handles KEY=VALUE lines, '#' line comments, blank lines,
 * and optional single/double quotes around values. Does NOT support
 * multi-line values, variable interpolation, or inline comments after
 * a value — keep .env files boring.
 */
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const [, , envFile, ...command] = process.argv;
if (!envFile || command.length === 0) {
  console.error(
    "Usage: node scripts/run-with-env.mjs <env-file> <command> [args...]"
  );
  process.exit(2);
}

const env = { ...process.env };
const filePath = path.resolve(projectRoot, envFile);
let content;
try {
  content = readFileSync(filePath, "utf8");
} catch (err) {
  console.error(`[run-with-env] cannot read ${filePath}: ${err.message}`);
  process.exit(2);
}

for (const rawLine of content.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const idx = line.indexOf("=");
  if (idx <= 0) continue;
  const key = line.slice(0, idx).trim();
  let val = line.slice(idx + 1).trim();
  const q = val[0];
  if ((q === '"' || q === "'") && val.endsWith(q)) {
    val = val.slice(1, -1);
  }
  env[key] = val;
}

// shell:false is intentional. Using shell:true on Windows routes through
// cmd.exe which re-tokenizes by whitespace and strips inner quotes —
// fatal for any arg that contains spaces or quotes (e.g. `node -e "…"`).
// Node 24 also deprecates shell:true with args (DEP0190). Callers must
// pass a real executable (e.g. `node`) + absolute-path script, not a
// .cmd shim like `next` — that's why our package.json scripts use the
// `node node_modules/next/dist/bin/next ...` form.
const child = spawn(command[0], command.slice(1), {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    try {
      process.kill(process.pid, signal);
    } catch {
      process.exit(1);
    }
  } else {
    process.exit(code ?? 1);
  }
});
