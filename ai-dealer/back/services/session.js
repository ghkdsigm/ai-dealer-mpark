// NOTE: 코드 주석에 이모티콘은 사용하지 않음

// 간단한 인메모리 세션 저장소
// 프로덕션에서 다중 인스턴스/오토스케일을 쓰면 Redis 등 외부 저장소로 교체 필요

const SESS = new Map() // sid -> { intent, stage, lastSeen }
const TTL_MS = 1000 * 60 * 10 // 10분 유휴 시 만료

export function getSess(sid) {
  const now = Date.now()
  const rec = SESS.get(sid)
  if (rec && now - rec.lastSeen > TTL_MS) {
    SESS.delete(sid)
  }
  if (!SESS.has(sid)) {
    SESS.set(sid, { intent: {}, stage: 'collect', lastSeen: now })
  } else {
    SESS.get(sid).lastSeen = now
  }
  return SESS.get(sid)
}

export function resetSess(sid) {
  SESS.delete(sid)
}
