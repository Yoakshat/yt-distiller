chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_TRANSCRIPT_URL') {
    fetch(message.url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'ANALYZE_TRANSCRIPT') {
    analyzeTranscript(message.transcript)
      .then((segments) => sendResponse({ ok: true, segments }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});

async function analyzeTranscript(transcript) {
  const { deepseekApiKey } = await chrome.storage.sync.get('deepseekApiKey');
  if (!deepseekApiKey) {
    throw new Error('No DeepSeek API key configured. Open the extension popup to add one.');
  }

  const transcriptText = transcript
    .slice(0, 800)
    .map((seg) => `[${seg.start.toFixed(1)}s] ${seg.text}`)
    .join('\n');

  const systemMessage = {
    role: 'system',
    content:
      'You are an expert at identifying the most educational and valuable content in video transcripts. ' +
      'You extract only the segments worth watching — the core insights, key explanations, and critical demonstrations. ' +
      'You skip intros, outros, filler, repetition, and off-topic tangents.',
  };

  const userMessage = {
    role: 'user',
    content:
      `Here is the transcript of a YouTube video with timestamps (in seconds):\n\n` +
      `${transcriptText}\n\n` +
      `Identify the segments worth watching. Return ONLY a JSON array, no other text:\n` +
      `[{"start": 12.1, "end": 45.3}, {"start": 102.5, "end": 187.2}]\n\n` +
      `Rules:\n` +
      `- Each segment should be at least 10 seconds long\n` +
      `- Merge adjacent segments if the gap between them is less than 5 seconds\n` +
      `- Aim to keep 30-60% of the original video\n` +
      `- Start and end times must correspond to actual transcript timestamps`,
  };

  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${deepseekApiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-pro',
      max_tokens: 2048,
      temperature: 0,
      messages: [systemMessage, userMessage],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `DeepSeek API error: HTTP ${response.status}${errorText ? ' — ' + errorText : ''}`
    );
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned an empty response.');

  return parseSegments(content);
}

function parseSegments(text) {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) throw new Error('No JSON array found in DeepSeek response.');

  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (e) {
    throw new Error('Failed to parse DeepSeek response: ' + e.message);
  }

  if (!Array.isArray(parsed)) throw new Error('DeepSeek response was not an array.');

  const segments = parsed.filter(
    (item) =>
      item !== null &&
      typeof item === 'object' &&
      typeof item.start === 'number' &&
      typeof item.end === 'number'
  );

  if (segments.length === 0) throw new Error('DeepSeek returned no valid segments.');

  return segments;
}
