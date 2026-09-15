'use strict';
/* Talk progressive presentation — allowlisted status, then verified payload.
 *
 * This is not a second answer authority and not a Gemini token pipe.
 * Status events are fixed phase ids only. The final result event is the
 * same public JSON body POST /talk/ask already publishes after packet
 * verification, Forecast computation where authorized, and Atlas
 * presentation. Incomplete model JSON, free-form model prose, and
 * session-turn internals cannot be encoded. There is no Last-Event-ID
 * resume and no partial figure.
 */

const EVENT_NAMES = Object.freeze({
  status: true,
  result: true,
  error: true,
});

const PHASES = Object.freeze({
  understanding: true,
  'checking-atlas-context': true,
  'running-forecast': true,
  'preparing-verified-answer': true,
});

const ERRORS = Object.freeze({
  'talk unavailable': true,
  'talk answer unavailable': true,
  'malformed request': true,
  'question too long': true,
  'not authenticated': true,
});

const RESULT_KEYS = Object.freeze([
  'answer',
  'source',
  'trust',
  'asOf',
  'freshness',
  'action',
  'cards',
  'citations',
]);

function wantsStream(req) {
  const accept = req && req.headers && req.headers.accept;
  if (typeof accept !== 'string' || !accept) return false;
  // Explicit text/event-stream token only. */* is not a stream request.
  return /(?:^|,)\s*text\/event-stream(?:\s*;[^,]*)?(?:\s*,|$)/i.test(accept);
}

function publicAskBody(presented) {
  if (!presented || typeof presented !== 'object' || Array.isArray(presented)) {
    return null;
  }
  if (typeof presented.answer !== 'string' || !presented.answer.trim()) {
    return null;
  }
  return {
    answer: presented.answer,
    source: presented.source || null,
    trust: presented.trust || null,
    asOf: presented.asOf || null,
    freshness: presented.freshness || null,
    action: presented.action || null,
    cards: presented.cards || null,
    citations: presented.citations || null,
  };
}

function encodeEvent(name, data) {
  if (!EVENT_NAMES[name]) return '';
  if (name === 'status') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
    if (Object.keys(data).length !== 1 || !PHASES[data.phase]) return '';
  } else if (name === 'error') {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
    if (Object.keys(data).length !== 1 || !ERRORS[data.error]) return '';
  } else if (name === 'result') {
    const body = publicAskBody(data);
    if (!body) return '';
    data = body;
  } else {
    return '';
  }
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function beginStream(res) {
  if (!res || res.headersSent) return false;
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  return true;
}

function writeEncoded(res, encoded) {
  if (!encoded || !res || res.writableEnded || res.destroyed) return false;
  const wrote = res.write(encoded);
  if (typeof res.flush === 'function') res.flush();
  return wrote !== false;
}

function writeStatus(res, phase) {
  return writeEncoded(res, encodeEvent('status', { phase }));
}

function writeResult(res, presented) {
  const body = publicAskBody(presented);
  if (!body) return false;
  return writeEncoded(res, encodeEvent('result', body));
}

function writeError(res, error) {
  return writeEncoded(res, encodeEvent('error', { error }));
}

function endStream(res) {
  if (res && !res.writableEnded) res.end();
}

function createAbortGate(req, res) {
  let closed = false;
  const mark = () => {
    // Request 'close' fires after the body is consumed. Only the
    // response closing before end means the household left mid-flight.
    if (res && !res.writableEnded) closed = true;
  };
  if (res && typeof res.on === 'function') {
    res.on('close', mark);
  }
  if (req && typeof req.on === 'function') {
    req.on('aborted', mark);
  }
  return {
    get closed() {
      return closed || !!(req && req.aborted);
    },
  };
}

module.exports = {
  EVENT_NAMES,
  PHASES,
  ERRORS,
  RESULT_KEYS,
  wantsStream,
  publicAskBody,
  encodeEvent,
  beginStream,
  writeStatus,
  writeResult,
  writeError,
  endStream,
  createAbortGate,
};
