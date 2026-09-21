import json
import boto3
from voicevox_core.blocking import (
    Onnxruntime,
    OpenJtalk,
    Synthesizer,
    VoiceModelFile,
)
import wave
import os
import datetime

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

    # リクエストイベントの text として送信されてきた文字列を取得し、音声データに変換する
    text = event.get('text','テキストが空です')
    audio_query = synthesizer.create_audio_query(text, SPEAKER_ID)
    wav = synthesizer.synthesis(audio_query, SPEAKER_ID)
    key = datetime.datetime.now().strftime('%Y%m%d%H%M%S') + '.wav'

    # 4. 音声ファイルの長さを取得
    path = '/tmp/' + key
    wr = open(path, 'wb')
    wr.write(wav)
    wr.close()
    wf = wave.open(path, mode='rb')
    audio_length = int((wf.getnframes() / wf.getframerate()) * 1000)

   # 音声ファイルを S3 バケットに保存する
   # 音声ファイルの長さをMeatadataで持たせる
    s3.put_object(
        Bucket= bucket,
        Body = wav,
        Key = key,
        Metadata = {
        'duration': str(audio_length)
        }
    )    

    os.remove(path)

    # 音声ファイルの長さをレスポンスする
    response = {
            'Audio-Length': audio_length
        }

    return {
        'statusCode': 200,
        'body': json.dumps(response)
    }
