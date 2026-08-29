'use strict';
/* Streamable HTTP MCP adapter for the incumbent Atlas assistant packet.
 *
 * This module is a protocol wrapper, not a planner. It exposes one read-only
 * tool that returns scripts/assistant-packet.js output. Forecast remains the
 * calculation authority. It never writes canonical state, never calls a
 * provider mutating verb, and never invents a second financial schema.
 *
 * HTTP consumer: POST /assistant/mcp (Bearer ATLAS_ASSISTANT_TOKEN).
 * ChatGPT Apps SDK OAuth remains a later adapter; Streamable HTTP + Bearer
 * is the ChatGPT/Codex connection slice this file implements.
 */

const Assistant = require('./assistant-packet.js');

const PROTOCOL_VERSIONS = Object.freeze([
  '2025-11-25',
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
]);
const PREFERRED_PROTOCOL_VERSION = '2025-11-25';
const SERVER_NAME = 'atlas-financial';
const SERVER_VERSION = 'assistant-mcp/v1';
const TOOL_NAME = 'get_current_state';
const ALLOWED_ORIGINS = Object.freeze([
  'https://chatgpt.com',
  'https://chat.openai.com',
]);
const INSTRUCTIONS = [
  'Atlas Financial read-only current-state.',
  'Forecast is the sole planner and calculation authority.',
  'Call get_current_state to retrieve the incumbent sanitized atlas-assistant-packet/v1.',
  'Do not invent figures. Do not treat estimated values as verified.',
  'Do not issue payments, transfers, provider writes, or canonical writes.',
  'Unavailable answers stay unavailable.',
].join(' ');

const TOOL = Object.freeze({
  name: TOOL_NAME,
  title: 'Atlas current state',
  description: [
    'Return the incumbent sanitized Atlas current-state packet',
    '(atlas-assistant-packet/v1). Read-only. Forecast remains the planner.',
    'Does not pay, transfer, or write canonical or provider state.',
  ].join(' '),
  inputSchema: Object.freeze({
    type: 'object',
    properties: Object.freeze({}),
    additionalProperties: false,
  }),
  annotations: Object.freeze({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  }),
});

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function originAllowed(origin) {
  if (origin == null || origin === '') return true;
  return ALLOWED_ORIGINS.includes(String(origin));
}

function protocolVersionHeaderAllowed(header) {
  if (header == null || header === '') return true;
  return PROTOCOL_VERSIONS.includes(String(header).trim());
}

function negotiateProtocolVersion(requested) {
  const version = typeof requested === 'string' ? requested.trim() : '';
  if (PROTOCOL_VERSIONS.includes(version)) return version;
  return PREFERRED_PROTOCOL_VERSION;
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } };
}

function initializeResult(params) {
  const protocolVersion = negotiateProtocolVersion(params && params.protocolVersion);
  return {
    protocolVersion,
    capabilities: { tools: {} },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      title: 'Atlas Financial',
      description: 'Read-only sanitized Atlas current-state for ChatGPT. Not a planner.',
    },
    instructions: INSTRUCTIONS,
  };
}

function listTools() {
  return { tools: [TOOL] };
}

function unknownToolResult(name) {
  const shown = typeof name === 'string' && name ? name : '(missing)';
  return {
    content: [{ type: 'text', text: `Unknown read-only tool: ${shown}` }],
    isError: true,
  };
}

function packetToolResult(packet) {
  if (!Assistant.looksSanitized(packet)) {
    throw new Error('Assistant packet is not sanitized.');
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(packet) }],
    structuredContent: packet,
    isError: false,
  };
}

async function callTool(params, getPacket) {
  const name = params && params.name;
  if (name !== TOOL_NAME) return unknownToolResult(name);
  const packet = await getPacket();
  return packetToolResult(packet);
}

function isNotification(message) {
  return isObject(message) && message.id === undefined && typeof message.method === 'string';
}

function isRequest(message) {
  return isObject(message)
    && message.id !== undefined
    && message.id !== null
    && typeof message.method === 'string';
}

async function handleMessage(message, opts) {
  opts = opts || {};
  if (Array.isArray(message)) {
    return { status: 400, body: rpcError(null, -32600, 'Invalid Request') };
  }
  if (!isObject(message) || message.jsonrpc !== '2.0') {
    return { status: 400, body: rpcError(null, -32600, 'Invalid Request') };
  }
  if (isNotification(message)) {
    if (message.method === 'notifications/initialized'
      || message.method === 'notifications/cancelled') {
      return { status: 202, body: null };
    }
    return { status: 400, body: rpcError(null, -32600, 'Invalid Request') };
  }
  if (!isRequest(message)) {
    return { status: 400, body: rpcError(null, -32600, 'Invalid Request') };
  }
  const id = message.id;
  try {
    switch (message.method) {
      case 'initialize':
        return { status: 200, body: rpcResult(id, initializeResult(message.params)) };
      case 'ping':
        return { status: 200, body: rpcResult(id, {}) };
      case 'tools/list':
        return { status: 200, body: rpcResult(id, listTools()) };
      case 'tools/call': {
        const result = await callTool(message.params, opts.getPacket);
        return { status: 200, body: rpcResult(id, result) };
      }
      default:
        return { status: 200, body: rpcError(id, -32601, 'Method not found') };
    }
  } catch (err) {
    return {
      status: 200,
      body: rpcError(id, -32603, 'Internal error'),
      logMessage: err && err.message,
    };
  }
}

module.exports = {
  PROTOCOL_VERSIONS,
  PREFERRED_PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
  TOOL_NAME,
  TOOL,
  INSTRUCTIONS,
  ALLOWED_ORIGINS,
  originAllowed,
  protocolVersionHeaderAllowed,
  negotiateProtocolVersion,
  initializeResult,
  listTools,
  handleMessage,
  packetToolResult,
};
