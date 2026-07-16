'use strict';

// Password hashing — Node core scrypt only, no native/3rd-party dependency.
// Kept in its own module (separate from server/auth.js's session logic) so
// server/db.js can hash the bootstrap admin password without pulling in the
// db-coupled session code (avoids a require cycle).
//
// Stored format:  scrypt$N$r$p$saltB64$hashB64   (self-describing, so cost
// parameters can be raised later without breaking existing hashes).

const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

const N = 16384; // CPU/memory cost (2^14)
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const dk = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

// Synchronous variant — used ONLY for the one-time global-admin bootstrap in
// server/db.js (which runs synchronously at module load). Produces the exact
// same scrypt$… format, so verifyPassword() reads it identically. Do not use
// on the request path — it blocks the event loop.
function hashPasswordSync(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const dk = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  let dk;
  try {
    dk = await scrypt(password, salt, expected.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  // Constant-time compare; length guard because timingSafeEqual throws on mismatch.
  return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
}

module.exports = { hashPassword, hashPasswordSync, verifyPassword };
