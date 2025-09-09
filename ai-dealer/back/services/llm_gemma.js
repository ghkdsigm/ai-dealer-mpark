// back/services/llm_gemma.js
// Ollama Gemma3 연동 유틸리티
// - askText: 단발 텍스트 생성
// - askJSON: JSON만 뽑아내기(코드블록/잡텍스트 섞여도 안전 파싱)
// - chat: 시스템/유저/어시스턴트 역할 기반 대화
// - streamText: 토큰 스트리밍
// - health: 모델/서버 상태 점검
//
// 의존: node-fetch (Node 18 이상이면 전역 fetch 사용 가능. 필요시 아래 require 유지)

let fetchFn = global.fetch;
if (!fetchFn) {
  fetchFn = require('node-fetch');
}

const { AbortController } = require('abort-controller');

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma3';
const OLLAMA_TEMPERATURE = parseFloat(process.env.OLLAMA_TEMPERATURE || '0.2');
const OLLAMA_NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX || '4096', 10);
const OLLAMA_TOP_P = process.env.OLLAMA_TOP_P ? parseFloat(process.env.OLLAMA_TOP_P) : undefined;
const OLLAMA_SEED = process.env.OLLAMA_SEED ? parseInt(process.env.OLLAMA_SEED, 10) : undefined;
const DEFAULT_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS || '30000', 10);
const DEFAULT_RETRIES = parseInt(process.env.OLLAMA_RETRIES || '2', 10);

/** 내부 공통 호출 */
async function generate({
  prompt,
  system,
  model = OLLAMA_MODEL,
  stream = false,
  temperature = OLLAMA_TEMPERATURE,
  num_ctx = OLLAMA_NUM_CTX,
  top_p = OLLAMA_TOP_P,
  seed = OLLAMA_SEED,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
}) {
  const body = {
    model,
    prompt,
    stream,
    options: cleanUndefined({
      temperature,
      num_ctx,
      top_p,
      seed,
    }),
    system,
  };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetchFn(`${OLLAMA_HOST}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(id);

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ollama HTTP ${res.status}: ${text}`);
      }

      if (!stream) {
        const data = await res.json();
        // data.response 에 최종 응답 문자열
        return data.response || '';
      }

      // 스트림 모드: NDJSON 라인을 순차적으로 yield
      // 사용자는 for await..of 루프로 소비
      async function* iter() {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;
            try {
              const json = JSON.parse(line);
              if (json.response) yield json.response;
            } catch {
              // 파싱 실패 라인은 무시
            }
          }
        }
        if (buf.trim()) {
          try {
            const json = JSON.parse(buf.trim());
            if (json.response) yield json.response;
          } catch { /* ignore */ }
        }
      }
      return iter();
    } catch (err) {
      clearTimeout(id);
      lastErr = err;
      if (attempt < retries) {
        await delay(200 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('Unknown error');
}

/** 텍스트 한 번 호출 */
async function askText(userPrompt, opts = {}) {
  const { system, ...rest } = opts;
  return generate({ prompt: userPrompt, system, ...rest, stream: false });
}

/** 시스템/유저/어시스턴트 역할 기반 chat 템플릿 */
function buildChatPrompt(messages) {
  // messages: [{role:'system'|'user'|'assistant', content:string}]
  // 간단한 역할 구분 템플릿. Gemma3는 일반 프롬프트도 잘 처리한다.
  const parts = [];
  for (const m of messages) {
    if (m.role === 'system') {
      parts.push(`[system]\n${m.content}\n`);
    } else if (m.role === 'assistant') {
      parts.push(`[assistant]\n${m.content}\n`);
    } else {
      parts.push(`[user]\n${m.content}\n`);
    }
  }
  parts.push(`[assistant]\n`);
  return parts.join('\n');
}

/** 대화형 호출 */
async function chat(messages, opts = {}) {
  const sysFromMsgs = messages.find(m => m.role === 'system');
  const system = opts.system || (sysFromMsgs ? sysFromMsgs.content : undefined);
  const prompt = buildChatPrompt(messages.filter(m => m.role !== 'system'));
  return generate({ prompt, system, ...opts, stream: false });
}

/** 토큰 스트리밍 */
async function* streamText(userPrompt, opts = {}) {
  const { system, ...rest } = opts;
  const it = await generate({ prompt: userPrompt, system, ...rest, stream: true });
  for await (const chunk of it) yield chunk;
}

/** JSON만 안전하게 회수하기 위한 유틸 */
async function askJSON(userPrompt, opts = {}) {
  const system = [
    '너는 JSON 생성 도우미이다.',
    '반드시 유효한 JSON 문자열만 출력한다.',
    '설명, 마크다운, 코드블록 표시는 출력하지 않는다.',
    '모든 숫자는 정수 또는 실수로 표현한다.',
    '필드값이 없으면 null을 넣는다.',
  ].join(' ');

  const raw = await generate({
    prompt: userPrompt,
    system: opts.system ? `${opts.system}\n${system}` : system,
    ...opts,
    stream: false,
  });

  const json = safeParseJSON(raw);
  if (json.ok) return json.value;

  // 백업: 백틱 코드블록 안 JSON 추출 시도
  const extracted = extractJSONFromText(raw);
  const json2 = safeParseJSON(extracted);
  if (json2.ok) return json2.value;

  // 최후: 중괄호 스니펫만 추출
  const braces = findFirstBraces(raw);
  const json3 = safeParseJSON(braces);
  if (json3.ok) return json3.value;

  const err = new Error('Failed to parse JSON from model response');
  err.raw = raw;
  throw err;
}

/** 서버/모델 상태 점검 */
async function health() {
  // 간단 호출로 확인
  try {
    const text = await askText('ping', { temperature: 0.0, timeoutMs: 8000 });
    return { ok: true, sample: text.slice(0, 64) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** 라우트 쪽에서 옵션 기본값 바꾸고 싶을 때 */
function withDefaults(baseOpts = {}) {
  return {
    askText: (p, o) => askText(p, { ...baseOpts, ...o }),
    askJSON: (p, o) => askJSON(p, { ...baseOpts, ...o }),
    chat: (m, o) => chat(m, { ...baseOpts, ...o }),
    streamText: (p, o) => streamText(p, { ...baseOpts, ...o }),
    health,
  };
}

/** 유틸리티들 */
function cleanUndefined(o) {
  const out = {};
  Object.entries(o).forEach(([k, v]) => {
    if (v !== undefined) out[k] = v;
  });
  return out;
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function safeParseJSON(s) {
  try {
    if (typeof s !== 'string') return { ok: false, error: 'not string' };
    const trimmed = s.trim();
    // 코드블록 제거 시도
    const t = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    return { ok: true, value: JSON.parse(t) };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function extractJSONFromText(s) {
  const codeBlock = /```json([\s\S]*?)```/i.exec(s) || /```([\s\S]*?)```/i.exec(s);
  if (codeBlock) return codeBlock[1].trim();
  return s;
}

function findFirstBraces(s) {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) return s.slice(start, end + 1);
  return s;
}

module.exports = {
  askText,
  askJSON,
  chat,
  streamText,
  health,
  withDefaults,
};
