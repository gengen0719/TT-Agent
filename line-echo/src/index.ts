import crypto from 'crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
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
const MAKE_VOICE_FUNCTION_ARN = requiredEnv('MAKE_VOICE_FUNCTION_ARN');
const VOICE_BUCKET_NAME = requiredEnv('VOICE_BUCKET_NAME');
const LINE_USERS_TABLE_NAME = requiredEnv('LINE_USERS_TABLE_NAME');

const lambdaClient = new LambdaClient({});
const s3Client = new S3Client({});
const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
const VERIFICATION_REPLY_TOKEN = '00000000000000000000000000000000';
const PRESIGNED_URL_EXPIRES_IN = 300;

export type LineEventRoute = 'follow' | 'text-message' | 'ignore';

export function classifyLineEvent(event: LineEvent): LineEventRoute {
  if (event.type === 'follow' && event.source?.userId) {
    return 'follow';
  }
  if (
    event.type === 'message' &&
    event.message?.type === 'text' &&
    typeof event.message.text === 'string' &&
    event.replyToken &&
    event.replyToken !== VERIFICATION_REPLY_TOKEN
  ) {
    return 'text-message';
  }
  return 'ignore';
}

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

export interface MakeVoiceResult {
  audioLength: number;
  bucket: string;
  key: string;
}

export function parseMakeVoiceResponse(payload: Uint8Array | string | undefined): MakeVoiceResult {
  if (!payload) {
    throw new Error('make-voice returned an empty payload');
  }
  const raw = typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf-8');
  const outer = JSON.parse(raw) as { statusCode?: number; body?: string };
  if (outer.statusCode !== 200 || !outer.body) {
    throw new Error(`make-voice returned statusCode=${outer.statusCode} body=${outer.body}`);
  }
  const body = JSON.parse(outer.body) as { 'Audio-Length'?: number; bucket?: string; key?: string };
  if (typeof body['Audio-Length'] !== 'number' || !body.bucket || !body.key) {
    throw new Error(`unexpected make-voice body: ${outer.body}`);
  }
  return { audioLength: body['Audio-Length'], bucket: body.bucket, key: body.key };
}

interface LineMessage {
  type: string;
  text?: string;
}

export interface LineEvent {
  type: string;
  timestamp?: number;
  replyToken?: string;
  message?: LineMessage;
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

async function makeVoice(text: string): Promise<MakeVoiceResult> {
  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: MAKE_VOICE_FUNCTION_ARN,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify({ text }),
    }),
  );
  if (response.FunctionError) {
    throw new Error(`make-voice invocation failed: ${response.FunctionError}`);
  }
  return parseMakeVoiceResponse(response.Payload);
}

async function presignedVoiceUrl(key: string): Promise<string> {
  return getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: VOICE_BUCKET_NAME, Key: key }),
    { expiresIn: PRESIGNED_URL_EXPIRES_IN },
  );
}

async function replyToLine(replyToken: string, messages: Record<string, unknown>[]): Promise<void> {
  const res = await fetch(LINE_REPLY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    console.error(`LINE reply API returned ${res.status}: ${await res.text()}`);
  }
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

async function handleTextMessage(replyToken: string, text: string): Promise<void> {
  const messages: Record<string, unknown>[] = [{ type: 'text', text }];
  try {
    const voice = await makeVoice(text);
    const url = await presignedVoiceUrl(voice.key);
    messages.push({ type: 'audio', originalContentUrl: url, duration: voice.audioLength });
  } catch (error) {
    console.error('make-voice failed; replying with text only', error);
  }
  await replyToLine(replyToken, messages);
}

async function handleEvent(event: LineEvent): Promise<void> {
  switch (classifyLineEvent(event)) {
    case 'follow': {
      const userId = event.source!.userId!;
      const displayName = await fetchDisplayName(userId);
      const item = buildUserItem(event, displayName);
      await docClient.send(new PutCommand({ TableName: LINE_USERS_TABLE_NAME, Item: item }));
      console.log(`Saved userId: ${item.userId} displayName: ${item.displayName}`);
      return;
    }
    case 'text-message':
      await handleTextMessage(event.replyToken!, event.message!.text!);
      return;
    case 'ignore':
      console.log(`ignoring event: type=${event.type} messageType=${event.message?.type}`);
  }
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
