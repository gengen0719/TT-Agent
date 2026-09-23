# line-echo

LINE Messaging API の Webhook から届いたテキストメッセージをオウム返しする Lambda 関数です。
テキストのオウム返しに加えて、`tt-make-voice` Lambda (VOICEVOX) で生成した音声ファイルを
S3 署名付き URL 経由で音声メッセージとしても返信します。

## 環境変数

| 変数名 | 説明 |
| --- | --- |
| `LINE_CHANNEL_SECRET` | LINE チャネルシークレット (署名検証に使用) |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE チャネルアクセストークン (返信 API に使用) |
| `MAKE_VOICE_FUNCTION_ARN` | `tt-make-voice` の呼び出し対象 ARN (エイリアス `live` 推奨) |
| `VOICE_BUCKET_NAME` | 生成音声が保存される S3 バケット名 |

## デプロイと Webhook 設定

前提: `TtMakeVoiceStack` が先にデプロイされていること
(新しい export 名 `TtMakeVoice-BucketName` / `TtMakeVoice-FunctionAliasArn` を含む状態に再デプロイ済みであること)。

```bash
cd cdk
LINE_CHANNEL_SECRET=... LINE_CHANNEL_ACCESS_TOKEN=... npx cdk deploy TtLineEchoStack
```

デプロイ後、スタック出力の `WebhookUrl` (Lambda Function URL) を
LINE Developers コンソールの Webhook URL に設定してください。
