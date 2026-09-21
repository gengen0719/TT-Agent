import json
import boto3
import voicevox_core
from voicevox_core import AccelerationMode, VoicevoxCore
from pathlib import Path
import wave
import os
import datetime

s3 = boto3.client('s3')
bucket = os.environ['BUCKET_NAME']

SPEAKER_ID = 1 # ずんだもん（あまあま）
                
open_jtalk_dict_dir = './open_jtalk_dic_utf_8-1.11'
acceleration_mode = AccelerationMode.AUTO
core = VoicevoxCore(
        acceleration_mode=acceleration_mode, open_jtalk_dict_dir=open_jtalk_dict_dir
    )
core.load_model(SPEAKER_ID)

def handler(event, context):

    # リクエストイベントの text として送信されてきた文字列を取得し、音声データに変換する
    text = event.get('text','テキストが空なのだ')
    audio_query = core.audio_query(text, SPEAKER_ID)
    wav = core.synthesis(audio_query, SPEAKER_ID)
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
