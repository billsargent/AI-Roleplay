/**
 * ─── DeepSeek request handling (server side) ───
 *
 * Validates what the browser asks the DeepSeek proxy to do, then forwards it.
 * The API key belongs to the site, so a logged-in user must not be able to
 * pick another model, ask for huge replies, or send arbitrary payloads.
 *
 * @module deepseek
 */

/** DeepSeek API base URL (DEEPSEEK_BASE_URL overrides it, e.g. to point tests at a fake server) */
export const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

/**
 * Hard ceiling for max_tokens in one request. Current DeepSeek models allow
 * far more output; this only stops runaway requests. The admin "Max Tokens
 * Cap" setting applies below it.
 */
export const MAX_REPLY_TOKENS = 32768;

/** Default model for new installs (DeepSeek's current general model) */
export const DEFAULT_MODEL = 'deepseek-flash';

/**
 * Thinking (reasoning) mode. '' leaves it to the model's default and sends
 * nothing. In thinking mode DeepSeek ignores temperature and the penalties,
 * so they are not sent, and the reply budget gets headroom for the
 * reasoning tokens.
 */
export const THINKING_LEVELS = ['', 'off', 'low', 'high', 'max'];
const THINKING_HEADROOM = { low: 2048, high: 4096, max: 8192 };
/** Upper bound on messages per request and on total characters sent */
export const MAX_MESSAGES = 1000;
export const MAX_TOTAL_CHARS = 1_500_000;

const ROLES = new Set(['system', 'user', 'assistant']);

export class LlmRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Validates a chat completion request from the browser and returns the
 * parameters to send upstream. The model always comes from server settings.
 *
 * @param {object} body - req.body
 * @param {object} opts
 * @param {string} opts.model - Admin-configured model id
 * @param {number} [opts.defaultMaxTokens]
 * @param {number} [opts.defaultTemperature]
 * @param {number} [opts.maxTokensCap] - Admin cap on reply tokens (before thinking headroom)
 * @param {string} [opts.thinking] - One of THINKING_LEVELS
 * @returns {{ model: string, messages: Array<{role: string, content: string}>, max_tokens: number, temperature?: number, frequency_penalty?: number, presence_penalty?: number, thinking?: object, reasoning_effort?: string }}
 */
export function validateCompletionRequest(body, { model, defaultMaxTokens = 800, defaultTemperature, maxTokensCap = MAX_REPLY_TOKENS, thinking = '' } = {}) {
  const { messages } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new LlmRequestError('messages must be a non-empty array');
  }
  if (messages.length > MAX_MESSAGES) {
    throw new LlmRequestError(`Too many messages (max ${MAX_MESSAGES})`, 413);
  }
  let total = 0;
  const clean = messages.map((m) => {
    if (!m || typeof m !== 'object' || !ROLES.has(m.role) || typeof m.content !== 'string') {
      throw new LlmRequestError('Each message needs a role (system, user or assistant) and string content');
    }
    total += m.content.length;
    return { role: m.role, content: m.content };
  });
  if (total > MAX_TOTAL_CHARS) {
    throw new LlmRequestError('Conversation is too long to send', 413);
  }

  const maxTokens = num(body.max_tokens);
  const temperature = num(body.temperature) ?? num(defaultTemperature);
  const frequency = num(body.frequency_penalty);
  const presence = num(body.presence_penalty);

  const cap = clamp(Math.round(num(maxTokensCap) ?? MAX_REPLY_TOKENS), 1, MAX_REPLY_TOKENS);
  const params = {
    model,
    messages: clean,
    max_tokens: clamp(Math.round(maxTokens ?? defaultMaxTokens), 1, cap),
  };

  const level = THINKING_LEVELS.includes(thinking) ? thinking : '';
  if (level && level !== 'off') {
    // Thinking on: sampling values would be ignored, and reasoning needs room
    params.thinking = { type: 'enabled' };
    params.reasoning_effort = level;
    params.max_tokens = Math.min(params.max_tokens + THINKING_HEADROOM[level], MAX_REPLY_TOKENS);
    return params;
  }
  if (level === 'off') params.thinking = { type: 'disabled' };

  if (temperature !== undefined) params.temperature = clamp(temperature, 0, 2);
  if (frequency !== undefined) params.frequency_penalty = clamp(frequency, -2, 2);
  if (presence !== undefined) params.presence_penalty = clamp(presence, -2, 2);
  return params;
}

/**
 * Calls DeepSeek once (no streaming) and returns the reply text, for work
 * the server finishes itself (e.g. memory cards).
 * @throws {LlmRequestError} 502 on upstream errors, 504 on timeout
 */
export async function completeOnce(params, { apiKey, fetchImpl = fetch, baseUrl = DEEPSEEK_BASE_URL, timeoutMs = 120_000 }) {
  let upstream;
  try {
    upstream = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new LlmRequestError(err?.name === 'TimeoutError' ? 'DeepSeek did not respond in time' : 'Failed to communicate with DeepSeek API', err?.name === 'TimeoutError' ? 504 : 502);
  }
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    throw new LlmRequestError(data.error?.message || `DeepSeek API error (HTTP ${upstream.status})`, 502);
  }
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Calls DeepSeek and relays the answer to the client.
 *
 * - Upstream errors are returned as 502 with DeepSeek's message, never with
 *   DeepSeek's own status: a 401 from DeepSeek (bad site key) must not look
 *   like the user's session expired.
 * - When the client disconnects, the upstream request is aborted so the site
 *   stops paying for tokens nobody will read.
 * - A failure mid-stream ends the response with an SSE error event instead of
 *   leaving the connection open.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {object} params - Output of validateCompletionRequest
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {boolean} [opts.stream]
 * @param {typeof fetch} [opts.fetchImpl] - injectable for tests
 * @param {string} [opts.baseUrl] - injectable for tests
 */
export async function relayCompletion(req, res, params, { apiKey, stream = false, fetchImpl = fetch, baseUrl = DEEPSEEK_BASE_URL }) {
  const controller = new AbortController();
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  res.on('close', onClose);
  // Give up if DeepSeek has not started answering within 2 minutes
  const startTimer = setTimeout(() => controller.abort(), 120_000);

  try {
    const upstream = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(stream ? { ...params, stream: true } : params),
      signal: controller.signal,
    });
    clearTimeout(startTimer);

    if (!upstream.ok) {
      const data = await upstream.json().catch(() => ({}));
      console.warn(`DeepSeek returned HTTP ${upstream.status}`);
      return res.status(502).json({ error: data.error?.message || `DeepSeek API error (HTTP ${upstream.status})` });
    }

    if (!stream) {
      return res.json(await upstream.json());
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const reader = upstream.body?.getReader();
    if (!reader) throw new Error('No response body from DeepSeek');
    const decoder = new TextDecoder();
    let sawDone = false;
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        if (line.trim() === 'data: [DONE]') sawDone = true;
        // Keep SSE framing: each event ends with a blank line
        res.write(line + '\n\n');
      }
    }
    if (buffer.trim()) {
      if (buffer.trim() === 'data: [DONE]') sawDone = true;
      res.write(buffer + '\n\n');
    }
    if (!sawDone) res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    clearTimeout(startTimer);
    if (controller.signal.aborted && res.destroyed) return; // client went away
    console.error('DeepSeek proxy error:', err?.message || err);
    if (!res.headersSent) {
      const timedOut = controller.signal.aborted;
      return res.status(timedOut ? 504 : 502).json({
        error: timedOut ? 'DeepSeek did not respond in time' : 'Failed to communicate with DeepSeek API',
      });
    }
    // Mid-stream failure: tell the client and close the stream
    res.write(`data: ${JSON.stringify({ error: { message: 'The AI response was interrupted' } })}\n\n`);
    res.end();
  } finally {
    res.off('close', onClose);
  }
}
