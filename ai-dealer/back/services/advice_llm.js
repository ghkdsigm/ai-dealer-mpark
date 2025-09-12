// NOTE: 코드 주석에 이모티콘은 사용하지 않음

// Node 18+ 글로벌 fetch 사용
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
const MODEL = process.env.ADVICE_MODEL || 'gemma3'

// 시스템 프롬프트
const SYSTEM = `
당신은 자동차 구매·사용 조언 상담사다.

스타일 가이드:
- 반드시 존댓말과 한국어 구어체를 사용한다. (예: "~하시는 게 좋아요", "~해주세요", "~입니다" 혼용 가능하나 반말 금지)
- 불필요한 인사말, 서두, 맺음말은 넣지 않는다. (바로 핵심만)
- 단정 표현 대신 제안 어조를 사용한다. (권유, 제안, 주의 환기)
- 차량 검색/재고 데이터 언급은 하지 않는다.
- 마지막에 추천 여부를 정중히 묻는 한 줄 제안을 포함한다.
- 출력은 반드시 JSON만 한다. JSON 외의 텍스트를 추가하지 않는다.

출력 JSON 스키마:
{
  "summary": "한 문단 요약 (존댓말·구어체, 1~3문장)",
  "bullets": ["핵심 포인트 1", "핵심 포인트 2", "핵심 포인트 3"],
  "caveats": ["주의/예외 1"],
  "followups": ["후속 질문 1"],
  "offer": "사용자에게 추천 진행 여부를 정중히 묻는 한 줄 제안 (존댓말·구어체)",
  "handoff": true,
  "handoff_triggers": ["응","네","그래","추천","추천해줘","알려줘","보여줘","검색","찾아줘","리스트"]
}

예시 출력(JSON):
{
  "summary": "빗길에서는 속도를 줄이고 타이어와 와이퍼 상태를 먼저 확인하시는 게 좋아요.",
  "bullets": [
    "배수 성능 좋은 타이어와 적정 공기압을 유지해주세요.",
    "차간거리는 평소의 2~3배로 넉넉하게 두시면 좋아요.",
    "급가속·급제동·급차선 변경은 피해주세요."
  ],
  "caveats": [
    "차종과 타이어 규격에 따라 권장 공기압이 달라질 수 있어요."
  ],
  "followups": [
    "평소 주행 환경(도심/고속/장거리)을 알려주실 수 있을까요?"
  ],
  "offer": "원하시면 예산이나 차종을 알려주시면 지금 바로 추천을 도와드릴게요. 추천을 진행할까요?",
  "handoff": true,
  "handoff_triggers": ["응","네","그래","추천","추천해줘","알려줘","보여줘","검색","찾아줘","리스트"]
}
`.trim()

// 기본 옵션 (stream 강제 on)
const DEFAULT_OPTS = {
	stream: true, // 스트리밍 강제 on
	timeoutMs: 15000, // 전체 타임아웃(요청+스트림)
	retries: 1, // 실패 시 재시도 횟수
	temperature: 0.28,
	num_predict: 160,
	num_ctx: 1792,
	keep_alive: '10m',
}

// 폴백 응답
function fallbackAdvice(text = '') {
	return {
		summary: text
			? text.slice(0, 300)
			: '간단 팁: 빗길/눈길에는 속도를 줄이고 타이어·와이퍼 상태를 우선 점검하는 것이 좋다.',
		bullets: [
			'배수 성능 좋은 타이어와 적정 공기압 권장',
			'차간거리 2~3배 유지, 급조작 지양',
			'와이퍼·워셔액·ABS/ESC 점검',
		],
		caveats: ['차종·타이어 규격에 따라 권장 공기압·성능이 다르다.'],
		followups: ['예산·차종을 말씀해주시면 모델 추천으로 이어갈 수 있다.'],
		offer: '원하시면 예산이나 차종을 알려주시면 지금 바로 추천을 도와드리겠습니다. 추천을 진행할까요?',
		handoff: true,
		handoff_triggers: ['응', '네', '그래', '추천', '추천해줘', '알려줘', '보여줘', '검색', '찾아줘', '리스트'],
	}
}

// 필수 필드 보정
function normalizeAdvice(parsed) {
	return {
		summary: parsed.summary || '',
		bullets: Array.isArray(parsed.bullets) ? parsed.bullets : [],
		caveats: Array.isArray(parsed.caveats) ? parsed.caveats : [],
		followups: Array.isArray(parsed.followups) ? parsed.followups : [],
		offer:
			typeof parsed.offer === 'string' && parsed.offer.trim()
				? parsed.offer
				: '원하시면 예산이나 차종을 알려주시면 지금 바로 추천을 도와드리겠습니다. 추천을 진행할까요?',
		handoff: typeof parsed.handoff === 'boolean' ? parsed.handoff : true,
		handoff_triggers:
			Array.isArray(parsed.handoff_triggers) && parsed.handoff_triggers.length
				? parsed.handoff_triggers
				: ['응', '네', '그래', '추천', '추천해줘', '알려줘', '보여줘', '검색', '찾아줘', '리스트'],
	}
}

// 모델이 출력한 텍스트에서 JSON을 최대한 복구하여 파싱
function parseAdvicePayload(text) {
	if (!text) return fallbackAdvice('')
	try {
		return normalizeAdvice(JSON.parse(text))
	} catch {}
	const first = text.indexOf('{')
	const last = text.lastIndexOf('}')
	if (first >= 0 && last > first) {
		try {
			return normalizeAdvice(JSON.parse(text.slice(first, last + 1)))
		} catch {}
	}
	const lines = text.split(/\r?\n/).filter(Boolean)
	for (const line of lines.reverse()) {
		const f = line.indexOf('{')
		const l = line.lastIndexOf('}')
		if (f >= 0 && l > f) {
			try {
				return normalizeAdvice(JSON.parse(line.slice(f, l + 1)))
			} catch {}
		}
	}
	return fallbackAdvice(text)
}

// NDJSON 스트림을 읽어 content를 누적한다.
// Ollama /api/chat 스트림은 각 줄이 JSON이며 message.content 조각이 점진적으로 도착한다.
async function readNdjsonToFullText(response, abortSignal) {
	if (!response.body) return ''
	const reader = response.body.getReader()
	const decoder = new TextDecoder()
	let buf = ''
	let full = ''

	while (true) {
		// AbortController가 중간에 abort 되면 여기서 예외가 난다.
		const { value, done } = await reader.read()
		if (done) break
		buf += decoder.decode(value, { stream: true })

		// 줄 단위로 분리
		const lines = buf.split(/\r?\n/)
		buf = lines.pop() || ''

		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed) continue
			try {
				const obj = JSON.parse(trimmed)
				if (obj?.message?.content) full += obj.message.content
				if (obj?.done) {
					// Ollama가 done 신호를 주는 경우
					// 남은 버퍼는 무시하고 종료
					return full
				}
			} catch {
				// 조각이 불완전한 경우는 다음 루프에서 이어붙여질 수 있으므로 무시
			}
		}
		if (abortSignal?.aborted) break
	}

	// 마지막 버퍼 플러시 시도
	if (buf.trim()) {
		try {
			const obj = JSON.parse(buf)
			if (obj?.message?.content) full += obj.message.content
		} catch {}
	}
	return full
}

// 메인: 스트리밍 on으로 조언 JSON을 반환
export async function askAdviceLLM(question, kbText = '', userOpts = {}) {
	const opts = { ...DEFAULT_OPTS, ...userOpts, stream: true } // 강제 스트리밍
	const messages = [
		{ role: 'system', content: SYSTEM },
		{ role: 'user', content: (kbText ? `참고지식:\n${kbText}\n\n` : '') + `질문: ${question}` },
	]

	const body = {
		model: MODEL,
		messages,
		stream: true,
		options: {
			temperature: opts.temperature,
			num_predict: opts.num_predict,
			num_ctx: opts.num_ctx,
			keep_alive: opts.keep_alive,
		},
	}

	let attempt = 0
	let lastError = null

	while (attempt <= opts.retries) {
		attempt += 1
		const ac = new AbortController()
		const to = setTimeout(() => ac.abort(), opts.timeoutMs)

		try {
			const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
				signal: ac.signal,
			})

			if (!res.ok) {
				const t = await res.text().catch(() => '')
				throw new Error(`ADVICE_LLM_BAD_STATUS: ${res.status} ${t}`)
			}

			const fullText = await readNdjsonToFullText(res, ac.signal)
			clearTimeout(to)

			// 모델이 JSON을 바로 내놓도록 프롬프트했지만, 방어적으로 복구
			return parseAdvicePayload(fullText)
		} catch (err) {
			clearTimeout(to)
			lastError = err
			// 재시도 조건: 타임아웃/연결 오류류만 재시도
			const msg = String(err?.message || '')
			const retriable =
				msg.includes('The operation was aborted') ||
				msg.includes('AbortError') ||
				msg.includes('ECONNRESET') ||
				msg.includes('ECONNREFUSED') ||
				msg.includes('socket hang up') ||
				msg.includes('fetch failed')

			if (!retriable || attempt > opts.retries) {
				// 최종 폴백
				return fallbackAdvice('')
			}

			// 간단한 지수 백오프
			const delay = Math.min(500 * Math.pow(2, attempt - 1), 2000)
			await new Promise(r => setTimeout(r, delay))
			continue
		}
	}

	// 코드 흐름상 도달하지 않지만 안전망
	return fallbackAdvice('')
}

// 유저 답변이 추천 진행 동의인지 판단
export function isRecommendConsent(userText) {
	const s = String(userText || '').toLowerCase()
	return /(응|네|그래|추천|추천해줘|알려줘|보여줘|검색|찾아줘|리스트)/i.test(s)
}
