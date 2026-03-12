import React, { useState, useEffect, useCallback } from 'react';
import './index.css';
import { api } from './utils/api';

// ─── Constants ──────────────────────────────────────────────────────────────

const AMBIENCES = [
  { id: 'forest',   em: '🌲', label: 'Forest'   },
  { id: 'ocean',    em: '🌊', label: 'Ocean'    },
  { id: 'mountain', em: '🏔️', label: 'Mountain' },
  { id: 'desert',   em: '🏜️', label: 'Desert'   },
  { id: 'meadow',   em: '🌿', label: 'Meadow'   },
];

function fmtDate(iso) {
  return new Date(iso).toLocaleString('en-IN', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function Toast({ msg, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  return <div className={`toast toast-${type}`}>{msg}</div>;
}

// ─── JournalForm ─────────────────────────────────────────────────────────────

function JournalForm({ userId, onSaved }) {
  const [ambience, setAmbience] = useState('forest');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const handleSubmit = async () => {
    if (!text.trim() || text.trim().length < 5) {
      setToast({ msg: 'Please write at least 5 characters.', type: 'error' }); return;
    }
    setLoading(true);
    try {
      const entry = await api.createEntry({ userId, ambience, text: text.trim() });
      setText('');
      setToast({ msg: 'Entry saved!', type: 'success' });
      onSaved(entry);
    } catch (e) {
      setToast({ msg: e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">
        <div className="icon icon-forest">✍️</div>
        New Journal Entry
      </div>

      <div className="field">
        <label>Ambience</label>
        <div className="ambience-grid">
          {AMBIENCES.map(a => (
            <button
              key={a.id}
              className={`ambience-pill ${ambience === a.id ? 'selected' : ''}`}
              onClick={() => setAmbience(a.id)}
            >
              <span className="em">{a.em}</span>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Your reflection</label>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="How are you feeling after your session? What did you notice in nature today..."
          maxLength={5000}
        />
        <div style={{ textAlign: 'right', fontSize: '0.72rem', color: 'var(--text3)', marginTop: 4 }}>
          {text.length}/5000
        </div>
      </div>

      <button className="btn btn-primary btn-full" onClick={handleSubmit} disabled={loading}>
        {loading ? <><span className="spinner" /> Saving...</> : '✦ Save Entry'}
      </button>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}

// ─── EntryCard ────────────────────────────────────────────────────────────────

function EntryCard({ entry, onAnalyzed }) {
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const handleAnalyze = async () => {
    setLoading(true);
    try {
      const result = await api.analyzeText(entry.text, entry.id);
      onAnalyzed(entry.id, result);
      setToast({ msg: 'Analysis complete!', type: 'success' });
    } catch (e) {
      setToast({ msg: e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const amb = AMBIENCES.find(a => a.id === entry.ambience) || AMBIENCES[0];

  return (
    <div className="entry-card">
      <div className="entry-header">
        <div className="entry-meta">
          <span className={`ambience-badge ambience-${entry.ambience}`}>
            {amb.em} {entry.ambience}
          </span>
          {entry.emotion && (
            <span className="emotion-badge">✦ {entry.emotion}</span>
          )}
        </div>
        <span className="entry-date">{fmtDate(entry.createdAt)}</span>
      </div>

      <p className="entry-text">{entry.text}</p>

      {entry.summary && <div className="entry-summary">"{entry.summary}"</div>}

      {entry.keywords?.length > 0 && (
        <div className="keywords">
          {entry.keywords.map(k => (
            <span key={k} className="keyword">#{k}</span>
          ))}
        </div>
      )}

      {!entry.emotion && (
        <div className="entry-actions">
          <button className="btn btn-ghost btn-sm" onClick={handleAnalyze} disabled={loading}>
            {loading ? <><span className="spinner" /> Analyzing...</> : '✦ Analyze Emotion'}
          </button>
        </div>
      )}

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}

// ─── EntriesList ──────────────────────────────────────────────────────────────

function EntriesList({ userId }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await api.getEntries(userId);
      setEntries(data.entries || []);
    } catch {}
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const handleAnalyzed = (id, result) => {
    setEntries(prev => prev.map(e =>
      e.id === id ? { ...e, emotion: result.emotion, keywords: result.keywords, summary: result.summary } : e
    ));
  };

  if (loading) return (
    <div className="card">
      <div className="card-title"><div className="icon icon-ocean">📖</div> Journal Entries</div>
      <div className="empty"><div className="spinner" /></div>
    </div>
  );

  return (
    <div className="card">
      <div className="card-title">
        <div className="icon icon-ocean">📖</div>
        Journal Entries
        {entries.length > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: '0.8rem', fontFamily: 'var(--font-mono)', color: 'var(--text3)', fontWeight: 400 }}>
            {entries.length} entries
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="empty">
          <div className="em">🌱</div>
          <p>No entries yet. Begin your first reflection.</p>
        </div>
      ) : (
        <div className="entries-list">
          {entries.map(e => (
            <EntryCard key={e.id} entry={e} onAnalyzed={handleAnalyzed} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── AnalyzePanel ─────────────────────────────────────────────────────────────

function AnalyzePanel() {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [streamText, setStreamText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('standard'); // 'standard' | 'stream'
  const [toast, setToast] = useState(null);

  const handleAnalyze = async () => {
    if (!text.trim()) return;

    if (mode === 'stream') {
      setStreaming(true);
      setStreamText('');
      setResult(null);
      try {
        await api.streamAnalysis(
          text.trim(),
          (chunk) => setStreamText(prev => prev + chunk),
          () => setStreaming(false)
        );
      } catch (e) {
        setToast({ msg: e.message, type: 'error' });
        setStreaming(false);
      }
      return;
    }

    setLoading(true);
    setResult(null);
    setStreamText('');
    try {
      const r = await api.analyzeText(text.trim());
      setResult(r);
    } catch (e) {
      setToast({ msg: e.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card full">
      <div className="card-title">
        <div className="icon icon-analyze">🔮</div>
        Emotion Analyzer
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            className={`btn btn-sm ${mode === 'standard' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setMode('standard')}
          >Standard</button>
          <button
            className={`btn btn-sm ${mode === 'stream' ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setMode('stream')}
          >✦ Streaming</button>
        </div>
      </div>

      <div className="field">
        <label>Text to analyze</label>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Paste any journal text here to analyze its emotional content..."
          style={{ minHeight: 100 }}
        />
      </div>

      <button
        className="btn btn-primary"
        onClick={handleAnalyze}
        disabled={!text.trim() || loading || streaming}
      >
        {(loading || streaming) ? <><span className="spinner" /> Analyzing...</> : '✦ Analyze'}
      </button>

      {streamText && (
        <div className="analyze-result">
          <div style={{ marginBottom: 12, fontSize: '0.75rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            Streaming Analysis
          </div>
          <pre className="stream-text">{streamText}{streaming && <span className="cursor" />}</pre>
        </div>
      )}

      {result && (
        <div className="analyze-result">
          <div style={{ marginBottom: 16, fontSize: '0.75rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            Analysis Result {result.cached && <span style={{ color: 'var(--green)' }}>· Cached</span>}
          </div>
          <div className="result-grid">
            <span className="result-key">emotion</span>
            <span className="result-val">
              <span className="emotion-badge">✦ {result.emotion}</span>
            </span>
            <span className="result-key">keywords</span>
            <span className="result-val">
              <div className="keywords" style={{ marginBottom: 0 }}>
                {result.keywords.map(k => <span key={k} className="keyword">#{k}</span>)}
              </div>
            </span>
            <span className="result-key">summary</span>
            <span className="result-val" style={{ fontStyle: 'italic', color: 'var(--text2)' }}>{result.summary}</span>
          </div>
        </div>
      )}

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}

// ─── InsightsPanel ────────────────────────────────────────────────────────────

function InsightsPanel({ userId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    api.getInsights(userId).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [userId]);

  if (loading) return (
    <div className="card full">
      <div className="card-title"><div className="icon icon-insight">📊</div> Insights</div>
      <div className="empty"><span className="spinner" /></div>
    </div>
  );

  if (!data) return null;

  const topEmotion = Object.entries(data.emotionBreakdown || {}).sort((a, b) => b[1] - a[1]);
  const topAmbience = Object.entries(data.ambienceBreakdown || {}).sort((a, b) => b[1] - a[1]);
  const maxEmotion = topEmotion[0]?.[1] || 1;
  const maxAmbience = topAmbience[0]?.[1] || 1;

  return (
    <div className="card full">
      <div className="card-title">
        <div className="icon icon-insight">📊</div>
        Your Insights
      </div>

      {data.totalEntries === 0 ? (
        <div className="empty">
          <div className="em">🌱</div>
          <p>No data yet. Write and analyze some entries first.</p>
        </div>
      ) : (
        <>
          <div className="insight-stats">
            <div className="stat-box">
              <div className="stat-value">{data.totalEntries}</div>
              <div className="stat-label">Total Entries</div>
            </div>
            <div className="stat-box">
              <div className="stat-value" style={{ fontSize: '1.4rem', textTransform: 'capitalize' }}>
                {data.topEmotion || '—'}
              </div>
              <div className="stat-label">Top Emotion</div>
            </div>
            <div className="stat-box">
              <div className="stat-value" style={{ fontSize: '1.4rem', textTransform: 'capitalize' }}>
                {data.mostUsedAmbience || '—'}
              </div>
              <div className="stat-label">Fav Ambience</div>
            </div>
            <div className="stat-box">
              <div className="stat-value">{data.recentKeywords.length}</div>
              <div className="stat-label">Unique Keywords</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {topEmotion.length > 0 && (
              <div className="breakdown-section">
                <div className="breakdown-title">Emotion Breakdown</div>
                {topEmotion.map(([e, c]) => (
                  <div className="bar-row" key={e}>
                    <span className="bar-label">{e}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(c / maxEmotion) * 100}%` }} />
                    </div>
                    <span className="bar-count">{c}</span>
                  </div>
                ))}
              </div>
            )}

            {topAmbience.length > 0 && (
              <div className="breakdown-section">
                <div className="breakdown-title">Ambience Breakdown</div>
                {topAmbience.map(([a, c]) => (
                  <div className="bar-row" key={a}>
                    <span className="bar-label">{a}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(c / maxAmbience) * 100}%`, background: 'linear-gradient(90deg, var(--purple), var(--accent))' }} />
                    </div>
                    <span className="bar-count">{c}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {data.recentKeywords.length > 0 && (
            <div className="breakdown-section" style={{ marginTop: 24 }}>
              <div className="breakdown-title">Top Keywords</div>
              <div className="keywords">
                {data.recentKeywords.map(k => (
                  <span key={k} className="keyword">#{k}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [userId, setUserId] = useState('user_123');
  const [tab, setTab] = useState('journal');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleSaved = () => setRefreshKey(k => k + 1);

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <div className="brand-icon">🌿</div>
          <div>
            <div className="brand-name">Arvy<span>aX</span> Journal</div>
            <div className="brand-tagline">Dream › Innovate › Create</div>
          </div>
        </div>

        <div className="user-selector">
          <span>User ID:</span>
          <input
            type="text"
            value={userId}
            onChange={e => setUserId(e.target.value)}
            placeholder="user_123"
          />
        </div>
      </header>

      <div className="tabs">
        <button className={`tab ${tab === 'journal' ? 'active' : ''}`} onClick={() => setTab('journal')}>
          ✍️ Journal
        </button>
        <button className={`tab ${tab === 'analyze' ? 'active' : ''}`} onClick={() => setTab('analyze')}>
          🔮 Analyze
        </button>
        <button className={`tab ${tab === 'insights' ? 'active' : ''}`} onClick={() => setTab('insights')}>
          📊 Insights
        </button>
      </div>

      {tab === 'journal' && (
        <div className="grid-2">
          <JournalForm userId={userId} onSaved={handleSaved} />
          <EntriesList key={refreshKey} userId={userId} />
        </div>
      )}

      {tab === 'analyze' && (
        <div className="grid-2">
          <AnalyzePanel />
        </div>
      )}

      {tab === 'insights' && (
        <div className="grid-2">
          <InsightsPanel key={userId} userId={userId} />
        </div>
      )}
    </div>
  );
}
