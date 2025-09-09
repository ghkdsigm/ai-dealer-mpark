// back/lib/answer_render.js
// 목적: 추천 결과(items)와 intent로 자연스러운 응답 문장을 만든다.
// 의존: 선택적으로 services/llm_gemma.js (후처리 강화 시)

function formatMoneyKman(x) {
    try {
      const n = parseInt(x, 10);
      if (!Number.isFinite(n)) return null;
      return `${n.toLocaleString()}만원`;
    } catch {
      return null;
    }
  }
  
  function shortName(v) {
    // carName에서 중요 부분만 간략 추출하는 간단 규칙
    const s = (v.carName || '').trim();
    if (s.length <= 24) return s;
    return s.slice(0, 24) + '…';
  }
  
  function renderPlain(intent, items, meta) {
    const parts = [];
  
    // 조건 요약
    const cond = [];
    if (intent?.budget?.maxKman) cond.push(`예산 ${formatMoneyKman(intent.budget.maxKman)} 이하`);
    if (intent?.mileage?.maxKm) cond.push(`주행 ${intent.mileage.maxKm.toLocaleString()}km 이하`);
    if (intent?.fuelTypes?.length) cond.push(`연료 ${intent.fuelTypes.join('/')}`);
    if (intent?.bodyTypes?.length) cond.push(`차종 ${intent.bodyTypes.join('/')}`);
    if (intent?.brands?.length) cond.push(`브랜드 ${intent.brands.join('/')}`);
    if (intent?.years?.min || intent?.years?.max) {
      const yr = `${intent.years?.min ?? ''}~${intent.years?.max ?? ''}`.replace(/^~|~$/g, '');
      if (yr) cond.push(`연식 ${yr}년`);
    }
    if (cond.length) parts.push(`요청 조건을 반영해 아래 차량을 추천합니다. (${cond.join(', ')})`);
    else parts.push(`요청 조건을 반영해 아래 차량을 추천합니다.`);
  
    // 결과 요약
    const n = items.length;
    parts.push(`총 ${n}대 중 상위 ${Math.min(n, 5)}대를 보여드립니다.`);
  
    // 리스트
    const top = items.slice(0, 5);
    top.forEach((v, i) => {
      const price = v.priceKman ? formatMoneyKman(v.priceKman) : null;
      const line = [
        `${i + 1}. ${shortName(v)}`,
        v.yymm ? `연식 ${v.yymm}` : null,
        v.mileage != null ? `주행 ${Number(v.mileage).toLocaleString()}km` : null,
        v.fuelType ? v.fuelType : null,
        price ? `가격 ${price}` : null,
      ].filter(Boolean).join(' · ');
      parts.push(line);
    });
  
    // Relaxed 사유
    if (meta?.relaxed && meta?.relaxedReasons?.length) {
      parts.push(`일부 조건을 완화하여 결과를 확장했습니다: ${meta.relaxedReasons.join(', ')}`);
    }
  
    return parts.join('\n');
  }
  
  module.exports = { renderPlain };
  