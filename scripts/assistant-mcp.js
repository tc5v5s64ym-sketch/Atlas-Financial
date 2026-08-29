'use strict';
/* Standards-compatible MCP transport for the incumbent Atlas assistant packet.
 *
 * This module is transport only. It registers one read-only tool whose result
 * is produced by scripts/assistant-packet.js. It does not calculate financial
 * figures, authenticate users, call providers, or write Atlas state.
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const {
  StreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const z = require('zod/v4');
const Assistant = require('./assistant-packet.js');

const TOOL_NAME = 'get_atlas_current';
const SERVER_NAME = 'atlas-financial-assistant';
const SERVER_VERSION = '1.0.0';
const REQUIRED_SCOPE = 'atlas.current.read';
const ALLOWED_ORIGINS = Object.freeze([
  'https://chatgpt.com',
  'https://chat.openai.com',
]);
const SECURITY_SCHEMES = Object.freeze([
  Object.freeze({ type: 'oauth2', scopes: Object.freeze([REQUIRED_SCOPE]) }),
]);
const ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});
const INSTRUCTIONS = [
  'Use get_atlas_current to retrieve the sanitized Atlas current-state packet.',
  'Forecast is the sole financial planner and calculation authority.',
  'This server cannot write Atlas or provider state and cannot move money.',
].join(' ');

function originAllowed(origin) {
  if (origin == null || origin === '') return true;
  return ALLOWED_ORIGINS.includes(String(origin));
}

function toolDescriptor() {
  return {
    name: TOOL_NAME,
    title: 'Atlas current state',
    description:
      'Return the incumbent sanitized Atlas current-state packet. Forecast remains the planner. This tool never writes, pays, transfers, or refreshes canonical state.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: ANNOTATIONS,
    _meta: { securitySchemes: SECURITY_SCHEMES },
  };
}

function packetResult(packet) {
  if (!packet || packet.schema !== Assistant.SCHEMA || !Assistant.looksSanitized(packet)) {
    return {
      content: [{ type: 'text', text: 'Assistant packet unavailable.' }],
      isError: true,
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(packet) }],
    structuredContent: packet,
    isError: false,
  };
}

function createServer(getPacket) {
  if (typeof getPacket !== 'function') throw new Error('getPacket is required');
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  }, {
    instructions: INSTRUCTIONS,
  });
  const descriptor = toolDescriptor();
  server.registerTool(TOOL_NAME, {
    title: descriptor.title,
    description: descriptor.description,
    inputSchema: z.object({}).strict(),
    annotations: descriptor.annotations,
    _meta: descriptor._meta,
  }, async () => packetResult(await getPacket()));
  return server;
}

async function handleHttp(req, res, opts) {
  const server = createServer(opts && opts.getPacket);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

module.exports = {
  TOOL_NAME,
  SERVER_NAME,
  SERVER_VERSION,
  REQUIRED_SCOPE,
  ALLOWED_ORIGINS,
  SECURITY_SCHEMES,
  ANNOTATIONS,
  INSTRUCTIONS,
  originAllowed,
  toolDescriptor,
  packetResult,
  createServer,
  handleHttp,
};
