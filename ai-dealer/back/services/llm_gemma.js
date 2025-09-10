export async function askJSONForChat(q) {
  const s = String(q || '').trim()

  // 기본 인사
  if (/^(안녕|안녕하세요|hi|hello|ㅎㅇ)$/i.test(s)) {
    return {
      normalized_query: s,
      direct_reply: '안녕하세요! 엠파크 AI 딜러입니다. 차량 추천을 도와드리겠습니다. 예산대(예: 2천만 원대)나 차종(SUV/세단)부터 알려주시면 추천을 준비하겠습니다.',
      filters: blankFilters()
    }
  }

  // 차량 관련 문맥 여부 판별 - 일시적으로 모든 입력 허용
  const looksVehicle = true // 임시로 모든 입력을 차량 관련으로 처리
  // const looksVehicle = /(차|차량|자동차|suv|세단|해치백|밴|승합|트럭|픽업|연비|예산|가격|만원|월\s*[0-9]+|할부|km|주행|연식|브랜드|모델|옵션|색상|lpg|디젤|가솔린|하이브리드|전기|ev|현대|기아|제네시스|BMW|벤츠|아우디|토요타|혼다|추천|찾아|보여|골라|선택|스포티지|투싼|싼타페|아반떼|쏘나타|그랜저|K3|K5|K7|K8|K9|레이|모닝|쏘렌토|카니발|니로|셀토스|펠리세이드)/i.test(s)
  if (!looksVehicle) {
    return {
      normalized_query: s,
      direct_reply: null,
      filters: { ...blankFilters(), notes: ['non_vehicle'] },
    }
  }

  // 1) 금액/월납입
  const { budgetMin, budgetMax } = parseLumpSumBudget(s)
  const { monthlyMin, monthlyMax } = parseMonthlyBudget(s)

  // 2) 주행거리
  const { kmMin, kmMax } = parseKm(s)

  // 3) 연식
  const { yearMin, yearMax } = parseYear(s)

  // 4) 연료/차종
  const fuelTypes = parseFuel(s)
  const bodyTypes = parseBodyType(s)

  // 5) 브랜드/모델명 단순 추출
  const brands = parseBrand(s)
  const models = parseModel(s)

  // 6) 색상/옵션
  const colors = parseColor(s)
  const options = parseOptions(s)

  // 7) 무사고/단거리
  const flags = parseFlags(s) // { noAccident: boolean|null, shortKm: boolean|null }

  // 파싱된 정보를 바탕으로 자연스러운 응답 생성
  const response = generateResponse({
    budgetMin, budgetMax, monthlyMin, monthlyMax,
    kmMin, kmMax, yearMin, yearMax,
    fuelTypes, bodyTypes, brands, models, colors, options,
    noAccident: flags.noAccident, shortKm: flags.shortKm
  })

  return {
    normalized_query: s,
    direct_reply: response,
    filters: {
      budget: { minKman: budgetMin, maxKman: budgetMax },
      monthly: { minKman: monthlyMin, maxKman: monthlyMax },
      km: { minKm: kmMin, maxKm: kmMax },
      years: { min: yearMin, max: yearMax },
      fuelTypes,
      bodyTypes,
      brands,
      models,
      colors,
      options,
      noAccident: flags.noAccident,
      shortKm: flags.shortKm,
      notes: []
    },
  }
}

function blankFilters() {
  return {
    budget: { minKman: null, maxKman: null },
    monthly: { minKman: null, maxKman: null },
    km: { minKm: null, maxKm: null },
    years: { min: null, max: null },
    fuelTypes: [],
    bodyTypes: [],
    brands: [],
    models: [],
    colors: [],
    options: [],
    noAccident: null,
    shortKm: null,
    notes: [],
  }
}

// 금액: 2,000만원대 / 2천만원 / 1800만원 이하 / 1500~2200만원
function parseLumpSumBudget(s) {
  let text = s.replace(/\s+/g, '') // 공백 제거
  text = text.replace(/마넌/g, '만원') // 구어체 보정

  const numMap = { 일:1, 이:2, 삼:3, 사:4, 오:5, 육:6, 칠:7, 팔:8, 구:9, 영:0, 공:0 }
  const unitMap = { 십:10, 백:100, 천:1000, 만:10000, 억:100000000 }

  function parseKoreanNumber(str) {
    let total = 0, num = 0, unit = 1
    for (let i = str.length - 1; i >= 0; i--) {
      const ch = str[i]
      if (unitMap[ch]) {
        if (num === 0) num = 1
        total += num * unitMap[ch]
        num = 0
      } else if (numMap[ch] !== undefined) {
        num = numMap[ch] + num * (num >= 10 ? 10 : 1)
      }
    }
    return total + num
  }

  function normalizeNumber(str) {
    if (!str) return null
    if (/^[0-9,]+$/.test(str)) return parseInt(str.replace(/,/g, ''), 10)
    return parseKoreanNumber(str)
  }

  let min = null, max = null

  // 범위: 1500~2200만원, 2천~3천만원, 1억~2억
  const between = text.match(/([0-9,일이삼사오육칠팔구영공십백천만억]+)~([0-9,일이삼사오육칠팔구영공십백천만억]+)(만원|억)?/)
  if (between) {
    min = normalizeNumber(between[1])
    max = normalizeNumber(between[2])
    if (between[3] && between[3].includes('억')) { min *= 10000; max *= 10000 }
  }

  // 대: 2천만원대, 2500만원대, 3억대
  const band = text.match(/([0-9,일이삼사오육칠팔구영공십백천만억]+)(만원대|억대)/)
  if (band) {
    let v = normalizeNumber(band[1])
    if (band[2].includes('억')) {
      min = v * 10000
      max = v * 10000 + 9999
    } else {
      min = v
      max = v + 999
    }
  }

  // 이하
  const le = text.match(/([0-9,일이삼사오육칠팔구영공십백천만억]+)(만원|억)?이하/)
  if (le) {
    max = normalizeNumber(le[1])
    if (le[2] && le[2].includes('억')) max *= 10000
  }

  // 이상
  const ge = text.match(/([0-9,일이삼사오육칠팔구영공십백천만억]+)(만원|억)?이상/)
  if (ge) {
    min = normalizeNumber(ge[1])
    if (ge[2] && ge[2].includes('억')) min *= 10000
  }

  // 단일 금액: 2000만원, 2천만원, 3억
  if (min === null && max === null) {
    const single = text.match(/([0-9,일이삼사오육칠팔구영공십백천만억]+)(만원|억)/)
    if (single) {
      max = normalizeNumber(single[1])
      if (single[2].includes('억')) max *= 10000
    }
  }

  return { budgetMin: min, budgetMax: max }
}


// 월납입: 월 25만원 / 월25만 / 20~30만
function parseMonthlyBudget(s) {
  let text = s.replace(/\s+/g, '') // 공백 제거
  text = text.replace(/마넌/g, '만원') // 구어체 보정

  // 한글 숫자 맵
  const numMap = { 일:1, 이:2, 삼:3, 사:4, 오:5, 육:6, 칠:7, 팔:8, 구:9, 영:0, 공:0 }
  const unitMap = { 십:10, 백:100, 천:1000, 만:10000, 억:100000000 }

  // 한글 숫자 파서
  function parseKoreanNumber(str) {
    let total = 0, num = 0, unit = 1
    for (let i = str.length - 1; i >= 0; i--) {
      const ch = str[i]
      if (unitMap[ch]) {
        if (num === 0) num = 1
        total += num * unitMap[ch]
        num = 0
      } else if (numMap[ch] !== undefined) {
        num = numMap[ch] + num * 10
      }
    }
    return total + num
  }

  // 숫자/콤마 추출 → 숫자로 변환
  function normalizeNumber(str) {
    if (!str) return null
    if (/^[0-9,]+$/.test(str)) {
      return parseInt(str.replace(/,/g, ''), 10)
    } else {
      return parseKoreanNumber(str)
    }
  }

  let min = null, max = null

  // 1) 범위 패턴: 월 50~70만, 월 이백~삼백만
  const band = text.match(/월?([0-9,일이삼사오육칠팔구영공십백천만억]+)~([0-9,일이삼사오육칠팔구영공십백천만억]+)만원?/)
  if (band) {
    min = normalizeNumber(band[1])
    max = normalizeNumber(band[2])
  }

  // 2) 단일 패턴: 월 30만, 월 이천오백만, 2532만원
  const single = text.match(/월?([0-9,일이삼사오육칠팔구영공십백천만억]+)만원?/)
  if (single) {
    max = normalizeNumber(single[1])
  }

  return { monthlyMin: min, monthlyMax: max }
}

// 주행: 8만km 이하 / 5만~9만km / 120000km 이상
function parseKm(s) {
  let min = null, max = null
  const src = String(s)

  // 5만~9만km, 5만 ~ 9만 키로
  const bandMan = src.match(/([0-9]{1,3})\s*만\s*~\s*([0-9]{1,3})\s*만\s*(?:k?m|키로|킬로|킬로미터)/i)
  if (bandMan) { min = toInt(bandMan[1]) * 10000; max = toInt(bandMan[2]) * 10000 }

  // 50000 ~ 90000km
  const bandKm = src.match(/([0-9]{1,6})\s*~\s*([0-9]{1,6})\s*(?:k?m|키로|킬로|킬로미터)/i)
  if (!bandMan && bandKm) { min = toInt(bandKm[1]); max = toInt(bandKm[2]) }

  // 이하: 8만km 이하, 300km 이하, 300키로 이하
  const leMan = src.match(/([0-9]{1,3})\s*만\s*(?:k?m|키로|킬로|킬로미터)?\s*이하/i)
  if (leMan) max = toInt(leMan[1]) * 10000
  const leKm = src.match(/([0-9]{1,6})\s*(?:k?m|키로|킬로|킬로미터)\s*이하/i)
  if (!leMan && leKm) max = toInt(leKm[1])

  // 이상: 5만km 이상, 300km 이상, 300키로 이상
  const geMan = src.match(/([0-9]{1,3})\s*만\s*(?:k?m|키로|킬로|킬로미터)?\s*이상/i)
  if (geMan) min = toInt(geMan[1]) * 10000
  const geKm = src.match(/([0-9]{1,6})\s*(?:k?m|키로|킬로|킬로미터)\s*이상/i)
  if (!geMan && geKm) min = toInt(geKm[1])

  return { kmMin: min, kmMax: max }
}

// 연식: 16~19년식 / 2016~2019 / 16년식 이상
function parseYear(input) {
  const s = normalize(input);

  // 결과
  let min = null, max = null;

  // 1) 범위 먼저 처리 (연속 텍스트/한글숫자/공백 유무/연식·연도/형 포함)
  // 예: 18~21년식 / 2018 ~ 2021 / '18~'21 / 십팔부터 이십일까지
  const rangePatterns = [
    // 4자리 연도 범위
    /(19|20)\d{2}\s*[\-~–—]\s*(19|20)\d{2}/g,
    // 2자리 범위 + 선택적 접미사(년|연|년도|연도|년식|연식|년형)
    /(?<!\d)(\d{2})\s*[\-~–—]\s*(\d{2})(?:\s*(?:년|연|년도|연도|년식|연식|년형))?/g,
    // 2자리 범위 양끝에 작은따옴표
    /[’'](\d{2})\s*[\-~–—]\s*[’'](\d{2})(?:\s*(?:년|연|년도|연도|년식|연식|년형))?/g,
    // 한글 숫자 범위 (십팔~이십일, 십구-이십)
    /([일이삼사오육칠팔구]?(십)[일이삼사오육칠팔구]?|[일이삼사오육칠팔구])\s*[\-~–—]\s*([일이삼사오육칠팔구]?(십)[일이삼사오육칠팔구]?|[일이삼사오육칠팔구])(?:\s*(?:년|연|년도|연도|년식|연식|년형))?/g,
    // "부터 ~ 까지" 형태 (숫자/한글/2자리/4자리 혼합)
    /(19|20)?\d{2}|[’']\d{2}|[일이삼사오육칠팔구]?(십)[일이삼사오육칠팔구]?/g // 토큰 추출에 사용
  ];

  // 1-a) 틸드/대시 형태 범위 매칭 처리
  let m;
  // 4자리
  while ((m = rangePatterns[0].exec(s))) {
    const y1 = toInt(m[0].match(/(19|20)\d{2}/g)[0]);
    const y2 = toInt(m[0].match(/(19|20)\d{2}/g)[1]);
    min = Math.min(y1, y2); max = Math.max(y1, y2);
  }
  // 2자리 숫자 범위
  while ((m = rangePatterns[1].exec(s))) {
    const y1 = toYear(m[1]);
    const y2 = toYear(m[2]);
    min = Math.min(y1, y2); max = Math.max(y1, y2);
  }
  // 'YY ~ 'YY
  while ((m = rangePatterns[2].exec(s))) {
    const y1 = toYear(m[1]);
    const y2 = toYear(m[2]);
    min = Math.min(y1, y2); max = Math.max(y1, y2);
  }
  // 한글 숫자 범위
  while ((m = rangePatterns[3].exec(s))) {
    const y1 = toYear(koNumTo2Digit(m[1]));
    const y2 = toYear(koNumTo2Digit(m[3]));
    min = Math.min(y1, y2); max = Math.max(y1, y2);
  }

  // 1-b) "부터/이상/이후/이하/까지" 형태 처리 (우선순위: 명시적 연산자 > 단일)
  // >=
  const ge = findYearWithOperator(s, /(부터|이상|이후)/, /*preferMin*/ true);
  if (ge != null) min = (min == null) ? ge : Math.min(min, ge);

  // <=
  const le = findYearWithOperator(s, /(이하|이전|까지)/, /*preferMin*/ false);
  if (le != null) max = (max == null) ? le : Math.max(max, le);

  // 2) 명시적 단일 연도 표기 처리 (앞에서 범위가 이미 정해졌다면 보완만 함)
  // 4자리: 1990~2029까지 인식
  const single4 = s.match(/\b(19|20)\d{2}\b\s*(?:년|연|년도|연도|년식|연식|년형)?/);
  if (single4 && min == null && max == null) {
    const y = toInt(single4[0].match(/(19|20)\d{2}/)[0]);
    min = y; max = null;
  }

  // 2자리: 00~99
  const single2 = s.match(/(?:[’']?)(\d{2})(?:\s*(?:년|연|년도|연도|년식|연식|년형))?/);
  if (single2 && min == null && max == null) {
    min = toYear(single2[1]); max = null;
  }

  // 한글 숫자 단일: 십사연도, 십오년도, 이십일년식, 구연도 등
  const singleKo = s.match(/([일이삼사오육칠팔구]?(십)[일이삼사오육칠팔구]?|[일이삼사오육칠팔구])\s*(?:년|연|년도|연도|년식|연식|년형)/);
  if (singleKo && min == null && max == null) {
    min = toYear(koNumTo2Digit(singleKo[1])); max = null;
  }

  return { yearMin: min, yearMax: max };

  // ===== Helpers =====

  function normalize(t) {
    // 소문자화 + 특수 공백 정리
    let x = String(t).replace(/\s+/g, ' ').trim();

    // 한글 표기 통일: 년/연 + 도/식/형 변형 모두 유지하되 검색을 위해 공백 제거 버전 병행
    // 여기서는 원문 보존하되, 비교는 공백 무시형도 함께 쓰도록 정규식이 설계됨.

    // 유니코드 작은따옴표 통일
    x = x.replace(/[‘’]/g, "'");

    // 자주 쓰는 연결어 표준화
    x = x
      .replace(/까지\s*$/g, '까지')
      .replace(/부터\s*$/g, '부터')
      .replace(/\s*~\s*/g, '~')
      .replace(/\s*-\s*/g, '-');

    return x;
  }

  function toInt(v) {
    return parseInt(String(v), 10);
  }

  // 2자리 → 연도: 00~29 => 2000~2029, 30~99 => 1930~1999 (필요에 따라 조정 가능)
  function toYear(yy) {
    const n = toInt(yy);
    if (n <= 29) return 2000 + n;
    return 1900 + n;
  }

  // 한글 숫자(최대 99) → 2자리 문자열
  // 십 = 10, 이십 = 20, 이십일 = 21, 십사 = 14, 구 = 9
  function koNumTo2Digit(word) {
    const unit = { 일:1, 이:2, 삼:3, 사:4, 오:5, 육:6, 칠:7, 팔:8, 구:9 };
    const hasSip = /십/.test(word);
    let val = 0;
    if (hasSip) {
      // [X]십[Y]
      // X 없으면 1십
      const m = word.match(/([일이삼사오육칠팔구])?십([일이삼사오육칠팔구])?/);
      const tens = m && m[1] ? unit[m[1]] : 1;
      const ones = m && m[2] ? unit[m[2]] : 0;
      val = tens * 10 + ones;
    } else {
      // 한 자리
      const m = word.match(/([일이삼사오육칠팔구])/);
      val = m ? unit[m[1]] : NaN;
    }
    if (!Number.isFinite(val)) return '00';
    // 00~99 범위 보정
    if (val < 0) val = 0;
    if (val > 99) val = 99;
    return String(val).padStart(2, '0');
  }

  // "이상/이후/부터" 또는 "이하/이전/까지" 같은 연산자 주변에서 연도 추출
  function findYearWithOperator(text, opRegex, preferMin) {
    const re = new RegExp(
      // 왼쪽에 연도, 오른쪽에 연산자 또는 그 반대 케이스 모두 탐색
      [
        // 왼쪽 연도 + 공백? + 연산자
        `((?:\\b(19|20)\\d{2}\\b)|(?:[’']\\d{2})|(?:\\b\\d{2}\\b)|(?:[일이삼사오육칠팔구]?십[일이삼사오육칠팔구]?|[일이삼사오육칠팔구]))\\s*(?:년|연|년도|연도|년식|연식|년형)?\\s*${opRegex.source}`,
        // 연산자 + 공백? + 오른쪽 연도
        `${opRegex.source}\\s*((?:\\b(19|20)\\d{2}\\b)|(?:[’']\\d{2})|(?:\\b\\d{2}\\b)|(?:[일이삼사오육칠팔구]?십[일이삼사오육칠팔구]?|[일이삼사오육칠팔구]))\\s*(?:년|연|년도|연도|년식|연식|년형)?`
      ].join('|'),
      'g'
    );

    let match, yearCandidate = null;
    while ((match = re.exec(text))) {
      let token = match[1] || match[3]; // 왼쪽 또는 오른쪽 토큰
      if (!token) continue;

      let y;
      if (/(19|20)\d{2}/.test(token)) {
        y = toInt(token.match(/(19|20)\d{2}/)[0]);
      } else if (/^[’']\d{2}$/.test(token)) {
        y = toYear(token.slice(1));
      } else if (/^\d{2}$/.test(token)) {
        y = toYear(token);
      } else {
        // 한글 숫자
        y = toYear(koNumTo2Digit(token));
      }

      // 여러 개가 잡히면 min 요청이면 가장 작은 쪽, max 요청이면 가장 큰 쪽으로 업데이트
      if (yearCandidate == null) {
        yearCandidate = y;
      } else {
        yearCandidate = preferMin ? Math.min(yearCandidate, y) : Math.max(yearCandidate, y);
      }
    }
    return yearCandidate;
  }
}


function parseFuel(s) {
  const fuels = []

  // 디젤
  if (/(디젤|diesel)/i.test(s)) fuels.push('diesel')

  // 가솔린
  if (/(가솔린|휘발유|gasoline|petrol)/i.test(s)) fuels.push('gasoline')

  // LPG
  if (/(lpg|엘피지|lp가스)/i.test(s)) fuels.push('lpg')

  // CNG/천연가스
  if (/(cng|천연가스|compressed natural gas)/i.test(s)) fuels.push('cng')

  // 하이브리드 (통합)
  if (/(하이브리드|hybrid)/i.test(s)) fuels.push('hybrid')

  // 마일드 하이브리드
  if (/(마일드\s?하이브리드|mhev|mild hybrid)/i.test(s)) fuels.push('mild-hybrid')

  // 풀 하이브리드
  if (/(풀\s?하이브리드|hev|full hybrid)/i.test(s)) fuels.push('full-hybrid')

  // 플러그인 하이브리드
  if (/(플러그인|phev|plug[-\s]?in hybrid)/i.test(s)) fuels.push('plug-in-hybrid')

  // 전기차
  if (/(전기|ev|battery electric|bev)/i.test(s)) fuels.push('ev')

  // 수소/연료전지
  if (/(수소|연료전지|fcev|fuel cell)/i.test(s)) fuels.push('hydrogen')

  // 바이퓨얼 (예: 가솔린+LPG, 가솔린+CNG)
  if (/(바이퓨얼|bi[-\s]?fuel|dual fuel|가솔린\+lpg|가솔린\+cng)/i.test(s)) fuels.push('bi-fuel')

  // 플렉스 연료 (에탄올 혼합 가능)
  if (/(플렉스|flex fuel|ffv|에탄올|ethanol|e85)/i.test(s)) fuels.push('flex-fuel')

  // 디젤 마일드 하이브리드 (별도 태깅)
  if (/(디젤\+마일드|디젤 mhev)/i.test(s)) fuels.push('diesel-mild-hybrid')

  // 가솔린 마일드 하이브리드
  if (/(가솔린\+마일드|가솔린 mhev)/i.test(s)) fuels.push('gasoline-mild-hybrid')

  return fuels
}


function parseBodyType(s) {
  const a = []
  // SUV 계열
  if (/(suv|에스유브이|스포츠유틸|스포츠 유틸리티|크로스오버|cuv|크로스 오버|crossover)/i.test(s)) a.push('suv')

  // 세단 계열
  if (/(세단|sedan|saloon)/i.test(s)) a.push('sedan')

  // 해치백
  if (/(해치백|해치|hatchback|hatch)/i.test(s)) a.push('hatch')

  // 쿠페
  if (/(쿠페|coupe)/i.test(s)) a.push('coupe')

  // 왜건
  if (/(왜건|wagon|estate|shooting brake|브레이크)/i.test(s)) a.push('wagon')

  // 컨버터블/로드스터/카브리올레
  if (/(컨버터블|convertible|카브리올레|cabriolet|로드스터|roadster|스파이더|spyder)/i.test(s)) a.push('convertible')

  // 밴/미니밴/MPV
  if (/(밴|승합|mpv|미니밴|minivan|멀티퍼포즈|multi[-\s]?purpose)/i.test(s)) a.push('van')

  // 트럭/픽업
  if (/(트럭|픽업|pickup|ute|픽업트럭)/i.test(s)) a.push('truck')

  // 리무진
  if (/(리무진|limousine|limo)/i.test(s)) a.push('limousine')

  // 스포츠카 (쿠페와 중복되기도 함)
  if (/(스포츠카|sportscar|supercar|hypercar)/i.test(s)) a.push('sport')

  // 컴팩트/소형차
  if (/(컴팩트|compact|소형차|준중형|subcompact|b세그먼트|c세그먼트)/i.test(s)) a.push('compact')

  // 세그먼트별 (D세그먼트, E세그먼트 등)
  if (/(중형차|mid[-\s]?size|d세그먼트)/i.test(s)) a.push('midsize')
  if (/(대형차|full[-\s]?size|e세그먼트|f세그먼트|flagship)/i.test(s)) a.push('fullsize')

  // 카브리오 SUV 같은 변형
  if (/(오픈탑|컨버터블 suv|오픈형)/i.test(s)) a.push('open-top')

  // 경차/케이카
  if (/(경차|kei car|케이카)/i.test(s)) a.push('kei')

  // 상용차
  if (/(상용|commercial|버스|화물)/i.test(s)) a.push('commercial')

  return a
}


// 모델·브랜드 매칭은 공백/대소문자 차이를 흡수해 탐지
function parseBrand(s) {
  const dict = [
    // 국산
    '현대','기아','제네시스','르노','르노코리아','삼성','쌍용','쉐보레','대우',
    // 독일
    '벤츠','메르세데스','BMW','아우디','폭스바겐','폴크스바겐','포르쉐',
    // 일본
    '렉서스','토요타','혼다','닛산','인피니티','아큐라','마쓰다','마즈다','스바루',
    // 미국
    '포드','링컨','캐딜락','지프','크라이슬러','테슬라',
    // 유럽
    '볼보','푸조','시트로엥','알피느','피아트','알파로메오','마세라티','페라리','람보르기니',
    // 영국
    '재규어','랜드로버','미니','롤스로이스','벤틀리'
  ]
  return dict.filter(k => {
    // 단어 경계를 사용한 정확한 매칭
    const regex = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    return regex.test(s)
  })
}

function parseModel(s) {
  const dict = [
    // 현대
    '포니','엑셀','스쿠프','베르나','아반떼','i30','i40','쏘나타','그랜저','아슬란','에쿠스','제네시스',
    '코나','베뉴','아이오닉','아이오닉5','아이오닉6','투싼','싼타페','베라크루즈','펠리세이드',
    '스타렉스','스타리아','포터','마이티',
    // 기아
    '프라이드','세피아','슈마','스펙트라','리오','포르테',
    'K3','K5','K7','K8','K9','로체','스팅어','쏘울','레이','모닝','니로','셀토스','스토닉',
    '스포티지','쏘렌토','카니발','카렌스','모하비','레토나','봉고',
    // 제네시스
    'EQ900','G70','G80','G90','GV60','GV70','GV80','GV90',
    // 르노/삼성
    'SM3','SM5','SM7','SM6','QM3','QM5','QM6','XM3','클리오',
    // 쌍용
    '무쏘','액티언','카이런','티볼리','코란도','렉스턴','체어맨',
    // 쉐보레/대우
    '마티즈','스파크','칼로스','젠트라','라세티','라세티 프리미어','크루즈','라노스','레간자','토스카',
    '아베오','말리부','임팔라','올란도','트랙스','트레일블레이저','캡티바','윈스톰','콜로라도','타호','서버밴',
    // 독일
    'A클래스','C클래스','E클래스','S클래스','GLA','GLC','GLE','GLS','G클래스',
    '1시리즈','3시리즈','5시리즈','7시리즈','X1','X3','X5','X7','i3','i4','iX',
    'A3','A4','A6','A8','Q3','Q5','Q7','Q8','e-tron',
    '골프','폴로','파사트','제타','티구안','투아렉','ID.4',
    // 일본
    '프리우스','캠리','코롤라','RAV4','하이랜더','시빅','어코드','CR-V','HR-V','알티마','맥시마','리프',
    'ES','GS','LS','RX','NX','UX',
    'CX-3','CX-5','CX-9','MX-5','임프레자','레거시','아웃백','포레스터',
    // 미국
    '포커스','몬데오','퓨전','머스탱','익스플로러','F-150','브롱코',
    'MKZ','노틸러스','네비게이터','레니게이드','체로키','그랜드체로키','랭글러',
    'CTS','ATS','CT5','CT6','에스컬레이드','모델3','모델S','모델X','모델Y',
    // 유럽
    'S60','S90','V60','V90','XC40','XC60','XC90',
    '208','308','508','2008','3008','5008','C3','C4','C5','DS3','DS7',
    '500','줄리아','스텔비오','기블리','르반떼','포르토피노','488','812','우라칸','우루스',
    // 영국
    'XE','XF','XJ','F-Pace','E-Pace','레인지로버','디스커버리','디펜더','쿠퍼','클럽맨','컨트리맨','팬텀','고스트','벤테이가'
  ]
  return dict.filter(k => {
    // 단어 경계를 사용한 정확한 매칭
    const regex = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    return regex.test(s)
  })
}



function parseColor(s) {
  const dict = [
    // 기본
    '검정','블랙','흰','화이트','은색','실버','회색','그레이',
    '빨강','레드','파랑','블루','남색','네이비','군청',
    '초록','그린','녹색','올리브','카키',
    '노랑','옐로우','골드','금색','베이지','아이보리',
    '갈색','브라운','코코아','카푸치노',
    '보라','퍼플','바이올렛','라벤더',
    '분홍','핑크','로즈','마젠타',

    // 특수 계열
    '버건디','와인','와인레드','체리','다크레드',
    '하늘','스카이','아쿠아','민트','터키석','에메랄드',
    '라임','라임그린','머스타드','샌드','샌드골드',
    '브론즈','코퍼','동색',
    '차콜','슬레이트','다크그레이',
    '진주','펄화이트','펄블랙','펄그레이',
    '메탈릭','메탈릭실버','메탈릭블루','메탈릭그레이',
    '매트블랙','무광블랙','무광그레이',

    // 국산차에서 흔히 쓰이는 명칭
    '쥐색','진주색','연금색','진회색','연회색',
    '연두','형광','형광녹색','형광옐로우',
    '진청','연청','청색','남보라',
    '아이보리화이트','크림','샴페인','샴페인골드',

    // 수입차 마케팅 네이밍 (자주 등장)
    '알파인화이트','미네랄화이트','스톤그레이',
    '미드나잇블루','딥블루','샤인블루',
    '로즈골드','선셋오렌지','코발트블루',
    '제트블랙','오닉스블랙','다이아몬드블랙',
    '실리콘실버','티타늄실버',
    '아마존그린','브리티시레이싱그린'
  ]

  return dict.filter(k => s.toLowerCase().includes(k.toLowerCase()))
}

function parseOptions(s) {
  const dict = [
    // 편의
    '후방카메라','360도카메라','어라운드뷰','블랙박스','하이패스','내비','네비','HUD','무선충전','스마트키',
    '전동트렁크','전동도어','전동시트','메모리시트','열선시트','통풍시트','안마시트','리클라이닝시트',
    '핸들열선','스티어링휠열선','스마트폰연동','애플카플레이','안드로이드오토','블루투스','USB포트',
    '리모컨시동','원격시동','자동주차','전동사이드미러','폴딩미러','룸미러ECM','크레스트라','BOSE','JBL',

    // 외관
    '썬루프','파노라마썬루프','루프랙','알로이휠','크롬휠','LED헤드램프','HID헤드램프','프로젝션램프',
    '데이라이트','안개등','자동와이퍼','레인센서','다이내믹턴시그널','스포일러',

    // 안전
    '차선이탈','차선유지','차선이탈경고','차선유지보조','전방추돌','후측방경고','후측방충돌방지',
    '사각지대감지','어댑티브크루즈','ACC','자동긴급제동','AEB','ABS','ESC','EBD','TCS','차체자세제어',
    '도로표지인식','운전자모니터링','에어백','사이드에어백','커튼에어백','무릎에어백','ISOFIX',

    // 주행/성능
    '크루즈컨트롤','어댑티브크루즈컨트롤','드라이브모드','스포츠모드','에코모드','전자식기어','패들쉬프트',
    '사륜구동','AWD','전자식서스펜션','에어서스펜션','토우패키지','런플랫타이어',

    // 기타 인포테인먼트
    '내비게이션','음성인식','음성명령','하만카돈','렉시콘','마크레빈슨','프리미엄오디오','뒷좌석모니터',
    'DMB','TV튜너','USB단자','AUX단자','CD플레이어',

    // 편의 세부
    '오토홀드','전자파킹','EPB','스마트크루즈','차간거리유지','헤드업디스플레이','무선키','카드키',
    '키레스고','스타트버튼','파워도어록','원터치다운','원터치업',

    // 고급 사양
    '가죽시트','나파가죽시트','스웨이드시트','우드그레인','앰비언트라이트','무드등','프리미엄패키지',
    '뒷좌석열선','뒷좌석통풍','VIP시트','캡틴시트'
  ]
  return dict.filter(k => s.toLowerCase().includes(k.toLowerCase()))
}

function parseFlags(s) {
  const noAcc =
    /(무사고|사고\s*없음|사고이력\s*없음)/i.test(s)
      ? true
      : /(유사고|사고차|사고\s*있음)/i.test(s)
      ? false
      : null

  const shortK =
    /(짧은\s*주행|단거리|주행\s*적음|주행거리\s*짧)/i.test(s)
      ? true
      : null

  return { noAccident: noAcc, shortKm: shortK }
}

function toInt(x) {
  const n = parseInt(String(x).replace(/[, ]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}
function toYear(twoOrFour) {
  const v = toInt(twoOrFour)
  if (!v) return null
  if (v >= 2000) return v
  return 2000 + v
}

// 파싱된 정보를 바탕으로 자연스러운 응답 생성
function generateResponse(parsed) {
  const {
    budgetMin, budgetMax, monthlyMin, monthlyMax,
    kmMin, kmMax, yearMin, yearMax,
    fuelTypes, bodyTypes, brands, models, colors, options,
    noAccident, shortKm
  } = parsed

  const conditions = []
  
  // 예산 정보
  if (budgetMin || budgetMax) {
    if (budgetMin && budgetMax) {
      conditions.push(`${budgetMin}만원~${budgetMax}만원`)
    } else if (budgetMax) {
      conditions.push(`${budgetMax}만원 이하`)
    } else if (budgetMin) {
      conditions.push(`${budgetMin}만원 이상`)
    }
  }
  
  // 월납입 정보
  if (monthlyMin || monthlyMax) {
    if (monthlyMin && monthlyMax) {
      conditions.push(`월 ${monthlyMin}만원~${monthlyMax}만원`)
    } else if (monthlyMax) {
      conditions.push(`월 ${monthlyMax}만원 이하`)
    } else if (monthlyMin) {
      conditions.push(`월 ${monthlyMin}만원 이상`)
    }
  }
  
  // 주행거리 정보
  if (kmMin || kmMax) {
    if (kmMin && kmMax) {
      conditions.push(`${Math.floor(kmMin/10000)}만~${Math.floor(kmMax/10000)}만km`)
    } else if (kmMax) {
      conditions.push(`${Math.floor(kmMax/10000)}만km 이하`)
    } else if (kmMin) {
      conditions.push(`${Math.floor(kmMin/10000)}만km 이상`)
    }
  }
  
  // 연식 정보
  if (yearMin || yearMax) {
    if (yearMin && yearMax) {
      conditions.push(`${yearMin}~${yearMax}년식`)
    } else if (yearMax) {
      conditions.push(`${yearMax}년식 이하`)
    } else if (yearMin) {
      conditions.push(`${yearMin}년식 이상`)
    }
  }
  
  // 차종 정보
  if (bodyTypes.length > 0) {
    const typeNames = bodyTypes.map(t => {
      const names = { suv: 'SUV', sedan: '세단', hatch: '해치백', van: '밴/승합', truck: '트럭' }
      return names[t] || t
    })
    conditions.push(typeNames.join(', '))
  }
  
  // 연료 정보
  if (fuelTypes.length > 0) {
    const fuelNames = fuelTypes.map(f => {
      const names = { diesel: '디젤', gasoline: '가솔린', hybrid: '하이브리드', ev: '전기', lpg: 'LPG' }
      return names[f] || f
    })
    conditions.push(fuelNames.join(', '))
  }
  
  // 브랜드 정보
  if (brands.length > 0) {
    conditions.push(brands.join(', '))
  }
  
  // 모델 정보
  if (models.length > 0) {
    conditions.push(models.join(', '))
  }
  
  // 색상 정보
  if (colors.length > 0) {
    conditions.push(colors.join(', '))
  }
  
  // 옵션 정보
  if (options.length > 0) {
    conditions.push(options.join(', '))
  }
  
  // 특별 조건
  if (noAccident === true) {
    conditions.push('무사고')
  }
  if (shortKm === true) {
    conditions.push('단거리')
  }
  
  if (conditions.length === 0) {
    return '조건을 더 구체적으로 알려주시면 더 정확한 추천을 드릴 수 있습니다. 예산대나 차종을 알려주세요.'
  }
  
  const conditionText = conditions.join(', ')
  
  // 모델명만 있는 경우 특별한 안내
  if (conditions.length === 1 && models.length > 0 && !budgetMin && !budgetMax && !monthlyMin && !monthlyMax && !bodyTypes.length && !fuelTypes.length) {
    return `좋습니다! ${conditionText}를 찾아보겠습니다. 더 구체적인 조건(예산, 차종, 연식 등)을 추가로 알려주시면 더 정확한 추천을 드릴 수 있습니다. "추천 실행" 버튼을 눌러 현재 조건으로 검색해 보세요.`
  }
  
  return `조건을 확인했습니다: ${conditionText}. 추가로 원하시는 조건이 있으시면 말씀해 주세요. "추천 실행" 버튼을 눌러 결과를 확인해 보세요.`
}