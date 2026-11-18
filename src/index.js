#!/usr/bin/env node
/**
 * lens-x402-onchain-mcp — an MCP (Model Context Protocol) stdio server that
 * exposes the LensExtract x402 API (https://lens-extract-x402.alkeke45.workers.dev)
 * as tools for Claude Desktop, Cursor, VS Code, Hermes Agent and any other
 * MCP client.
 *
 * The upstream API is paid per call with the x402 protocol: every data tool
 * costs a small amount of USDC on Base (from $0.001 to $0.10). Payment is
 * handled by the official @x402/fetch client: on an HTTP 402 the client
 * signs an EIP-3009 USDC authorization with YOUR wallet key and retries.
 * Funds go to the API operator's wallet 0x8488E45d428a3B2BC7116c8657b8FF23Cd042ef6.
 *
 * Configuration (environment):
 *   LENS_X402_PRIVATE_KEY  Your own Base wallet private key (0x-prefixed)
 *                          holding a little USDC. Required for the paid
 *                          tools; without it they return the API's 402
 *                          payment requirements instead of data. The key
 *                          never leaves your machine.
 *   LENS_X402_BASE_URL     Override the API base URL (optional).
 *
 * One tool (ask_kinetic_dune) sits on the Stacks/sBTC x402 rail, which an
 * EVM signer cannot pay; it returns the live 402 requirements verbatim.
 * The discovery tool (lens_discover) is free and needs no key.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

const BASE_URL = (
  process.env.LENS_X402_BASE_URL ||
  "https://lens-extract-x402.alkeke45.workers.dev"
).replace(/\/$/, "");
const OPERATOR_PAYTO = "0x8488E45d428a3B2BC7116c8657b8FF23Cd042ef6";

// ---------------------------------------------------------------- payments
let paidFetch = null;
let payerAddress = null;
const rawKey = (process.env.LENS_X402_PRIVATE_KEY || "").trim();
if (rawKey) {
  const account = privateKeyToAccount(
    rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`,
  );
  payerAddress = account.address;
  const client = new x402Client().register(
    "eip155:8453",
    new ExactEvmScheme(account),
  );
  paidFetch = wrapFetchWithPayment(fetch, client);
}

function decodeRequirements(res) {
  const header = res.headers.get("payment-required");
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function callApi(path, { method = "GET", query, body } = {}) {
  const url = new URL(path, BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await (paidFetch || fetch)(url, init);
  const text = await res.text();
  if (res.status === 402) {
    const req = decodeRequirements(res);
    const accepts = req?.accepts?.length
      ? req.accepts
          .map(
            (a) =>
              `${a.scheme} on ${a.network}: ${a.amount} atomic units of ${a.asset} to ${a.payTo}`,
          )
          .join("; ")
      : "see the PAYMENT-REQUIRED header";
    throw new Error(
      `Payment required (HTTP 402). Accepts: ${accepts}. ` +
        (paidFetch
          ? `A payment was attempted from ${payerAddress} but the API still returned 402 — check the wallet's USDC balance on Base.`
          : `Set LENS_X402_PRIVATE_KEY to your own Base wallet private key (holding USDC) so this server can pay per call. Payments go to the API operator ${OPERATOR_PAYTO}.`),
    );
  }
  if (!res.ok) {
    throw new Error(`Upstream HTTP ${res.status}: ${text.slice(0, 600)}`);
  }
  return text;
}

// ------------------------------------------------------------------- tools
const addressProp = {
  type: "string",
  pattern: "^0x[0-9a-fA-F]{40}$",
  description: "An EVM address (0x-prefixed, 40 hex chars).",
};

const TOOLS = [
  {
    name: "lens_discover",
    description:
      "FREE. Fetch the live x402 discovery document of the LensExtract API: every paid endpoint, its price, network and payTo address. No payment, no wallet key needed.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const res = await fetch(`${BASE_URL}/.well-known/x402`);
      if (!res.ok) throw new Error(`Discovery HTTP ${res.status}`);
      return res.text();
    },
  },
  {
    name: "lens_extract",
    description:
      "Extract clean readable markdown/text from any public web page URL. Price: $0.001 USDC on Base per call (x402).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Public http(s) page URL to extract." },
        maxChars: {
          type: "number",
          description: "Max characters of markdown returned (default 20000, cap 50000).",
        },
      },
      required: ["url"],
    },
    run: (a) =>
      callApi("/v1/extract", {
        method: "POST",
        body: { url: a.url, ...(a.maxChars ? { maxChars: a.maxChars } : {}) },
      }),
  },
  {
    name: "morpho_vault_audit",
    description:
      "Morpho Vaults V2 verified census & timelock audit: 68 vaults >= $5M TVL, dual-RPC verified (snapshot 2026-11-17). Price: $0.10 USDC on Base per call (x402).",
    inputSchema: { type: "object", properties: {} },
    run: () => callApi("/v1/morpho-vault-audit"),
  },
  {
    name: "crypto_alpha_feed",
    description:
      "Live Morpho Vaults V2 TVL & APY feed (top vaults by TVL with APY, net APY and fee data, fetched live at request time). Price: $0.05 USDC on Base per call (x402).",
    inputSchema: { type: "object", properties: {} },
    run: () => callApi("/v1/crypto-alpha-feed"),
  },
  {
    name: "base_gas_and_sequencer",
    description:
      "Live Base gas price, block base fee/utilization, L1 blob fee and fee-history snapshot. Price: $0.005 USDC on Base per call (x402).",
    inputSchema: { type: "object", properties: {} },
    run: () => callApi("/v1/base-gas-and-sequencer"),
  },
  {
    name: "defi_yield_radar",
    description:
      "Top 20 USDC yields on Base & Arbitrum by APY (DeFiLlama data, fetched live). Price: $0.01 USDC on Base per call (x402).",
    inputSchema: { type: "object", properties: {} },
    run: () => callApi("/v1/defi-yield-radar"),
  },
  {
    name: "token_contract_guard",
    description:
      "Heuristic screen ONLY (not a safety guarantee): Base ERC-20 contract bytecode checks, EIP-1967 proxy detection and standard view probes for one address. Price: $0.01 USDC on Base per call (x402).",
    inputSchema: {
      type: "object",
      properties: { address: addressProp },
      required: ["address"],
    },
    run: (a) => callApi("/v1/token-contract-guard", { query: { address: a.address } }),
  },
  {
    name: "crypto_momentum_signals",
    description:
      "BTC/ETH/SOL descriptive momentum stats: price, 7d change, RSI(14), 30d range (Kraken OHLC, fetched live). Descriptive statistics, not trading advice. Price: $0.01 USDC on Base per call (x402).",
    inputSchema: { type: "object", properties: {} },
    run: () => callApi("/v1/crypto-momentum-signals"),
  },
  {
    name: "stablecoin_peg_monitor",
    description:
      "Major USD stablecoin prices and deviation from $1 in basis points (DeFiLlama, fetched live). Price: $0.005 USDC on Base per call (x402).",
    inputSchema: { type: "object", properties: {} },
    run: () => callApi("/v1/stablecoin-peg-monitor"),
  },
  {
    name: "fear_greed",
    description:
      "Crypto Fear & Greed index: current value/classification plus 30 days of history (alternative.me, fetched live). Price: $0.005 USDC on Base per call (x402).",
    inputSchema: { type: "object", properties: {} },
    run: () => callApi("/v1/fear-greed"),
  },
  {
    name: "base_wallet_scan",
    description:
      "Base address scan: ETH balance, transaction count, contract flag, and USDC/WETH/DAI balances for one address. Price: $0.01 USDC on Base per call (x402).",
    inputSchema: {
      type: "object",
      properties: { address: addressProp },
      required: ["address"],
    },
    run: (a) => callApi("/v1/base-wallet-scan", { query: { address: a.address } }),
  },
  {
    name: "ens_lookup",
    description:
      "ENS forward resolution (name -> address) or reverse resolution (address -> name) via ensideas. Price: $0.005 USDC on Base per call (x402).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "ENS name, e.g. vitalik.eth (forward lookup)." },
        address: { type: "string", description: "Ethereum address (reverse lookup)." },
      },
    },
    run: (a) => callApi("/v1/ens-lookup", { query: { name: a.name, address: a.address } }),
  },
  {
    name: "ask_kinetic_dune",
    description:
      "Ask the Kinetic Dune tutor a question. This endpoint is paid on the Stacks x402 rail (10 sats sBTC), which this EVM-based client cannot pay — the tool returns the live 402 payment requirements so a Stacks-capable client can complete it. Price: 10 sats sBTC on Stacks.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask." },
      },
      required: ["question"],
    },
    run: async (a) => {
      const url = new URL("/ask", BASE_URL);
      url.searchParams.set("question", a.question);
      const res = await fetch(url);
      const text = await res.text();
      if (res.status === 402) {
        const req = decodeRequirements(res);
        return JSON.stringify(
          {
            note: "This endpoint charges 10 sats sBTC on the Stacks x402 rail. This MCP server pays with an EVM (Base) wallet, so it cannot settle a Stacks payment. The live payment requirements are included verbatim for a Stacks-capable x402 client.",
            paymentRequired: req ?? text,
          },
          null,
          2,
        );
      }
      if (!res.ok) throw new Error(`Upstream HTTP ${res.status}: ${text.slice(0, 600)}`);
      return text;
    },
  },
];

// ------------------------------------------------------------------ server
const server = new Server(
  { name: "lens-x402-onchain-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS.find((t) => t.name === request.params.name);
  if (!tool) throw new Error(`Unknown tool: ${request.params.name}`);
  try {
    const out = await tool.run(request.params.arguments || {});
    return { content: [{ type: "text", text: out }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message || err}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `lens-x402-onchain-mcp v0.1.0 ready (base ${BASE_URL}; payments ${
    paidFetch ? `enabled from ${payerAddress}` : "disabled — LENS_X402_PRIVATE_KEY not set"
  })`,
);
