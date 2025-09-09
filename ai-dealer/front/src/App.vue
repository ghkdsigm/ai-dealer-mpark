<!-- src/App.vue -->
<template>
	<main class="min-h-screen bg-gray-50 p-6 max-w-5xl mx-auto">
	  <!-- 입력 + 버튼들 -->
	  <div class="flex flex-wrap items-center gap-2 mb-2">
		<input
		  v-model="q"
		  placeholder="예) 2천만 원 이하 디젤 SUV / 월 25만원"
		  class="border rounded px-3 py-2 flex-1 min-w-[280px]"
		  @keydown.enter="ask"
		/>
  
		<!-- 추천 버튼 -->
		<button
		  @click="ask"
		  class="px-4 py-2 rounded bg-blue-600 text-white"
		  :disabled="loading"
		>
		  {{ loading ? '추천 중…' : '추천' }}
		</button>
  
		<!-- 대답해줘: STT 중지 후 즉시 추천 -->
		<button
		  @click="answerNow"
		  class="px-4 py-2 rounded border"
		  :disabled="loading || !isSttSupported"
		  title="음성 인식을 멈추고 바로 추천 실행"
		>
		  대답해줘
		</button>
  
		<!-- STT 토글 -->
		<button
		  :disabled="!isSttSupported"
		  @click="toggleSTT"
		  class="px-3 py-2 rounded border"
		  :class="recognizing ? 'bg-red-600 text-white' : 'bg-white'"
		  title="마이크로 질문 말하기"
		>
		  {{ isSttSupported ? (recognizing ? '듣는 중(끄기)' : '말하기') : '미지원' }}
		</button>
  
		<!-- 자동 추천 토글 -->
		<label class="flex items-center gap-2 text-sm ml-2 select-none">
		  <input type="checkbox" v-model="autoRecommend" />
		  음성 최종 인식 시 자동 추천
		</label>
	  </div>
  
	  <!-- STT 상태 -->
	  <p v-if="interim" class="text-sm text-gray-500 mb-2">
		인식 중: {{ interim }}
	  </p>
  
	  <!-- 결과/오류 -->
	  <p v-if="error" class="text-red-600 text-sm mb-2">
		요청 오류: {{ error }}
	  </p>
	  <p v-if="reply" class="text-gray-800 mb-4">
		{{ reply }}
	  </p>
  
	  <!-- 추천 카드 -->
	  <div class="grid md:grid-cols-2 gap-4">
		<article
		  v-for="v in items"
		  :key="v.id"
		  class="rounded-xl border bg-white shadow p-4"
		>
		  <div class="flex items-start justify-between gap-2">
			<h3 class="font-semibold">
			  {{ v.year ?? '연식미상' }} {{ v.make }} {{ v.model }}
			</h3>
			<span
			  v-if="v.noAccident"
			  class="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700"
			>
			  무사고
			</span>
		  </div>
  
		  <p class="text-sm text-gray-600">
			{{ bodyTypeLabel(v.bodyType) }}
			<span v-if="v.fuelType"> · {{ fuelLabel(v.fuelType) }}</span>
			<span v-if="v.yymm"> · {{ v.yymm }}</span>
		  </p>
  
		  <p class="mt-1 text-sm">
			주행 <strong>{{ formatNumber(v.mileage) }}</strong> km
		  </p>
  
		  <div class="mt-2 flex items-baseline gap-2">
			<p class="font-bold text-lg">
			  <span v-if="isNumber(v.price)">{{ formatNumber(v.price) }} 만원</span>
			  <span v-else class="text-gray-400">가격문의</span>
			</p>
			<p
			  v-if="isNumber(v.monthlyPrice)"
			  class="text-sm text-gray-500"
			  title="월 예상 부담(만원)"
			>
			  · 월 {{ formatNumber(v.monthlyPrice) }} 만원
			</p>
		  </div>
		</article>
	  </div>
	</main>
  </template>
  
  <script setup>
  import { ref, onMounted, onBeforeUnmount } from 'vue'
  
  /* 상태 */
  const q = ref('')
  const items = ref([])
  const reply = ref('')
  const loading = ref(false)
  const error = ref('')
  
  /* 자동 추천 설정: STT가 최종 인식 문장을 내보낼 때 자동으로 ask() 실행 */
  const autoRecommend = ref(true)
  
  /* 서버 호출 (/api/recommend) */
  async function ask() {
	if (!q.value || !q.value.trim()) return
	loading.value = true
	error.value = ''
	reply.value = ''
	items.value = []
	try {
	  const r = await fetch('/api/recommend', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ q: q.value, limit: 5 }),
	  })
	  if (!r.ok) throw new Error(`HTTP ${r.status}`)
	  const data = await r.json()
	  items.value = (data.items ?? data) || []
	  if (items.value.length) {
		const top = items.value[0]
		reply.value = `${top.year ?? ''} ${top.make} ${top.model} 포함 ${items.value.length}건 추천했습니다.`
	  } else {
		reply.value = '조건에 맞는 매물이 없어 보입니다. 범위를 조금 넓혀 다시 시도해 주세요.'
	  }
	  if (reply.value) speak(reply.value)
	} catch (e) {
	  console.error(e)
	  error.value = String(e.message ?? e)
	  /* 오류 안내도 음성으로 읽어주고 싶다면 아래 주석 해제
	  speak('오류가 발생했습니다. 잠시 후 다시 시도해 주세요.')
	  */
	} finally {
	  loading.value = false
	}
  }
  
  /* 표시용 헬퍼 */
  function isNumber(n) {
	return typeof n === 'number' && Number.isFinite(n)
  }
  function formatNumber(n) {
	if (!isNumber(n)) return ''
	try {
	  return n.toLocaleString()
	} catch {
	  return String(n)
	}
  }
  function fuelLabel(code) {
	const map = {
	  gasoline: '가솔린',
	  diesel: '디젤',
	  hybrid: '하이브리드',
	  ev: '전기',
	  lpg: 'LPG',
	}
	return map[code] ?? code
  }
  function bodyTypeLabel(code) {
	const map = {
	  suv: 'SUV',
	  sedan: '세단',
	  hatch: '해치백',
	  cuv: 'CUV/전기',
	  truck: '트럭/상용',
	  van: '승합/밴',
	}
	return map[code] ?? (code || '차종미상')
  }
  
  /* TTS: 우선 서버(/api/tts) 사용, 실패 시 브라우저 음성으로 폴백 */
  let audioElem = null
  async function speak(text) {
  if (!text) return
  try {
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!r.ok) throw new Error(`TTS HTTP ${r.status}`)
    const blob = await r.blob()
    if (!blob || blob.size === 0) throw new Error('empty audio')
    try { audioElem && audioElem.pause() } catch {}
    audioElem = new Audio(URL.createObjectURL(blob))
    await audioElem.play()
  } catch (err) {
    console.warn('TTS 오류, 브라우저 음성으로 폴백:', err)
    browserSpeakFallback(text)
  }
}
  function browserSpeakFallback(text) {
	try {
	  const u = new SpeechSynthesisUtterance(text)
	  u.lang = 'ko-KR'
	  const voices = speechSynthesis.getVoices()
	  const pick =
		voices.find(v => /ko-KR/i.test(v.lang) && /(Neural|Natural|Female|A|B)/i.test(v.name || '')) ||
		voices.find(v => /ko-KR/i.test(v.lang))
	  if (pick) u.voice = pick
	  u.rate = 1.0
	  u.pitch = 1.05
	  speechSynthesis.cancel()
	  speechSynthesis.speak(u)
	} catch (e) {
	  console.warn('browser TTS fallback error:', e)
	}
  }
  
  /* STT(Web Speech API) */
  const isSttSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
  const recognizing = ref(false)
  const interim = ref('')
  
  let recognition = null
  let sttManuallyStopped = false
  let sttKeepAlive = true
  let askTimer = null
  
  function initSTT() {
	const SR = window.SpeechRecognition || window.webkitSpeechRecognition
	if (!SR) return
	recognition = new SR()
	recognition.lang = 'ko-KR'
	recognition.interimResults = true
	recognition.continuous = true
  
	recognition.onstart = () => {
	  recognizing.value = true
	  interim.value = ''
	}
  
	recognition.onresult = e => {
	  let finalText = ''
	  let interimText = ''
	  for (let i = e.resultIndex; i < e.results.length; i++) {
		const transcript = e.results[i][0].transcript.trim()
		if (e.results[i].isFinal) finalText += transcript + ' '
		else interimText += transcript + ' '
	  }
  
	  if (finalText) {
		q.value = (q.value + ' ' + finalText).replace(/\s+/g, ' ').trim()
  
		/* 자동 추천: 최종 문장 들어오면 약간 디바운스해서 ask() 실행 */
		if (autoRecommend.value) {
		  if (askTimer) clearTimeout(askTimer)
		  askTimer = setTimeout(() => {
			ask()
		  }, 150)
		}
	  }
	  interim.value = interimText
	}
  
	recognition.onerror = e => {
	  console.warn('STT error:', e.error)
	  if (!sttManuallyStopped) {
		try { recognition.stop() } catch {}
	  }
	}
  
	recognition.onend = () => {
	  recognizing.value = false
	  if (!sttManuallyStopped && sttKeepAlive) {
		setTimeout(() => {
		  try { recognition.start() } catch {}
		}, 80)
	  }
	}
  }
  
  function startSTT() {
	if (!recognition) initSTT()
	if (!recognition || recognizing.value) return
	sttManuallyStopped = false
	sttKeepAlive = true
	try { recognition.start() } catch (e) { console.warn(e) }
  }
  
  function stopSTT() {
	sttManuallyStopped = true
	sttKeepAlive = false
	try { recognition && recognition.stop() } catch {}
	recognizing.value = false
  }
  
  function toggleSTT() {
	recognizing.value ? stopSTT() : startSTT()
  }
  
  /* 대답해줘: STT를 수동 종료하고 즉시 추천 */
  async function answerNow() {
	stopSTT()
	await ask()
  }
  
  onMounted(() => {
	if (isSttSupported) initSTT()
  })
  onBeforeUnmount(() => {
	stopSTT()
	if (askTimer) clearTimeout(askTimer)
  })
  </script>
  
  <style scoped>
  /* 선택적으로 카드나 버튼 스타일 보완 가능 */
  </style>
  