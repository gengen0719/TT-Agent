from voicevox_core.blocking import (
    Onnxruntime,
    OpenJtalk,
    Synthesizer,
    VoiceModelFile,
)

SPEAKER_ID = 47
OPEN_JTALK_DICT_DIR = "./lib/dict/open_jtalk_dic_utf_8-1.11"
VVM_PATH = "./lib/models/vvms/11.vvm"

def main():
    onnxruntime = Onnxruntime.load_once(
        filename="./lib/onnxruntime/lib/libvoicevox_onnxruntime.1.17.3.dylib"
    )

    open_jtalk = OpenJtalk(OPEN_JTALK_DICT_DIR)

    synthesizer = Synthesizer(
        onnxruntime,
        open_jtalk,
        acceleration_mode="AUTO",
    )

    model = VoiceModelFile.open(VVM_PATH)
    synthesizer.load_voice_model(model)

    audio_query = synthesizer.create_audio_query(
        "本日のご予定をお伝えします",
        SPEAKER_ID,
    )

    wav = synthesizer.synthesis(
        audio_query,
        SPEAKER_ID,
    )

    with open("output.wav", "wb") as f:
        f.write(wav)

    print("output.wav を生成しました")


if __name__ == "__main__":
    main()