import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  buildUserItem,
  classifyLineEvent,
  handler,
  parseMakeVoiceResponse,
  verifySignature,
} from '../src/index';

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

describe('classifyLineEvent', () => {
  it('routes follow events with a user ID to registration', () => {
    assert.equal(classifyLineEvent({ type: 'follow', source: { userId: 'U123' } }), 'follow');
  });

  it('routes text messages with a reply token to echo handling', () => {
    assert.equal(
      classifyLineEvent({
        type: 'message',
        replyToken: 'reply-token',
        message: { type: 'text', text: 'hello' },
      }),
      'text-message',
    );
  });

  it('ignores verification and unsupported events', () => {
    assert.equal(
      classifyLineEvent({
        type: 'message',
        replyToken: '00000000000000000000000000000000',
        message: { type: 'text', text: 'hello' },
      }),
      'ignore',
    );
    assert.equal(classifyLineEvent({ type: 'unfollow' }), 'ignore');
  });
});

describe('buildUserItem', () => {
  it('builds a user record from a follow event', () => {
    assert.deepEqual(
      buildUserItem({ type: 'follow', timestamp: 1700000000000, source: { userId: 'U123' } }, 'Taro'),
      {
        userId: 'U123',
        displayName: 'Taro',
        timestamp: 1700000000000,
        followedAt: '2023-11-14T22:13:20.000Z',
      },
    );
  });

  it('uses an empty user ID and current time when event fields are missing', () => {
    const item = buildUserItem({ type: 'follow' }, 'Unknown');
    assert.equal(item.userId, '');
    assert.equal(item.displayName, 'Unknown');
    assert.equal(typeof item.timestamp, 'number');
    assert.equal(item.followedAt, new Date(item.timestamp).toISOString());
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
