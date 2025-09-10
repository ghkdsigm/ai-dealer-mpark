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
				class="px-3 py-2 rounded-full border relative wave-button"
				:class="recognizing ? 'bg-blue-600 text-white' : 'bg-white'"
				title="마이크로 질문 말하기"
			>
				{{ isSttSupported ? (recognizing ? '듣는 중…' : '말하기') : '미지원' }}
			</button>

			<!-- 자동 추천 토글 -->
			<label class="flex items-center gap-2 text-sm ml-2 select-none">
				<input
					type="checkbox"
					v-model="autoRecommend"
				/>
				음성 최종 인식 시 자동 추천
			</label>
		</div>

		<!-- STT 상태 -->
		<p
			v-if="interim"
			class="text-sm text-gray-500 mb-2"
		>
			인식 중: {{ interim }}
		</p>

		<!-- 결과/오류 -->
		<p
			v-if="error"
			class="text-red-600 text-sm mb-2"
		>
			요청 오류: {{ error }}
		</p>
		<p
			v-if="reply"
			class="text-gray-800 mb-4"
		>
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
					<h3 class="font-semibold">{{ v.year ?? '연식미상' }} {{ v.make }} {{ v.model }}</h3>
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
						<span
							v-else
							class="text-gray-400"
							>가격문의</span
						>
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

function echoQuery(q) {
	if (!q) return ''
	// 간단한 자연어 에코: 문장 끝 처리 및 조사 보정
	const trimmed = q.trim().replace(/\s+/g, ' ')
	const hasEnd = /[.!?…]$/.test(trimmed)
	const qEnd = hasEnd ? '' : ''
	return `요청하신 “${trimmed}${qEnd}” 조건으로`
}

/* 서버 호출 (/api/recommend) */
async function ask() {
	if (!q.value || !q.value.trim()) return
	const asked = q.value.trim() // 사용자가 실제로 입력한 원문 보관
	loading.value = true
	error.value = ''
	reply.value = ''
	items.value = []
	try {
		const r = await fetch('/api/recommend', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ q: asked, limit: 5 }), // asked 사용
		})
		if (!r.ok) throw new Error(`HTTP ${r.status}`)
		const data = await r.json()
		items.value = (data.items ?? data) || []

		if (items.value.length) {
			const top = items.value[0]
			// 복명복창 + 결과 요약 + 마지막 안내멘트
			reply.value = `${echoQuery(asked)} ${items.value.length}건을 찾았어요. 대표 추천: ${top.year ?? ''} ${
				top.make
			} ${top.model}. ${top.model} 포함 ${items.value.length}건 추천드려요.`
		} else {
			reply.value = `${echoQuery(asked)}는 현재 조건에 맞는 매물이 없어요. 범위를 조금 넓혀 다시 시도해 주세요.`
		}

		if (reply.value) speak(reply.value)

		// 결과가 세팅되면 input 초기화
		q.value = ''
	} catch (e) {
		console.error(e)
		error.value = String(e.message ?? e)
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
		try {
			audioElem && audioElem.pause()
		} catch {}
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
			try {
				recognition.stop()
			} catch {}
		}
	}

	recognition.onend = () => {
		recognizing.value = false
		if (!sttManuallyStopped && sttKeepAlive) {
			setTimeout(() => {
				try {
					recognition.start()
				} catch {}
			}, 80)
		}
	}
}

function startSTT() {
	if (!recognition) initSTT()
	if (!recognition || recognizing.value) return
	sttManuallyStopped = false
	sttKeepAlive = true
	try {
		recognition.start()
	} catch (e) {
		console.warn(e)
	}
}

function stopSTT() {
	sttManuallyStopped = true
	sttKeepAlive = false
	try {
		recognition && recognition.stop()
	} catch {}
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
/* 색상 토큰 */
:root {
	--bg-grad-a: 245, 248, 255;
	--bg-grad-b: 232, 238, 255;
	--primary: 37, 99, 235;
	--primary-600: 37, 99, 235;
	--primary-700: 29, 78, 216;
	--ink: 31, 41, 55;
	--sub: 107, 114, 128;
	--card: 255, 255, 255;
}

/* 메인 배경 및 레이아웃 */
main {
	min-height: 100vh;
	display: grid;
	grid-template-rows: auto 1fr;
	gap: 16px;
	background: linear-gradient(135deg, rgba(var(--bg-grad-a), 1) 0%, rgba(var(--bg-grad-b), 1) 70%);
	padding-top: 56px;
	padding-bottom: 56px;
}

/* 상단 입력 영역: 키오스크 느낌으로 크기 확대 */
main > .flex {
	background: rgba(255, 255, 255, 0.6);
	box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
	border: 1px solid rgba(255, 255, 255, 0.7);
	backdrop-filter: blur(10px);
	border-radius: 20px;
	padding: 14px;
}

/* 입력창 */
input[placeholder] {
	height: 56px;
	font-size: 18px;
	line-height: 1.4;
	color: rgb(var(--ink));
	border-radius: 14px;
	border: 1px solid rgba(0, 0, 0, 0.06);
	background: #fff;
	padding: 0 16px;
	transition: box-shadow 0.2s ease, border-color 0.2s ease, transform 0.06s ease;
}
input[placeholder]::placeholder {
	color: #cbd5e1;
}
input[placeholder]:focus {
	outline: none;
	border-color: rgba(var(--primary), 0.45);
	box-shadow: 0 0 0 3px rgba(var(--primary), 0.15);
}

/* 공통 버튼 베이스 */
button {
	height: 56px;
	padding: 0 18px;
	font-weight: 600;
	border-radius: 14px;
	border: 1px solid rgba(0, 0, 0, 0.06);
	background: #fff;
	color: rgb(var(--ink));
	transition: transform 0.06s ease, box-shadow 0.2s ease, background 0.2s ease, color 0.2s ease,
		border-color 0.2s ease;
}
button:hover {
	box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
}
button:active {
	transform: translateY(1px);
}
button:disabled {
	opacity: 0.55;
	cursor: not-allowed;
	box-shadow: none;
}

/* 추천 버튼 강조 */
button.bg-blue-600,
button[class*='bg-blue-600'] {
	background: linear-gradient(180deg, rgba(var(--primary-600), 1) 0%, rgba(var(--primary-700), 1) 100%);
	color: #fff;
	border: none;
	box-shadow: 0 10px 20px rgba(var(--primary-600), 0.25);
}
button.bg-blue-600:hover,
button[class*='bg-blue-600']:hover {
	box-shadow: 0 14px 28px rgba(var(--primary-600), 0.3);
}

/* 보조 버튼 */
button.border {
	background: #fff;
	color: rgb(var(--ink));
}

/* 토글 체크 레이블 */
label.select-none {
	user-select: none;
	color: rgb(var(--sub));
}

/* STT 상태 텍스트 */
p.text-sm.text-gray-500 {
	color: rgba(var(--ink), 0.6);
}

/* 오류 문구 */
p.text-red-600 {
	color: #dc2626;
}

/* 안내/응답 문구 */
p.text-gray-800 {
	color: rgb(var(--ink));
	font-size: 18px;
}

/* 카드 그리드 */
.grid {
	margin-top: 12px;
}

/* 추천 카드: 글래스 + 엘리베이션 */
article.rounded-xl {
	border-radius: 18px;
	border: 1px solid rgba(0, 0, 0, 0.06);
	background: rgba(var(--card), 0.9);
	backdrop-filter: blur(10px);
	box-shadow: 0 10px 24px rgba(0, 0, 0, 0.07);
	transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
	padding: 10px 20px;
}
article.rounded-xl:hover {
	transform: translateY(-3px);
	box-shadow: 0 16px 32px rgba(0, 0, 0, 0.1);
	border-color: rgba(0, 0, 0, 0.08);
}

/* 카드 내부 타이포 */
article h3 {
	font-size: 18px;
	color: rgb(var(--ink));
}
article p {
	color: rgb(75, 85, 99);
}
article strong {
	font-weight: 800;
	letter-spacing: -0.01em;
}

/* 뱃지 */
article .bg-emerald-100 {
	background: #ecfdf5;
	color: #047857;
	border: 1px solid rgba(4, 120, 87, 0.15);
}

/* 마이크 버튼 파동: title로 버튼을 식별하고 STT on 상태는 기존 클래스(bg-red-600)로 감지 */
button[title='마이크로 질문 말하기'] {
	position: relative;
	overflow: visible;
}
button[title='마이크로 질문 말하기'].bg-red-600 {
	background: radial-gradient(
			120px 120px at center,
			rgba(239, 68, 68, 0.18) 0%,
			rgba(239, 68, 68, 0.06) 60%,
			transparent 70%
		),
		#ef4444;
	color: #fff;
	border: none;
	box-shadow: 0 10px 24px rgba(239, 68, 68, 0.25);
}
button[title='마이크로 질문 말하기'].bg-red-600::before,
button[title='마이크로 질문 말하기'].bg-red-600::after {
	content: '';
	position: absolute;
	inset: -8px;
	border-radius: 9999px;
	border: 2px solid rgba(239, 68, 68, 0.35);
	animation: micPulse 1.8s ease-out infinite;
	pointer-events: none;
}
button[title='마이크로 질문 말하기'].bg-red-600::after {
	inset: -16px;
	animation-delay: 0.6s;
	opacity: 0.75;
}

/* 파동 애니메이션 */
@keyframes micPulse {
	0% {
		transform: scale(0.8);
		opacity: 0.9;
	}
	60% {
		transform: scale(1.3);
		opacity: 0;
	}
	100% {
		transform: scale(0.8);
		opacity: 0;
	}
}

/* 상단 바의 버튼 간격 보정 */
main > .flex button + button {
	margin-left: 8px;
}

/* 반응형 보완 */
@media (max-width: 768px) {
	main {
		padding-top: 32px;
		padding-bottom: 40px;
	}
	input[placeholder] {
		height: 52px;
		font-size: 16px;
	}
	button {
		height: 52px;
	}
	article h3 {
		font-size: 17px;
	}
}

/* 포커스 가시성 향상 */
button:focus-visible,
input[placeholder]:focus-visible {
	outline: none;
	box-shadow: 0 0 0 3px rgba(var(--primary), 0.25);
}

/* 미세 인터랙션 */
button:hover:not(:disabled) .icon-shift {
	transform: translateX(2px);
}
main {
	min-height: 100vh;
	display: flex; /* flex 레이아웃으로 변경 */
	flex-direction: column;
	justify-content: flex-start; /* 입력창은 위 */
	align-items: center; /* 중앙 정렬 */
	gap: 24px;
	background: linear-gradient(135deg, rgba(var(--bg-grad-a), 1) 0%, rgba(var(--bg-grad-b), 1) 70%);
	padding: 56px 24px;
}
/* 아이템 개수에 따라 열 수를 1~4로 고정 (최대 4열) */
main .grid {
	display: grid;
	gap: 1.5rem;
	justify-content: center; /* 좌우 중앙 정렬 */
	grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
	max-width: 1200px;
	width: 100%;
}

/* 4개 이상이면 4열 */
main .grid:has(> article:nth-child(4)) {
	grid-template-columns: repeat(4, 1fr) !important;
}

/* 정확히 3개 이상이면 3열(4열 규칙에 덮이지 않을 때) */
main .grid:has(> article:nth-child(3)):not(:has(> article:nth-child(4))) {
	grid-template-columns: repeat(3, 1fr) !important;
}

/* 정확히 2개 이상이면 2열(3·4열 규칙에 덮이지 않을 때) */
main .grid:has(> article:nth-child(2)):not(:has(> article:nth-child(3))) {
	grid-template-columns: repeat(2, 1fr) !important;
}
article.rounded-xl {
	height: auto;
}
article.rounded-xl {
	will-change: transform;
}
/* 1개면 1열(기본값) */
</style>
