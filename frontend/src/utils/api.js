const BASE_URL = process.env.REACT_APP_API_URL || '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  createEntry: (payload) =>
    request('/journal', { method: 'POST', body: JSON.stringify(payload) }),

  getEntries: (userId, params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/journal/${userId}${qs ? '?' + qs : ''}`);
  },

  analyzeText: (text, entryId) =>
    request('/journal/analyze', { method: 'POST', body: JSON.stringify({ text, entryId }) }),

  getInsights: (userId) =>
    request(`/journal/insights/${userId}`),

  streamAnalysis: async (text, onChunk, onDone) => {
    const res = await fetch(`${BASE_URL}/journal/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, stream: true })
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6);
        if (payload === '[DONE]') { onDone?.(); return; }
        try {
          const { chunk, error } = JSON.parse(payload);
          if (error) throw new Error(error);
          if (chunk) onChunk(chunk);
        } catch {}
      }
    }
    onDone?.();
  }
};
