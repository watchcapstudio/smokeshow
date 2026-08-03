import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

// Identity here is deliberately thin: an opaque device ID and a secret, both
// random, neither derived from anything about the person holding the phone.
// No email, no password, no account (platform plan §4). The ID is the only
// handle the service has on a subscriber, which is also why deleting a device
// row is a complete deletion — there is nothing else to forget.

const ID_BYTES = 16; // 128 bits, base64url -> 22 chars
const SECRET_BYTES = 32;

function b64url(buf) {
  return buf.toString('base64url');
}

export function newDeviceId() {
  return `dev_${b64url(randomBytes(ID_BYTES))}`;
}

// Returned to the client exactly once, at registration. The service stores
// only the hash, so a dump of the device table cannot be used to impersonate
// or reconfigure anyone's device.
export function newDeviceSecret() {
  return b64url(randomBytes(SECRET_BYTES));
}

export function hashSecret(secret) {
  return createHash('sha256').update(String(secret)).digest('hex');
}

export function secretMatches(secret, storedHash) {
  if (!secret || !storedHash) return false;
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(String(storedHash), 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Webhook shared secrets are compared the same way — a length-leaking `===`
// on a bearer token is how you turn an authenticated endpoint into an
// unauthenticated one.
export function constantTimeEquals(a, b) {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
