import datetime
import io
import json
import os
import subprocess
import tempfile
import uuid
import wave

import boto3
from voicevox_core.blocking import (
    Onnxruntime,
    OpenJtalk,
    Synthesizer,
    VoiceModelFile,
)

s3 = boto3.client('s3')
bucket = os.environ['BUCKET_NAME']

SPEAKER_ID = 47 # ナースロボ＿タイプＴ（ノーマル）
ONNXRUNTIME_PATH = './lib/onnxruntime/lib/libvoicevox_onnxruntime.so.1.17.3'
OPEN_JTALK_DICT_DIR = './lib/dict/open_jtalk_dic_utf_8-1.11'
VVM_PATH = './lib/models/vvms/11.vvm'

onnxruntime = Onnxruntime.load_once(filename=ONNXRUNTIME_PATH)
open_jtalk = OpenJtalk(OPEN_JTALK_DICT_DIR)
synthesizer = Synthesizer(onnxruntime, open_jtalk, acceleration_mode="AUTO")
with VoiceModelFile.open(VVM_PATH) as model:
    synthesizer.load_voice_model(model)

def handler(event, context):
    text = event.get('text', 'テキストが空です')
    audio_query = synthesizer.create_audio_query(text, SPEAKER_ID)
    wav = synthesizer.synthesis(audio_query, SPEAKER_ID)
    with wave.open(io.BytesIO(wav), mode='rb') as audio:
        audio_length = audio.getnframes() * 1000 // audio.getframerate()

    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S')
    key = f'{timestamp}-{uuid.uuid4().hex}.mp3'
    with tempfile.TemporaryDirectory(dir='/tmp') as directory:
        mp3_path = os.path.join(directory, 'voice.mp3')
        # FFmpeg needs seekable output to write the encoder delay and padding.
        subprocess.run(
            ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0',
             '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', mp3_path],
            input=wav,
            check=True,
        )
        with open(mp3_path, 'rb') as mp3:
            s3.put_object(
                Bucket=bucket,
                Body=mp3,
                Key=key,
                ContentType='audio/mpeg',
                Metadata={'duration': str(audio_length)},
            )

    response = {
        'Audio-Length': audio_length,
        'bucket': bucket,
        'key': key,
    }

    return {
        'statusCode': 200,
        'body': json.dumps(response)
    }
