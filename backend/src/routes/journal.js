const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const { analyzeEmotion, analyzeEmotionStream } = require('../services/llm');

const router = express.Router();

// ── Validation helpers ──────────────────────────────────────────────────────

const VALID_AMBIENCES = ['forest', 'ocean', 'mountain', 'desert', 'meadow'];

function validateJournalEntry(body) {
  const errors = [];
  if (!body.userId || typeof body.userId !== 'string' || body.userId.trim().length === 0)
    errors.push('userId is required');
  if (!body.ambience || !VALID_AMBIENCES.includes(body.ambience))
    errors.push(`ambience must be one of: ${VALID_AMBIENCES.join(', ')}`);
  if (!body.text || typeof body.text !== 'string' || body.text.trim().length < 5)
    errors.push('text must be at least 5 characters');
  if (body.text && body.text.length > 5000)
    errors.push('text must be under 5000 characters');
  return errors;
}

// ── POST /api/journal ──────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const errors = validateJournalEntry(req.body);
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

  const { userId, ambience, text } = req.body;
  const id = uuidv4();
  const db = getDb();

  try {
    db.prepare(`
      INSERT INTO journal_entries (id, user_id, ambience, text, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(id, userId.trim(), ambience, text.trim());

    const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id);
    res.status(201).json(formatEntry(entry));
  } catch (err) {
    console.error('POST /journal error:', err);
    res.status(500).json({ error: 'Failed to save entry' });
  }
});

// ── GET /api/journal/:userId ───────────────────────────────────────────────

router.get('/insights/:userId', async (req, res) => {
  // Placed before /:userId to avoid routing conflict
  const { userId } = req.params;
  const db = getDb();

  try {
    const entries = db.prepare(`
      SELECT * FROM journal_entries WHERE user_id = ? ORDER BY created_at DESC
    `).all(userId);

    if (entries.length === 0) {
      return res.json({
        totalEntries: 0,
        topEmotion: null,
        mostUsedAmbience: null,
        recentKeywords: [],
        emotionBreakdown: {},
        ambienceBreakdown: {}
      });
    }

    // Emotion frequency
    const emotionCount = {};
    const ambienceCount = {};
    const keywordFreq = {};

    entries.forEach(e => {
      if (e.ambience) {
        ambienceCount[e.ambience] = (ambienceCount[e.ambience] || 0) + 1;
      }
      if (e.emotion) {
        emotionCount[e.emotion] = (emotionCount[e.emotion] || 0) + 1;
      }
      if (e.keywords) {
        try {
          JSON.parse(e.keywords).forEach(k => {
            keywordFreq[k] = (keywordFreq[k] || 0) + 1;
          });
        } catch {}
      }
    });

    const topEmotion = Object.entries(emotionCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const mostUsedAmbience = Object.entries(ambienceCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const recentKeywords = Object.entries(keywordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k]) => k);

    res.json({
      totalEntries: entries.length,
      topEmotion,
      mostUsedAmbience,
      recentKeywords,
      emotionBreakdown: emotionCount,
      ambienceBreakdown: ambienceCount
    });
  } catch (err) {
    console.error('GET /insights error:', err);
    res.status(500).json({ error: 'Failed to fetch insights' });
  }
});

router.get('/:userId', async (req, res) => {
  const { userId } = req.params;
  const { limit = 50, offset = 0 } = req.query;
  const db = getDb();

  try {
    const entries = db.prepare(`
      SELECT * FROM journal_entries 
      WHERE user_id = ? 
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, parseInt(limit), parseInt(offset));

    const total = db.prepare('SELECT COUNT(*) as count FROM journal_entries WHERE user_id = ?').get(userId);

    res.json({
      entries: entries.map(formatEntry),
      total: total.count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (err) {
    console.error('GET /:userId error:', err);
    res.status(500).json({ error: 'Failed to fetch entries' });
  }
});

// ── POST /api/journal/analyze ──────────────────────────────────────────────

router.post('/analyze', async (req, res) => {
  const { text, entryId, stream } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length < 5) {
    return res.status(400).json({ error: 'text must be at least 5 characters' });
  }

  // Streaming mode
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      for await (const chunk of analyzeEmotionStream(text.trim())) {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }
    return res.end();
  }

  // Standard mode
  try {
    const result = await analyzeEmotion(text.trim());

    // If entryId provided, update the entry with analysis results
    if (entryId) {
      const db = getDb();
      db.prepare(`
        UPDATE journal_entries 
        SET emotion = ?, keywords = ?, summary = ?, analyzed_at = datetime('now')
        WHERE id = ?
      `).run(result.emotion, JSON.stringify(result.keywords), result.summary, entryId);
    }

    res.json(result);
  } catch (err) {
    console.error('POST /analyze error:', err);
    res.status(500).json({ error: 'Analysis failed: ' + err.message });
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

function formatEntry(row) {
  return {
    id: row.id,
    userId: row.user_id,
    ambience: row.ambience,
    text: row.text,
    emotion: row.emotion || null,
    keywords: row.keywords ? JSON.parse(row.keywords) : [],
    summary: row.summary || null,
    analyzedAt: row.analyzed_at || null,
    createdAt: row.created_at
  };
}

module.exports = router;
