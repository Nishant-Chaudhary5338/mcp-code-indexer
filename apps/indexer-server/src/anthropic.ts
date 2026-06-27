/**
 * Bring-your-own-key path for the hosted demo. The local `claude` CLI doesn't
 * exist on the server, so a visitor who wants real LLM answers supplies their own
 * Anthropic key per request. The key is used for exactly one call and never
 * stored, logged, or persisted — it lives only for the duration of the fetch.
 */
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;
const TIMEOUT_MS = 30_000;

interface AnthropicResponse {
  content?: { type: string; text?: string }[];
}

/** One-shot completion via a user-supplied key. Returns null on any failure. */
export const askAnthropic = async (
  apiKey: string,
  prompt: string,
): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AnthropicResponse;
    const text = data.content
      ?.filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')
      .trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};
