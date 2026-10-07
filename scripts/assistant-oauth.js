'use strict';
/* OAuth 2.1 protected-resource boundary for the Atlas MCP endpoint.
 *
 * Atlas is only the resource server. An external standards-compatible OAuth
 * authorization server owns login, consent, PKCE, client registration, token
 * issuance, and refresh. Atlas verifies every issuer-signed JWT access token
 * locally against the configured issuer JWKS, the exact configured issuer
 * identifier, audience/resource, expiry, and read scope. Opaque tokens are
 * not supported; there is no introspection path.
 */
const {
  InvalidTokenError,
} = require('@modelcontextprotocol/sdk/server/auth/errors.js');
const {
  requireBearerAuth,
} = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js');
const AssistantMcp = require('./assistant-mcp.js');
const { READ_SCOPE, WRITE_SCOPE } = require('./assistant-lunchmoney.js');

const METADATA_PATH = '/.well-known/oauth-protected-resource';
// WWW-Authenticate challenge advertises packet + ledger-read so MCP clients
// (SEP-835) request both. Gate still requires only atlas.current.read. Write
// stays out of the challenge so it is not requested up front.
const CHALLENGE_SCOPES = Object.freeze([
  AssistantMcp.REQUIRED_SCOPE,
  READ_SCOPE,
]);
const ASYMMETRIC_JWT_ALGORITHMS = Object.freeze([
  'RS256', 'RS384', 'RS512',
  'PS256', 'PS384', 'PS512',
  'ES256', 'ES384', 'ES512',
  'EdDSA',
]);

function safeUrl(name, raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.username || url.password || url.hash || url.search) {
    throw new Error(`${name} must not contain credentials, query, or fragment`);
  }
  const localHttp = url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1');
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error(`${name} must use HTTPS outside localhost`);
  }
  return url;
}

function readConfig(env) {
  env = env || {};
  const raw = {
    resource: env.ATLAS_MCP_RESOURCE_URL || '',
    issuer: env.ATLAS_OAUTH_ISSUER || '',
    jwksUri: env.ATLAS_OAUTH_JWKS_URI || '',
  };
  const present = Object.values(raw).filter(Boolean).length;
  if (present === 0) {
    return { configured: false, reason: 'oauth-not-configured' };
  }
  if (present !== Object.keys(raw).length) {
    return { configured: false, reason: 'oauth-configuration-incomplete' };
  }
  try {
    const resource = safeUrl('ATLAS_MCP_RESOURCE_URL', raw.resource);
    // Validate the issuer as a safe absolute HTTPS URL, but keep the
    // configured identifier exactly. `URL.href` can append `/` and would
    // then fail exact OAuth issuer comparison.
    safeUrl('ATLAS_OAUTH_ISSUER', raw.issuer);
    const jwksUri = safeUrl('ATLAS_OAUTH_JWKS_URI', raw.jwksUri);
    if (resource.pathname !== '/assistant/mcp') {
      throw new Error('ATLAS_MCP_RESOURCE_URL must identify /assistant/mcp');
    }
    return {
      configured: true,
      resource,
      issuer: raw.issuer,
      jwksUri,
      requiredScope: AssistantMcp.REQUIRED_SCOPE,
      metadataUrl: new URL(METADATA_PATH, resource).href,
    };
  } catch (err) {
    return { configured: false, reason: err.message };
  }
}

function protectedResourceMetadata(config) {
  if (!config || !config.configured) throw new Error('OAuth is not configured');
  return {
    resource: config.resource.href,
    authorization_servers: [config.issuer],
    scopes_supported: [config.requiredScope, READ_SCOPE, WRITE_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Atlas Financial assistant with confirmed Lunch Money edits',
  };
}

function parseScopes(payload) {
  if (typeof payload.scope === 'string') {
    return payload.scope.split(/\s+/).filter(Boolean);
  }
  if (Array.isArray(payload.scp)) {
    return payload.scp.filter(scope => typeof scope === 'string' && scope);
  }
  if (typeof payload.scp === 'string') {
    return payload.scp.split(/\s+/).filter(Boolean);
  }
  return [];
}

function createTokenVerifier(config, deps) {
  if (!config || !config.configured) throw new Error('OAuth is not configured');
  deps = deps || {};
  let josePromise;
  let jwks;
  async function jose() {
    if (!josePromise) josePromise = deps.jose ? Promise.resolve(deps.jose) : import('jose');
    return josePromise;
  }
  return {
    async verifyAccessToken(token) {
      try {
        if (typeof token !== 'string' || !token) throw new Error('missing token');
        const lib = await jose();
        if (!jwks) jwks = deps.jwks || lib.createRemoteJWKSet(config.jwksUri);
        const verified = await lib.jwtVerify(token, jwks, {
          issuer: config.issuer,
          audience: config.resource.href,
          algorithms: ASYMMETRIC_JWT_ALGORITHMS,
          requiredClaims: ['iss', 'aud', 'exp'],
        });
        const payload = verified.payload || {};
        if (typeof payload.exp !== 'number') throw new Error('missing expiry');
        const clientId = typeof payload.client_id === 'string' && payload.client_id
          ? payload.client_id
          : (typeof payload.azp === 'string' && payload.azp ? payload.azp : 'oauth-client');
        return {
          token,
          clientId,
          scopes: parseScopes(payload),
          expiresAt: payload.exp,
          resource: config.resource,
          extra: typeof payload.sub === 'string' ? { subject: payload.sub } : {},
        };
      } catch {
        throw new InvalidTokenError('Invalid or expired access token');
      }
    },
  };
}

function rewriteChallengeScope(header, advertisedScope) {
  if (typeof header !== 'string' || !header) return header;
  if (/\bscope="/.test(header)) {
    return header.replace(/\bscope="[^"]*"/, `scope="${advertisedScope}"`);
  }
  return header;
}

function createBearerMiddleware(config, deps) {
  const inner = requireBearerAuth({
    verifier: createTokenVerifier(config, deps),
    requiredScopes: [config.requiredScope],
    resourceMetadataUrl: config.metadataUrl,
  });
  const advertised = CHALLENGE_SCOPES.join(' ');
  return async function advertiseChallengeScopes(req, res, next) {
    const originalSet = res.set.bind(res);
    res.set = function setWithChallengeScopes(field, value) {
      if (arguments.length >= 2
          && typeof field === 'string'
          && field.toLowerCase() === 'www-authenticate') {
        return originalSet(field, rewriteChallengeScope(value, advertised));
      }
      if (arguments.length === 1 && field && typeof field === 'object') {
        const headers = Object.assign({}, field);
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'www-authenticate') {
            headers[key] = rewriteChallengeScope(headers[key], advertised);
          }
        }
        return originalSet(headers);
      }
      return originalSet.apply(res, arguments);
    };
    return inner(req, res, next);
  };
}

module.exports = {
  METADATA_PATH,
  CHALLENGE_SCOPES,
  ASYMMETRIC_JWT_ALGORITHMS,
  safeUrl,
  readConfig,
  protectedResourceMetadata,
  parseScopes,
  rewriteChallengeScope,
  createTokenVerifier,
  createBearerMiddleware,
};
