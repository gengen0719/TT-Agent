#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MakeVoiceStack } from '../lib/make-voice-stack';
import { LineEchoStack } from '../lib/line-echo-stack';
import { LineChatStack } from '../lib/line-chat-stack';

const app = new cdk.App();
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

new MakeVoiceStack(app, 'TtMakeVoiceStack', { env });

new LineEchoStack(app, 'TtLineEchoStack', { env });

new LineChatStack(app, 'TtLineChatStack', { env });
