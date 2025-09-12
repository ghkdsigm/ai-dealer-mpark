// NOTE: 코드 주석에 이모티콘은 사용하지 않음

export function safeInt(x, min) {
	if (x === null || x === undefined) return undefined
	const n = parseInt(String(x), 10)
	if (!Number.isFinite(n)) return undefined
	if (typeof min === 'number' && n < min) return min
	return n
}

export function toBoolLoose(x) {
	if (typeof x === 'boolean') return x
	const s = String(x || '').toLowerCase()
	if (s === 'true' || s === '1' || s === 'y') return true
	if (s === 'false' || s === '0' || s === 'n') return false
	return undefined
}

export function isVehicleRelated(intent, msg) {
	if (!intent) return false
	if (intent.kind === 'buy' || intent.kind === 'sell') return true
	const looksVehicle =
		/(차|차량|suv|세단|해치백|밴|승합|트럭|픽업|연비|예산|가격|만원|월\s*[0-9]+|할부|km|주행|연식|브랜드|모델|옵션|색상|lpg|디젤|가솔린|하이브리드|전기|ev)/i.test(
			msg || '',
		)
	return looksVehicle
}

export function classifyIntentAdvice(text) {
	const raw = String(text || '')
	const s = raw.toLowerCase().trim()
	const sNoSpace = s.replace(/\s+/g, '')

	// 1) 시소러스 정의
	const adviceLex = [
		// 색상/외관 관리
		'무슨색',
		'색추천',
		'색상추천',
		'색깔',
		'광택',
		'스크래치',
		'발열',
		'야외',
		'야외주차',
		'세워두',
		'노지',
		// 가족/생활 맥락
		'가족',
		'아이',
		'유아',
		'카시트',
		'유모차',
		'5인',
		'여행',
		'캠핑',
		'차박',
		'짐',
		'트렁크',
		'승하차',
		// 사용환경/패턴
		'출퇴근',
		'도심',
		'장거리',
		'고속',
		'눈길',
		'빗길',
		'비포장',
		'오프로드',
		'주차',
		'문콕',
		'소음',
		'정숙성',
		'승차감',
		// 비용/유지
		'유지비',
		'보험',
		'세금',
		'감가',
		'감가상각',
		'리세일',
		'중고가치',
		'관리',
		'세차',
		'코팅',
		'연비현실',
		'타이어',
		// 비교/의견
		'장단점',
		'비교',
		'권장',
		'추천이유',
		'고민',
		'괜찮을까',
		'어울리',
		'적합',
		'용도',
		'생활형',
	]

	const searchLex = [
		// 정형 조건
		'재고',
		'목록',
		'리스트',
		'검색',
		'찾아줘',
		'보여줘',
		'조건',
		'필터',
		'정렬',
		'옵션',
		'트림',
		'사양',
		'가격',
		'예산',
		'만원',
		'억',
		'월',
		'할부',
		'리스',
		'전액',
		'무보증',
		'km',
		'키로',
		'킬로',
		'주행',
		'연식',
		'년식',
		'년도',
		'등록',
		'배기량',
		'마력',
		'토크',
		// 차종/연료
		'suv',
		'세단',
		'해치백',
		'밴',
		'승합',
		'트럭',
		'픽업',
		'왜건',
		'쿠페',
		'컨버터블',
		'mpv',
		'미니밴',
		'디젤',
		'가솔린',
		'휘발유',
		'하이브리드',
		'hev',
		'mhev',
		'phev',
		'전기',
		'ev',
		'lpg',
		'cng',
		'수소',
		'fcev',
		// 구동/기능
		'awd',
		'사륜구동',
		'4wd',
		'후륜',
		'전륜',
		'차선유지',
		'어댑티브크루즈',
		'파노라마',
		'썬루프',
		// 모델/브랜드 힌트 일부
		'아반떼',
		'쏘나타',
		'그랜저',
		'스포티지',
		'쏘렌토',
		'투싼',
		'싼타페',
		'k3',
		'k5',
		'k7',
		'k8',
		'k9',
		'카니발',
		'g70',
		'g80',
		'g90',
		'gv70',
		'gv80',
		'bmw',
		'벤츠',
		'아우디',
		'폭스바겐',
		'렉서스',
		'토요타',
		'혼다',
	]

	// 2) 숫자/단위 힌트
	const hasMoney = /([0-9][0-9., ]*|[일이삼사오육칠팔구영공십백천만억]+)\s*(만원|억)/.test(sNoSpace)
	const hasMonthly = /월\s*[0-9]+|[0-9]+~[0-9]+\s*만/.test(s)
	const hasKm = /(km|키로|킬로|킬로미터)/i.test(s) || /[0-9]\s*만\s*(km|키로|킬로)/i.test(s)
	const hasYear = /((19|20)\d{2}|\b\d{2}\b)\s*(년|연|년식|연식)?/.test(s)
	const hasBodyFuel =
		/(suv|세단|해치백|밴|승합|트럭|픽업|왜건|쿠페|컨버터블|디젤|가솔린|휘발유|하이브리드|전기|ev|lpg|cng|수소)/i.test(
			s,
		)

	// 3) 스코어링
	const adviceScore = countMatches(sNoSpace, adviceLex)
	const searchScore =
		countMatches(sNoSpace, searchLex) +
		(hasMoney ? 2 : 0) +
		(hasMonthly ? 1 : 0) +
		(hasKm ? 1 : 0) +
		(hasYear ? 1 : 0) +
		(hasBodyFuel ? 1 : 0)

	// 4) 하드 룰: 전혀 차량 맥락이 없으면 clarify
	const looksVehicleLoose =
		/(차|차량|자동차|suv|세단|주행|연식|브랜드|모델|옵션|색상|연비|lpg|디젤|가솔린|하이브리드|전기|ev)/i.test(s) ||
		searchScore > 0 ||
		adviceScore > 0
	if (!looksVehicleLoose) return 'clarify'

	// 5) 판정
	const diff = adviceScore - searchScore
	if (diff >= 1) return 'advice'
	if (diff <= -1) return 'search'

	// 6) 타이브레이커
	// 추천/보여줘가 있고 숫자나 단위가 있으면 검색형, 그렇지 않으면 조언형에 가중
	if (/(추천|보여줘|찾아줘|검색)/.test(s)) {
		if (hasMoney || hasKm || hasYear || hasBodyFuel) return 'search'
		return 'advice'
	}

	// 양쪽 모두 애매하면 명시적 명사 위주면 search, 의견/비교/괜찮을까 톤이면 advice
	if (/\b(가격|연식|주행|리스트|옵션|트림)\b/.test(s)) return 'search'
	if (/(괜찮을까|어울리|장단점|고민|추천이유)/.test(s)) return 'advice'

	return 'clarify'

	function countMatches(str, dict) {
		let score = 0
		for (const w of dict) {
			if (!w) continue
			const re = new RegExp(escapeRegex(w), 'g')
			const hits = str.match(re)
			if (hits) score += Math.min(hits.length, 2) // 과도 가산 방지
		}
		return score
	}

	function escapeRegex(t) {
		return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	}
}
