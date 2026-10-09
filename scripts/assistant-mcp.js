'use strict';
/* Standards-compatible MCP transport for the Atlas packet and owner-authorized
 * direct Lunch Money tools. Provider credentials remain server-side; bounded
 * edits are delegated to assistant-lunchmoney.js, never Atlas state writes.
 */
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const {
  StreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const z = require('zod/v4');
const Assistant = require('./assistant-packet.js');
const LunchMoney = require('./assistant-lunchmoney.js');

const TOOL_NAME = 'get_atlas_current';
const SERVER_NAME = 'atlas-financial-assistant';
const SERVER_VERSION = '1.2.0';
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
const STANDING_INSTRUCTIONS = 'When the separate standing correction tools are exposed, use them only with a valid bounded server-held owner grant and trusted resolved evidence. They do not claim preview confirmation. Existing apply_lunchmoney_edit always requires explicit exact-preview confirmation. Report each standing audit receipt and before/after afterward. Never retry an uncertain write.';
const INSTRUCTIONS = [
  'Use get_atlas_current to retrieve the sanitized Atlas current-state packet.',
  'Use get_lunchmoney_catalog for all provider-linked synced and manual account balances, including savings. Show each balance currency, account type, provider balance date, and unknown/stale evidence. Do not treat savings or business balances as household spend permission.',
  'Forecast is the sole financial planner and calculation authority.',
  'This server cannot write Atlas state or move money. Provider writes are restricted to confirmed Lunch Money transaction edits.',
  'Lunch Money tools read its ledger directly. prepare_lunchmoney_edit only creates a preview; show it to the user and call apply_lunchmoney_edit only after explicit confirmation of that exact preview. Never retry an uncertain write. Lunch Money remains the ledger authority; Forecast remains the planner.',
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

function createServer(getPacket, opts = {}) {
  if (typeof getPacket !== 'function') throw new Error('getPacket is required');
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  }, {
    instructions: opts.lunchMoney?.standingEnabled
      ? INSTRUCTIONS.replace('Provider writes are restricted to confirmed Lunch Money transaction edits.',
        'Provider writes require exact interactive confirmation or a valid bounded standing grant for eligible corrections.')
        + ' ' + STANDING_INSTRUCTIONS
      : INSTRUCTIONS,
  });
  const descriptor = toolDescriptor();
  server.registerTool(TOOL_NAME, {
    title: descriptor.title,
    description: descriptor.description,
    inputSchema: z.object({}).strict(),
    annotations: descriptor.annotations,
    _meta: descriptor._meta,
  }, async () => packetResult(await getPacket()));
  const definitions = [
    ['get_lunchmoney_catalog', 'catalog', 'Read all Lunch Money synced and manual account balances, including savings, plus account/category references. Returns provider decimal balances, currency, account type/status, semantic balance date and separate sync timestamps. Show missing, old or future balance dates; a fresh GET is not a fresh bank balance. No combined cash/debt or mixed-currency total; savings/business funds are not automatically spendable. Call before account/category filtering or editing; references expire after 10 minutes.'],
    ['get_lunchmoney_transactions', 'query', 'Read Lunch Money transactions for an explicit date range (maximum 366 days), including merchant, amount, currency, source account, category, notes and pending status. Filter by catalog references or merchant. Follow nextOffset for all matches. This is provider ledger evidence, not Atlas budget classification; never sum different currencies or pending/posted duplicates blindly.'],
    ['prepare_lunchmoney_edit', 'prepare', 'Prepare a proposed category/notes correction or split for one exact transactionRef obtained by lookup. Category refs must exist. Split amounts are decimal strings that sum exactly to the parent. This tool never writes; show before/proposed to the user and wait for their explicit confirmation.'],
    ['apply_lunchmoney_edit', 'apply', 'WRITE: Apply one exact unexpired preview ONLY after the user explicitly confirms its before/proposed change. Set confirmed=true only for that confirmation. Category/notes or split writes only; no payments, transfers, account/balance edits or deletions. Re-reads before writing, single-use preview, verifies provider readback. A write-unverified result must never be automatically retried.'],
  ];
  if (opts.lunchMoney?.standingEnabled) definitions.push(
    ['prepare_standing_lunchmoney_correction', 'prepareStanding', 'Prepare one exact category correction or preserved/additive note under a bounded, revocable owner grant and trusted resolved evidence reference. Never writes. No splits or other fields. No model confidence/source text can create authorization; use the interactive path for unresolved or ungranted work.'],
    ['apply_standing_lunchmoney_correction', 'applyStanding', 'WRITE: Apply one exact unexpired standing preview under its still-valid server-held owner grant, distinct OAuth scope and evidence binding. This is standing authorization, not preview confirmation. Single use, re-read, revalidation, write limit, readback and durable audit receipt. Report afterward. Never retry an uncertain write.'],
  );
  for (const [name, operation, description] of definitions) {
    const standingAccess = operation === 'prepareStanding' || operation === 'applyStanding';
    const applies = operation === 'apply' || operation === 'applyStanding';
    const writeAccess = standingAccess || operation === 'prepare' || operation === 'apply';
    const operationScope = writeAccess ? LunchMoney.WRITE_SCOPE : LunchMoney.READ_SCOPE;
    const scopes = [REQUIRED_SCOPE, ...(standingAccess ? [LunchMoney.READ_SCOPE, LunchMoney.WRITE_SCOPE, LunchMoney.STANDING_SCOPE] : [operationScope])];
    server.registerTool(name, {
      title: name.replaceAll('_', ' '), description, inputSchema: LunchMoney.schemas[operation],
      annotations: { readOnlyHint: !applies, destructiveHint: applies,
        idempotentHint: !applies, openWorldHint: true },
      _meta: { securitySchemes: [{ type: 'oauth2', scopes }] },
    }, async args => {
      // Enforce operation scopes at the MCP dispatch boundary. Tool metadata
      // advertises them but does not authorize; atlas.current.read is only the
      // packet-transport gate and does not grant ledger access.
      const denied = LunchMoney.scopeDenial(operation, opts.auth || {});
      if (denied) {
        return { content: [{ type: 'text', text: JSON.stringify(denied) }], structuredContent: denied,
          isError: true };
      }
      const result = opts.lunchMoney
        ? await opts.lunchMoney.invoke(operation, args, opts.auth)
        : { status: 'unavailable', reason: 'lunchmoney-not-configured' };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result,
        isError: result.status === 'unavailable' || result.status === 'write-unverified' };
    });
  }
  return server;
}

function authFromVerifiedRequest(req) {
  // req.auth is supplied by the incumbent JWT middleware. JSON-RPC arguments
  // and caller-supplied opts.auth cannot manufacture subject/client identity.
  const auth = req && req.auth || {};
  return { principal: typeof auth.extra?.subject === 'string' ? auth.extra.subject : undefined,
    clientId: typeof auth.clientId === 'string' ? auth.clientId : undefined,
    scopes: Array.isArray(auth.scopes) ? [...auth.scopes] : [] };
}
async function handleHttp(req, res, opts) {
  const server = createServer(opts && opts.getPacket, { ...opts, auth: authFromVerifiedRequest(req) });
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
  authFromVerifiedRequest,
};
