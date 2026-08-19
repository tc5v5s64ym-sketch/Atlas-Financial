'use strict';
/* Local Lunch Money credential resolver and one-time Windows bootstrap.
 *
 *   node scripts/local-credentials.js setup-lunchmoney
 *   node scripts/local-credentials.js setup-lunchmoney --replace
 *   node scripts/local-credentials.js remove-lunchmoney
 *
 * Resolution order: process.env.LUNCHMONEY_ACCESS_TOKEN, then (Windows only)
 * CurrentUser DPAPI at %LOCALAPPDATA%\\Atlas-Financial\\secrets\\lunchmoney.dat.
 * The decrypted value stays in process memory for the GET-only Lunch Money
 * client. It is never printed, never placed in argv, and never written back
 * to the repository.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const readline = require('readline');

const TOKEN_ENV = 'LUNCHMONEY_ACCESS_TOKEN';
const PATH_ENV = 'ATLAS_LUNCHMONEY_CREDENTIAL_FILE';
const ROOT = path.join(__dirname, '..');
const DPAPI_SCRIPT = path.join(__dirname, 'windows-dpapi.ps1');
const DEFAULT_DIR_SEGMENTS = ['Atlas-Financial', 'secrets'];
const DEFAULT_FILE = 'lunchmoney.dat';
