# line-echo

LINE Messaging API の Webhook を受け付け、イベント内容に応じて処理する Lambda 関数です。`follow` イベントではユーザー情報を DynamoDB に保存します。
テキストのオウム返しに加えて、`tt-make-voice` Lambda (VOICEVOX) で生成した音声ファイルを
S3 署名付き URL 経由で音声メッセージとしても返信します。

## 環境変数

| 変数名 | 説明 |
| --- | --- |
| `LINE_CHANNEL_SECRET` | LINE チャネルシークレット (署名検証に使用) |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE チャネルアクセストークン (返信 API に使用) |
| `MAKE_VOICE_FUNCTION_ARN` | `tt-make-voice` の呼び出し対象 ARN (エイリアス `live` 推奨) |
| `VOICE_BUCKET_NAME` | 生成音声が保存される S3 バケット名 |
| `LINE_USERS_TABLE_NAME` | `follow` イベントのユーザー情報を保存する DynamoDB テーブル名 |

## デプロイと Webhook 設定

前提: `TtMakeVoiceStack` が先にデプロイされていること
(新しい export 名 `TtMakeVoice-BucketName` / `TtMakeVoice-FunctionAliasArn` を含む状態に再デプロイ済みであること)。

```bash
cd cdk
npx cdk deploy TtLineEchoStack
```

デプロイ後、Lambda `tt-line-echo` の環境変数 `LINE_CHANNEL_SECRET` と `LINE_CHANNEL_ACCESS_TOKEN` を AWS マネジメントコンソールで実際の値に更新してください。

`TtLineUsers` は `TtLineEchoStack` が作成します。既存の `LINE_Users` テーブルは保持されますが、データは `TtLineUsers` に自動移行されません。既存データが必要な場合は、別途移行してください。

デプロイ後、スタック出力の `WebhookUrl` (Lambda Function URL) を
LINE Developers コンソールの Webhook URL に設定してください。
