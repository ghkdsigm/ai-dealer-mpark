<template>
	<main class="min-h-screen bg-neutral-50 dark:bg-neutral-950">
		<!-- 검색 영역 컨테이너 -->
		<div class="sticky top-0 z-10 backdrop-blur">
			<div class="mx-auto max-w-6xl px-4 sm:px-6 py-4">
				<div class="search-shell">
					<div class="search-row">
						<input
							v-model="q"
							class="search-input"
							placeholder="예) SUV 좋아요 / 2천만 원대 생각 / 연식은 16~19년"
							@keydown.enter="sendChat"
						/>
						<div class="search-actions mb-4">
							<button
								class="btn-primary"
								:disabled="loading"
								@click="sendChat"
							>
								{{ loading ? '보내는 중…' : '보내기' }}
							</button>
							<button
								class="btn-ghost"
								:disabled="loading"
								@click="runRecommend"
								title="현재 조건으로 최종 추천"
							>
								추천 실행
							</button>
							<button
								class="btn-ghost"
								:disabled="loading"
								@click="resetSess"
								title="세션 초기화"
							>
								초기화
							</button>
						</div>
					</div>
					<div
						class="search-hint"
						v-if="!hasAnyOutput"
					>
						<span class="hint-dot hint-blue"></span> 엔터로 전송
						<span class="mx-3 opacity-40">|</span>
						<span class="hint-dot hint-emerald"></span> 조건 확정 후 추천 실행
					</div>
				</div>
			</div>
		</div>

		<!-- 본문 -->
		<section
			class="mx-auto max-w-6xl px-4 sm:px-6 my-6"
			style="display: block; margin-top: 30px"
		>
			<div
				v-if="error"
				class="alert-error"
			>
				{{ error }}
			</div>

			<!-- 조언/설명 영역: 확정 HTML + 라이브 꼬리 -->
			<div
				v-if="hasAnyOutput"
				class="panel prose-like mt-4 pt-4"
			>
				<div v-html="formattedHTML"></div>
				<pre
					ref="liveEl"
					class="live-tail"
				></pre>
			</div>

			<!-- 결과 카드 그리드: 최대 5열 -->
			<div
				v-if="route === 'final_recommend'"
				class="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
			>
				<article
					v-for="v in items"
					:key="v.id || v.carNo"
					class="card group"
				>
					<div class="flex items-start justify-between gap-2">
						<h3 class="title-3">
							{{ v.year ?? '연식미상' }}
							<span class="opacity-70">{{ v.brand }}</span>
							<span class="font-semibold">{{ v.carName }}</span>
						</h3>
						<span
							v-if="v.noAccident"
							class="badge badge-emerald"
							>무사고</span
						>
					</div>

					<p class="meta">
						{{ bodyTypeLabel(v.bodyType) }}
						<span v-if="v.fuelType"> · {{ fuelLabel(v.fuelType) }}</span>
						<span v-if="v.colorName"> · {{ v.colorName }}</span>
					</p>

					<p class="mt-1 text-sm">
						주행 <strong class="tabular-nums">{{ nf(kmOf(v)) }}</strong> km
					</p>

					<p
						v-if="v.options && v.options.length > 0"
						class="mt-2 text-xs text-neutral-500 dark:text-neutral-400 line-clamp-1"
					>
						옵션: {{ v.options.slice(0, 3).join(', ') }}{{ v.options.length > 3 ? '...' : '' }}
					</p>

					<div class="mt-3 flex items-baseline gap-2">
						<p class="price">
							<span v-if="isNum(v.priceKman)">{{ nf(v.priceKman) }} 만원</span>
							<span
								v-else
								class="text-neutral-400 dark:text-neutral-500"
								>가격문의</span
							>
						</p>
						<span
							v-if="isNum(v.monthlyKman)"
							class="text-sm text-neutral-500 dark:text-neutral-400"
						>
							(월 {{ nf(v.monthlyKman) }}만원)
						</span>
					</div>
				</article>
			</div>
		</section>
	</main>
</template>

<script setup>
// NOTE: 코드 주석에 이모티콘은 사용하지 않음
import { ref, computed, onBeforeUnmount } from 'vue'

const q = ref('')
const loading = ref(false)
const error = ref('')

const items = ref([])
const route = ref('')

// 스트리밍 출력 버퍼
const rawBuffer = ref('') // 서버에서 받은 전체 원본 텍스트
const consumedIdx = ref(0) // 포맷 완료되어 formattedHTML로 옮긴 마지막 인덱스
const formattedHTML = ref('') // 확정된 HTML 누적
const liveEl = ref(null) // 아직 확정 안 된 꼬리 텍스트를 즉시 표시할 요소
let flushTimer = null

const hasAnyOutput = computed(() => {
	return formattedHTML.value.length > 0 || rawBuffer.value.length > 0
})

function nf(n) {
	try {
		return Number(n).toLocaleString('ko-KR')
	} catch {
		return String(n)
	}
}
function isNum(n) {
	return typeof n === 'number' && Number.isFinite(n)
}
function kmOf(v) {
	const n = v?.km
	return isNum(n) ? n : Number(n) || 0
}
function fuelLabel(code) {
	return { gasoline: '가솔린', diesel: '디젤', hybrid: '하이브리드', ev: '전기', lpg: 'LPG' }[code] || code
}
function bodyTypeLabel(code) {
	return (
		{ suv: 'SUV', sedan: '세단', hatch: '해치백', cuv: 'CUV', truck: '트럭', van: '승합' }[code] ||
		code ||
		'차종미상'
	)
}

// 백엔드가 <JSON> 이후를 차단하더라도 혹시 남은 조각이 섞였을 수 있어 최소 정리
function cleanupVisibleText(s) {
	s = s.split('<JSON>')[0]
	s = s.replace(/```[\s\S]*?```/g, '')
	return s
}

function escapeHTML(s) {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// 라인을 블록으로 변환해 HTML 조각 생성
function linesToHTML(lines) {
	const blocks = []
	let list = null
	const pushP = t => {
		if (list) {
			blocks.push(list)
			list = null
		}
		if (t) blocks.push({ t: 'p', v: t })
	}
	const pushL = (t, o) => {
		if (!list || list.o !== o) {
			if (list) blocks.push(list)
			list = { t: 'l', o, items: [] }
		}
		list.items.push(t)
	}

	for (let line of lines) {
		const l = line.trim()
		if (!l) continue
		if (/^[-•·]\s+/.test(l)) {
			pushL(l.replace(/^[-•·]\s+/, ''), false)
			continue
		}
		if (/^\d+[.)]\s+/.test(l)) {
			pushL(l.replace(/^\d+[.)]\s+/, ''), true)
			continue
		}
		pushP(l)
	}
	if (list) blocks.push(list)

	let html = ''
	for (const b of blocks) {
		if (b.t === 'p') html += `<p>${escapeHTML(b.v)}</p>`
		else {
			const tag = b.o ? 'ol' : 'ul'
			html += `<${tag}>${b.items.map(i => `<li>${escapeHTML(i)}</li>`).join('')}</${tag}>`
		}
	}
	return html
}

// 디바운스 스케줄링
function scheduleFlush() {
	if (flushTimer) return
	flushTimer = setTimeout(() => {
		flushTimer = null
		flush()
	}, 140)
}

// 라이브 꼬리에 즉시 텍스트 추가
function appendToLive(text) {
	if (!liveEl.value) return
	liveEl.value.appendChild(document.createTextNode(text))
}

// 점진 플러시: 안전 경계까지 formattedHTML로 이동
function flush() {
	const tail = cleanupVisibleText(rawBuffer.value.slice(consumedIdx.value))
	if (!tail) return

	// 안전 경계: 마침표(숫자 소수점 제외), !, ?, 줄바꿈
	const re = /(?<!\d)\.(?!\d)|[!?]|\n/g
	let m,
		lastSafe = -1
	while ((m = re.exec(tail))) lastSafe = m.index + m[0].length
	if (lastSafe <= 0) return

	const safeChunk = tail.slice(0, lastSafe)
	const lines = safeChunk
		.replace(/(?<!\d)\.(?!\d)\s+/g, '.\n')
		.replace(/([!?])\s+/g, '$1\n')
		.split('\n')

	formattedHTML.value += linesToHTML(lines)

	const remaining = tail.slice(lastSafe)
	if (liveEl.value) liveEl.value.textContent = remaining

	consumedIdx.value += safeChunk.length
}

async function sendChat() {
	if (!q.value.trim()) return
	loading.value = true
	error.value = ''

	// 스트림 출력 초기화
	rawBuffer.value = ''
	consumedIdx.value = 0
	formattedHTML.value = ''
	if (liveEl.value) liveEl.value.textContent = ''
	items.value = []
	route.value = ''

	try {
		const r = await fetch('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ message: q.value.trim() }),
		})
		if (!r.ok) throw new Error(`HTTP ${r.status}`)

		const reader = r.body.getReader()
		const decoder = new TextDecoder()

		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			const chunk = decoder.decode(value, { stream: true })
			rawBuffer.value += chunk
			appendToLive(chunk)
			scheduleFlush()
		}

		// 종료 시 남은 꼬리까지 정리
		const tail = cleanupVisibleText(rawBuffer.value.slice(consumedIdx.value))
		if (tail) {
			const lines = tail
				.replace(/(?<!\d)\.(?!\d)\s+/g, '.\n')
				.replace(/([!?])\s+/g, '$1\n')
				.split('\n')
			formattedHTML.value += linesToHTML(lines)
			if (liveEl.value) liveEl.value.textContent = ''
			consumedIdx.value = rawBuffer.value.length
		}

		q.value = ''
	} catch (e) {
		error.value = String(e.message || e)
	} finally {
		loading.value = false
		if (flushTimer) {
			clearTimeout(flushTimer)
			flushTimer = null
		}
	}
}

async function runRecommend() {
	loading.value = true
	error.value = ''
	items.value = []
	route.value = ''
	try {
		const r = await fetch('/api/recommend', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ q: q.value.trim(), limit: 100 }),
		})
		if (!r.ok) throw new Error(`HTTP ${r.status}`)
		const data = await r.json()
		// 추천 응답은 스트리밍이 아니므로 그대로 출력
		formattedHTML.value = `<p>${escapeHTML(data.reply || '')}</p>`
		if (liveEl.value) liveEl.value.textContent = ''
		items.value = Array.isArray(data.items) ? data.items : []
		route.value = data.route || ''
	} catch (e) {
		error.value = String(e.message || e)
	} finally {
		loading.value = false
	}
}

async function resetSess() {
	loading.value = true
	error.value = ''
	items.value = []
	route.value = ''
	try {
		await fetch('/api/reset', { method: 'POST' })
		formattedHTML.value = `<p>대화 세션을 초기화했습니다. 예산/차종 중 하나를 알려주세요.</p>`
		if (liveEl.value) liveEl.value.textContent = ''
		rawBuffer.value = ''
		consumedIdx.value = 0
	} catch (e) {
		error.value = String(e.message || e)
	} finally {
		loading.value = false
	}
}

onBeforeUnmount(() => {
	if (flushTimer) {
		clearTimeout(flushTimer)
		flushTimer = null
	}
})
</script>

<style scoped>
/* Search shell */
.search-shell {
	@apply rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/70 shadow-sm p-3 sm:p-4;
}
.search-row {
	@apply flex flex-col gap-3 sm:flex-row sm:items-center;
}
.search-input {
	margin-bottom: 10px;
	padding: 5px 10px;
	border-radius: 10px;
	@apply flex-1 h-11 px-4 rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800
         placeholder:text-neutral-400 dark:placeholder:text-neutral-500
         focus:outline-none focus:ring-4 focus:ring-blue-100 dark:focus:ring-blue-900/40;
}
.search-actions {
	@apply flex gap-2 shrink-0;
}
.search-hint {
	@apply mt-2 text-xs text-neutral-500 dark:text-neutral-400 flex items-center;
}
.hint-dot {
	@apply inline-block align-middle w-2 h-2 rounded-full mr-1;
}
.hint-blue {
	@apply bg-blue-500;
}
.hint-emerald {
	@apply bg-emerald-500;
}

/* Panels */
.panel {
	@apply rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 sm:p-5 mb-6 shadow-sm;
}

/* Buttons */
.btn-primary {
	@apply h-11 px-4 rounded-xl bg-blue-600 text-white font-medium shadow-sm
         hover:bg-blue-700 active:bg-blue-800
         disabled:opacity-50 disabled:cursor-not-allowed
         focus:outline-none focus:ring-4 focus:ring-blue-200 dark:focus:ring-blue-900/40;
}
.btn-ghost {
	@apply h-11 px-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/70
         text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800
         disabled:opacity-50 disabled:cursor-not-allowed
         focus:outline-none focus:ring-4 focus:ring-neutral-200 dark:focus:ring-neutral-800;
}

/* Cards */
.card {
	@apply rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 shadow-sm
         hover:-translate-y-0.5 transition will-change-transform;
}
.title-3 {
	@apply font-semibold text-neutral-900 dark:text-neutral-100 leading-tight;
}
.meta {
	@apply text-sm text-neutral-600 dark:text-neutral-400;
}
.badge {
	@apply text-xs px-2 py-0.5 rounded-full font-medium border;
}
.badge-emerald {
	@apply bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-900/30;
}
.price {
	@apply font-bold text-lg text-neutral-900 dark:text-neutral-100 tracking-tight;
}

/* Helpers */
.alert-error {
	@apply text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/30
         text-sm px-3 py-2 rounded-lg mb-4;
}
.line-clamp-1 {
	display: -webkit-box;
	-webkit-line-clamp: 1;
	-webkit-box-orient: vertical;
	overflow: hidden;
}
.tabular-nums {
	font-variant-numeric: tabular-nums;
}

/* Prose and live tail */
.prose-like :is(p, ul, ol) {
	margin: 0 0 0.6rem 0;
}
.prose-like ul,
.prose-like ol {
	padding-left: 1.2rem;
}
.prose-like li {
	margin: 0.25rem 0;
}
.live-tail {
	white-space: pre-wrap;
	margin: 0;
	color: inherit;
	font-size: 14px;
	font-weight: 400;
}
</style>
