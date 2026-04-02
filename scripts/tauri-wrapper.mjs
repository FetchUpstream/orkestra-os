// Copyright 2026 Louis Scheepers
//
// This file is dual-licensed under:
//
// 1. The MIT License (MIT)
//    See: https://opensource.org/licenses/MIT
//
// 2. The Apache License, Version 2.0
//    See: https://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import { mkdir, readFile, rm, writeFile } from "fs/promises";
import net from "net";
import os from "os";
import path from "path";

const BASE_PORT = 1420;
const MAX_PORT = 1520;
const args = process.argv.slice(2);

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(startPort) {
  for (let port = startPort; port <= MAX_PORT; port += 1) {
    if (await isPortFree(port)) {
      return port;
    }
  }

  throw new Error(
    `No available dev port found between ${startPort} and ${MAX_PORT}.`,
  );
}

function spawnAndWait(command) {
  const proc = Bun.spawn(command, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  return proc.exited;
}

async function runDynamicTauriDev(rawArgs) {
  const dryRunIndex = rawArgs.indexOf("--dry-run");
  const dryRun = dryRunIndex >= 0;
  const tauriArgs =
    dryRunIndex >= 0
      ? [...rawArgs.slice(0, dryRunIndex), ...rawArgs.slice(dryRunIndex + 1)]
      : rawArgs;

  const selectedPort = await findAvailablePort(BASE_PORT);
  const projectRoot = process.cwd();
  const baseConfigPath = path.join(projectRoot, "src-tauri", "tauri.conf.json");
  const configText = await readFile(baseConfigPath, "utf8");
  const config = JSON.parse(configText);

  config.build ??= {};
  config.build.beforeDevCommand = `bun run dev -- --port ${selectedPort} --strictPort`;
  config.build.devUrl = `http://localhost:${selectedPort}`;

  const tempDir = path.join(os.tmpdir(), "orkestra-tauri-dev");
  await mkdir(tempDir, { recursive: true });
  const tempConfigPath = path.join(
    tempDir,
    `tauri.conf.dev.${process.pid}.${Date.now()}.json`,
  );

  await writeFile(tempConfigPath, JSON.stringify(config, null, 2));

  if (dryRun) {
    console.log(`[tauri-wrapper] selected port: ${selectedPort}`);
    console.log(`[tauri-wrapper] generated config: ${tempConfigPath}`);
    console.log(`[tauri-wrapper] devUrl: ${config.build.devUrl}`);
    await rm(tempConfigPath, { force: true });
    return 0;
  }

  try {
    return await spawnAndWait([
      "bunx",
      "tauri",
      "dev",
      "--config",
      tempConfigPath,
      ...tauriArgs,
    ]);
  } finally {
    await rm(tempConfigPath, { force: true });
  }
}

async function main() {
  if (args[0] !== "dev") {
    const code = await spawnAndWait(["bunx", "tauri", ...args]);
    process.exit(code);
  }

  const code = await runDynamicTauriDev(args.slice(1));
  process.exit(code);
}

main().catch((error) => {
  console.error("[tauri-wrapper]", error);
  process.exit(1);
});
