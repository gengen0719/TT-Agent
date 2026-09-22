#!/usr/bin/env python3
import os

import aws_cdk as cdk

from tt_make_voice.make_voice_stack import MakeVoiceStack

app = cdk.App()
MakeVoiceStack(
    app,
    "TtMakeVoiceStack",
    env=cdk.Environment(
        account=os.environ.get("CDK_DEFAULT_ACCOUNT"),
        region=os.environ.get("CDK_DEFAULT_REGION"),
    ),
)
app.synth()
