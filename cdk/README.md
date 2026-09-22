# cdk

`make-voice` をデプロイする AWS CDK (Python) アプリです。スタック `TtMakeVoiceStack` は以下を作成します。

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
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
npx aws-cdk@2 bootstrap   # 初回のみ
npx aws-cdk@2 deploy
```

Docker image のビルドは arm64 で行われるため、arm64 以外のマシンでは `docker buildx` / QEMU (binfmt) のセットアップが必要です。

```bash
docker run --privileged --rm tonistiigi/binfmt --install arm64
```
