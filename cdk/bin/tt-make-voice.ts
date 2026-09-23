#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { MakeVoiceStack } from '../lib/make-voice-stack';

const app = new cdk.App();
new MakeVoiceStack(app, 'TtMakeVoiceStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
