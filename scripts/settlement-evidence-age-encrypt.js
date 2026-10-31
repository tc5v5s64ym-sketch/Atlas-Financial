'use strict';
// Recipient-only encrypt(bytes) for the existing object-adapter seam. Inert on
// import; no production binding. Profile: native ML-KEM-768 + X25519 hybrid.
// A single public recipient only. Multiple age recipients are OR, not quorum.
const A = require('./settlement-evidence-age-process');
const TA = Object.getPrototypeOf(Uint8Array.prototype);
const get = name => Object.getOwnPropertyDescriptor(TA, name).get;
const tag = get(Symbol.toStringTag), length = get('byteLength'), buffer = get('buffer'), offset = get('byteOffset');
const set = TA.set;
function copyBytes(value, max) {
  if (!value || Reflect.apply(tag, value, []) !== 'Uint8Array') throw new Error('age input unavailable');
  const n = Reflect.apply(length, value, []), backing = Reflect.apply(buffer, value, []);
  if (!n || n > max || !(backing instanceof ArrayBuffer)) throw new Error('age input unavailable');
  const out = Buffer.alloc(n);
  Reflect.apply(set, out, [new Uint8Array(backing, Reflect.apply(offset, value, []), n)]);
  return out;
}
function createAgeEncryptor(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype ||
    Reflect.ownKeys(options).some(k => !['binaryPath', 'recipient', 'timeoutMs'].includes(k) ||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(options, k), 'value'))) throw new Error('age options unavailable');
  const { binaryPath, recipient, timeoutMs = 10000 } = options;
  // Native recipient syntax only, never a private identity, SSH or plugin.
  // The official binary additionally validates the Bech32 checksum/encoding.
  if (typeof recipient !== 'string' || !/^age1pq1[023456789acdefghjklmnpqrstuvwxyz]{1900,2000}$/.test(recipient))
    throw new Error('age recipient unavailable');
  A.verifyAgeBinary(binaryPath);
  return async function encrypt(bytes) {
    const input = copyBytes(bytes, 4 * 1024 * 1024);
    try {
      return await A.runAge({ binaryPath, args: ['--encrypt', '--recipient', recipient], input,
        maxOutput: 5 * 1024 * 1024, timeoutMs });
    } finally { input.fill(0); }
  };
}
module.exports = Object.freeze({ createAgeEncryptor, copyBytes });
