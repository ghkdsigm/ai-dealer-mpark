#!/usr/bin/env node
/*
 * merge-vehicles.js (엠파크2 맞춤형 · 랜덤 색상/옵션 채움 포함)
 *
 * 👉 목적: 아래 형태의 JSON들을 하나로 병합해 "enriched_vehicles.json" 생성
 *   - vehicles.json (API 래핑: { statusCode, responseMessage, data: [...] })
 *   - carfuel.json      (연료:   { statusCode, responseMessage, data: [{ fuelCode, fuelName }] })
 *   - carauto.json      (변속기: { statusCode, responseMessage, data: [{ autoCode, autoName }] })
 *   - carcolor.json     (색상:   { statusCode, responseMessage, data: [{ code, codeName, rgbCode }] })
 *   - caraddoption.json (옵션:   { statusCode, responseMessage, data: [{ optionCode, optionName }] })
 *   - carcode.json      (차량코드: { statusCode, responseMessage, data: { level5: [{ carCode, carName, parentCode, ... }] } })
 *
 * ✅ 특징
 * - vehicles의 값이 비어있고 보조 테이블에만 정보가 있어도 이름/코드 기준으로 매칭해서 채움
 * - fuel/gear/color/option/carcode 모두 코드와 이름 매칭 지원
 * - carOption은 코드/이름 혼합 배열·문자열 다 허용
 * - 결과에 label과 code를 함께 남김
 * - unmapped(미매핑) 항목은 warnings에 기록
 * - (테스트용) 색상/옵션이 비었을 때 랜덤으로 채워 넣기 지원
 *
 * 📦 사용법
 *   node merge-vehicles.js --out ./_out/enriched_vehicles.json --pretty
 */

// @ts-check
const fs = require('fs');
const path = require('path');

const CONFIG = {
  input: {
    vehicles: './_data/vehicles.json',
    fuels: './_data/carfuel.json',
    autos: './_data/carauto.json',
    colors: './_data/carcolor.json',
    options: './_data/caraddoption.json',
    codes: './_data/carcode.json',
  },
  output: { file: './_out/enriched_vehicles.json', pretty: false },
  unwrapKey: 'data',
  vehicles: {
    id: 'carNo',
    name: 'carName',
    fuelName: 'carGas',
    fuelCode: 'fuel',
    gearName: 'gear',
    colorName: 'color',
    colorCode: 'colorCode',
    optionField: 'carOption',
    codeField: 'code', // 차량코드 연결용
    passThrough: [
      'demoNo','demoDay','yymm','km','noAccident','shortKm','demoAmt','monthlyDemoAmt','yyyy','year','type','km','price','state','dealer','phone','park'
    ],
  },
  ref: {
    fuels: { code: 'fuelCode', name: 'fuelName' },
    autos: { code: 'autoCode', name: 'autoName' },
    colors: { code: 'code', name: 'codeName', rgb: 'rgbCode' },
    options: { code: 'optionCode', name: 'optionName' },
    codes: { code: 'carCode', name: 'carName' },
  },
  normalize: {
    fuels: { '가솔린':'가솔린','휘발유':'가솔린','gasoline':'가솔린','디젤':'디젤','경유':'디젤','diesel':'디젤','lpg':'LPG','엘피지':'LPG','전기':'전기','ev':'전기','가솔린+전기':'가솔린+전기','하이브리드':'가솔린+전기','디젤+전기':'디젤+전기','수소+전기':'수소+전기','기타':'기타' },
    autos: { '오토':'오토','자동':'오토','auto':'오토','수동':'수동','manual':'수동' },
  },
  // 테스트용 랜덤 채움 설정 (매핑 실패/비어있을 때만 동작)
  randomFill: {
    colorOnMissing: true,            // 색상 미매핑/누락 시 랜덤 1개
    optionsOnMissing: { min: 1, max: 3 }, // 옵션 미매핑/누락 시 랜덤 1~3개
    seed: null, // 숫자를 넣으면 재현 가능한 결과. null이면 매 실행마다 달라짐.
  }
};

// ---------- 유틸 ----------
function readJson(p) {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs,'utf-8')); } catch { return null; }
}
function unwrap(payload) {
  if (!payload) return [];
  if (payload.data && Array.isArray(payload.data)) return payload.data;
  if (payload.data && payload.data.level5 && Array.isArray(payload.data.level5)) return payload.data.level5;
  if (Array.isArray(payload)) return payload;
  return [];
}
function writeJson(p,data,pretty){
  fs.mkdirSync(path.dirname(p),{recursive:true});
  fs.writeFileSync(p, pretty?JSON.stringify(data,null,2):JSON.stringify(data),'utf-8');
}
const clean = (s)=>s==null?'':String(s).trim();
const toArray=(v)=>Array.isArray(v)?v:(v?String(v).split(',').map(s=>s.trim()).filter(Boolean):[]);
function makeDualMap(list, codeKey, nameKey){
  const byCode=new Map(), byName=new Map();
  for(const it of list||[]){
    const c=clean(it?.[codeKey]);
    const n=clean(it?.[nameKey]);
    if(c) byCode.set(c,it);
    if(n) byName.set(n,it);
  }
  return {byCode,byName};
}
function normName(kind,name){
  const norm=CONFIG.normalize[kind]||{};
  const k=clean(name).toLowerCase();
  for(const [from,to] of Object.entries(norm)){
    if(k===clean(from).toLowerCase()) return to;
  }
  return clean(name);
}

// 간단한 PRNG (seed 지원)
function makeRng(seed) {
  if (seed == null) {
    return Math.random;
  }
  let s = Number(seed) || 1;
  return function rnd() {
    // xorshift32
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    // 0..1
    return ((s >>> 0) / 0xFFFFFFFF);
  };
}
function pickRandom(arr, rnd) {
  if (!arr || !arr.length) return null;
  const i = Math.floor(rnd() * arr.length);
  return arr[i];
}
function pickRandomN(arr, n, rnd) {
  if (!arr || !arr.length || n <= 0) return [];
  const out = [];
  const used = new Set();
  const cnt = Math.min(n, arr.length);
  while (out.length < cnt) {
    const i = Math.floor(rnd() * arr.length);
    if (used.has(i)) continue;
    used.add(i);
    out.push(arr[i]);
  }
  return out;
}

// ---------- 머지 ----------
function mergeOne(v,maps,warnings,rnd){
  const V=CONFIG.vehicles,R=CONFIG.ref;
  const carNo=clean(v[V.id]);
  const carName=clean(v[V.name]);

  // ---- 연료
  let fuelRec=null;{
    const code=clean(v[V.fuelCode]);
    let name=normName('fuels',v[V.fuelName]);
    if(code&&maps.fuels.byCode.has(code)) fuelRec=maps.fuels.byCode.get(code);
    else if(name&&maps.fuels.byName.has(name)) fuelRec=maps.fuels.byName.get(name);
    else if(code||name) warnings.push({carNo,field:'fuel',value:code||name});
  }

  // ---- 변속기
  let autoRec=null;{
    let name=normName('autos',v[V.gearName]);
    if(name&&maps.autos.byName.has(name)) autoRec=maps.autos.byName.get(name);
    else if(name) warnings.push({carNo,field:'gear',value:name});
  }

  // ---- 색상 (코드/이름 매핑 실패 시 랜덤)
  let colorRec=null;{
    const code=clean(v[V.colorCode]);
    const name=clean(v[V.colorName]);
    if(code&&maps.colors.byCode.has(code)) colorRec=maps.colors.byCode.get(code);
    else if(name&&maps.colors.byName.has(name)) colorRec=maps.colors.byName.get(name);
    else {
      if (CONFIG.randomFill.colorOnMissing) {
        const allColors = Array.from(maps.colors.byCode.values());
        colorRec = pickRandom(allColors, rnd);
      }
      if (!colorRec && (code||name)) warnings.push({carNo,field:'color',value:code||name});
      if (!colorRec && !(code||name) && !CONFIG.randomFill.colorOnMissing) {
        // 완전 누락인데 랜덤도 끔 → 경고는 남기지 않음 (노이즈 방지)
      }
    }
  }

  // ---- 옵션 (없거나 매핑 실패 시 랜덤 1~3개)
  const rawOpts=toArray(v[V.optionField]);
  const optCodes=[],optNames=[];
  if (rawOpts.length) {
    for(const o of rawOpts){
      const s = clean(o);
      if(!s) continue;
      if(maps.options.byCode.has(s)){
        const r=maps.options.byCode.get(s);
        optCodes.push(r[R.options.code]); optNames.push(r[R.options.name]);
      }
      else if(maps.options.byName.has(s)){
        const r=maps.options.byName.get(s);
        optCodes.push(r[R.options.code]); optNames.push(r[R.options.name]);
      }
      else {
        warnings.push({carNo,field:'option',value:s});
      }
    }
  }
  if (!optCodes.length && !optNames.length && CONFIG.randomFill.optionsOnMissing) {
    const allOpts = Array.from(maps.options.byCode.values());
    if (allOpts.length) {
      const { min, max } = CONFIG.randomFill.optionsOnMissing;
      const cnt = Math.max(0, Math.min(max, Math.floor(rnd() * (max - min + 1)) + min));
      const picked = pickRandomN(allOpts, cnt, rnd);
      for (const r of picked) {
        optCodes.push(r[R.options.code]); optNames.push(r[R.options.name]);
      }
    }
  }

  // ---- 차량 코드
  let codeRec=null;{
    const code=clean(v[V.codeField]);
    if(code&&maps.codes.byCode.has(code)) codeRec=maps.codes.byCode.get(code);
    else if(code) warnings.push({carNo,field:'carCode',value:code});
  }

  // passthrough
  const passthrough={};
  for(const k of V.passThrough) if(k in v) passthrough[k]=v[k];

  // 결과
  return pruneEmpty({
    carNo,carName,
    fuel:fuelRec?{code:fuelRec[R.fuels.code],name:fuelRec[R.fuels.name]}:undefined,
    transmission:autoRec?{code:autoRec[R.autos.code],name:autoRec[R.autos.name]}:undefined,
    color:colorRec?{code:colorRec[R.colors.code],name:colorRec[R.colors.name],rgb:clean(colorRec[R.colors.rgb])}:undefined,
    options:(optCodes.length||optNames.length)?{codes:optCodes,names:optNames}:undefined,
    carCode:codeRec?{code:codeRec[R.codes.code],name:codeRec[R.codes.name],parent:codeRec.parentCode||undefined}:undefined,
    ...passthrough
  });
}

function pruneEmpty(obj){
  const out=Array.isArray(obj)?[]:{};
  for(const [k,v] of Object.entries(obj)){
    if(Array.isArray(v)){const arr=v.filter(x=>!(x==null||x===''));if(arr.length) out[k]=arr;}
    else if(v&&typeof v==='object'){const sub=pruneEmpty(v);if(Object.keys(sub).length) out[k]=sub;}
    else if(!(v==null||v==='')) out[k]=v;
  }
  return out;
}

// ---------- 메인 ----------
function main(){
  // CLI 옵션
  const argv=process.argv.slice(2);
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--out' && argv[i+1]){ CONFIG.output.file=argv[++i]; }
    else if(argv[i]==='--pretty'){ CONFIG.output.pretty=true; }
    else if(argv[i]==='--seed' && argv[i+1]){ CONFIG.randomFill.seed = Number(argv[++i]) || 1; }
  }
  const rnd = makeRng(CONFIG.randomFill.seed);

  // 데이터 로드
  const vehiclesSrc=unwrap(readJson(CONFIG.input.vehicles));
  const fuelsSrc=unwrap(readJson(CONFIG.input.fuels));
  const autosSrc=unwrap(readJson(CONFIG.input.autos));
  const colorsSrc=unwrap(readJson(CONFIG.input.colors));
  const optionsSrc=unwrap(readJson(CONFIG.input.options));
  const codesSrc=unwrap(readJson(CONFIG.input.codes));

  // 맵 구성
  const maps={
    fuels:makeDualMap(fuelsSrc,CONFIG.ref.fuels.code,CONFIG.ref.fuels.name),
    autos:makeDualMap(autosSrc,CONFIG.ref.autos.code,CONFIG.ref.autos.name),
    colors:makeDualMap(colorsSrc,CONFIG.ref.colors.code,CONFIG.ref.colors.name),
    options:makeDualMap(optionsSrc,CONFIG.ref.options.code,CONFIG.ref.options.name),
    codes:makeDualMap(codesSrc,CONFIG.ref.codes.code,CONFIG.ref.codes.name),
  };

  const warnings=[];
  const data=vehiclesSrc.map(v=>mergeOne(v,maps,warnings,rnd));
  const result={meta:{count:data.length,generatedAt:new Date().toISOString()},data,warnings};

  writeJson(CONFIG.output.file,result,CONFIG.output.pretty);
  console.log(`[OK] Enriched vehicles → ${CONFIG.output.file}`);
  if(warnings.length){
    console.log(`[WARN] ${warnings.length} unmapped entries`);
    try { console.table(warnings.slice(0,15)); } catch {}
  }
}

if(require.main===module) main();
