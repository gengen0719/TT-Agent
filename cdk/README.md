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

`line-echo` をデプロイするスタックです。LINE Messaging API の Webhook 用 Lambda 関数 `tt-line-echo` と、その公開エンドポイントとなる Lambda Function URL (認証なし、署名検証はコード内で実施) を作成します。受け取ったテキストメッセージをオウム返しし、`tt-make-voice` で生成した音声も音声メッセージとして返信します。

前提: `TtMakeVoiceStack` がデプロイ済みであること。`TtMakeVoice-BucketName` / `TtMakeVoice-FunctionAliasArn` の export を使ってリソースを参照するため、export 追加後の `TtMakeVoiceStack` を一度再デプロイしてください。

```bash
cd cdk
LINE_CHANNEL_SECRET=... LINE_CHANNEL_ACCESS_TOKEN=... npx cdk deploy TtLineEchoStack
```

(`LINE_CHANNEL_*` の代わりに `-c lineChannelSecret=... -c lineChannelAccessToken=...` の context 指定も可)

デプロイ後、出力 `WebhookUrl` の値を LINE Developers コンソールの Webhook URL に設定してください。
