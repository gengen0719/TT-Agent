import io
import json
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import Mock, patch

import lambda_function


class Mp3DurationTest(unittest.TestCase):
    def test_decoded_mp3_matches_reported_duration(self):
        sample_rate = 24_000
        sample_width = 2
        wav = io.BytesIO()
        with wave.open(wav, 'wb') as audio:
            audio.setnchannels(1)
            audio.setsampwidth(sample_width)
            audio.setframerate(sample_rate)
            audio.writeframes(bytes(sample_rate * sample_width))

        uploaded = {}

        def capture_upload(**object_args):
            uploaded.update(object_args, Body=object_args['Body'].read())

        synthesizer = Mock()
        synthesizer.synthesis.return_value = wav.getvalue()
        with patch.object(lambda_function, 'synthesizer', synthesizer), \
             patch.object(lambda_function.s3, 'put_object', side_effect=capture_upload):
            response = lambda_function.handler({'text': 'test'}, None)

        with tempfile.TemporaryDirectory() as directory:
            mp3_path = Path(directory) / 'uploaded.mp3'
            mp3_path.write_bytes(uploaded['Body'])
            pcm = subprocess.run(
                ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(mp3_path),
                 '-ac', '1', '-ar', str(sample_rate), '-f', 's16le', 'pipe:1'],
                stdout=subprocess.PIPE, check=True,
            ).stdout
        decoded_frames = len(pcm) // sample_width
        reported_ms = json.loads(response['body'])['Audio-Length']
        self.assertEqual(decoded_frames, sample_rate)
        self.assertEqual(reported_ms, decoded_frames * 1000 // sample_rate)
        self.assertEqual(uploaded['Metadata']['duration'], str(reported_ms))


if __name__ == '__main__':
    unittest.main()
