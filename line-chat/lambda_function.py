import base64
import hashlib
import hmac
import json
import logging
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone

import boto3
from strands import Agent
from strands.models import BedrockModel

logger = logging.getLogger()
logger.setLevel(logging.INFO)

LINE_CHANNEL_SECRET = os.environ['LINE_CHANNEL_SECRET']
LINE_CHANNEL_ACCESS_TOKEN = os.environ['LINE_CHANNEL_ACCESS_TOKEN']
LINE_USERS_TABLE_NAME = os.environ['LINE_USERS_TABLE_NAME']
BEDROCK_MODEL_ID = os.environ.get('BEDROCK_MODEL_ID', 'amazon.nova-micro-v1:0')
MAKE_VOICE_FUNCTION_ARN = os.environ['MAKE_VOICE_FUNCTION_ARN']
VOICE_BUCKET_NAME = os.environ['VOICE_BUCKET_NAME']
LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply'
VERIFICATION_REPLY_TOKEN = '00000000000000000000000000000000'
MAX_REPLY_LENGTH = 100
PRESIGNED_URL_EXPIRES_IN = 300

lambda_client = boto3.client('lambda')
s3_client = boto3.client('s3')
users_table = boto3.resource('dynamodb').Table(LINE_USERS_TABLE_NAME)
agent = Agent(
    model=BedrockModel(model_id=BEDROCK_MODEL_ID),
    system_prompt=(
        'あなたはLINEで気軽に日本語で話せる、ナースロボタイプTです。'
        'あなたの性格は少しダウナー気質です。'
        'あー、、えー、、のようなフィラーをよく使います。'
        '相手の話をよく受け止め、自然な口語で簡潔に返答をします。'
        '知らないことは断定せず、雑談の流れを大切にしてください。'
        '返答は原則1〜2文、80文字以内にしてください。前置きや長い説明は避けます。'
        '箇条書きや見出しは、相手が求めた場合を除いて使いません。'
        '口癖は「いい感じに」です。'
    ),
)


def verify_signature(raw_body: str, signature: str | None) -> bool:
    if not signature:
        return False
    digest = hmac.new(
        LINE_CHANNEL_SECRET.encode('utf-8'),
        raw_body.encode('utf-8'),
        hashlib.sha256,
    ).digest()
    expected = base64.b64encode(digest).decode('ascii')
    return hmac.compare_digest(expected, signature)


def reply_to_line(reply_token: str, messages: list[dict]) -> None:
    body = json.dumps({'replyToken': reply_token, 'messages': messages}).encode('utf-8')
    request = urllib.request.Request(
        LINE_REPLY_URL,
        data=body,
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {LINE_CHANNEL_ACCESS_TOKEN}',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            if response.status >= 300:
                logger.error('LINE reply API returned %s', response.status)
    except urllib.error.HTTPError as error:
        logger.error('LINE reply API returned %s: %s', error.code, error.read().decode('utf-8'))


def fetch_display_name(user_id: str) -> str:
    request = urllib.request.Request(
        f'https://api.line.me/v2/bot/profile/{user_id}',
        headers={'Authorization': f'Bearer {LINE_CHANNEL_ACCESS_TOKEN}'},
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            profile = json.loads(response.read().decode('utf-8'))
            return profile.get('displayName', 'Unknown')
    except (urllib.error.URLError, json.JSONDecodeError) as error:
        logger.warning('Could not fetch LINE profile for %s: %s', user_id, error)
        return 'Unknown'


def save_followed_user(event: dict) -> None:
    user_id = event.get('source', {}).get('userId')
    if not user_id:
        return
    timestamp = event.get('timestamp', int(datetime.now(timezone.utc).timestamp() * 1000))
    item = {
        'userId': user_id,
        'displayName': fetch_display_name(user_id),
        'timestamp': timestamp,
        'followedAt': datetime.fromtimestamp(timestamp / 1000, timezone.utc).isoformat(),
    }
    users_table.put_item(Item=item)
    logger.info('Saved LINE user %s', user_id)


def generate_reply(text: str) -> str:
    result = agent(text)
    content = result.message.get('content', [])
    answer = ''.join(part.get('text', '') for part in content if part.get('type') == 'text')
    return answer.strip() or 'うまく言葉にできなかったみたい。もう一度聞かせてくれる？'


def constrain_reply(text: str) -> str:
    if len(text) <= MAX_REPLY_LENGTH:
        return text

    clipped = text[:MAX_REPLY_LENGTH]
    boundary = max(clipped.rfind(mark) for mark in ('。', '！', '？', '!', '?'))
    if boundary >= MAX_REPLY_LENGTH // 2:
        return clipped[:boundary + 1]
    return clipped[:MAX_REPLY_LENGTH - 1].rstrip('、。！？」』 ') + '…'


def make_voice(text: str) -> tuple[int, str]:
    response = lambda_client.invoke(
        FunctionName=MAKE_VOICE_FUNCTION_ARN,
        InvocationType='RequestResponse',
        Payload=json.dumps({'text': text}).encode('utf-8'),
    )
    if response.get('FunctionError'):
        raise RuntimeError(f"make-voice invocation failed: {response['FunctionError']}")
    result = json.loads(response['Payload'].read().decode('utf-8'))
    if result.get('statusCode') != 200 or not result.get('body'):
        raise RuntimeError(f'make-voice returned an error: {result}')
    voice = json.loads(result['body'])
    duration = voice.get('Audio-Length')
    key = voice.get('key')
    if not isinstance(duration, (int, float)) or not key:
        raise RuntimeError(f'make-voice returned an unexpected body: {result["body"]}')
    return int(duration), key


def presigned_voice_url(key: str) -> str:
    return s3_client.generate_presigned_url(
        'get_object',
        Params={'Bucket': VOICE_BUCKET_NAME, 'Key': key},
        ExpiresIn=PRESIGNED_URL_EXPIRES_IN,
    )


def handle_event(event: dict) -> None:
    event_type = event.get('type')
    if event_type == 'follow':
        save_followed_user(event)
        return

    message = event.get('message', {})
    reply_token = event.get('replyToken')
    if (
        event_type != 'message'
        or message.get('type') != 'text'
        or not isinstance(message.get('text'), str)
        or not reply_token
        or reply_token == VERIFICATION_REPLY_TOKEN
    ):
        return

    try:
        answer = constrain_reply(generate_reply(message['text']))
    except Exception:
        logger.exception('Strands agent failed; returning fallback reply')
        answer = 'ごめんね、今ちょっと考えがまとまらなかったみたい。少ししてからまた話しかけてね。'
    messages = [{'type': 'text', 'text': answer}]
    try:
        duration, key = make_voice(answer)
        messages.append({
            'type': 'audio',
            'originalContentUrl': presigned_voice_url(key),
            'duration': duration,
        })
    except Exception:
        logger.exception('make-voice failed; replying with text only')
    reply_to_line(reply_token, messages)


def handler(event: dict, _context: object) -> dict:
    body = event.get('body') or ''
    if event.get('isBase64Encoded'):
        body = base64.b64decode(body).decode('utf-8')
    signature = (event.get('headers') or {}).get('x-line-signature')

    if not verify_signature(body, signature):
        logger.warning('Invalid or missing x-line-signature')
        return {'statusCode': 401, 'body': 'Unauthorized'}

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return {'statusCode': 400, 'body': 'Bad Request'}

    for item in payload.get('events', []):
        try:
            handle_event(item)
        except Exception:
            logger.exception('LINE event handling failed')
    return {'statusCode': 200, 'body': 'OK'}