// vehicle_nlp.js
// Brand/model/body/fuel/year/budget/km/color/option parsing and response generation for AI dealer

export async function askJSONForChat(q) {
  const s = String(q || '').trim();

  // Basic greetings
  if (/^(안녕|안녕하세요|hi|hello|ㅎㅇ)$/i.test(s)) {
    return {
      normalized_query: s,
      direct_reply:
        '안녕하세요! 엠파크 AI 딜러입니다. 차량 추천을 도와드리겠습니다. 예산대(예: 2천만 원대)나 차종(SUV/세단)부터 알려주시면 추천을 준비하겠습니다.',
      filters: blankFilters(),
    };
  }

  // Determine whether the query is vehicle-related
  const looksVehicle = looksLikeVehicleQuery(s);
  if (!looksVehicle) {
    return {
      normalized_query: s,
      direct_reply: null,
      filters: { ...blankFilters(), notes: ['non_vehicle'] },
    };
  }

  // 1) Lump-sum budget
  const { budgetMin, budgetMax } = parseLumpSumBudget(s);
  // 2) Monthly budget
  const { monthlyMin, monthlyMax } = parseMonthlyBudget(s);
  // 3) Mileage
  const { kmMin, kmMax } = parseKm(s);
  // 4) Year range
  const { yearMin, yearMax } = parseYear(s);
  // 5) Fuel and body type
  const fuelTypes = parseFuel(s);
  const bodyTypes = parseBodyType(s);
  // 6) Brand and model
  const brands = parseBrand(s);
  const models = parseModel(s);
  // 7) Colors and options
  const colors = parseColor(s);
  const options = parseOptions(s);
  // 8) Flags
  const flags = parseFlags(s); // { noAccident: boolean|null, shortKm: boolean|null }

  const response = generateResponse({
    budgetMin,
    budgetMax,
    monthlyMin,
    monthlyMax,
    kmMin,
    kmMax,
    yearMin,
    yearMax,
    fuelTypes,
    bodyTypes,
    brands,
    models,
    colors,
    options,
    noAccident: flags.noAccident,
    shortKm: flags.shortKm,
  });

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
      notes: [],
    },
  };
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
  };
}

/* =========================
   Budget (lump-sum, KRW)
   ========================= */
// Examples: 2,000만원대 / 2천만원 / 1800만원 이하 / 1500~2200만원 / 3억대 / 1억~2억
function parseLumpSumBudget(s) {
  let text = s.replace(/\s+/g, ''); // remove spaces
  text = text.replace(/마넌/g, '만원'); // colloquial fix

  const numMap = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9, 영: 0, 공: 0 };
  const unitMap = { 십: 10, 백: 100, 천: 1000, 만: 10000, 억: 100000000 };

  function parseKoreanNumber(str) {
    let total = 0,
      num = 0;
    for (let i = str.length - 1; i >= 0; i--) {
      const ch = str[i];
      if (unitMap[ch]) {
        if (num === 0) num = 1;
        total += num * unitMap[ch];
        num = 0;
      } else if (numMap[ch] !== undefined) {
        num = numMap[ch] + num * (num >= 10 ? 10 : 1);
      }
    }
    return total + num;
  }

  function normalizeNumber(str) {
    if (!str) return null;
    if (/^[0-9,]+$/.test(str)) return parseInt(str.replace(/,/g, ''), 10);
    return parseKoreanNumber(str);
  }

  let min = null,
    max = null;

  // Range: 1500~2200만원, 2천~3천만원, 1억~2억
  const between = text.match(
    /([0-9,일이삼사오육칠팔구영공십백천만억]+)~([0-9,일이삼사오육칠팔구영공십백천만억]+)(만원|억)?/
  );
  if (between) {
    min = normalizeNumber(between[1]);
    max = normalizeNumber(between[2]);
    if (between[3] && between[3].includes('억')) {
      min *= 10000;
      max *= 10000;
    }
  }

  // Band: 2천만원대, 2500만원대, 3억대
  const band = text.match(/([0-9,일이삼사오육칠팔구영공십백천만억]+)(만원대|억대)/);
  if (band) {
    let v = normalizeNumber(band[1]);
    if (band[2].includes('억')) {
      min = v * 10000;
      max = v * 10000 + 9999;
    } else {
      min = v;
      max = v + 999;
    }
  }

  // Less-than-or-equal
  const le = text.match(/([0-9,일이삼사오육칠팔구영공십백천만억]+)(만원|억)?이하/);
  if (le) {
    max = normalizeNumber(le[1]);
    if (le[2] && le[2].includes('억')) max *= 10000;
  }

  // Greater-than-or-equal
  const ge = text.match(/([0-9,일이삼사오육칠팔구영공십백천만억]+)(만원|억)?이상/);
  if (ge) {
    min = normalizeNumber(ge[1]);
    if (ge[2] && ge[2].includes('억')) min *= 10000;
  }

  // Single: 2000만원, 2천만원, 3억
  if (min === null && max === null) {
    const single = text.match(/([0-9,일이삼사오육칠팔구영공십백천만억]+)(만원|억)/);
    if (single) {
      max = normalizeNumber(single[1]);
      if (single[2].includes('억')) max *= 10000;
    }
  }

  return { budgetMin: min, budgetMax: max };
}

/* =========================
   Monthly payment (만원)
   ========================= */
// Examples: 월 25만원 / 월25만 / 20~30만 / 월 이백만
function parseMonthlyBudget(s) {
  let text = s.replace(/\s+/g, '');
  text = text.replace(/마넌/g, '만원');

  const numMap = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9, 영: 0, 공: 0 };
  const unitMap = { 십: 10, 백: 100, 천: 1000, 만: 10000, 억: 100000000 };

  function parseKoreanNumber(str) {
    let total = 0,
      num = 0;
    for (let i = str.length - 1; i >= 0; i--) {
      const ch = str[i];
      if (unitMap[ch]) {
        if (num === 0) num = 1;
        total += num * unitMap[ch];
        num = 0;
      } else if (numMap[ch] !== undefined) {
        num = numMap[ch] + num * 10;
      }
    }
    return total + num;
  }

  function normalizeNumber(str) {
    if (!str) return null;
    if (/^[0-9,]+$/.test(str)) {
      return parseInt(str.replace(/,/g, ''), 10);
    } else {
      return parseKoreanNumber(str);
    }
  }

  let min = null,
    max = null;

  // Range: 월 50~70만
  const band = text.match(/월?([0-9,일이삼사오육칠팔구영공십백천만억]+)~([0-9,일이삼사오육칠팔구영공십백천만억]+)만원?/);
  if (band) {
    min = normalizeNumber(band[1]);
    max = normalizeNumber(band[2]);
  }

  // Single: 월 30만, 2532만원
  const single = text.match(/월?([0-9,일이삼사오육칠팔구영공십백천만억]+)만원?/);
  if (single) {
    max = normalizeNumber(single[1]);
  }

  return { monthlyMin: min, monthlyMax: max };
}

/* =========================
   Mileage (km)
   ========================= */
// Examples: 8만km 이하 / 5만~9만km / 120000km 이상
function parseKm(s) {
  let min = null,
    max = null;
  const src = String(s);

  // 5만~9만km
  const bandMan = src.match(/([0-9]{1,3})\s*만\s*~\s*([0-9]{1,3})\s*만\s*(?:k?m|키로|킬로|킬로미터)/i);
  if (bandMan) {
    min = toInt(bandMan[1]) * 10000;
    max = toInt(bandMan[2]) * 10000;
  }

  // 50000 ~ 90000km
  const bandKm = src.match(/([0-9]{1,6})\s*~\s*([0-9]{1,6})\s*(?:k?m|키로|킬로|킬로미터)/i);
  if (!bandMan && bandKm) {
    min = toInt(bandKm[1]);
    max = toInt(bandKm[2]);
  }

  // 이하
  const leMan = src.match(/([0-9]{1,3})\s*만\s*(?:k?m|키로|킬로|킬로미터)?\s*이하/i);
  if (leMan) max = toInt(leMan[1]) * 10000;
  const leKm = src.match(/([0-9]{1,6})\s*(?:k?m|키로|킬로|킬로미터)\s*이하/i);
  if (!leMan && leKm) max = toInt(leKm[1]);

  // 이상
  const geMan = src.match(/([0-9]{1,3})\s*만\s*(?:k?m|키로|킬로|킬로미터)?\s*이상/i);
  if (geMan) min = toInt(geMan[1]) * 10000;
  const geKm = src.match(/([0-9]{1,6})\s*(?:k?m|키로|킬로|킬로미터)\s*이상/i);
  if (!geMan && geKm) min = toInt(geKm[1]);

  return { kmMin: min, kmMax: max };
}

/* =========================
   Year range
   ========================= */
// Examples: 16~19년식 / 2016~2019 / 16년식 이상
function parseYear(input) {
  const s = normalizeForYear(input);

  let min = null,
    max = null;

  const rangePatterns = [
    /(19|20)\d{2}\s*[\-~–—]\s*(19|20)\d{2}/g,
    /(?<!\d)(\d{2})\s*[\-~–—]\s*(\d{2})(?:\s*(?:년|연|년도|연도|년식|연식|년형))?/g,
    /[’'](\d{2})\s*[\-~–—]\s*[’'](\d{2})(?:\s*(?:년|연|년도|연도|년식|연식|년형))?/g,
    /([일이삼사오육칠팔구]?(십)[일이삼사오육칠팔구]?|[일이삼사오육칠팔구])\s*[\-~–—]\s*([일이삼사오육칠팔구]?(십)[일이삼사오육칠팔구]?|[일이삼사오육칠팔구])(?:\s*(?:년|연|년도|연도|년식|연식|년형))?/g,
  ];

  let m;
  while ((m = rangePatterns[0].exec(s))) {
    const y = m[0].match(/(19|20)\d{2}/g);
    const y1 = toInt(y[0]);
    const y2 = toInt(y[1]);
    min = Math.min(y1, y2);
    max = Math.max(y1, y2);
  }
  while ((m = rangePatterns[1].exec(s))) {
    const y1 = toYear2(m[1]);
    const y2 = toYear2(m[2]);
    min = Math.min(y1, y2);
    max = Math.max(y1, y2);
  }
  while ((m = rangePatterns[2].exec(s))) {
    const y1 = toYear2(m[1]);
    const y2 = toYear2(m[2]);
    min = Math.min(y1, y2);
    max = Math.max(y1, y2);
  }
  while ((m = rangePatterns[3].exec(s))) {
    const y1 = toYear2(koNumTo2Digit(m[1]));
    const y2 = toYear2(koNumTo2Digit(m[3]));
    min = Math.min(y1, y2);
    max = Math.max(y1, y2);
  }

  const ge = findYearWithOperator(s, /(부터|이상|이후)/, true);
  if (ge != null) min = min == null ? ge : Math.min(min, ge);

  const le = findYearWithOperator(s, /(이하|이전|까지)/, false);
  if (le != null) max = max == null ? le : Math.max(max, le);

  const single4 = s.match(/\b(19|20)\d{2}\b\s*(?:년|연|년도|연도|년식|연식|년형)?/);
  if (single4 && min == null && max == null) {
    const y = toInt(single4[0].match(/(19|20)\d{2}/)[0]);
    min = y;
    max = null;
  }

  const single2 = s.match(/(?:[’']?)(\d{2})(?:\s*(?:년|연|년도|연도|년식|연식|년형))?/);
  if (single2 && min == null && max == null) {
    min = toYear2(single2[1]);
    max = null;
  }

  const singleKo = s.match(/([일이삼사오육칠팔구]?(십)[일이삼사오육칠팔구]?|[일이삼사오육칠팔구])\s*(?:년|연|년도|연도|년식|연식|년형)/);
  if (singleKo && min == null && max == null) {
    min = toYear2(koNumTo2Digit(singleKo[1]));
    max = null;
  }

  return { yearMin: min, yearMax: max };

  function normalizeForYear(t) {
    let x = String(t).replace(/\s+/g, ' ').trim();
    x = x.replace(/[‘’]/g, "'");
    x = x.replace(/\s*~\s*/g, '~').replace(/\s*-\s*/g, '-');
    return x;
  }

  function toYear2(yy) {
    const n = toInt(yy);
    if (n <= 29) return 2000 + n;
    return 1900 + n;
  }

  function koNumTo2Digit(word) {
    const unit = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
    const hasSip = /십/.test(word);
    let val = 0;
    if (hasSip) {
      const m = word.match(/([일이삼사오육칠팔구])?십([일이삼사오육칠팔구])?/);
      const tens = m && m[1] ? unit[m[1]] : 1;
      const ones = m && m[2] ? unit[m[2]] : 0;
      val = tens * 10 + ones;
    } else {
      const m = word.match(/([일이삼사오육칠팔구])/);
      val = m ? unit[m[1]] : NaN;
    }
    if (!Number.isFinite(val)) return '00';
    if (val < 0) val = 0;
    if (val > 99) val = 99;
    return String(val).padStart(2, '0');
  }

  function findYearWithOperator(text, opRegex, preferMin) {
    const re = new RegExp(
      [
        `((?:\\b(19|20)\\d{2}\\b)|(?:[’']\\d{2})|(?:\\b\\d{2}\\b)|(?:[일이삼사오육칠팔구]?십[일이삼사오육칠팔구]?|[일이삼사오육칠팔구]))\\s*(?:년|연|년도|연도|년식|연식|년형)?\\s*${opRegex.source}`,
        `${opRegex.source}\\s*((?:\\b(19|20)\\d{2}\\b)|(?:[’']\\d{2})|(?:\\b\\d{2}\\b)|(?:[일이삼사오육칠팔구]?십[일이삼사오육칠팔구]?|[일이삼사오육칠팔구]))\\s*(?:년|연|년도|연도|년식|연식|년형)?`,
      ].join('|'),
      'g'
    );

    let match,
      yearCandidate = null;
    while ((match = re.exec(text))) {
      let token = match[1] || match[3];
      if (!token) continue;

      let y;
      if (/(19|20)\d{2}/.test(token)) {
        y = toInt(token.match(/(19|20)\d{2}/)[0]);
      } else if (/^[’']\d{2}$/.test(token)) {
        y = toYear2(token.slice(1));
      } else if (/^\d{2}$/.test(token)) {
        y = toYear2(token);
      } else {
        y = toYear2(koNumTo2Digit(token));
      }

      if (yearCandidate == null) {
        yearCandidate = y;
      } else {
        yearCandidate = preferMin ? Math.min(yearCandidate, y) : Math.max(yearCandidate, y);
      }
    }
    return yearCandidate;
  }
}

/* =========================
   Fuel types
   ========================= */
function parseFuel(s) {
  const fuels = [];
  if (/(디젤|diesel)/i.test(s)) fuels.push('diesel');
  if (/(가솔린|휘발유|gasoline|petrol)/i.test(s)) fuels.push('gasoline');
  if (/(lpg|엘피지|lp가스)/i.test(s)) fuels.push('lpg');
  if (/(cng|천연가스|compressed natural gas)/i.test(s)) fuels.push('cng');
  if (/(하이브리드|hybrid)/i.test(s)) fuels.push('hybrid');
  if (/(마일드\s?하이브리드|mhev|mild hybrid)/i.test(s)) fuels.push('mild-hybrid');
  if (/(풀\s?하이브리드|hev|full hybrid)/i.test(s)) fuels.push('full-hybrid');
  if (/(플러그인|phev|plug[-\s]?in hybrid)/i.test(s)) fuels.push('plug-in-hybrid');
  if (/(전기|ev|battery electric|bev)/i.test(s)) fuels.push('ev');
  if (/(수소|연료전지|fcev|fuel cell)/i.test(s)) fuels.push('hydrogen');
  if (/(바이퓨얼|bi[-\s]?fuel|dual fuel|가솔린\+lpg|가솔린\+cng)/i.test(s)) fuels.push('bi-fuel');
  if (/(디젤\+마일드|디젤 mhev)/i.test(s)) fuels.push('diesel-mild-hybrid');
  if (/(가솔린\+마일드|가솔린 mhev)/i.test(s)) fuels.push('gasoline-mild-hybrid');
  return fuels;
}

/* =========================
   Body types
   ========================= */
function parseBodyType(s) {
  const a = [];
  if (/(suv|에스유브이|스포츠유틸|스포츠 유틸리티|크로스오버|cuv|크로스 오버|crossover)/i.test(s)) a.push('suv');
  if (/(세단|sedan|saloon)/i.test(s)) a.push('sedan');
  if (/(해치백|해치|hatchback|hatch)/i.test(s)) a.push('hatch');
  if (/(쿠페|coupe)/i.test(s)) a.push('coupe');
  if (/(왜건|wagon|estate|shooting brake|브레이크)/i.test(s)) a.push('wagon');
  if (/(컨버터블|convertible|카브리올레|cabriolet|로드스터|roadster|스파이더|spyder)/i.test(s)) a.push('convertible');
  if (/(밴|승합|mpv|미니밴|minivan|멀티퍼포즈|multi[-\s]?purpose)/i.test(s)) a.push('van');
  if (/(트럭|픽업|pickup|ute|픽업트럭)/i.test(s)) a.push('truck');
  if (/(리무진|limousine|limo)/i.test(s)) a.push('limousine');
  if (/(스포츠카|sportscar|supercar|hypercar)/i.test(s)) a.push('sport');
  if (/(컴팩트|compact|소형차|준중형|subcompact|b세그먼트|c세그먼트)/i.test(s)) a.push('compact');
  if (/(중형차|mid[-\s]?size|d세그먼트)/i.test(s)) a.push('midsize');
  if (/(대형차|full[-\s]?size|e세그먼트|f세그먼트|flagship)/i.test(s)) a.push('fullsize');
  if (/(오픈탑|컨버터블 suv|오픈형)/i.test(s)) a.push('open-top');
  if (/(경차|kei car|케이카)/i.test(s)) a.push('kei');
  if (/(상용|commercial|버스|화물)/i.test(s)) a.push('commercial');
  return a;
}

/* =========================
   Normalization for brand/model
   ========================= */
function normalizeQuery(text) {
  let t = String(text || '')
    .toLowerCase()
    .replace(/[\s\-_/.,()[\]{}:;!?'"]/g, '')
    .replace(/(자동차|오토|카)$/g, '')
    .replace(/그렌저/g, '그랜저')
    .replace(/제니시스/g, '제네시스')
    .replace(/소나타/g, '쏘나타')
    .replace(/산타페/g, '싼타페')
    .replace(/아반테/g, '아반떼')
    .replace(/레인지로바/g, '레인지로버')
    .replace(/폴크스바겐|폭스바건/g, '폭스바겐')
    .replace(/메르세데스/g, '벤츠');
  return t;
}

/* =========================
   Brand and model dictionaries
   ========================= */
const BRAND_KEYS = [
  '현대',
  '기아',
  '제네시스',
  '르노코리아',
  '쌍용',
  '쉐보레',
  '대우',
  '벤츠',
  'bmw',
  '아우디',
  '폭스바겐',
  '포르쉐',
  '렉서스',
  '토요타',
  '혼다',
  '닛산',
  '인피니티',
  '마쓰다',
  '스바루',
  '포드',
  '링컨',
  '캐딜락',
  '지프',
  '크라이슬러',
  '테슬라',
  '볼보',
  '푸조',
  '시트로엥',
  '피아트',
  '알파로메오',
  '마세라티',
  '페라리',
  '람보르기니',
  '재규어',
  '랜드로버',
  '미니',
  '롤스로이스',
  '벤틀리',
];

const BRAND_ALIASES = new Map([
  ['현대', '현대'],
  ['hyundai', '현대'],
  ['hd', '현대'],

  ['기아', '기아'],
  ['kia', '기아'],

  ['제네시스', '제네시스'],
  ['genesis', '제네시스'],
  ['genny', '제네시스'],

  ['르노', '르노코리아'],
  ['르노코리아', '르노코리아'],
  ['삼성', '르노코리아'],
  ['renault', '르노코리아'],
  ['renaultsamsung', '르노코리아'],

  ['쌍용', '쌍용'],
  ['ssangyong', '쌍용'],

  ['쉐보레', '쉐보레'],
  ['chevrolet', '쉐보레'],
  ['chevy', '쉐보레'],

  ['대우', '대우'],
  ['daewoo', '대우'],

  ['벤츠', '벤츠'],
  ['mercedes', '벤츠'],
  ['mercedesbenz', '벤츠'],
  ['benz', '벤츠'],
  ['mb', '벤츠'],

  ['bmw', 'bmw'],
  ['비엠더블유', 'bmw'],

  ['아우디', '아우디'],
  ['audi', '아우디'],

  ['폭스바겐', '폭스바겐'],
  ['volkswagen', '폭스바겐'],
  ['vw', '폭스바겐'],

  ['포르쉐', '포르쉐'],
  ['porsche', '포르쉐'],

  ['렉서스', '렉서스'],
  ['lexus', '렉서스'],

  ['토요타', '토요타'],
  ['toyota', '토요타'],

  ['혼다', '혼다'],
  ['honda', '혼다'],

  ['닛산', '닛산'],
  ['nissan', '닛산'],

  ['인피니티', '인피니티'],
  ['infiniti', '인피니티'],

  ['마쓰다', '마쓰다'],
  ['mazda', '마쓰다'],

  ['스바루', '스바루'],
  ['subaru', '스바루'],

  ['포드', '포드'],
  ['ford', '포드'],

  ['링컨', '링컨'],
  ['lincoln', '링컨'],

  ['캐딜락', '캐딜락'],
  ['cadillac', '캐딜락'],

  ['지프', '지프'],
  ['jeep', '지프'],

  ['크라이슬러', '크라이슬러'],
  ['chrysler', '크라이슬러'],

  ['테슬라', '테슬라'],
  ['tesla', '테슬라'],

  ['볼보', '볼보'],
  ['volvo', '볼보'],

  ['푸조', '푸조'],
  ['peugeot', '푸조'],

  ['시트로엥', '시트로엥'],
  ['citroen', '시트로엥'],

  ['피아트', '피아트'],
  ['fiat', '피아트'],

  ['알파로메오', '알파로메오'],
  ['alfaromeo', '알파로메오'],

  ['마세라티', '마세라티'],
  ['maserati', '마세라티'],

  ['페라리', '페라리'],
  ['ferrari', '페라리'],

  ['람보르기니', '람보르기니'],
  ['lamborghini', '람보르기니'],

  ['재규어', '재규어'],
  ['jaguar', '재규어'],

  ['랜드로버', '랜드로버'],
  ['landrover', '랜드로버'],
  ['rangerover', '랜드로버'],
  ['ranger rover', '랜드로버'],

  ['미니', '미니'],
  ['mini', '미니'],

  ['롤스로이스', '롤스로이스'],
  ['rollsroyce', '롤스로이스'],
  ['rolls-royce', '롤스로이스'],

  ['벤틀리', '벤틀리'],
  ['bentley', '벤틀리'],
]);

const MODEL_DICT = [
  // Hyundai
  '아반떼',
  '쏘나타',
  '그랜저',
  '투싼',
  '싼타페',
  '펠리세이드',
  '코나',
  '베뉴',
  '아이오닉',
  '아이오닉5',
  '아이오닉6',
  '스타리아',
  '스타렉스',
  '포터',
  '마이티',
  '베라크루즈',
  '제네시스',
  // Kia
  'k3',
  'k5',
  'k7',
  'k8',
  'k9',
  '레이',
  '모닝',
  '스포티지',
  '쏘렌토',
  '카니발',
  '니로',
  '셀토스',
  '스토닉',
  '카렌스',
  '모하비',
  '봉고',
  // Genesis
  'g70',
  'g80',
  'g90',
  'gv60',
  'gv70',
  'gv80',
  'gv90',
  'eq900',
  // Renault/Samsung
  'sm3',
  'sm5',
  'sm6',
  'sm7',
  'qm3',
  'qm5',
  'qm6',
  'xm3',
  '클리오',
  // SsangYong
  '티볼리',
  '코란도',
  '렉스턴',
  '체어맨',
  '무쏘',
  '액티언',
  '카이런',
  // Chevrolet/Daewoo
  '마티즈',
  '스파크',
  '칼로스',
  '젠트라',
  '라세티',
  '라세티프리미어',
  '크루즈',
  '라노스',
  '레간자',
  '토스카',
  '아베오',
  '말리부',
  '임팔라',
  '올란도',
  '트랙스',
  '트레일블레이저',
  '캡티바',
  '윈스톰',
  '콜로라도',
  '타호',
  '서버밴',
  // Germany
  'a클래스',
  'c클래스',
  'e클래스',
  's클래스',
  'g클래스',
  'gla',
  'glc',
  'gle',
  'gls',
  '1시리즈',
  '3시리즈',
  '5시리즈',
  '7시리즈',
  'x1',
  'x3',
  'x5',
  'x7',
  'i3',
  'i4',
  'ix',
  'a3',
  'a4',
  'a6',
  'a8',
  'q3',
  'q5',
  'q7',
  'q8',
  'e-tron',
  '골프',
  '폴로',
  '파사트',
  '제타',
  '티구안',
  '투아렉',
  'id.4',
  // Japan
  '프리우스',
  '캠리',
  '코롤라',
  'rav4',
  '하이랜더',
  '시빅',
  '어코드',
  'cr-v',
  'hr-v',
  '알티마',
  '맥시마',
  '리프',
  'es',
  'gs',
  'ls',
  'rx',
  'nx',
  'ux',
  'cx-3',
  'cx-5',
  'cx-9',
  'mx-5',
  '임프레자',
  '레거시',
  '아웃백',
  '포레스터',
];

/* =========================
   Brand and model parsing
   ========================= */
function parseBrand(s) {
  const q = normalizeQuery(s);
  const hits = new Set();

  for (const [alias, canonical] of BRAND_ALIASES.entries()) {
    if (q.includes(alias)) hits.add(canonical);
  }
  for (const canonical of BRAND_KEYS) {
    const key = normalizeQuery(canonical);
    if (q.includes(key)) hits.add(canonical);
  }
  return Array.from(hits);
}

function parseModel(s) {
  const q = normalizeQuery(s);
  return MODEL_DICT.filter((k) => q.includes(normalizeQuery(k)));
}

/* =========================
   Vehicle-query detector
   ========================= */
function looksLikeVehicleQuery(s) {
  const baseRe =
    /(차|차량|자동차|suv|세단|해치백|밴|승합|트럭|픽업|연비|예산|가격|만원|월\s*[0-9]+|할부|km|주행|연식|브랜드|모델|옵션|색상|lpg|디젤|가솔린|하이브리드|전기|ev|추천|찾아|보여|골라|선택|스포티지|투싼|싼타페|아반떼|쏘나타|그랜저|k3|k5|k7|k8|k9|레이|모닝|쏘렌토|카니발|니로|셀토스|펠리세이드)/i;
  if (baseRe.test(s)) return true;
  const bh = parseBrand(s);
  const mh = parseModel(s);
  return bh.length > 0 || mh.length > 0;
}

/* =========================
   Colors and options
   ========================= */
function parseColor(s) {
  const dict = [
    '검정',
    '블랙',
    '흰',
    '화이트',
    '은색',
    '실버',
    '회색',
    '그레이',
    '빨강',
    '레드',
    '파랑',
    '블루',
    '남색',
    '네이비',
    '군청',
    '초록',
    '그린',
    '녹색',
    '올리브',
    '카키',
    '노랑',
    '옐로우',
    '골드',
    '금색',
    '베이지',
    '아이보리',
    '갈색',
    '브라운',
    '코코아',
    '카푸치노',
    '보라',
    '퍼플',
    '바이올렛',
    '라벤더',
    '분홍',
    '핑크',
    '로즈',
    '마젠타',
    '버건디',
    '와인',
    '와인레드',
    '체리',
    '다크레드',
    '하늘',
    '스카이',
    '아쿠아',
    '민트',
    '터키석',
    '에메랄드',
    '라임',
    '라임그린',
    '머스타드',
    '샌드',
    '샌드골드',
    '브론즈',
    '코퍼',
    '동색',
    '차콜',
    '슬레이트',
    '다크그레이',
    '진주',
    '펄화이트',
    '펄블랙',
    '펄그레이',
    '메탈릭',
    '메탈릭실버',
    '메탈릭블루',
    '메탈릭그레이',
    '매트블랙',
    '무광블랙',
    '무광그레이',
    '쥐색',
    '진주색',
    '연금색',
    '진회색',
    '연회색',
    '연두',
    '형광',
    '형광녹색',
    '형광옐로우',
    '진청',
    '연청',
    '청색',
    '남보라',
    '아이보리화이트',
    '크림',
    '샴페인',
    '샴페인골드',
    '알파인화이트',
    '미네랄화이트',
    '스톤그레이',
    '미드나잇블루',
    '딥블루',
    '샤인블루',
    '로즈골드',
    '선셋오렌지',
    '코발트블루',
    '제트블랙',
    '오닉스블랙',
    '다이아몬드블랙',
    '실리콘실버',
    '티타늄실버',
    '아마존그린',
    '브리티시레이싱그린',
  ];
  return dict.filter((k) => s.toLowerCase().includes(k.toLowerCase()));
}

function parseOptions(s) {
  const dict = [
    '후방카메라',
    '360도카메라',
    '어라운드뷰',
    '블랙박스',
    '하이패스',
    '내비',
    '네비',
    'HUD',
    '무선충전',
    '스마트키',
    '전동트렁크',
    '전동도어',
    '전동시트',
    '메모리시트',
    '열선시트',
    '통풍시트',
    '안마시트',
    '리클라이닝시트',
    '핸들열선',
    '스티어링휠열선',
    '스마트폰연동',
    '애플카플레이',
    '안드로이드오토',
    '블루투스',
    'USB포트',
    '리모컨시동',
    '원격시동',
    '자동주차',
    '전동사이드미러',
    '폴딩미러',
    '룸미러ECM',
    '크레스트라',
    'BOSE',
    'JBL',
    '썬루프',
    '파노라마썬루프',
    '루프랙',
    '알로이휠',
    '크롬휠',
    'LED헤드램프',
    'HID헤드램프',
    '프로젝션램프',
    '데이라이트',
    '안개등',
    '자동와이퍼',
    '레인센서',
    '다이내믹턴시그널',
    '스포일러',
    '차선이탈',
    '차선유지',
    '차선이탈경고',
    '차선유지보조',
    '전방추돌',
    '후측방경고',
    '후측방충돌방지',
    '사각지대감지',
    '어댑티브크루즈',
    'ACC',
    '자동긴급제동',
    'AEB',
    'ABS',
    'ESC',
    'EBD',
    'TCS',
    '차체자세제어',
    '도로표지인식',
    '운전자모니터링',
    '에어백',
    '사이드에어백',
    '커튼에어백',
    '무릎에어백',
    'ISOFIX',
    '크루즈컨트롤',
    '어댑티브크루즈컨트롤',
    '드라이브모드',
    '스포츠모드',
    '에코모드',
    '전자식기어',
    '패들쉬프트',
    '사륜구동',
    'AWD',
    '전자식서스펜션',
    '에어서스펜션',
    '토우패키지',
    '런플랫타이어',
    '내비게이션',
    '음성인식',
    '음성명령',
    '하만카돈',
    '렉시콘',
    '마크레빈슨',
    '프리미엄오디오',
    '뒷좌석모니터',
    'DMB',
    'TV튜너',
    'USB단자',
    'AUX단자',
    'CD플레이어',
    '오토홀드',
    '전자파킹',
    'EPB',
    '스마트크루즈',
    '차간거리유지',
    '헤드업디스플레이',
    '무선키',
    '카드키',
    '키레스고',
    '스타트버튼',
    '파워도어록',
    '원터치다운',
    '원터치업',
    '가죽시트',
    '나파가죽시트',
    '스웨이드시트',
    '우드그레인',
    '앰비언트라이트',
    '무드등',
    '프리미엄패키지',
    '뒷좌석열선',
    '뒷좌석통풍',
    'VIP시트',
    '캡틴시트',
  ];
  return dict.filter((k) => s.toLowerCase().includes(k.toLowerCase()));
}

/* =========================
   Flags
   ========================= */
function parseFlags(s) {
  const noAcc = /(무사고|사고\s*없음|사고이력\s*없음)/i.test(s)
    ? true
    : /(유사고|사고차|사고\s*있음)/i.test(s)
    ? false
    : null;

  const shortK = /(짧은\s*주행|단거리|주행\s*적음|주행거리\s*짧)/i.test(s) ? true : null;

  return { noAccident: noAcc, shortKm: shortK };
}

/* =========================
   Helpers
   ========================= */
function toInt(x) {
  const n = parseInt(String(x).replace(/[, ]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/* =========================
   Natural-language response
   ========================= */
function generateResponse(parsed) {
  const {
    budgetMin,
    budgetMax,
    monthlyMin,
    monthlyMax,
    kmMin,
    kmMax,
    yearMin,
    yearMax,
    fuelTypes,
    bodyTypes,
    brands,
    models,
    colors,
    options,
    noAccident,
    shortKm,
  } = parsed;

  const conditions = [];

  // Budget
  if (budgetMin || budgetMax) {
    if (budgetMin && budgetMax) {
      conditions.push(`${budgetMin}만원~${budgetMax}만원`);
    } else if (budgetMax) {
      conditions.push(`${budgetMax}만원 이하`);
    } else if (budgetMin) {
      conditions.push(`${budgetMin}만원 이상`);
    }
  }

  // Monthly
  if (monthlyMin || monthlyMax) {
    if (monthlyMin && monthlyMax) {
      conditions.push(`월 ${monthlyMin}만원~${monthlyMax}만원`);
    } else if (monthlyMax) {
      conditions.push(`월 ${monthlyMax}만원 이하`);
    } else if (monthlyMin) {
      conditions.push(`월 ${monthlyMin}만원 이상`);
    }
  }

  // Mileage
  if (kmMin || kmMax) {
    if (kmMin && kmMax) {
      conditions.push(`${Math.floor(kmMin / 10000)}만~${Math.floor(kmMax / 10000)}만km`);
    } else if (kmMax) {
      conditions.push(`${Math.floor(kmMax / 10000)}만km 이하`);
    } else if (kmMin) {
      conditions.push(`${Math.floor(kmMin / 10000)}만km 이상`);
    }
  }

  // Year
  if (yearMin || yearMax) {
    if (yearMin && yearMax) {
      conditions.push(`${yearMin}~${yearMax}년식`);
    } else if (yearMax) {
      conditions.push(`${yearMax}년식 이하`);
    } else if (yearMin) {
      conditions.push(`${yearMin}년식 이상`);
    }
  }

  // Body types
  if (bodyTypes.length > 0) {
    const names = {
      suv: 'SUV',
      sedan: '세단',
      hatch: '해치백',
      van: '밴/승합',
      truck: '트럭',
      wagon: '왜건',
      coupe: '쿠페',
      convertible: '컨버터블',
      sport: '스포츠카',
      compact: '컴팩트',
      midsize: '중형차',
      fullsize: '대형차',
      'open-top': '오픈탑',
      kei: '경차',
      commercial: '상용',
      limousine: '리무진',
    };
    conditions.push(bodyTypes.map((t) => names[t] || t).join(', '));
  }

  // Fuel types
  if (fuelTypes.length > 0) {
    const names = {
      diesel: '디젤',
      gasoline: '가솔린',
      hybrid: '하이브리드',
      ev: '전기',
      lpg: 'LPG',
      cng: 'CNG',
      'mild-hybrid': '마일드 하이브리드',
      'full-hybrid': '풀 하이브리드',
      'plug-in-hybrid': '플러그인 하이브리드',
      hydrogen: '수소',
      'bi-fuel': '바이퓨얼',
      'diesel-mild-hybrid': '디젤 마일드 하이브리드',
      'gasoline-mild-hybrid': '가솔린 마일드 하이브리드',
    };
    conditions.push(fuelTypes.map((f) => names[f] || f).join(', '));
  }

  if (brands.length > 0) {
    conditions.push(brands.join(', '));
  }

  if (models.length > 0) {
    conditions.push(models.join(', '));
  }

  if (colors.length > 0) {
    conditions.push(colors.join(', '));
  }

  if (options.length > 0) {
    conditions.push(options.join(', '));
  }

  if (noAccident === true) conditions.push('무사고');
  if (shortKm === true) conditions.push('단거리');

  if (conditions.length === 0) {
    return '조건을 더 구체적으로 알려주시면 더 정확한 추천을 드릴 수 있습니다. 예산대나 차종을 알려주세요.';
  }

  const conditionText = conditions.join(', ');

  if (
    conditions.length === 1 &&
    models.length > 0 &&
    !budgetMin &&
    !budgetMax &&
    !monthlyMin &&
    !monthlyMax &&
    !bodyTypes.length &&
    !fuelTypes.length
  ) {
    return `좋습니다! ${conditionText}를 찾아보겠습니다. 더 구체적인 조건(예산, 차종, 연식 등)을 추가로 알려주시면 더 정확한 추천을 드릴 수 있습니다. "추천 실행" 버튼을 눌러 현재 조건으로 검색해 보세요.`;
  }

  return `조건을 확인했습니다: ${conditionText}. 추가로 원하시는 조건이 있으시면 말씀해 주세요. "추천 실행" 버튼을 눌러 결과를 확인해 보세요.`;
}
