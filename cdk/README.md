# cdk

`make-voice` をデプロイする AWS CDK (TypeScript) アプリです。スタック `TtMakeVoiceStack` は以下を作成します。

- ECR リポジトリ `voicevox-image`
  - `make-voice/Dockerfile` を linux/arm64 でビルドし、`latest` タグとしてこのリポジトリに push します。`cdk deploy` するたびに Docker image も更新されます。
  - ライフサイクル: 最新イメージ (`latest` タグ付き) は無期限に保持、1 つ前のイメージ (tag が外れたもの) は push から 3 日間保持、それより古いイメージは即時削除。
- Lambda 関数 `tt-make-voice`
  - 上記 ECR イメージ (digest 参照) / arm64 / メモリ 4096 MB / SnapStart (`PublishedVersions`) 有効。
  - SnapStart はバージョンに対して有効になるため、エイリアス `live` を発行しています。呼び出しは `tt-make-voice:live` を使ってください (`$LATEST` では SnapStart は効きません)。
- 出力先 S3 バケット
  - 全オブジェクトを 1 日で削除、バージョニング無効、パブリックアクセス完全ブロック。アクセスは署名付き URL を想定しています。
  - Lambda 実行ロールにのみ書き込み権限を付与しています。

## 使い方

```bash
cd cdk
npm ci
npx cdk bootstrap   # 初回のみ
npx cdk deploy
```

Docker image のビルドは arm64 で行われるため、arm64 以外のマシンでは `docker buildx` / QEMU (binfmt) のセットアップが必要です。

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm64
```

## TtLineEchoStack

LINE Messaging API の Webhook 用 API Gateway HTTP API と Lambda 関数 `tt-line-echo` を作成します。HTTP API は Lambda の `$default` ルートに統合され、認証なしで公開されます。LINE 署名検証はコード内で実施します。受け取ったテキストメッセージをオウム返しし、`tt-make-voice` で生成した音声も音声メッセージとして返信します。`follow` イベントではプロフィールを取得し、友だち情報を `LINE_Users` テーブルに保存します。

前提: `TtMakeVoiceStack` がデプロイ済みであること。`TtMakeVoice-BucketName` / `TtMakeVoice-FunctionAliasArn` の export を使ってリソースを参照するため、export 追加後の `TtMakeVoiceStack` を一度再デプロイしてください。

```bash
cd cdk
npx cdk deploy TtLineEchoStack
```

デプロイ後、AWS マネジメントコンソールで Lambda `tt-line-echo` を開き、Configuration > Environment variables から `LINE_CHANNEL_SECRET` と `LINE_CHANNEL_ACCESS_TOKEN` を実際の値に更新してください。デプロイ時点では両方とも `REPLACE_IN_LAMBDA_CONSOLE` が設定されています。CDK で Lambda の環境変数を更新する変更を再デプロイすると、このプレースホルダーに戻る可能性があるため、その場合はコンソールで再設定してください。

デプロイ後、出力 `WebhookUrl` の値を LINE Developers コンソールの Webhook URL に設定してください。

`TtLineEchoStack` はユーザー情報を保存する DynamoDB テーブル `TtLineUsers` (パーティションキー `userId`、オンデマンド課金、削除時は保持) も作成し、Webhook Lambda から使用します。既存の `LINE_Users` テーブルは保持され、新しいテーブルへデータは自動移行されません。
