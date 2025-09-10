// back/services/rules.js
// 운전 패턴/직업/연간거리 등으로 연료/차종 가이드(룰기반)
function recommendFuel({ yearlyKm, monthlyKm, job, cityRatio = 0.5 }) {
	const yr = yearlyKm ?? (monthlyKm ? monthlyKm * 12 : undefined)
	if (yr == null) return null

	// 대략 가이드
	if (yr >= 20000) {
		// 많이 타면: 디젤/하이브리드/LPG(영업) 추천
		if (job && /택시|대리|배달|렌트|영업/.test(job)) return ['lpg', 'hybrid', 'gasoline']
		return ['diesel', 'hybrid', 'ev']
	} else if (yr >= 12000) {
		return ['hybrid', 'gasoline', 'diesel']
	} else {
		// 적게 타면: 가솔린/하이브리드
		return ['gasoline', 'hybrid', 'ev']
	}
}

module.exports = { recommendFuel }
