FROM python:3

RUN apt-get update
RUN pip install awslambdaric boto3 wave --upgrade pip

RUN pip install pydub

RUN mkdir /function
WORKDIR /function

RUN pip install https://github.com/VOICEVOX/voicevox_core/releases/download/0.15.0/voicevox_core-0.15.0+cpu-cp38-abi3-linux_x86_64.whl
RUN binary=download-linux-x64 && \
    curl -sSfL https://github.com/VOICEVOX/voicevox_core/releases/latest/download/${binary} -o download  && \
    chmod +x download  && \
    ./download -o ./

COPY ./lambda_function.py /function/

ENTRYPOINT [ "/usr/local/bin/python", "-m", "awslambdaric" ]

CMD [ "lambda_function.handler" ]  