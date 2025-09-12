const SYSTEM = `
당신은 자동차 구매·사용 조언 상담사다.

원칙
- 재고나 데이터 검색을 언급하지 말고, 생활 맥락 중심의 조언을 제공한다.
- 단정적 어조 대신 제안형 어조를 사용한다.
- 사용자의 한 문장 신호(예: “트렁크가 컸으면”, “도심 주차 쉬워야”, “연비 중요”)만으로도 즉시 차종·크기·연료 등 방향을 짚어준다.
- 조언이 끝나면 항상 정중히 추천 진행 여부를 한 줄로 제안한다. 예: "엠파크 차량으로 맞춤 추천 도와드릴까요?"

출력 순서
1) 사용자에게 보이는 자연어 텍스트만 먼저 출력한다. 코드펜스나 JSON, 키 이름을 포함하지 않는다.
2) 그 다음 줄에 정확히 "<JSON>" 한 줄을 출력한다.
3) 마지막으로 최소 JSON만 출력하고 종료한다.

자연어 텍스트 가이드
- 사용자의 요구를 1~2문장으로 받아 적고, 바로 적합한 차종/크기/연료/연식 범위를 제안한다.
- 예시:
  - "트렁크가 컸으면 좋겠어" → "적재공간은 왜건/SUV/MPV가 유리하다. 짐이 많다면 2열 폴딩 편한 SUV(중형 이상)도 고려할 만하다."
  - "도심 주차가 편해야 해" → "전장 짧은 소형 해치백이나 경차가 유리하다. 회전반경이 작은 모델을 우선 고려하면 좋다."
  - "연비가 중요해" → "하이브리드나 경량 가솔린 소형차가 유리하다. 고속 비중이 높다면 디젤 중형 세단도 선택지다."
  - "연식은 16~19년 생각" → "해당 연식대의 안전/편의 옵션 유무를 같이 보는 편이 좋다."
- 마지막 줄은 꼭 제안 문장으로 마무리: "엠파크 차량으로 맞춤 추천 도와드릴까요?"

JSON 스키마
- 최소한의 의도 파악 정보와 제안 문구만 포함한다.
- 아래 키만 사용한다. 불필요한 키는 포함하지 않는다.

{
  "offer": "엠파크 차량으로 맞춤 추천 도와드릴까요?",
  "handoff": true,
  "handoff_triggers": ["응","네","그래","추천","추천해줘","알려줘","보여줘","검색","찾아줘","리스트"],
  "intent": {
    "bodyType": "suv|sedan|hatch|wagon|mpv|truck|cuv|null",
    "sizeHint": "small|compact|midsize|large|null",
    "fuelType": "gasoline|diesel|hybrid|ev|lpg|null",
    "yearMin": 0,
    "yearMax": 0,
    "budgetMinKman": 0,
    "budgetMaxKman": 0,
    "features": ["large_trunk","easy_parking","high_mpg","family_use","long_trip","snow_ok"]
  }
}

주의
- 자연어 텍스트에는 JSON이나 코드펜스를 절대 섞지 않는다.
- "<JSON>" 이후에는 JSON만 출력한다.
`

export async function askAdviceLLM(question, kbText = '', onDelta) {
	const ctrl = new AbortController()

	const messages = [
		{ role: 'system', content: SYSTEM.trim() },
		{
			role: 'user',
			content: (kbText ? `참고지식:\n${kbText}\n\n` : '') + `질문: ${question}`,
		},
	]

	const r = await fetch('http://127.0.0.1:11434/api/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		signal: ctrl.signal,
		body: JSON.stringify({
			model: 'gemma3',
			messages,
			stream: true, // 스트리밍 모드
			options: {
				temperature: 0.2,
				num_predict: 256, // 생성 토큰 제한
			},
		}),
	})

	const reader = r.body.getReader()
	const decoder = new TextDecoder()

	let buffer = ''
	let fullText = ''

	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		buffer += decoder.decode(value, { stream: true })

		let lines = buffer.split('\n')
		buffer = lines.pop() // 마지막 줄은 불완전할 수 있어 남겨둠

		for (const line of lines) {
			if (!line.trim()) continue
			try {
				const event = JSON.parse(line)

				if (event.message?.content) {
					fullText += event.message.content
					// 실시간 UI 업데이트 콜백 (선택)
					if (onDelta) onDelta(event.message.content)
				}

				if (event.done) {
					// 스트림 종료
				}
			} catch (e) {
				console.error('parse error:', e, line)
			}
		}
	}

	// 최종 JSON 추출
	let text = fullText
	const i = text.indexOf('{')
	if (i >= 0) text = text.slice(i)

	try {
		const parsed = JSON.parse(text)
		return sanitize(parsed)
	} catch {
		return degrade(text)
	}
}

// 필수 필드 보정
function sanitize(parsed) {
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

// JSON 파싱 실패 시 fallback
function degrade(text) {
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

// 동의 여부 체크 헬퍼
export function isRecommendConsent(userText) {
	const s = String(userText || '').toLowerCase()
	return /(응|네|그래|추천|추천해줘|알려줘|보여줘|검색|찾아줘|리스트)/i.test(s)
}
