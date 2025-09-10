<template>
	<main class="min-h-screen bg-gradient-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-950 p-6 md:p-8 max-w-5xl mx-auto">
	  <div class="sticky top-0 z-10 -mx-6 md:-mx-8 px-6 md:px-8 py-4 mb-4 bg-gradient-to-b from-gray-50/90 to-white/60 dark:from-gray-900/70 dark:to-gray-950/40 backdrop-blur supports-[backdrop-filter]:backdrop-blur">
		<div class="flex flex-wrap items-center gap-2">
		  <input
			v-model="q"
			placeholder="예) SUV 좋아요 / 2천만 원대 생각 / 연식은 16~19년"
			class="peer input-base flex-1 min-w-[280px]"
			@keydown.enter="sendChat"
		  />
		  <button
			@click="sendChat"
			class="btn-primary"
			:disabled="loading"
		  >
			{{ loading ? '보내는 중…' : '보내기' }}
		  </button>
		  <button
			@click="runRecommend"
			class="btn-ghost"
			:disabled="loading"
			title="현재까지 수집된 조건으로 최종 추천 실행"
		  >
			추천 실행
		  </button>
		  <button
			@click="resetSess"
			class="btn-ghost"
			:disabled="loading"
			title="세션 초기화"
		  >
			초기화
		  </button>
		</div>
		<div class="mt-2 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
		  <span class="inline-flex items-center gap-1">
			<span class="dot dot-blue"></span> 엔터로 전송
		  </span>
		  <span class="inline-flex items-center gap-1">
			<span class="dot dot-emerald"></span> 추천 실행은 조건 확정 후
		  </span>
		</div>
	  </div>
  
	  <p v-if="error" class="alert-error">{{ error }}</p>
	  <p v-if="reply" class="prose-base">{{ reply }}</p>
  
	  <!-- 최종 추천에서만 카드 렌더 -->
	  <div v-if="route === 'final_recommend'" class="grid gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-2 mt-4">
		<article
		  v-for="v in items"
		  :key="v.id || v.carNo"
		  class="card group"
		>
		  <div class="flex items-start justify-between gap-2">
			<h3 class="title-3">
			  {{ v.year ?? '연식미상' }}
			  <span class="opacity-80">{{ v.brand || '' }}</span>
			  <span class="opacity-90 font-semibold">{{ v.carName || '' }}</span>
			</h3>
			<span
			  v-if="v.noAccident"
			  class="badge badge-emerald"
			>
			  무사고
			</span>
		  </div>
  
		  <p class="meta">
			{{ bodyTypeLabel(v.bodyType) }}
			<span v-if="v.fuelType"> · {{ fuelLabel(v.fuelType) }}</span>
			<span v-if="v.colorName"> · {{ v.colorName }}</span>
		  </p>
  
		  <p class="mt-1 text-sm text-gray-700 dark:text-gray-300">
			주행 <strong class="tabular-nums">{{ nf(kmOf(v)) }}</strong> km
		  </p>
  
		  <div v-if="v.options && v.options.length > 0" class="mt-2">
			<p class="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
			  옵션: {{ v.options.slice(0, 3).join(', ') }}{{ v.options.length > 3 ? '...' : '' }}
			</p>
		  </div>
  
		  <div class="mt-3 flex items-baseline gap-2">
			<p class="price">
			  <span v-if="isNum(v.priceKman)" class="tabular-nums">{{ nf(v.priceKman) }} 만원</span>
			  <span v-else class="text-gray-400 dark:text-gray-500 font-medium">가격문의</span>
			</p>
			<span v-if="isNum(v.monthlyKman)" class="text-sm text-gray-500 dark:text-gray-400">
			  (월 <span class="tabular-nums">{{ nf(v.monthlyKman) }}</span>만원)
			</span>
		  </div>
		</article>
	  </div>
	</main>
  </template>
  
  <script setup>
  import { ref } from 'vue'
  
  const q = ref('')
  const loading = ref(false)
  const reply = ref('')
  const error = ref('')
  const items = ref([])
  const route = ref('') // 서버가 내려주는 route 기준으로 표시 제어
  
  function nf(n){ try{ return Number(n).toLocaleString('ko-KR') }catch{ return String(n) } }
  function isNum(n){ return typeof n === 'number' && Number.isFinite(n) }
  function kmOf(v){ const n = v?.km; return isNum(n) ? n : Number(n)||0 }
  function fuelLabel(code){ return ({ gasoline:'가솔린', diesel:'디젤', hybrid:'하이브리드', ev:'전기', lpg:'LPG' })[code] || code }
  function bodyTypeLabel(code){ return ({ suv:'SUV', sedan:'세단', hatch:'해치백', cuv:'CUV', truck:'트럭', van:'승합' })[code] || (code || '차종미상') }
  
  async function sendChat(){
	if (!q.value || !q.value.trim()) return
	loading.value = true; error.value = ''; items.value = []; reply.value = ''; route.value = ''
	try{
	  const r = await fetch('/api/chat', {
		method:'POST',
		headers:{'Content-Type':'application/json'},
		body: JSON.stringify({ message: q.value.trim() })
	  })
	  if(!r.ok) throw new Error(`HTTP ${r.status}`)
	  const data = await r.json()
	  reply.value = data.reply || ''
	  route.value = data.route || ''
	  items.value = route.value === 'final_recommend' ? (data.items||[]) : []
	  q.value = ''
	}catch(e){
	  error.value = String(e.message || e)
	}finally{
	  loading.value = false
	}
  }
  
  async function runRecommend(){
	loading.value = true; error.value=''; items.value=[]; route.value=''
	try{
	  const r = await fetch('/api/recommend', {
		method:'POST',
		headers:{'Content-Type':'application/json'},
		body: JSON.stringify({ q: q.value.trim(), limit: 100 })
	  })
	  if(!r.ok) throw new Error(`HTTP ${r.status}`)
	  const data = await r.json()
	  reply.value = data.reply || ''
	  route.value = data.route || ''
	  items.value = Array.isArray(data.items) ? data.items : []
	}catch(e){
	  error.value = String(e.message || e)
	}finally{
	  loading.value = false
	}
  }
  
  async function resetSess(){
	loading.value = true; error.value=''; items.value=[]; reply.value=''; route.value=''
	try{
	  await fetch('/api/reset', { method:'POST' })
	  reply.value = '대화 세션을 초기화했습니다. 예산/차종 중 하나를 알려주세요.'
	}catch(e){
	  error.value = String(e.message || e)
	}finally{
	  loading.value = false
	}
  }
  </script>
  
  <style scoped>
  /* Inputs */
  .input-base {
	@apply border rounded-xl px-4 py-2.5 bg-white/90 dark:bg-gray-900/70 border-gray-200 dark:border-gray-700
		   shadow-sm placeholder:text-gray-400 dark:placeholder:text-gray-500
		   focus:outline-none focus:ring-4 focus:ring-blue-100 dark:focus:ring-blue-900/40
		   focus:border-blue-400 dark:focus:border-blue-500 transition;
  }
  
  /* Buttons */
  .btn-primary {
	@apply px-4 py-2 rounded-xl bg-blue-600 text-white font-medium shadow-sm
		   hover:bg-blue-700 active:bg-blue-800
		   disabled:opacity-50 disabled:cursor-not-allowed
		   focus:outline-none focus:ring-4 focus:ring-blue-200 dark:focus:ring-blue-900/50 transition;
  }
  
  .btn-ghost {
	@apply px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/50
		   text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800
		   active:bg-gray-100 dark:active:bg-gray-700
		   disabled:opacity-50 disabled:cursor-not-allowed
		   focus:outline-none focus:ring-4 focus:ring-gray-200 dark:focus:ring-gray-800 transition;
  }
  
  /* Cards */
  .card {
	@apply rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60
		   shadow-sm p-4 md:p-5
		   hover:shadow-md hover:-translate-y-0.5
		   transition will-change-transform;
  }
  .title-3 {
	@apply font-semibold text-gray-900 dark:text-gray-100 leading-tight;
  }
  .meta {
	@apply text-sm text-gray-600 dark:text-gray-400;
  }
  .badge {
	@apply text-xs px-2 py-0.5 rounded-full font-medium border;
  }
  .badge-emerald {
	@apply bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-900/30;
  }
  .price {
	@apply font-bold text-lg text-gray-900 dark:text-gray-100 tracking-tight;
  }
  
  /* Helper UI */
  .alert-error {
	@apply text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/30
		   text-sm px-3 py-2 rounded-lg mb-2;
  }
  .prose-base {
	@apply text-gray-800 dark:text-gray-200 mb-4 whitespace-pre-line leading-relaxed;
  }
  .dot {
	@apply inline-block align-middle w-2 h-2 rounded-full;
  }
  .dot-blue { @apply bg-blue-500; }
  .dot-emerald { @apply bg-emerald-500; }
  
  /* Typography niceties */
  .tabular-nums {
	font-variant-numeric: tabular-nums;
  }
  
  /* Line clamp utility (for options) */
  .line-clamp-1 {
	display: -webkit-box;
	-webkit-line-clamp: 1;
	-webkit-box-orient: vertical;
	overflow: hidden;
  }
  
  /* Smooth scrolling for sticky header context */
  :host, :root {
	scroll-behavior: smooth;
  }
  
  /* Optional: improve focus visible when using keyboard */
  :focus-visible {
	outline: none;
	box-shadow: 0 0 0 3px rgba(59,130,246,0.35);
	border-radius: 12px;
  }
  </style>
  