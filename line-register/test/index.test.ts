import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { buildUserItem, handler, verifySignature } from '../src/index';

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

describe('buildUserItem', () => {
  it('builds an item with userId, displayName, timestamp and followedAt', () => {
    const item = buildUserItem(
      { type: 'follow', timestamp: 1700000000000, source: { userId: 'U123' } },
      'Taro',
    );
    assert.deepEqual(item, {
      userId: 'U123',
      displayName: 'Taro',
      timestamp: 1700000000000,
      followedAt: '2023-11-14T22:13:20.000Z',
    });
  });

  it('falls back to empty userId and current time when fields are missing', () => {
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
