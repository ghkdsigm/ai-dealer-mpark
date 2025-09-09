// back/services/maintenance.js
// 연식/주행거리 기준 정비 체크리스트(룰)
function checklist({ year, mileage }) {
	const list = []
	if (mileage >= 80000) list.push('타이밍벨트/워터펌프 점검(차종별 해당 시)')
	if (mileage >= 60000) list.push('브레이크 패드/디스크, 점화플러그/코일 점검')
	if (mileage >= 40000) list.push('변속기 오일, 브레이크 오일, 냉각수 상태 점검')
	if (mileage >= 20000) list.push('에어컨 필터, 엔진오일/오일필터 교환 주기 확인')
	if (!year || year <= 2015) list.push('고무부품(호스/벨트)/부싱/엔진마운트 노화 점검')
	if (year && year <= 2010) list.push('서스펜션 누유/하체 부식, 연료라인 점검')
	if (list.length === 0) list.push('기본 안전 점검(타이어/등화류/배터리/와이퍼)')
	return list
}

module.exports = { checklist }
