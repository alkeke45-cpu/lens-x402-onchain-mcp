FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
LABEL io.modelcontextprotocol.server.name="io.github.alkeke45-cpu/lens-x402-onchain-mcp"
LABEL org.opencontainers.image.source="https://github.com/alkeke45-cpu/lens-x402-onchain-mcp"
LABEL org.opencontainers.image.description="MCP server for the LensExtract x402 API (web extraction + live on-chain/crypto data, paid per call in Base USDC)"
ENTRYPOINT ["node", "src/index.js"]
