#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MakeVoiceStack } from '../lib/make-voice-stack';
import { LineEchoStack } from '../lib/line-echo-stack';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

new MakeVoiceStack(app, 'TtMakeVoiceStack', { env });

const lineChannelSecret =
  process.env.LINE_CHANNEL_SECRET ?? app.node.tryGetContext('lineChannelSecret') ?? '';
const lineChannelAccessToken =
  process.env.LINE_CHANNEL_ACCESS_TOKEN ?? app.node.tryGetContext('lineChannelAccessToken') ?? '';
if (!lineChannelSecret || !lineChannelAccessToken) {
  console.warn(
    'LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN are not set; TtLineEchoStack synthesis will fail. ' +
      'Set them as environment variables or via -c lineChannelSecret=... -c lineChannelAccessToken=...',
  );
}

new LineEchoStack(app, 'TtLineEchoStack', {
  env,
  lineChannelSecret,
  lineChannelAccessToken,
});
