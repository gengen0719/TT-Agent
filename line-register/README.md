# line-register

LINE Messaging API の Webhook から届いた `follow` イベント (友だち追加) を受け取り、
ユーザーの `userId` と表示名 (`displayName`) を DynamoDB テーブル `LINE_Users` に保存する
Lambda 関数です。`follow` 以外のイベントは無視します。

## 環境変数

| 変数名 | 説明 |
| --- | --- |
| `LINE_CHANNEL_SECRET` | LINE チャネルシークレット (署名検証に使用) |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE チャネルアクセストークン (プロフィール取得 API に使用) |
| `LINE_USERS_TABLE_NAME` | ユーザー情報を保存する DynamoDB テーブル名 (`LINE_Users`) |

## DynamoDB テーブル

- テーブル名: `LINE_Users`
- パーティションキー: `userId` (String)
- 課金モード: オンデマンド (`PAY_PER_REQUEST`)
- 保存する項目: `userId`, `displayName`, `timestamp` (イベント発生時刻、ミリ秒), `followedAt` (ISO 8601 文字列)

## デプロイと Webhook 設定

```bash
cd cdk
LINE_CHANNEL_SECRET=... LINE_CHANNEL_ACCESS_TOKEN=... npx cdk deploy TtLineRegisterStack
```

デプロイ後、スタック出力の `WebhookUrl` (Lambda Function URL) を
LINE Developers コンソールの Webhook URL に設定してください。

注意: LINE Messaging API では 1 チャネルにつき Webhook URL は 1 つなので、
tt-line-echo と同時に使う場合は別チャネルにするか Webhook URL を切り替える必要があります。
