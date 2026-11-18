# LensExtract x402 On-Chain MCP

An open-source [MCP (Model Context Protocol)](https://modelcontextprotocol.io)
server that connects MCP clients — Claude Desktop, Cursor, VS Code, Hermes
Agent — to the **LensExtract x402 API**
(`https://lens-extract-x402.alkeke45.workers.dev`): web-page extraction plus
live on-chain / crypto-market data, paid **per call** in USDC on Base with
the [x402 protocol](https://www.x402.org). No API keys, no subscriptions —
each tool call settles its own micropayment.

Listed in the Official MCP Registry as
`io.github.alkeke45-cpu/lens-x402-onchain-mcp`.

## Tools

| Tool | What it does | Price |
| --- | --- | --- |
| `lens_discover` | Live x402 discovery document (endpoints, prices, payTo) | **free** |
| `lens_extract` | Clean markdown/text extraction from any public web page | $0.001 |
| `morpho_vault_audit` | Morpho Vaults V2 census & timelock audit (68 vaults ≥ $5M, dual-RPC verified) | $0.10 |
| `crypto_alpha_feed` | Live Morpho Vaults V2 TVL & APY feed | $0.05 |
| `base_gas_and_sequencer` | Live Base gas, base fee, blob fee snapshot | $0.005 |
| `defi_yield_radar` | Top 20 USDC yields on Base & Arbitrum (DeFiLlama, live) | $0.01 |
| `token_contract_guard` | Heuristic ERC-20 contract screen (bytecode, proxy, views) — a screen, not a safety guarantee | $0.01 |
| `crypto_momentum_signals` | BTC/ETH/SOL momentum stats (price, 7d change, RSI-14) — descriptive, not advice | $0.01 |
| `stablecoin_peg_monitor` | USD stablecoin peg deviations in bps (live) | $0.005 |
| `fear_greed` | Fear & Greed index + 30d history (live) | $0.005 |
| `base_wallet_scan` | Base address balances (ETH, USDC, WETH, DAI), tx count, contract flag | $0.01 |
| `ens_lookup` | ENS forward/reverse resolution | $0.005 |
| `ask_kinetic_dune` | Ask the Kinetic Dune tutor — paid on the **Stacks** rail (10 sats sBTC); this EVM client returns the live 402 requirements for a Stacks-capable client | 10 sats |

All Base prices are USDC on Base (chain 8453), paid to the API operator
`0x8488E45d428a3B2BC7116c8657b8FF23Cd042ef6`.

## How payment works

The API answers unpaid calls with HTTP 402 and an x402 v2
`PAYMENT-REQUIRED` challenge. This server wraps `fetch` with the official
`@x402/fetch` client and the `@x402/evm` exact scheme: it signs an EIP-3009
USDC `transferWithAuthorization` with **your** wallet key and retries with a
`PAYMENT-SIGNATURE` header. The API's facilitator settles on Base. Your key
is used locally only — it is never sent anywhere.

You need a Base wallet holding a small amount of USDC (a dollar covers
hundreds of calls). Without a key, the free discovery tool still works and
paid tools return the API's payment requirements instead of data.

## Install

### MCPB bundle (Claude Desktop)

Download `lens-x402-onchain-mcp.mcpb` from the
[latest GitHub release](https://github.com/alkeke45-cpu/lens-x402-onchain-mcp/releases)
and open it with Claude Desktop (or double-click it). You will be asked for
your Base wallet private key once; it is stored by the host as a secret.

### From source (any MCP client)

```bash
git clone https://github.com/alkeke45-cpu/lens-x402-onchain-mcp.git
cd lens-x402-onchain-mcp
npm install
```

Claude Desktop / Cursor / VS Code MCP config:

```json
{
  "mcpServers": {
    "lens-x402": {
      "command": "node",
      "args": ["/absolute/path/to/lens-x402-onchain-mcp/src/index.js"],
      "env": {
        "LENS_X402_PRIVATE_KEY": "0xYOUR_BASE_WALLET_PRIVATE_KEY"
      }
    }
  }
}
```

### Docker

```bash
docker build -t lens-x402-onchain-mcp .
docker run -i --rm -e LENS_X402_PRIVATE_KEY=0xYOUR_KEY lens-x402-onchain-mcp
```

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `LENS_X402_PRIVATE_KEY` | for paid tools | Your own Base wallet private key holding USDC. Never share it; it stays on your machine. |
| `LENS_X402_BASE_URL` | no | Override the API base URL (default `https://lens-extract-x402.alkeke45.workers.dev`). |

## Smoke test

```bash
npm run smoke         # handshake + tools/list + live free discovery call
npm run smoke:offline # handshake + tools/list only
```

## Publishing (maintainers)

`server.json` is published to the Official MCP Registry by
`.github/workflows/publish-mcp.yml` on every push to `main`: it builds the
MCPB bundle, uploads it to the `v0.1.0` GitHub release, writes its SHA-256
into `server.json`, then publishes with `mcp-publisher` using GitHub OIDC
(no stored credentials). Bump the version in `package.json`, `server.json`,
`manifest.json` and the workflow's `RELEASE_TAG` together for a new release.

## License

MIT — see [LICENSE](LICENSE).
