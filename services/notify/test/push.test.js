import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto';
import { createDispatcher } from '../src/push/dispatcher.js';
import { createApnsSender } from '../src/push/apns.js';
import { createFcmSender } from '../src/push/fcm.js';
import { appleProviderToken, googleAssertion } from '../src/push/jwt.js';
import { createMemoryStore } from '../src/store.js';
import { buildDeviceRecord } from '../src/store.js';

const message = { title: 'Heavy haze in Home', body: 'Clears Thursday ~6 PM', urgent: true, collapseId: 'k', data: {} };

function decode(token) {
  const [header, claims, signature] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url')),
    claims: JSON.parse(Buffer.from(claims, 'base64url')),
    signed: `${header}.${claims}`,
    signature: Buffer.from(signature, 'base64url'),
  };
}

describe('provider tokens', () => {
  it('signs an APNs token Apple can verify (raw r||s, not DER)', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const token = appleProviderToken({
      keyId: 'ABC123DEFG',
      teamId: 'TEAM123456',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      nowSec: 1_800_000_000,
    });
    const { header, claims, signed, signature } = decode(token);

    expect(header).toEqual({ alg: 'ES256', kid: 'ABC123DEFG', typ: 'JWT' });
    expect(claims).toEqual({ iss: 'TEAM123456', iat: 1_800_000_000 });
    expect(signature).toHaveLength(64); // P-256 r||s; a DER blob would be ~70 and Apple would 403
    expect(cryptoVerify('sha256', Buffer.from(signed), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature)).toBe(true);
  });

  it('signs a Google assertion with the scope FCM wants', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const token = googleAssertion({
      clientEmail: 'push@smokeshow.iam.gserviceaccount.com',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      nowSec: 1_800_000_000,
    });
    const { header, claims, signed, signature } = decode(token);

    expect(header.alg).toBe('RS256');
    expect(claims.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    expect(claims.exp).toBe(1_800_003_600);
    expect(cryptoVerify('sha256', Buffer.from(signed), publicKey, signature)).toBe(true);
  });
});

// A stand-in for an HTTP/2 session: enough of the surface for the sender to
// drive it, so the status-to-verdict mapping is tested rather than assumed.
function fakeApnsSession(responses) {
  const requests = [];
  const session = new EventEmitter();
  session.closed = false;
  session.destroyed = false;
  session.request = (headers) => {
    requests.push(headers);
    const stream = new EventEmitter();
    stream.setEncoding = () => {};
    stream.end = () => {
      const response = responses[requests.length - 1] ?? responses.at(-1);
      queueMicrotask(() => {
        stream.emit('response', { ':status': response.status });
        if (response.body) stream.emit('data', response.body);
        stream.emit('end');
      });
    };
    return stream;
  };
  session.close = () => {
    session.closed = true;
  };
  return { session, requests };
}

function apnsFixture(responses) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const { session, requests } = fakeApnsSession(responses);
  const sender = createApnsSender({
    keyId: 'K',
    teamId: 'T',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    topic: 'earth.smokeshow.app',
    connect: () => session,
  });
  return { sender, requests };
}

describe('APNs response mapping', () => {
  it('reports success on 200 and sets the urgent headers', async () => {
    const { sender, requests } = apnsFixture([{ status: 200 }]);
    expect(await sender.send({ token: 'tok', platform: 'ios', message })).toMatchObject({ ok: true });

    expect(requests[0][':path']).toBe('/3/device/tok');
    expect(requests[0]['apns-priority']).toBe('10');
    expect(requests[0]['apns-topic']).toBe('earth.smokeshow.app');
    expect(requests[0].authorization).toMatch(/^bearer /);
  });

  it('marks a non-urgent alert priority 5', async () => {
    const { sender, requests } = apnsFixture([{ status: 200 }]);
    await sender.send({ token: 'tok', platform: 'ios', message: { ...message, urgent: false } });
    expect(requests[0]['apns-priority']).toBe('5');
  });

  it('treats 410 as a dead token', async () => {
    const { sender } = apnsFixture([{ status: 410, body: '{"reason":"Unregistered"}' }]);
    expect(await sender.send({ token: 'tok', platform: 'ios', message })).toMatchObject({ invalidToken: true });
  });

  it('treats BadDeviceToken at 400 as a dead token', async () => {
    const { sender } = apnsFixture([{ status: 400, body: '{"reason":"BadDeviceToken"}' }]);
    expect(await sender.send({ token: 'tok', platform: 'ios', message })).toMatchObject({ invalidToken: true });
  });

  it('treats 503 as retryable and a 400 PayloadTooLarge as permanent', async () => {
    const { sender } = apnsFixture([{ status: 503, body: '{"reason":"ServiceUnavailable"}' }]);
    expect(await sender.send({ token: 'tok', platform: 'ios', message })).toMatchObject({ retryable: true });

    const permanent = apnsFixture([{ status: 400, body: '{"reason":"PayloadTooLarge"}' }]);
    const verdict = await permanent.sender.send({ token: 'tok', platform: 'ios', message });
    expect(verdict).toMatchObject({ ok: false, retryable: false });
    expect(verdict.invalidToken).toBeUndefined(); // a bad payload is our bug, not a dead phone
  });

  it('refuses to pretend it is configured when it is not', async () => {
    const sender = createApnsSender({});
    expect(await sender.send({ token: 'tok', platform: 'ios', message })).toMatchObject({
      ok: false,
      reason: 'apns-not-configured',
    });
  });
});

function fcmFixture(sendResponses) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const calls = [];
  let sendIndex = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('oauth2')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.fake', expires_in: 3600 }) };
    }
    const response = sendResponses[sendIndex++] ?? sendResponses.at(-1);
    return {
      ok: response.status === 200,
      status: response.status,
      json: async () => response.body ?? {},
    };
  };
  const sender = createFcmSender({
    projectId: 'smokeshow',
    clientEmail: 'push@smokeshow.iam.gserviceaccount.com',
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    fetchImpl,
  });
  return { sender, calls };
}

describe('FCM response mapping', () => {
  it('exchanges the assertion once and reuses the bearer', async () => {
    const { sender, calls } = fcmFixture([{ status: 200 }]);
    await sender.send({ token: 'tok', platform: 'android', message });
    await sender.send({ token: 'tok', platform: 'android', message });

    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
    const body = JSON.parse(calls.at(-1).init.body);
    expect(body.message.token).toBe('tok');
    expect(body.message.android.priority).toBe('high');
    expect(body.message.android.notification.channel_id).toBe('smokeshow_alerts');
  });

  it('stringifies data values, because FCM rejects anything else', async () => {
    const { sender, calls } = fcmFixture([{ status: 200 }]);
    await sender.send({
      token: 'tok',
      platform: 'android',
      message: { ...message, data: { levelIndex: 3, label: null, lat: 39.7 } },
    });

    const { data } = JSON.parse(calls.at(-1).init.body).message;
    expect(data).toEqual({ levelIndex: '3', label: 'null', lat: '39.7' });
  });

  it('treats UNREGISTERED as a dead token', async () => {
    const { sender } = fcmFixture([
      { status: 404, body: { error: { status: 'UNREGISTERED', message: 'app uninstalled' } } },
    ]);
    expect(await sender.send({ token: 'tok', platform: 'android', message })).toMatchObject({ invalidToken: true });
  });

  it('retries a 503 and a stale bearer', async () => {
    const unavailable = fcmFixture([{ status: 503, body: { error: { status: 'UNAVAILABLE' } } }]);
    expect(await unavailable.sender.send({ token: 'tok', platform: 'android', message })).toMatchObject({
      retryable: true,
    });

    const expired = fcmFixture([{ status: 401, body: { error: { status: 'UNAUTHENTICATED' } } }]);
    expect(await expired.sender.send({ token: 'tok', platform: 'android', message })).toMatchObject({ retryable: true });
  });
});

function fixtureDevice(platform = 'ios') {
  return buildDeviceRecord({ id: 'dev-1', secret: 's', platform, pushToken: 'tok-1' });
}

describe('the dispatcher', () => {
  const noSleep = async () => {};

  it('routes by platform', async () => {
    const seen = [];
    const sender = (name) => ({ name, send: async () => (seen.push(name), { ok: true }) });
    const dispatcher = createDispatcher({
      senders: { apns: sender('apns'), fcm: sender('fcm') },
      store: createMemoryStore(),
      sleep: noSleep,
    });

    for (const platform of ['ios', 'macos', 'android']) {
      await dispatcher.deliver({ device: fixtureDevice(platform), message });
    }
    expect(seen).toEqual(['apns', 'apns', 'fcm']);
  });

  it('retries a retryable failure and succeeds', async () => {
    let attempts = 0;
    const apns = {
      name: 'apns',
      send: async () => (++attempts < 3 ? { ok: false, retryable: true, status: 503 } : { ok: true }),
    };
    const dispatcher = createDispatcher({ senders: { apns }, store: createMemoryStore(), sleep: noSleep });

    const result = await dispatcher.deliver({ device: fixtureDevice(), message });
    expect(result).toMatchObject({ delivered: true, attempts: 3 });
  });

  it('gives up after the attempt budget and reports it as retryable', async () => {
    const apns = { name: 'apns', send: async () => ({ ok: false, retryable: true, status: 503 }) };
    const dispatcher = createDispatcher({
      senders: { apns },
      store: createMemoryStore(),
      attempts: 3,
      sleep: noSleep,
    });

    const result = await dispatcher.deliver({ device: fixtureDevice(), message });
    expect(result).toMatchObject({ delivered: false, retryable: true, attempts: 3 });
  });

  it('does not retry a permanent rejection', async () => {
    let calls = 0;
    const apns = {
      name: 'apns',
      send: async () => (calls++, { ok: false, retryable: false, status: 400, reason: 'PayloadTooLarge' }),
    };
    const dispatcher = createDispatcher({ senders: { apns }, store: createMemoryStore(), sleep: noSleep });

    const result = await dispatcher.deliver({ device: fixtureDevice(), message });
    expect(calls).toBe(1);
    expect(result.delivered).toBe(false);
  });

  it('clears the token when the provider says the install is gone', async () => {
    const store = createMemoryStore();
    const device = fixtureDevice();
    await store.registerDevice(device);

    const apns = { name: 'apns', send: async () => ({ ok: false, invalidToken: true, reason: 'Unregistered' }) };
    const dispatcher = createDispatcher({ senders: { apns }, store, sleep: noSleep });

    const result = await dispatcher.deliver({ device, message });
    expect(result).toMatchObject({ delivered: false, tokenCleared: true, retryable: false });
    expect((await store.getDevice(device.id)).pushToken).toBeNull();
  });

  it('keeps a token that was replaced while the send was in flight', async () => {
    const store = createMemoryStore();
    const device = fixtureDevice();
    await store.registerDevice(device);

    const apns = {
      name: 'apns',
      send: async () => {
        await store.updateDevice(device.id, { pushToken: 'tok-2' }); // the app re-registered
        return { ok: false, invalidToken: true, reason: 'Unregistered' };
      },
    };
    const dispatcher = createDispatcher({ senders: { apns }, store, sleep: noSleep });

    await dispatcher.deliver({ device, message });
    expect((await store.getDevice(device.id)).pushToken).toBe('tok-2');
  });

  it('refuses a platform it has no sender for', async () => {
    const dispatcher = createDispatcher({ senders: {}, store: createMemoryStore(), sleep: noSleep });
    const result = await dispatcher.deliver({ device: fixtureDevice('android'), message });
    expect(result).toMatchObject({ delivered: false, retryable: false });
  });
});
