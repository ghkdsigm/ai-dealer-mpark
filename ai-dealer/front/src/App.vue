<template>
	<main class="min-h-screen bg-gray-50 p-6 max-w-5xl mx-auto">
	  <div class="flex flex-wrap items-center gap-2 mb-4">
		<input
		  v-model="q"
		  placeholder="예) SUV 좋아요 / 2천만 원대 생각 / 연식은 16~19년"
		  class="border rounded px-3 py-2 flex-1 min-w-[280px]"
		  @keydown.enter="sendChat"
		/>
		<button
		  @click="sendChat"
		  class="px-4 py-2 rounded bg-blue-600 text-white"
		  :disabled="loading"
		>
		  {{ loading ? '보내는 중…' : '보내기' }}
		</button>
		<button
		  @click="runRecommend"
		  class="px-4 py-2 rounded border"
		  :disabled="loading"
		  title="현재까지 수집된 조건으로 최종 추천 실행"
		>
		  추천 실행
		</button>
		<button
		  @click="resetSess"
		  class="px-4 py-2 rounded border"
		  :disabled="loading"
		  title="세션 초기화"
		>
		  초기화
		</button>
	  </div>
  
	  <p v-if="error" class="text-red-600 text-sm mb-2">오류: {{ error }}</p>
	  <p v-if="reply" class="text-gray-800 mb-4 whitespace-pre-line">{{ reply }}</p>
  
	  <!-- 최종 추천에서만 카드 렌더 -->
	  <div v-if="route === 'final_recommend'" class="grid md:grid-cols-2 gap-4">
		<article
		  v-for="v in items"
		  :key="v.id || v.carNo"
		  class="rounded-xl border bg-white shadow p-4"
		>
		  <div class="flex items-start justify-between gap-2">
			<h3 class="font-semibold">{{ v.year ?? '연식미상' }} {{ v.brand || '' }} {{ v.carName || '' }}</h3>
			<span v-if="v.noAccident" class="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
			  무사고
			</span>
		  </div>
  
		  <p class="text-sm text-gray-600">
			{{ bodyTypeLabel(v.bodyType) }}
			<span v-if="v.fuelType"> · {{ fuelLabel(v.fuelType) }}</span>
			<span v-if="v.colorName"> · {{ v.colorName }}</span>
		  </p>
  
		  <p class="mt-1 text-sm">주행 <strong>{{ nf(kmOf(v)) }}</strong> km</p>
		  
		  <div v-if="v.options && v.options.length > 0" class="mt-2">
			<p class="text-xs text-gray-500">옵션: {{ v.options.slice(0, 3).join(', ') }}{{ v.options.length > 3 ? '...' : '' }}</p>
		  </div>
  
		  <div class="mt-2 flex items-baseline gap-2">
			<p class="font-bold text-lg">
			  <span v-if="isNum(v.priceKman)">{{ nf(v.priceKman) }} 만원</span>
			  <span v-else class="text-gray-400">가격문의</span>
			</p>
			<span v-if="isNum(v.monthlyKman)" class="text-sm text-gray-500">
			  (월 {{ nf(v.monthlyKman) }}만원)
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
	  // 대화 단계에서는 리스트를 절대 표시하지 않음
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
	  // 추천 후에는 입력을 남겨두어도 좋음
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
  /* 최소 스타일은 tailwind로 충분. 필요시 커스텀 추가 */
  </style>
  