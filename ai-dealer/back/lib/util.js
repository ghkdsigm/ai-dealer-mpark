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
  
  export function normalizeIntent(intent) {
    const out = { ...intent }
  
    // 기본 필드 보정
    if (!Array.isArray(out.brands)) out.brands = []
    if (!Array.isArray(out.models)) out.models = []
    if (!Array.isArray(out.colors)) out.colors = []
    if (!Array.isArray(out.options)) out.options = []
  
    // 범위 보정
    if (Number.isFinite(out.budgetMin) && Number.isFinite(out.budgetMax) && out.budgetMin > out.budgetMax) {
      const t = out.budgetMin; out.budgetMin = out.budgetMax; out.budgetMax = t
    }
    if (Number.isFinite(out.monthlyMin) && Number.isFinite(out.monthlyMax) && out.monthlyMin > out.monthlyMax) {
      const t = out.monthlyMin; out.monthlyMin = out.monthlyMax; out.monthlyMax = t
    }
    if (Number.isFinite(out.kmMin) && Number.isFinite(out.kmMax) && out.kmMin > out.kmMax) {
      const t = out.kmMin; out.kmMin = out.kmMax; out.kmMax = t
    }
    if (Number.isFinite(out.yearMin) && Number.isFinite(out.yearMax) && out.yearMin > out.yearMax) {
      const t = out.yearMin; out.yearMin = out.yearMax; out.yearMax = t
    }
  
    // 음수 방지
    ['budgetMin','budgetMax','monthlyMin','monthlyMax','kmMin','kmMax'].forEach(k => {
      if (Number.isFinite(out[k]) && out[k] < 0) out[k] = 0
    })
  
    return out
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
  