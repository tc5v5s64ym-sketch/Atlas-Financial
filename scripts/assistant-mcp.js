'use strict';
/* Read-only MCP adapter for GET /assistant/current.
 *
 * Transport only. It does not compute household figures, does not write, and
 * is not a second packet builder. tools/call get_atlas_current returns the
 * incumbent sanitized atlas-assistant-packet/v1 produced by
 * scripts/assistant-packet.js. ChatGPT Apps SDK OAuth remains a later slice.
 */
const Assistant = require('./assistant-packet.js');

const PROTOCOL_VERSION = '2025-03-26';
const TOOL_NAME = 'get_atlas_current';
const SERVER_NAME = 'atlas-financial-assistant';

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: '2.0',
    id: id === undefined ? null : id,
    error: { code, message },
  };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function toolDescriptor() {
  return {
    name: TOOL_NAME,
    title: 'Atlas current state',
    description:
      'Return the sanitized read-only Atlas current-state packet. Forecast remains the planner. This tool never writes, never pays, and never refreshes canonical state.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  };
}

function hasId(message) {
  return !!(message && Object.prototype.hasOwnProperty.call(message, 'id'));
}

function emptyArgs(value) {
  if (value == null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).length === 0;
}

function handle(message, opts) {
  opts = opts || {};
  if (message == null || typeof message !== 'object' || Array.isArray(message)) {
    return { status: 400, body: jsonRpcError(null, -32600, 'invalid request') };
  }
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method) {
    return {
      status: 400,
      body: jsonRpcError(hasId(message) ? message.id : null, -32600, 'invalid request'),
    };
  }

  const notification = !hasId(message);
  const id = notification ? undefined : message.id;
  const method = message.method;

  if (method.indexOf('notifications/') === 0) {
    return { status: 204, body: null };
  }
  if (notification) return { status: 204, body: null };

  if (method === 'initialize') {
    return {
      status: 200,
      body: jsonRpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: '1' },
        instructions:
          'Call get_atlas_current for the sanitized Atlas packet. This server is not a planner.',
      }),
    };
  }
  if (method === 'ping') {
    return { status: 200, body: jsonRpcResult(id, {}) };
  }
  if (method === 'tools/list') {
    return { status: 200, body: jsonRpcResult(id, { tools: [toolDescriptor()] }) };
  }
  if (method === 'tools/call') {
    const params = message.params && typeof message.params === 'object' && !Array.isArray(message.params)
      ? message.params
      : null;
    if (!params || params.name !== TOOL_NAME) {
      return { status: 200, body: jsonRpcError(id, -32602, 'unknown tool') };
    }
    if (!emptyArgs(params.arguments)) {
      return { status: 200, body: jsonRpcError(id, -32602, 'get_atlas_current takes no arguments') };
    }
    const packet = opts.packet;
    if (!packet || packet.schema !== Assistant.SCHEMA || !Assistant.looksSanitized(packet)) {
      return {
        status: 200,
        body: jsonRpcResult(id, {
          content: [{ type: 'text', text: 'Assistant packet unavailable.' }],
          isError: true,
        }),
      };
    }
    return {
      status: 200,
      body: jsonRpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(packet) }],
        isError: false,
      }),
    };
  }

  return { status: 200, body: jsonRpcError(id, -32601, 'method not found') };
}

module.exports = {
  PROTOCOL_VERSION,
  TOOL_NAME,
  SERVER_NAME,
  handle,
  toolDescriptor,
};
