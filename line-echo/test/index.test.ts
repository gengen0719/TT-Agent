import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler, parseMakeVoiceResponse, verifySignature } from '../src/index';

const SECRET = 'test-channel-secret';

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

describe('verifySignature', () => {
  it('accepts a valid signature', () => {
    const body = '{"events":[]}';
    assert.equal(verifySignature(body, sign(body, SECRET), SECRET), true);
  });

  it('rejects a wrong signature', () => {
    const body = '{"events":[]}';
    assert.equal(verifySignature(body, sign('tampered', SECRET), SECRET), false);
  });

  it('rejects a missing signature', () => {
    assert.equal(verifySignature('{}', undefined, SECRET), false);
  });

  it('rejects a malformed signature without throwing', () => {
    assert.equal(verifySignature('{}', '!!!not-base64!!!', SECRET), false);
  });
});

describe('parseMakeVoiceResponse', () => {
  it('parses a successful response', () => {
    const payload = JSON.stringify({
      statusCode: 200,
      body: JSON.stringify({ 'Audio-Length': 1234, bucket: 'voice-bucket', key: '20240101000000.wav' }),
    });
    assert.deepEqual(parseMakeVoiceResponse(payload), {
      audioLength: 1234,
      bucket: 'voice-bucket',
      key: '20240101000000.wav',
    });
  });

  it('parses a Uint8Array payload', () => {
    const payload = new TextEncoder().encode(
      JSON.stringify({ statusCode: 200, body: JSON.stringify({ 'Audio-Length': 10, bucket: 'b', key: 'k' }) }),
    );
    assert.equal(parseMakeVoiceResponse(payload).key, 'k');
  });

  it('throws on non-200 status', () => {
    const payload = JSON.stringify({ statusCode: 500, body: 'error' });
    assert.throws(() => parseMakeVoiceResponse(payload));
  });

  it('throws on missing fields', () => {
    const payload = JSON.stringify({ statusCode: 200, body: JSON.stringify({ 'Audio-Length': 1 }) });
    assert.throws(() => parseMakeVoiceResponse(payload));
  });

  it('throws on empty payload', () => {
    assert.throws(() => parseMakeVoiceResponse(undefined));
  });
});

describe('handler', () => {
  it('returns 401 when the signature is invalid', async () => {
    const event = {
      version: '2.0',
      headers: { 'x-line-signature': 'invalid' },
      body: '{"events":[]}',
      isBase64Encoded: false,
    } as unknown as APIGatewayProxyEventV2;
    const result = await handler(event);
    assert.equal(typeof result === 'object' && result.statusCode, 401);
  });

  it('returns 401 when the signature header is missing', async () => {
    const event = {
      version: '2.0',
      headers: {},
      body: '{"events":[]}',
      isBase64Encoded: false,
    } as unknown as APIGatewayProxyEventV2;
    const result = await handler(event);
    assert.equal(typeof result === 'object' && result.statusCode, 401);
  });
});
