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
			<button
				@click="ask"
				class="px-4 py-2 rounded bg-blue-600 text-white"
				:disabled="loading"
			>
				{{ loading ? '추천 중…' : '추천' }}
			</button>

			<!-- 🎤 STT 버튼 -->
			<button
				:disabled="!isSttSupported"
				@click="toggleSTT"
				class="px-3 py-2 rounded border"
				:class="recognizing ? 'bg-red-600 text-white' : 'bg-white'"
				title="마이크로 질문 말하기"
			>
				{{ isSttSupported ? (recognizing ? '🎤 듣는 중(끄기)' : '🎤 말하기') : '🎤 미지원' }}
			</button>
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
						>무사고</span
					>
				</div>

				<p class="text-sm text-gray-600">
					{{ bodyTypeLabel(v.bodyType) }}
					<span v-if="v.fuelType"> · {{ fuelLabel(v.fuelType) }}</span>
					<span v-if="v.yymm"> · {{ v.yymm }}</span>
				</p>

				<p class="mt-1 text-sm">
					주행
					<strong>{{ formatNumber(v.mileage) }}</strong> km
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

/** 상태 */
const q = ref('')
const items = ref([])
const reply = ref('')
const loading = ref(false)
const error = ref('')

/** 서버 호출 (/api/chat) */
async function ask() {
	loading.value = true
	error.value = ''
	reply.value = ''
	items.value = []
	try {
		const r = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message: q.value }),
		})
		if (!r.ok) throw new Error(`HTTP ${r.status}`)
		const data = await r.json()
		reply.value = data.reply || ''
		items.value = data.items || []
		if (reply.value) speak(reply.value) // 🔊 TTS
	} catch (e) {
		console.error(e)
		error.value = String(e.message ?? e)
	} finally {
		loading.value = false
	}
}

/** 표시용 헬퍼 */
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
	// backend: gasoline | diesel | hybrid | ev | lpg
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

/** 🔊 TTS */
function speak(text) {
	if (!text) return
	try {
		const u = new SpeechSynthesisUtterance(text)
		u.lang = 'ko-KR'
		u.rate = 1
		u.pitch = 1
		speechSynthesis.cancel()
		speechSynthesis.speak(u)
	} catch (err) {
		console.warn('TTS 오류:', err)
	}
}

/** 🎤 STT(Web Speech API) */
const isSttSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
const recognizing = ref(false)
const interim = ref('')
let recognition = null
let silenceTimer = null

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
		resetSilenceTimer()
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
			q.value = finalText
			resetSilenceTimer()
			ask() // 최종 문장 들어오면 자동 추천
		}
		interim.value = interimText
	}

	recognition.onerror = e => {
		console.warn('STT error:', e.error)
		stopSTT()
	}

	recognition.onend = () => {
		recognizing.value = false
		clearSilenceTimer()
	}
}

function startSTT() {
	if (!recognition) initSTT()
	if (!recognition || recognizing.value) return
	try {
		recognition.start()
	} catch (e) {
		console.warn(e)
	}
}
function stopSTT() {
	try {
		recognition && recognition.stop()
	} catch {}
	recognizing.value = false
	clearSilenceTimer()
}
function toggleSTT() {
	recognizing.value ? stopSTT() : startSTT()
}

/** 무음 자동 종료(3초) */
function resetSilenceTimer() {
	clearSilenceTimer()
	silenceTimer = setTimeout(() => stopSTT(), 3000)
}
function clearSilenceTimer() {
	if (silenceTimer) {
		clearTimeout(silenceTimer)
		silenceTimer = null
	}
}

onMounted(() => {
	if (isSttSupported) initSTT()
})
onBeforeUnmount(() => {
	stopSTT()
})
</script>
