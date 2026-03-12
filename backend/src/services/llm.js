const crypto = require('crypto');
const { getDb } = require('../db');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Hash text for cache key
 */
function hashText(text) {
  return crypto.createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
}

/**
 * Check analysis cache in SQLite
 */
function getCachedAnalysis(textHash) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM analysis_cache WHERE text_hash = ?').get(textHash);
  if (row) {
    return {
      emotion: row.emotion,
      keywords: JSON.parse(row.keywords),
      summary: row.summary,
      cached: true
    };
  }
  return null;
}

/**
 * Save analysis to cache
 */
function cacheAnalysis(textHash, result) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO analysis_cache (text_hash, emotion, keywords, summary)
    VALUES (?, ?, ?, ?)
  `).run(textHash, result.emotion, JSON.stringify(result.keywords), result.summary);
}

/**
 * Analyze text with Anthropic Claude API
 * Returns emotion, keywords, summary
 */
async function analyzeEmotion(text) {
  const textHash = hashText(text);

  // Check cache first
  const cached = getCachedAnalysis(textHash);
  if (cached) {
    console.log('📦 Cache hit for analysis');
    return cached;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const prompt = `Analyze the emotional content of this journal entry and respond ONLY with valid JSON.

Journal text: "${text}"

Respond with exactly this JSON structure (no markdown, no extra text):
{
  "emotion": "primary emotion in one word (e.g. calm, anxious, joyful, sad, grateful, energized, melancholic, peaceful)",
  "keywords": ["array", "of", "3-5", "key", "thematic", "words"],
  "summary": "One sentence summarizing the user's mental/emotional state"
}`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', // cheapest model for cost efficiency
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`LLM API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  const rawText = data.content[0].text.trim();

  let result;
  try {
    // Strip markdown fences if present
    const clean = rawText.replace(/```json|```/g, '').trim();
    result = JSON.parse(clean);
  } catch (e) {
    throw new Error('Failed to parse LLM response as JSON: ' + rawText);
  }

  // Validate shape
  if (!result.emotion || !Array.isArray(result.keywords) || !result.summary) {
    throw new Error('Invalid LLM response structure');
  }

  // Normalize
  result.emotion = result.emotion.toLowerCase().trim();
  result.keywords = result.keywords.map(k => k.toLowerCase().trim()).slice(0, 5);
  result.cached = false;

  // Cache result
  cacheAnalysis(textHash, result);

  return result;
}

/**
 * Streaming version - yields chunks
 */
async function* analyzeEmotionStream(text) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const prompt = `Analyze the emotional content of this journal entry.

Journal text: "${text}"

Provide a warm, insightful analysis covering:
1. Primary emotion detected
2. Key themes and keywords  
3. A brief summary of their mental state
4. A gentle, supportive observation

Be empathetic and encouraging.`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      stream: true,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) throw new Error(`Stream error: ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

    for (const line of lines) {
      const data = line.slice(6);
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          yield parsed.delta.text;
        }
      } catch {}
    }
  }
}

module.exports = { analyzeEmotion, analyzeEmotionStream };
