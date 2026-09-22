# build: docker build --platform linux/arm64 [--build-arg GH_TOKEN=...] .
FROM python:3.12-slim

# Required for Lambda SnapStart on images that are not based on an AWS Lambda base image
LABEL com.amazonaws.lambda.feature.snapstart="Allow"

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN pip install --upgrade pip && pip install awslambdaric boto3

RUN mkdir /function
WORKDIR /function

RUN pip install https://github.com/VOICEVOX/voicevox_core/releases/download/0.17.0/voicevox_core-0.17.0-cp310-abi3-manylinux_2_34_aarch64.whl
ARG GH_TOKEN
RUN curl -sSfL https://github.com/VOICEVOX/voicevox_core/releases/download/0.17.0/download-linux-arm64 -o download && \
    chmod +x download && \
    yes | ./download --os linux --cpu-arch arm64 --only onnxruntime models dict --models-pattern 11.vvm -o ./lib && \
    rm download

COPY ./lambda_function.py /function/

ENTRYPOINT [ "/usr/local/bin/python", "-m", "awslambdaric" ]

CMD [ "lambda_function.handler" ]
