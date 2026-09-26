import crypto from 'crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

const LINE_CHANNEL_SECRET = requiredEnv('LINE_CHANNEL_SECRET');
const LINE_CHANNEL_ACCESS_TOKEN = requiredEnv('LINE_CHANNEL_ACCESS_TOKEN');
const LINE_USERS_TABLE_NAME = requiredEnv('LINE_USERS_TABLE_NAME');

const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export function verifySignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) {
    return false;
  }
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

export interface LineEvent {
  type: string;
  timestamp?: number;
  source?: {
    userId?: string;
  };
}

interface LineWebhookBody {
  destination?: string;
  events?: LineEvent[];
}

export interface UserItem {
  userId: string;
  displayName: string;
  timestamp: number;
  followedAt: string;
}

export function buildUserItem(event: LineEvent, displayName: string): UserItem {
  const timestamp = event.timestamp ?? Date.now();
  return {
    userId: event.source?.userId ?? '',
    displayName,
    timestamp,
    followedAt: new Date(timestamp).toISOString(),
  };
}

async function fetchDisplayName(userId: string): Promise<string> {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    });
    if (!res.ok) {
      console.error(`LINE profile API returned ${res.status}: ${await res.text()}`);
      return 'Unknown';
    }
    const profile = (await res.json()) as { displayName?: string };
    return profile.displayName ?? 'Unknown';
  } catch (error) {
    console.error('failed to fetch LINE profile', error);
    return 'Unknown';
  }
}

async function handleEvent(event: LineEvent): Promise<void> {
  if (event.type !== 'follow' || !event.source?.userId) {
    console.log(`ignoring event: type=${event.type}`);
    return;
  }
  const displayName = await fetchDisplayName(event.source.userId);
  const item = buildUserItem(event, displayName);
  await docClient.send(new PutCommand({ TableName: LINE_USERS_TABLE_NAME, Item: item }));
  console.log(`Saved userId: ${item.userId} displayName: ${item.displayName}`);
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf-8')
    : (event.body ?? '');
  const signature = event.headers?.['x-line-signature'];

  if (!verifySignature(rawBody, signature, LINE_CHANNEL_SECRET)) {
    console.warn('invalid or missing x-line-signature');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody) as LineWebhookBody;
  } catch (error) {
    console.error('failed to parse request body', error);
    return { statusCode: 400, body: 'Bad Request' };
  }

  const results = await Promise.allSettled((body.events ?? []).map(handleEvent));
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('event handling failed', result.reason);
    }
  }

  return { statusCode: 200, body: 'OK' };
};
