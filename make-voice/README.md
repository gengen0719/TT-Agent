VOICEVOXを展開したDocker ImageをECRに配置し、そのECRをAWS Lambdaに展開して動作します。
AWS Lambda に渡されたテキストを VOICEVOX で合成し、FFmpeg で MP3 に変換して S3 のバケット直下に保存します。レスポンスの `key` には `.mp3` のオブジェクトキーが入ります。
