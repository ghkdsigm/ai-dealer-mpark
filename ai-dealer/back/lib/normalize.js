// back/lib/normalize.js
// NOTE: 코드 주석에 이모티콘은 사용하지 않음
// 목적: 원본 인벤토리 레코드를 추천/서빙이 기대하는 스키마로 정규화한다.
// 입력 예시 스키마(원본):
//   {
//     demoNo, demoDay, yymm, carNo, carName, yyyy, km,
//     demoAmt, monthlyDemoAmt, carGas, noAccident, shortKm, color, colorCode
//   }
// 출력 스키마(정규화):
//   {
//     id, carNo, carName, make, model, trim,
//     year, km, price, monthlyPrice, fuelType, bodyType,
//     segment, transmission, noAccident, shortKm, yymm, color, colorCode,
//     tags, options, _raw
//   }

function mapFuel(carGas) {
    const s = String(carGas || '').toLowerCase()
    if (!s) return null
    if (s.includes('수소')) return 'fcev'
    if (s.includes('전기') && !s.includes('가솔린') && !s.includes('디젤') && !s.includes('lpg')) return 'ev'
    if (s.includes('전기')) return 'hybrid' // 가솔린+전기, 디젤+전기, lpg+전기 등은 하이브리드로 통합
    if (s.includes('디젤')) return 'diesel'
    if (s.includes('lpg')) return 'lpg'
    if (s.includes('가솔린') || s.includes('휘발')) return 'gasoline'
    return null
  }
  
  function splitMakeModel(carName) {
    const name = String(carName || '').trim()
    if (!name) return { make: null, model: null, trim: null }
    const parts = name.split(/\s+/)
    const make = parts[0] || null
    let model = null
    let trim = null
    if (parts.length >= 2) {
      const clean = parts.slice(1).join(' ').replace(/\(.*?\)/g, '').trim()
      const tokens = clean.split(/\s+/)
      if (tokens.length === 1) {
        model = tokens[0]
      } else {
        model = tokens.slice(0, 1).join(' ')
        trim = tokens.slice(1).join(' ') || null
      }
    }
    return { make, model, trim }
  }
  
  function toBool(s) {
    if (typeof s === 'boolean') return s
    const v = String(s ?? '').toLowerCase()
    if (v === 'true') return true
    if (v === 'false') return false
    if (v === '1') return true
    if (v === '0') return false
    return undefined
  }
  
  function toInt(x) {
    if (x == null) return null
    const n = parseInt(String(x).replace(/[^\d-]/g, ''), 10)
    return Number.isFinite(n) ? n : null
  }
  
  function inferBodyTypeFromName(carName) {
    const s = String(carName || '')
    // 트럭 계열
    if (/픽업|포터|봉고|라보|실버라도|f-?150|렉스턴\s*스포츠/i.test(s)) return 'truck'
    // 승합/밴
    if (/밴|승합|카니발|스타렉스|스타리아/i.test(s)) return 'van'
    // SUV 계열
    if (/suv|투싼|스포티지|쏘렌토|싼타페|모하비|펠리세이드|텔루라이드|니로|코나|셀토스|캐스퍼/i.test(s)) return 'suv'
    // 해치백
    if (/해치백|i30|폴로|골프|프라이드\s*해치|피에스타/i.test(s)) return 'hatch'
    // 세단 계열
    if (/세단|소나타|k5|k7|k8|그랜저|제네시스|아반떼|말리부|토러스|sm6|티구안\s*세단/i.test(s)) return 'sedan'
    return null
  }
  
  /**
   * 단일 레코드를 표준 스키마로 정규화한다.
   * @param {Object} r 원본 레코드
   * @returns {Object} 정규화된 레코드
   */
  function normalizeRow(r) {
    const { make, model, trim } = splitMakeModel(r.carName)
    const year = toInt(r.yyyy)
    const km = toInt(r.km)
    const price = toInt(r.demoAmt)               // 단위: 만원
    const monthlyPrice = toInt(r.monthlyDemoAmt) // 단위: 만원
    const fuelType = mapFuel(r.carGas)
    const bodyType = inferBodyTypeFromName(r.carName)
    const noAccident = toBool(r.noAccident)
    const shortKm = toBool(r.shortKm)
  
    return {
      _raw: { demoNo: r.demoNo, demoDay: r.demoDay, yymm: r.yymm, carGas: r.carGas },
  
      id: String(r.demoNo || r.carNo || ''),
      carNo: r.carNo || null,
      carName: r.carName || null,
  
      make,
      model,
      trim,
      year,
      km,
      price,
      monthlyPrice,
      fuelType,     // gasoline|diesel|hybrid|ev|lpg|fcev|null
      bodyType,     // sedan|suv|truck|van|hatch|null
      segment: null,
      transmission: null,
  
      noAccident,
      shortKm,
  
      yymm: r.yymm || null,
      color: r.color || null,
      colorCode: r.colorCode || null,
  
      tags: [],
      options: [],
    }
  }
  
  /**
   * 배열 단위 정규화 유틸리티
   * @param {Array<Object>} rows 원본 레코드 배열
   * @returns {Array<Object>} 정규화된 배열
   */
  function normalizeList(rows) {
    return (rows || []).map(normalizeRow)
  }
  
  module.exports = {
    normalizeRow,
    normalizeList,
    mapFuel,
    splitMakeModel,
    toBool,
    toInt,
    inferBodyTypeFromName,
  }
  