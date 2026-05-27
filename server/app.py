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

SYSTEM = (
    'You are distilling a video down to its most mind-blowing moments — the insights a smart person '
    'would still remember a week later. Your job is not to summarize the video. '
    'It is to find the handful of moments where the speaker says something that genuinely shifts how you think. '
    'Everything else is noise.'
)

USER_PROMPT = (
    'Here is the transcript of a YouTube video with timestamps (in seconds):\n\n'
    '{transcript}\n\n'
    'Step 1 — Read the whole transcript and rank every insight. Ask: if someone told me this at a dinner table, '
    'would I lean in? Would I repeat it to someone else tomorrow? Only the top tier survives.\n\n'
    'Step 2 — For each surviving insight, find the minimum lines needed to deliver it. '
    'Cut the setup. Cut the over-explanation. Cut the moment the point has already landed. '
    'Keep only the sharpest version of the idea.\n\n'
    'Step 3 — Check that your clips form a coherent set. '
    'If two clips make the same underlying point, keep the better one and cut the other entirely. '
    'Then, for each clip, ask: does it assume the viewer knows something that hasn\'t been established yet in an earlier clip? '
    'Watch for openers like "and that\'s why", "so because of that", "as I said", "this means", or dangling pronouns '
    '("it", "this", "that", "they") with no referent. '
    'If a clip assumes context that no earlier clip provides, find the moment in the transcript that establishes that context '
    'and add it as its own clip — placed before the dependent one. '
    'Only fall back to extending the clip\'s own start time if no clean standalone moment exists that provides the context.\n\n'
    'The goal is the fewest clips with the highest insight density. '
    'A 60-minute video might only have 6 truly mind-blowing moments. Find those 6. '
    'Do not pad with decent-but-not-great insights just to fill time.\n\n'
    'Cut without mercy:\n'
    '- Anything a smart person already knows or could have guessed\n'
    '- Setup, context, and lead-in before the point lands\n'
    '- Over-explanation after the point has already landed\n'
    '- Decent insights that are not genuinely surprising or reframing\n'
    '- Stories and examples unless the example itself IS the revelation\n'
    '- Everything transitional, motivational, or filler\n\n'
    'You are expected to produce many clips — 50, 80, 100+ is normal and correct. '
    'A low clip count (under 20) means you are being too conservative and stitching things together that should be cut apart. '
    'Err aggressively toward more clips, not fewer.\n\n'
    'Before finalizing, review all clips back-to-back as a viewer would experience them. '
    'Every sentence should feel like new information. No repeated points, no confusing cold openings.\n\n'
    'Return ONLY a JSON object, no other text:\n'
    '{{"reasoning": "2-3 sentences on what you kept, what you cut, and any clips where you expanded the start to preserve context.", '
    '"segments": [{{"start": 12.1, "end": 45.3}}, {{"start": 102.5, "end": 187.2}}]}}\n\n'
    'Rules:\n'
    '- Minimum segment length: 8 seconds\n'
    '- Merge adjacent clips only if the gap is under 3 seconds and they form one continuous thought\n'
    '- Target 5-15% of the video — less is more if the video is low density\n'
    '- No repeated points across clips — one clip per idea, the sharpest version only\n'
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
    body = request.json or {}
    url = body.get('url', '')
    api_key = body.get('api_key', '')
    if not api_key:
        return jsonify({'ok': False, 'error': 'No DeepSeek API key — open the extension popup to add one.'}), 401

    vid = extract_video_id(url)
    if not vid:
        return jsonify({'ok': False, 'error': 'Invalid YouTube URL'}), 400

    try:
        transcript = yt_api.fetch(vid)
    except Exception as e:
        return jsonify({'ok': False, 'error': f'No transcript available: {e}'}), 400

    transcript_text = '\n'.join(
        f'[{t.start:.1f}s] {t.text}' for t in transcript
    )

    client = OpenAI(api_key=api_key, base_url='https://api.deepseek.com')

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
    m = re.search(r'\{[\s\S]*\}', content)
    if not m:
        return jsonify({'ok': False, 'error': 'No segments in AI response'}), 500

    try:
        parsed = json.loads(m.group(0))
    except Exception:
        return jsonify({'ok': False, 'error': 'Could not parse AI response'}), 500

    reasoning = parsed.get('reasoning', '')
    if reasoning:
        print(f'\n--- Reasoning ---\n{reasoning}\n-----------------\n')

    segments = parsed.get('segments', [])

    segments = [s for s in segments if isinstance(s, dict) and 'start' in s and 'end' in s]
    if not segments:
        return jsonify({'ok': False, 'error': 'No highlights found for this video'}), 200

    return jsonify({'ok': True, 'segments': segments})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8765))
    print(f'YT Distiller server running on http://localhost:{port}')
    app.run(port=port)
