// NOTE: 코드 주석에 이모티콘은 사용하지 않음

import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'

// 서버 전역 app 생성 및 공통 미들웨어 장착
export const app = express()

app.use(express.json())
app.use(cookieParser())

// 개발 환경에서만 CORS 완화 필요 시 사용
// 운영 배포 시에는 Nginx 등으로 같은 오리진으로 프록시하는 것을 권장
app.use(cors({
  origin: true,
  credentials: true,
}))

// sid 쿠키 자동 발급 미들웨어
app.use((req, res, next) => {
  const COOKIE = 'sid'
  let sid = req.cookies?.[COOKIE]
  if (!sid) {
    // 간단하게 타임스탬프 기반. uuid 패키지를 쓰고 싶다면 그걸 사용해도 됨.
    sid = String(Date.now()) + Math.random().toString(16).slice(2)
    res.cookie(COOKIE, sid, {
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    })
  }
  req._sid = sid
  next()
})

export function sidFrom(req) {
  // 쿠키 기반 sid를 우선 사용
  return req._sid || req.cookies?.sid || req.ip
}
