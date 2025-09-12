const SYSTEM = `
당신은 자동차 구매·사용 조언 상담사다.
- 재고나 데이터 검색을 언급하지 말고, 생활 맥락 조언을 준다.
- 확정 표현 대신 제안 어조를 사용한다.
- 답변 마지막에는 사용자가 원하면 차량 검색을 진행할 수 있도록 공손한 한 줄 제안을 포함한다.
  예: "원하시면 예산이나 차종을 알려주시면 지금 바로 추천을 도와드리겠습니다. 추천을 진행할까요?"
- 반드시 아래 JSON 형식을 지켜서 출력한다.

{
  "summary": "한 문단 요약",
  "bullets": ["핵심 포인트 1","핵심 포인트 2","핵심 포인트 3"],
  "caveats": ["주의/예외 1"],
  "followups": ["후속 질문 1"],
  "offer": "사용자에게 추천 진행 여부를 정중히 묻는 한 줄 제안",
  "handoff": true,
  "handoff_triggers": ["응","네","그래","추천","추천해줘","알려줘","보여줘","검색","찾아줘","리스트"]
}
`

export async function askAdviceLLM(question, kbText = '') {
	const messages = [
		{ role: 'system', content: SYSTEM.trim() },
		{ role: 'user', content: (kbText ? `참고지식:\n${kbText}\n\n` : '') + `질문: ${question}` },
	]

	const r = await fetch('http://127.0.0.1:11434/api/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: 'gemma3', messages, stream: false, options: { temperature: 0.4 } }),
	})
	const data = await r.json()
	let text = data?.message?.content || ''

	try {
		const i = text.indexOf('{')
		if (i >= 0) text = text.slice(i)
		const parsed = JSON.parse(text)

		// 필수 필드 보정
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
	} catch {
		// JSON이 아니어도 graceful degrade
		return {
			summary: text.slice(0, 300),
			bullets: [],
			caveats: [],
			followups: [],
			offer: '원하시면 예산이나 차종을 알려주시면 지금 바로 추천을 도와드리겠습니다. 추천을 진행할까요?',
			handoff: true,
			handoff_triggers: ['응', '네', '그래', '추천', '추천해줘', '알려줘', '보여줘', '검색', '찾아줘', '리스트'],
		}
	}
}

// 유저 답변이 추천 진행 동의인지 판단하는 헬퍼 (선택)
export function isRecommendConsent(userText) {
	const s = String(userText || '').toLowerCase()
	return /(응|네|그래|추천|추천해줘|알려줘|보여줘|검색|찾아줘|리스트)/i.test(s)
}
