import { createPrivateKey, sign as cryptoSign } from 'node:crypto';

// Minimal JWT signing for the two provider tokens this service needs: ES256
// for APNs (Apple's .p8 key) and RS256 for Google's service-account assertion.
// Both are a handful of lines with node:crypto, and neither justifies a
// dependency in a service whose whole job is to be cheap to run.

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function encodeSegment(obj) {
  return b64url(JSON.stringify(obj));
}

export function signJwt({ header, claims, privateKey, algorithm }) {
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
  const body = `${encodeSegment(header)}.${encodeSegment(claims)}`;
  // ES256 signatures must be raw r||s, not the DER envelope node emits by
  // default. Getting this wrong yields a 403 InvalidProviderToken that looks
  // exactly like a bad key.
  const options =
    algorithm === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : { key };
  const signature = cryptoSign('sha256', Buffer.from(body), options);
  return `${body}.${signature.toString('base64url')}`;
}

// Apple provider token. Valid for an hour; Apple rejects tokens refreshed more
// than once every 20 minutes, so callers cache for ~40.
export function appleProviderToken({ keyId, teamId, privateKey, nowSec = Math.floor(Date.now() / 1000) }) {
  return signJwt({
    header: { alg: 'ES256', kid: keyId, typ: 'JWT' },
    claims: { iss: teamId, iat: nowSec },
    privateKey,
    algorithm: 'ES256',
  });
}

// Google service-account assertion, exchanged at the OAuth token endpoint for
// the bearer token FCM v1 wants.
export function googleAssertion({
  clientEmail,
  privateKey,
  scope = 'https://www.googleapis.com/auth/firebase.messaging',
  audience = 'https://oauth2.googleapis.com/token',
  nowSec = Math.floor(Date.now() / 1000),
  ttlSec = 3600,
}) {
  return signJwt({
    header: { alg: 'RS256', typ: 'JWT' },
    claims: {
      iss: clientEmail,
      scope,
      aud: audience,
      iat: nowSec,
      exp: nowSec + ttlSec,
    },
    privateKey,
    algorithm: 'RS256',
  });
}
