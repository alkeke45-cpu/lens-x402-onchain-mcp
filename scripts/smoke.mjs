#!/usr/bin/env node
/**
 * Smoke test: spawn the MCP server over stdio, run the JSON-RPC handshake,
 * list tools, and (unless --offline) call the free lens_discover tool.
 * No wallet key is needed and no payment is made.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const offline = process.argv.includes("--offline");
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const child = spawn("node", [path.join(root, "src", "index.js")], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env, LENS_X402_PRIVATE_KEY: "" },
});

let buffer = "";
const pending = new Map();
let nextId = 1;

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) => {
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => reject(new Error(`Timeout waiting for ${method}`)), 30000);
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

try {
  const init = await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "0.1.0" },
  });
  console.log(
    `initialize OK -> server ${init.serverInfo.name} v${init.serverInfo.version}, protocol ${init.protocolVersion}`,
  );
  notify("notifications/initialized", {});

  const listed = await send("tools/list", {});
  console.log(`tools/list OK -> ${listed.tools.length} tools:`);
  for (const t of listed.tools) console.log(`  - ${t.name}`);
  if (listed.tools.length !== 13) {
    throw new Error(`Expected 13 tools, got ${listed.tools.length}`);
  }

  if (!offline) {
    const res = await send("tools/call", { name: "lens_discover", arguments: {} });
    const text = res.content?.[0]?.text || "";
    if (res.isError) throw new Error(`lens_discover returned an error: ${text}`);
    const doc = JSON.parse(text);
    const baseRoutes = (doc.endpoints || []).filter((e) => e.network === "eip155:8453");
    console.log(
      `tools/call lens_discover OK -> API "${doc.name}", ${doc.endpoints.length} endpoints (${baseRoutes.length} on Base), payTo ${baseRoutes[0]?.payTo}`,
    );
    if (!text.includes("0x8488E45d428a3B2BC7116c8657b8FF23Cd042ef6")) {
      throw new Error("Discovery document does not name the expected payTo");
    }
  } else {
    console.log("offline mode: discovery call skipped");
  }
  console.log("SMOKE PASS");
  child.kill();
  process.exit(0);
} catch (err) {
  console.error(`SMOKE FAIL: ${err.message}`);
  child.kill();
  process.exit(1);
}
