import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// $ per million tokens. Verify at https://platform.claude.com/docs/en/about-claude/pricing
// before switching the schedule on -- prices do change.
const PRICING = {
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
  'claude-sonnet-5': { input: 2.0, output: 10.0 },
};

function costUsd(model, usage) {
  const p = PRICING[model];
  if (!p) return null;
  const inputTok = (usage.input_tokens ?? 0) - (usage.cache_read_input_tokens ?? 0);
  const cacheReadTok = usage.cache_read_input_tokens ?? 0;
  const outputTok = usage.output_tokens ?? 0;
  return (inputTok * p.input + cacheReadTok * p.input * 0.1 + outputTok * p.output) / 1_000_000;
}

const usageLog = [];

export async function callClaude({ model, system, messages, maxTokens = 1024, action }) {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages,
    thinking: { type: 'disabled' },
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  const record = {
    at: new Date().toISOString(),
    action,
    model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    costUsd: costUsd(model, response.usage),
  };
  usageLog.push(record);

  return { text: textBlock?.text ?? '', usage: response.usage, record };
}

export function getUsageLog() {
  return usageLog;
}

export function summarizeUsage() {
  const totalCost = usageLog.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const byAction = {};
  for (const r of usageLog) {
    byAction[r.action] ??= { calls: 0, costUsd: 0 };
    byAction[r.action].calls += 1;
    byAction[r.action].costUsd += r.costUsd ?? 0;
  }
  return { totalCost, calls: usageLog.length, byAction };
}
