import os, re, json
from flask import Flask, request, jsonify
from flask_cors import CORS
from youtube_transcript_api import YouTubeTranscriptApi
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

yt_api = YouTubeTranscriptApi()

client = OpenAI(
    api_key=os.environ.get('DEEPSEEK_API_KEY', ''),
    base_url='https://api.deepseek.com',
)

SYSTEM = (
    'You are an expert at identifying the most educational and valuable content in video transcripts. '
    'Extract only the segments worth watching — core insights, key explanations, critical demonstrations. '
    'Skip intros, outros, filler, repetition, and off-topic tangents.'
)

USER_PROMPT = (
    'Here is the transcript of a YouTube video with timestamps (in seconds):\n\n'
    '{transcript}\n\n'
    'Identify the segments worth watching. Return ONLY a JSON array, no other text:\n'
    '[{{"start": 12.1, "end": 45.3}}, {{"start": 102.5, "end": 187.2}}]\n\n'
    'Rules:\n'
    '- Each segment should be at least 10 seconds long\n'
    '- Merge adjacent segments if the gap between them is less than 5 seconds\n'
    '- Aim to keep 30-60% of the original video\n'
    '- Start and end times must correspond to actual transcript timestamps'
)

def extract_video_id(url):
    m = re.search(r'(?:v=|youtu\.be/)([^&?/]+)', url)
    return m.group(1) if m else None

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'ok': True})

@app.route('/distill', methods=['POST'])
def distill():
    url = (request.json or {}).get('url', '')
    vid = extract_video_id(url)
    if not vid:
        return jsonify({'ok': False, 'error': 'Invalid YouTube URL'}), 400

    try:
        transcript = yt_api.fetch(vid)
    except Exception as e:
        return jsonify({'ok': False, 'error': f'No transcript available: {e}'}), 400

    transcript_text = '\n'.join(
        f'[{t.start:.1f}s] {t.text}' for t in list(transcript)[:800]
    )

    try:
        resp = client.chat.completions.create(
            model='deepseek-chat',
            max_tokens=2048,
            temperature=0,
            messages=[
                {'role': 'system', 'content': SYSTEM},
                {'role': 'user', 'content': USER_PROMPT.format(transcript=transcript_text)},
            ],
        )
    except Exception as e:
        return jsonify({'ok': False, 'error': f'AI error: {e}'}), 500

    content = resp.choices[0].message.content or ''
    m = re.search(r'\[[\s\S]*?\]', content)
    if not m:
        return jsonify({'ok': False, 'error': 'No segments in AI response'}), 500

    try:
        segments = json.loads(m.group(0))
    except Exception:
        return jsonify({'ok': False, 'error': 'Could not parse AI response'}), 500

    segments = [s for s in segments if isinstance(s, dict) and 'start' in s and 'end' in s]
    if not segments:
        return jsonify({'ok': False, 'error': 'No highlights found for this video'}), 200

    return jsonify({'ok': True, 'segments': segments})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8765))
    print(f'YT Distiller server running on http://localhost:{port}')
    app.run(port=port)
