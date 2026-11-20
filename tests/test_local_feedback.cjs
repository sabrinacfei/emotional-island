const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('../EmotionApp2/node_modules/typescript');
const cache = new Map();
function load(relative) {
  const filename = path.resolve(__dirname, '../EmotionApp2/src/onDevice', relative + '.ts');
  if (cache.has(filename)) return cache.get(filename).exports;
  const m = new Module(filename, module); cache.set(filename, m);
  m.require = name => name.startsWith('.') ? load(path.relative(path.join(__dirname, '../EmotionApp2/src/onDevice'), path.resolve(path.dirname(filename), name))) : require(name);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return m.exports;
}
global.__DEV__ = false;
const { runLocalFeedback, runImmediateSupport, parseDailySources } = load('localFeedback');
const { selectDisplayContent } = load('qwen/policy');
const { PHONE_MODELS } = load('qwen/config');
const { trendPaths } = load('weekly');
const { completeDiaryExcerpts, diarySentenceSpans, isSourceExplanation } = load('emotionEvidence');
test('evidence expands to complete Chinese sentences instead of ending inside a word', () => {
  const text='我擔心報告。朋友問我「還好嗎？」但我一時說不出來，其實我也不是每天都不開心。晚上終於解決了程式問題，我很開心。';
  assert.deepEqual(completeDiaryExcerpts(text,['其實我也不是每天都不開']),['朋友問我「還好嗎？」但我一時說不出來，其實我也不是每天都不開心。']);
  assert.deepEqual(completeDiaryExcerpts(text,['終於解決了程式問題']),['晚上終於解決了程式問題，我很開心。']);
  assert.equal(diarySentenceSpans(text).length,3);
  assert.equal(isSourceExplanation('未找到明確反感，故略過此情緒。'),false);
});
const diary = '今天報告受到批評，覺得有點委屈，現在只想被傾聽，不需要建議。';
const scores = { Joy: 0, Sadness: 60, Anger: 10, Fear: 30, Anticipation: 0, Surprise: 0, Disgust: 0, Trust: 0 };
const analysis = { probabilities: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v / 100])), chunk_count: 1, truncated: false };
const run = (output, model = 'qwen3.5-4b-q4_k_m') => ({ output, trace: { execution: 'on-device', tokens_predicted: 10, raw_text: JSON.stringify(output), runtime: 'test-double', model, sha256: PHONE_MODELS[model].sha256, duration_ms: 1, tokens_per_second: null, stopped_eos: true } });
const assessment = { risk_level: 'none', risk_evidence: [], support_style: 'listening', context: {
  event_context: '報告受到批評。', emotional_context: '有點委屈。', main_concern: '希望被理解。', coping_already_tried: '未提及', support_preference: '只想被傾聽。',
} };
function setup(overrides = {}) {
  const calls = [];
  return { calls,
    classify: async text => { calls.push(['classify', text]); return { backend: 'modernbert', classification_available: true, scores, analysis, receipt_token: 'server-receipt', risk_floor: 'none', ...overrides.classification }; },
    slm: { assess: async input => { calls.push(['assess', input]); return run(overrides.assessment ?? assessment); },
      respond: async input => { calls.push(['respond', input]); return run(overrides.support ?? { comfort: '你準備報告的付出沒有被看見，這份委屈可以慢慢說。', suggestions: [], blessing: '' }, overrides.model); } },
  };
}
test('cloud scores and the complete diary reach both local stages in order', async () => {
  const h = setup(); const r = await runLocalFeedback(diary, h.classify, h.slm);
  assert.equal(r.status, 'completed'); assert.deepEqual(r.scores, scores);
  assert.deepEqual(h.calls.map(c => c[0]), ['classify', 'assess', 'respond']);
  assert.equal(h.calls[1][1].diary, diary); assert.deepEqual(h.calls[1][1].emotion_scores, scores);
  assert.equal(h.calls[2][1].diary, diary); assert.deepEqual(h.calls[2][1].emotion_scores, scores);
  assert.equal(h.calls[2][1].safety.response_mode, 'SUPPORT_MODE');
});
test('the smaller model completes local feedback with its own source', async () => {
  const h = setup({ model: 'qwen3.5-2b-q4_k_m' });
  const result = await runImmediateSupport(diary, h.slm);
  assert.equal(result.status, 'completed');
  assert.equal(result.inference_source, 'phone-qwen3.5-2b');
  assert.equal(result.generation.model, 'qwen3.5-2b-q4_k_m');
});
test('local Qwen receives original names and accepts named context and feedback', async () => {
  const original='今天林小晴陪我準備 11 月 8 日的報告，我很感謝她。';
  const named={...assessment,context:{...assessment.context,event_context:'林小晴陪我準備 11 月 8 日的報告。'}};
  const support={comfort:'林小晴的陪伴讓這次準備報告多了一份支持。',suggestions:[],blessing:''};
  const h=setup({assessment:named,support});
  const r=await runLocalFeedback(original,h.classify,h.slm);
  assert.equal(r.status,'completed');
  assert.equal(h.calls[0][1],original);
  assert.equal(h.calls[1][1].diary,original);assert.equal(h.calls[2][1].diary,original);
  assert.equal(r.context.event_context,named.context.event_context);assert.equal(r.comfort,support.comfort);
});
test('overlap analysis and corrected weights reach local feedback without changing classifier scores', async () => {
  const overlapAnalysis = { ...analysis, token_count: 127, chunk_count: 2,
    chunks: [{ start_token: 0, end_token: 126, aggregation_weight: 110 },
      { start_token: 94, end_token: 127, aggregation_weight: 17 }],
    aggregation: { method: 'overlap_coverage_weighted_mean', overlap_tokens: 32,
      unique_content_tokens: 127, processed_content_tokens: 159, weight_sum: 127 } };
  const h = setup({ classification: { analysis: overlapAnalysis } });
  const r = await runLocalFeedback(diary, h.classify, h.slm);
  assert.equal(r.status, 'completed');
  assert.deepEqual(r.classifier_analysis, overlapAnalysis);
  assert.deepEqual(r.scores, scores);
  assert.deepEqual(h.calls[1][1].emotion_probabilities, overlapAnalysis.probabilities);
  assert.deepEqual(h.calls[2][1].emotion_probabilities, overlapAnalysis.probabilities);
});
test('native classification completes without a cloud receipt and preserves its source', async () => {
  const trace={execution:'on-device',runtime:'coreml',model:'modernbert-lora-coreml-fp16-v1',model_sha256:'a'.repeat(64),
    tokenizer_sha256:'b'.repeat(64),input_sha256:'c'.repeat(64),duration_ms:100,load_ms:20};
  const h=setup({classification:{receipt_token:null,classifier_trace:trace}});
  const result=await runLocalFeedback(diary,h.classify,h.slm);
  assert.equal(result.status,'completed');assert.equal(result.receipt_token,null);
  assert.deepEqual(result.classifier_trace,trace);assert.deepEqual(result.scores,scores);
  assert.deepEqual(h.calls.map(c=>c[0]),['classify','assess','respond']);
});
test('a missing or invalid native source never becomes a completed classification', async () => {
  for(const classifier_trace of [undefined,{execution:'cloud'},{execution:'on-device',runtime:'coreml',model:'model',model_sha256:'invalid'}]){
    const h=setup({classification:{receipt_token:null,classifier_trace}});
    const result=await runLocalFeedback(diary,h.classify,h.slm);
    assert.equal(result.status,'unavailable');assert.equal(h.calls.length,1);
  }
});
test('encoder and generation tasks cannot occupy native inference concurrently', () => {
  const {beginModelTask}=load('modelExecution');
  const finish=beginModelTask('encoder');
  assert.throws(()=>beginModelTask('generation'));
  finish();finish();
  const next=beginModelTask('generation');next();
});
test('explicit high risk uses a fixed local response without classifier or generation', async () => {
  const h = setup(); const r = await runLocalFeedback('這是合成測試：我今晚想結束生命。', h.classify, h.slm);
  assert.equal(r.status, 'local_safety'); assert.equal(r.response_mode, 'SAFE_MODE');
  assert.equal(r.scores, null); assert.deepEqual(h.calls, []);
  assert.equal(r.inference_source, 'fixed-safety'); assert.equal(r.generation, null);
});
test('semantic high risk stops after assessment and before free response generation', async () => {
  const h = setup({ assessment: { ...assessment, risk_level: 'high', risk_evidence: ['受到批評'] } });
  const r = await runLocalFeedback(diary, h.classify, h.slm);
  assert.equal(r.status, 'local_safety'); assert.equal(h.calls.length, 2);
});
test('rule and server risk floors cannot be downgraded by the SLM', async () => {
  for (const [raw, classification] of [['今天我覺得我很沒用。', {}], [diary, { risk_floor: 'moderate' }]]) {
    const h = setup({ classification }); const r = await runLocalFeedback(raw, h.classify, h.slm);
    assert.equal(r.status, 'completed'); assert.equal(r.response_mode, 'SAFE_MODE');
    assert.equal(h.calls[2][1].safety.response_mode, 'SAFE_MODE');
  }
});
test('unavailable classifier, invalid distributions and unknown risk never produce ordinary feedback', async () => {
  for (const classification of [{ classification_available: false }, { scores: { ...scores, Joy: 50 } }, { risk_floor: 'unknown' }, { backend: 'other' }]) {
    const h = setup({ classification }); const r = await runLocalFeedback(diary, h.classify, h.slm);
    assert.equal(r.status, 'unavailable'); assert.equal(r.response_mode, 'SAFE_MODE'); assert.equal(h.calls.length, 1);
  }
  const h = setup(); const r = await runLocalFeedback(diary, async () => { throw new Error('network down'); }, h.slm);
  assert.equal(r.safety_check_status, 'unavailable'); assert.equal(h.calls.length, 0);
});
test('bad assessments and invented evidence fail closed before response generation', async () => {
  for (const value of [{ ...assessment, risk_level: 'unknown' }, { ...assessment, risk_level: 'low', risk_evidence: ['invented words'] }, { ...assessment, context: {} }]) {
    const h = setup({ assessment: value }); const r = await runLocalFeedback(diary, h.classify, h.slm);
    assert.equal(r.status, 'unavailable'); assert.equal(h.calls.length, 2);
  }
});
test('a listening preference does not receive forced suggestions or a fabricated blessing', async () => {
  const h = setup({ support: { comfort: '我會先聽你說。', suggestions: ['先做一個計畫'], blessing: '' } });
  const r = await runLocalFeedback(diary, h.classify, h.slm);
  assert.equal(r.status, 'unavailable'); assert.equal(r.response_mode, 'SAFE_MODE');
});
test('phone feedback rejects questions and requests for a next turn', async () => {
  for (const ending of ['你現在還好嗎？', '如果想聊，歡迎繼續分享。']) {
    const h = setup({ support: { comfort: `這份失落有它的分量。${ending}`, suggestions: [], blessing: '' } });
    const result = await runLocalFeedback(diary, h.classify, h.slm);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.failure_stage, 'support_validation');
    assert.ok(!result.comfort.includes(ending));
  }
});

test('fragment support runs native assessment and response without any cloud scores', async () => {
  const h = setup(); const r = await runImmediateSupport(diary, h.slm);
  assert.equal(r.status, 'completed'); assert.equal(r.scores, null);
  assert.equal(r.receipt_token, null); assert.equal(r.classification_available, false);
  assert.deepEqual(h.calls.map(c => c[0]), ['assess', 'respond']);
  assert.equal('emotion_scores' in h.calls[0][1], false);
  assert.equal('emotion_probabilities' in h.calls[1][1], false);
  assert.deepEqual(r.causes, []);
});
test('an emotion can have its own grounded source without a corresponding event category', () => {
  const source = { emotion: 'Sadness', evidence: '覺得有點委屈', explanation: '受到批評讓我感到委屈。' };
  assert.deepEqual(parseDailySources({ causes: [], emotion_sources: [source] }, diary).emotion_sources, [source]);
  assert.throws(() => parseDailySources({ causes: [], emotion_sources: [{ ...source, evidence: '考試失利' }] }, diary));
  assert.throws(() => parseDailySources({ causes: [], emotion_sources: [source, source] }, diary));
});
test('verified empty thinking and assistant prefixes preserve valid JSON but never reasoning', () => {
  const json = '{"comfort":"我聽見了。"}';
  for (const raw of [json, '<think></think>\n'+json, '<|im_start|>assistant\n<think>\n</think>\n'+json+'<|im_end|>']) {
    assert.equal(selectDisplayContent({ text: raw }).content, json);
  }
  assert.throws(() => selectDisplayContent({text:'<think>private reasoning</think>'+json}));
  assert.throws(() => selectDisplayContent({text:'<|im_start|>user\n'+json}));
  assert.throws(() => selectDisplayContent({text:json,interrupted:true}));
  assert.throws(() => selectDisplayContent({text:'', reasoning_content:'private reasoning'}));
});
test('seven-day paths keep missing dates distinct from real zero scores', () => {
  const days = [0,1,2,3,4,5,6].map(i => ({date:`2026-11-0${i+1}`,status:'missing',analysis:null}));
  days[0] = {...days[0],status:'analyzed',analysis:{scores:{Joy:0}}};
  days[2] = {...days[2],status:'analyzed',analysis:{scores:{Joy:0.5}}};
  days[3] = {...days[3],status:'analyzed',analysis:{scores:{Joy:1}}};
  const paths = trendPaths(days, 'Joy');
  assert.equal(paths.length,2); assert.equal(paths[0],'M0,150');
  assert.equal(paths[1].includes(' L'),true);
});
const { composeDaily } = load('dailyComposition');
test('daily composition synthesizes all chronological originals in one generation', async () => {
  const calls = [];
  const sources = [{id:'night',timestamp:'2026-11-07T20:00:00Z',content:'晚上和朋友散步，心情放鬆。'}, {id:'morning',timestamp:'2026-11-07T08:00:00Z',content:'報告受肯定，很開心。'}];
  const prose = '報告受到肯定讓我很開心，晚上又和朋友散步，心情也放鬆下來。';
  assert.equal(await composeDaily(sources, async segments => { calls.push(segments); return {diary:prose}; }, () => false),prose);
  assert.equal(calls.length,1); assert.deepEqual(calls[0].map(s=>s.content), [sources[1].content,sources[0].content]);
  assert.equal(sources[0].id,'night');
});
test('long diary composition retains every original group without summarizing summaries again', async () => {
 const calls=[];
 const sources=[0,1].map(i=>({id:String(i),timestamp:String(i),content:'原始片段'+i+'x'.repeat(80)}));
 const result=await composeDaily(sources,async segments=>{
  calls.push(segments);
  if(segments.map(s=>s.content).join('').length>100)throw new RangeError('measured prompt budget');
  return{diary:'保留事件'+segments[0].timestamp};
 },e=>e instanceof RangeError);
 assert.equal(result,'保留事件0 保留事件1');assert.equal(calls.length,3);
 assert.deepEqual(calls.slice(1).flatMap(c=>c.map(s=>s.content)),sources.map(s=>s.content));
});
test('six daily fragments are composed in ordered groups without a final event-dropping rewrite',async()=>{
 const sources=Array.from({length:6},(_,i)=>({id:String(i),timestamp:String(i),content:'事件'+i}));const seen=[];
 const result=await composeDaily(sources,async segments=>{seen.push(segments);return{diary:segments.map(s=>s.content).join('，')+'。'}},()=>false);
 assert.equal(seen.length,3);assert.deepEqual(seen.flat().map(s=>s.content),sources.map(s=>s.content));
 for(const source of sources)assert.ok(result.includes(source.content));
});
test('composition errors preserve originals and never masquerade as a completed daily draft', async () => {
  const source=[{id:'1',timestamp:'1',content:'原始日記'}];
  for(const output of [{diary:''},{diary:'<think>reasoning</think>'},{diary:'日記',extra:true},{diary:'- 條列事件'}]) {
    await assert.rejects(composeDaily(source,async()=>output,()=>false));
  }
  await assert.rejects(composeDaily(source,async()=>{throw new Error('interrupted')},()=>false),/interrupted/);
  assert.equal(source[0].content,'原始日記');
});
const { percentageScores } = load('emotionScores');
test('already converted percentages containing a one-percent emotion are never scaled twice', () => {
  const percentages={Joy:76,Surprise:10,Anticipation:7,Trust:6,Anger:1,Sadness:0,Fear:0,Disgust:0};
  const probabilities=Object.fromEntries(Object.entries(percentages).map(([key,value])=>[key,value/100]));
  assert.deepEqual(percentageScores(probabilities),percentages);
  assert.deepEqual(percentageScores(percentageScores(probabilities)),percentages);
  assert.deepEqual(percentageScores(percentages),percentages);
  assert.deepEqual(percentageScores({Joy:1,Sadness:0}),{Joy:100,Sadness:0});
});

const { generateGroundedSources, sourceUnits } = load('qwen/sourceAnalysis');
const { SOURCE_STATE_SYSTEM, parseSourceEmotionStates } = load('qwen/sourceStates');
const stateOutput=(phrase,emotion,effect='unclear',holder='writer')=>({output:{states:[{phrase,emotion,effect,holder}]}});
test('unsupported explanations are rejected on ingestion, not presented as emotion reasons', () => {
  for (const explanation of ['無相關事件引發開心，無法建立對應依據。','沒有足夠線索。','未找到信任的來源，故略過。']) {
    assert.equal(isSourceExplanation(explanation), false);
    assert.throws(() => parseDailySources({ causes: [], emotion_sources: [{ emotion: 'Joy', explanation, evidence: diary.slice(0,8) }] }, diary));
  }
});
test('source quotes preserve full context including negation and outcomes across splits', () => {
  const input='我戴上耳機，希望安靜。可是噪音仍然很大，我更生氣了。後來朋友帶我散步，我才慢慢放鬆。';
  const units=sourceUnits(input);
  assert.equal(units[0].text,'我戴上耳機，希望安靜。');
  assert.ok(units[0].context.includes('我更生氣了。'));
  assert.ok(units[1].context.includes('希望安靜。'));
  assert.deepEqual(units.map(u=>u.text).join(''),input);
});
function emptyExtraction(system) { if(system.includes('辨識一筆調適行動'))return{output:{attempted:false,outcome:'unclear',topic:'',reason:'',quote:'',emotion:'Joy'}}; return {output:system.includes('只找一筆')?{present:false,topic:'',reason:'',quote:'',emotion:'Joy'}:{supported:false,reason:'',quote:''}}; }
test('focused review rejects failed coping and unsupported emotions without inventing replacements',async()=>{
 const raw='我試著運動，但還是很煩躁。她很快樂，我卻難過。';const seen=[];
 const result=await generateGroundedSources(raw,async(system,payload)=>{
  seen.push(payload);
  if(system===SOURCE_STATE_SYSTEM)return stateOutput('很快樂','Joy','unclear','other');
  if(payload.source_quote)return{output:{cause_clause_ids:payload.cause_clauses.map(c=>c.id),topic:'對應事件'}};
  if(payload.quote&&payload.explanation)return{output:{supported:false}};
  if(system.includes('辨識一筆調適行動'))return{output:{attempted:true,outcome:'not_improved',topic:'運動',reason:'運動後仍煩躁。',sentence_ids:[1],emotion:'Anger'}};
  if(system.includes('這次只判 Joy'))return{output:{supported:true,reason:'她快樂所以我開心。',sentence_ids:[2]}};
  return emptyExtraction(system);
 },()=>false);
 assert.deepEqual(result.causes,[]);assert.deepEqual(result.emotion_sources,[]);
 assert.ok(seen.some(p=>p.quote==='她很快樂，我卻難過。'));assert.ok(seen.every(p=>!('scores' in p)&&!('emotion_probabilities' in p)));
});
test('successful relief requires both an improved outcome and an exact source quote',async()=>{
 const raw='和同學聊過之後，我漸漸安心。';
 for(const outcome of ['improved','unclear','not_improved']) {
  const result=await generateGroundedSources(raw,async(system,payload)=>{
  if(system===SOURCE_STATE_SYSTEM)return stateOutput('安心','Trust','improved');
   if(payload.source_quote)return{output:{cause_clause_ids:payload.cause_clauses.map(c=>c.id),topic:'對應事件'}};
   if(payload.quote&&payload.explanation)return{output:{supported:true}};
   if(system.includes('辨識一筆調適行動'))return{output:{attempted:true,outcome,topic:'同學陪伴',reason:'談話後安心。',sentence_ids:[1],emotion:'Anger'}};
   return emptyExtraction(system);
  },()=>false);
  assert.equal(result.causes.length,outcome==='improved'?1:0);
  if(outcome==='improved')assert.deepEqual(result.causes[0].emotions,[]);
 }
});
test('invented quotes and malformed reviews never become accepted evidence',async()=>{
 const raw='這個景色讓我很驚訝。';
 const invalid=await generateGroundedSources(raw,async(system,payload)=>system.includes('這次只判 Surprise')?
  {output:{supported:true,reason:'景色出乎預期。',sentence_ids:[99]}}:emptyExtraction(system),()=>false);
 assert.deepEqual(invalid.emotion_sources,[]);
 await assert.rejects(generateGroundedSources(raw,async(system,payload)=>{
  if(system===SOURCE_STATE_SYSTEM)return stateOutput('很驚訝','Surprise');
  if(payload.source_quote)return{output:{cause_clause_ids:payload.cause_clauses.map(c=>c.id),topic:'對應事件'}};
  if(payload.quote&&payload.explanation)return{output:{}};
  return system.includes('這次只判 Surprise')?{output:{supported:true,reason:'景色出乎預期。',sentence_ids:[1]}}:emptyExtraction(system);
 },()=>false),/Invalid evidence review/);
});
const { translateClassificationDiary }=load('classificationTranslation');
test('translation uses one generation for a complete fitting diary and preserves source binding',async()=>{
 const input='我試著聽音樂，但還是很煩躁。\n\n晚上朋友陪我，我才放鬆。';let calls=0;
 const result=await translateClassificationDiary(input,async(system,payload)=>{
  calls++;assert.equal(payload.diary,input);assert.equal('source' in payload,false);
  return {output:{english:'I tried listening to music but was still irritated. Later, I relaxed with my friend.'}};
 },()=>false);
 assert.equal(calls,1);assert.equal(result.segments.map(s=>s.source).join(''),input);
 await assert.rejects(translateClassificationDiary(input,async()=>({output:{english:''}}),()=>false),/Invalid classification translation/);
});
test('translation budget splitting never summarizes or drops source characters',async()=>{
 const input='早上收到壞消息，我很難過。晚上和朋友聊過後比較安心。';
 const result=await translateClassificationDiary(input,async(system,payload)=>{
  if('source' in payload)return {output:{faithful:true,issues:[]}};
  if(payload.diary===input)throw new RangeError('budget');
  return{output:{english:payload.diary.startsWith('早上')?'I felt sad after bad news in the morning.':'I felt reassured after talking with a friend at night.'}};
 },e=>e instanceof RangeError);
 assert.equal(result.segments.length,2);assert.equal(result.segments.map(s=>s.source).join(''),input);
});

const { TranslationService }=load('TranslationService');
const { EmotionClassificationService }=load('EmotionClassificationService');
test('classification service sends only faithful English into the unchanged classifier and retains Chinese binding',async()=>{
 const raw='我試著戴耳機，還是很煩。';let input;
 const translator=new TranslationService(async(system,payload)=>run('source' in payload?{faithful:true,issues:[]}:{english:'I tried wearing headphones but was still annoyed.'}),()=>false);
 const service=new EmotionClassificationService(translator,async(text)=>{input=text;return {backend:'modernbert',classification_available:true,scores,analysis,receipt_token:'receipt',risk_floor:'none'};});
 const result=await service.classify(raw);
 assert.equal(input,'I tried wearing headphones but was still annoyed.');assert.deepEqual(result.scores,scores);
 assert.equal(result.classification_translation.segments[0].source,raw);
 assert.equal(result.classification_translation.version,'zh-en-faithful-v1');
});
test('a translated dominant emotion without Chinese evidence stays incomplete and keeps raw scores',async()=>{
 for(const supported of [false,true]) {
  const h=setup({classification:{classification_translation:{version:'zh-en-faithful-v1'}}});
  h.slm.causes=async()=>({output:{causes:[],emotion_sources:supported?[{emotion:'Sadness',explanation:'被批評後覺得委屈。',evidence:'覺得有點委屈'}]:[],source_analysis_version:'emotion-evidence-v4'}});
  const result=await runLocalFeedback(diary,h.classify,h.slm);
  assert.equal(result.status,supported?'completed':'unavailable');assert.deepEqual(result.scores,scores);
  if(!supported)assert.equal(result.failure_stage,'causes_validation');
 }
});
test('failed coping is shown as a sourced supplement and never as a buffer',async()=>{
 const cause='有人插隊讓我很生氣。', attempt='我試著戴耳機，但仍無法專心，心情沒有改善。',raw=cause+attempt;
 const result=await generateGroundedSources(raw,async(system,payload)=>{
  if(system===SOURCE_STATE_SYSTEM)return stateOutput('很生氣','Anger');
  if(payload.source_quote)return{output:{cause_clause_ids:payload.cause_clauses.map(c=>c.id),topic:'對應事件'}};
  if(payload.quote&&payload.explanation)return{output:{supported:true}};
  if(payload.source)return{output:{supported:true}};
  if(system.includes('辨識一筆調適行動'))return{output:{attempted:true,outcome:'not_improved',topic:'耳機',reason:'戴耳機後仍無法專心，情緒沒有改善。',sentence_ids:[2],emotion:'Anger'}};
  if(system.includes('這次只判 Anger'))return{output:{supported:true,reason:'插隊讓我生氣。',sentence_ids:[1]}};
  return emptyExtraction(system);
 },()=>false,['Anger'],{Anger:85,Joy:0});
 assert.equal(result.causes.some(c=>c.type==='buffer'),false);
 assert.match(result.emotion_sources[0].coping_note,/沒有改善/);
 assert.deepEqual(result.emotion_sources[0].additional_evidence,[attempt]);
 assert.throws(()=>parseDailySources({causes:[],emotion_sources:[{...result.emotion_sources[0],additional_evidence:['原文沒有的句子']}]},raw));
});
test('real negative causes are not mistaken for an unsupported-analysis template',()=>{
 for(const reason of ['未找到程式錯誤原因，讓我持續焦慮。','沒有明確的交期，讓我對進度感到不安。','對方略過我的提案，讓我覺得不被尊重。','無法建立開發環境，讓我感到挫折。'])assert.equal(isSourceExplanation(reason),true,reason);
 for(const reason of ['日記沒有足夠線索判斷。','無法建立對應依據。','無直接壓力來源依據。'])assert.equal(isSourceExplanation(reason),false,reason);
});
test('model-selected sentence IDs become exact Chinese text and ignore invented quotations',async()=>{
 const raw='早上和朋友吃飯。後來有人插隊，我真的很生氣。';
 const result=await generateGroundedSources(raw,async(system,payload)=>{
  if(system===SOURCE_STATE_SYSTEM)return stateOutput('很生氣','Anger');
  if(payload.source_quote)return{output:{topic:'插隊',cause_clause_ids:payload.cause_clauses.map(c=>c.id)}};
  if(payload.quote&&payload.explanation)return{output:{supported:true}};
  if(system.includes('這次只判 Anger'))return{output:{supported:true,sentence_ids:[2],quote:'模型另寫的假引句。'}};
  return emptyExtraction(system);
 },()=>false,['Anger'],{Anger:100});
 assert.equal(result.emotion_sources[0].evidence,'後來有人插隊，我真的很生氣。');
 assert.deepEqual(result.causes[0].emotions,['Anger']);
});

test('emotion tree ordering uses raw probabilities before rounded percent ties', () => {
  const {rankedEmotionScores}=load('emotionScores');
  assert.deepEqual(rankedEmotionScores({Anger:34,Sadness:34,Joy:0},{Anger:0.34152,Sadness:0.34172,Joy:0.0001},2),[['Sadness',34],['Anger',34]]);
  assert.deepEqual(rankedEmotionScores({Anger:40,Sadness:60},{},1),[['Sadness',60]]);
});

test('separate selected events never include unrelated intervening diary text',async()=>{
 const raw='插隊讓我生氣。午餐很好吃。被誤會讓我生氣。';const quotes=[];
 const result=await generateGroundedSources(raw,async(system,payload)=>{
  if(system===SOURCE_STATE_SYSTEM)return stateOutput('生氣','Anger');
  if(payload.source_quote){quotes.push(payload.source_quote);return{output:{topic:'不公平事件',cause_clause_ids:payload.cause_clauses.map(c=>c.id)}};}
  if(payload.quote&&payload.explanation)return{output:{supported:true}};
  if(system.includes('這次只判 Anger'))return{output:{supported:true,sentence_ids:[1,3]}};
  return emptyExtraction(system);
 },()=>false,['Anger'],{Anger:100});
 assert.deepEqual(quotes,['插隊讓我生氣。','被誤會讓我生氣。']);
 assert.equal(result.emotion_sources[0].evidence,'插隊讓我生氣。');
});

test('reason text comes from original clauses even if the model invents another reason',async()=>{
 const raw='有人誤會我，我解釋後終於釐清，對方卻沒有道歉，讓我很生氣。';
 const result=await generateGroundedSources(raw,async(system,payload)=>{
  if(system===SOURCE_STATE_SYSTEM)return stateOutput('很生氣','Anger');
  if(payload.source_quote)return{output:{topic:'誤會',cause_clause_ids:[2,3,4],reason:'我解釋無效。'}};
  if(payload.quote&&payload.explanation)return{output:{supported:true}};
  if(system.includes('這次只判 Anger'))return{output:{supported:true,sentence_ids:[1]}};
  return emptyExtraction(system);
 },()=>false,['Anger'],{Anger:100});
 assert.equal(result.emotion_sources[0].explanation,raw);
 assert.ok(raw.includes(result.emotion_sources[0].explanation));
});

test('motivation and future arrangements alone do not establish emotional relief',()=>{
 const {hasReliefOutcome}=load('qwen/sourceAnalysis');
 assert.equal(hasReliefOutcome('把事情寫進行事曆，發現好多值得期待的安排，覺得充滿動力。'),false);
 assert.equal(hasReliefOutcome('跟朋友聊完後，我慢慢放鬆。'),true);
 assert.equal(hasReliefOutcome('散步讓我心情變好。'),true);
 assert.equal(hasReliefOutcome('同事肯定後，沉重的心情也因此輕鬆了一些。'),true);
});


test('exact feelings and holder checks reject reassurance as joy and another persons recovery',async()=>{
 for(const [raw,phrase,emotion,holder,kind] of [
  ['朋友可靠的協助讓我安心。','安心','Trust','writer','Joy'],
  ['聽完我的安慰，朋友終於放鬆了。','放鬆','Other','other','buffer'],
 ]) {
  const out=await generateGroundedSources(raw,async(system,payload)=>{
   if(system===SOURCE_STATE_SYSTEM)return stateOutput(phrase,emotion,'improved',holder);
   if(payload.source_quote)return {output:{topic:'朋友',cause_clause_ids:[1]}};
   if(payload.quote&&payload.explanation)return {output:{supported:true}};
   if(system.includes('辨識一筆調適行動'))return kind==='buffer'?{output:{attempted:true,outcome:'improved',topic:'朋友',reason:raw,sentence_ids:[1],emotion:'Trust'}}:emptyExtraction(system);
   return {output:{supported:true,sentence_ids:[1]}};
  },()=>false,kind==='Joy'?['Joy']:[],{Joy:90,Trust:10});
  assert.deepEqual(out.emotion_sources,[]);assert.deepEqual(out.causes,[]);
 }
});
test('actual writer recovery can be a buffer without manufacturing joy',async()=>{
 const raw='朋友陪我散步後，我終於放鬆了。';
 const out=await generateGroundedSources(raw,async(system,payload)=>{
  if(system===SOURCE_STATE_SYSTEM)return stateOutput('放鬆','Other','improved');
  if(payload.source_quote)return {output:{topic:'散步',cause_clause_ids:[1,2]}};
  if(payload.quote&&payload.explanation)return {output:{supported:true}};
  if(system.includes('辨識一筆調適行動'))return {output:{attempted:true,outcome:'improved',topic:'散步',reason:raw,sentence_ids:[1],emotion:'Trust'}};
  return emptyExtraction(system);
 },()=>false);
 assert.equal(out.causes[0].type,'buffer');assert.deepEqual(out.causes[0].emotions,[]);assert.deepEqual(out.emotion_sources,[]);
});
test('state phrases absent from original cannot prove a model estimate',()=>{
 assert.deepEqual(parseSourceEmotionStates(stateOutput('很開心','Joy').output,'我很生氣。'),[]);
});
test('separate semicolon events keep the full matching event without attaching the next one',()=>{
 const raw='中午餐具很髒，我很反感；下午客服推責任，我很生氣。';
 assert.deepEqual(completeDiaryExcerpts(raw,['我很反感']),['中午餐具很髒，我很反感；']);
});
test('missing original evidence cannot become a legacy tag explanation',()=>{
 const {emotionEvidence}=load('emotionEvidence');
 assert.deepEqual(emotionEvidence({final_content:'我很生氣。',emotion_sources:[],causes:[{emotions:['Joy'],explanation:'我很開心',evidence:'我很生氣。'}]},'Joy'),[]);
 assert.deepEqual(emotionEvidence({final_content:'我很生氣。',emotion_sources:[{emotion:'Joy',explanation:'我很開心',evidence:'不存在的快樂'}]},'Joy'),[]);
});

test('emotion reason retains needed preceding context without attaching the next event',()=>{
 const {completeEmotionEvent}=load('emotionEvidence');
 const text='早上發生地震，我遠離櫃子。雖然搖晃不久，我還是害怕。午餐很好吃。';
 assert.equal(completeEmotionEvent(text,'還是害怕'),'早上發生地震，我遠離櫃子。雖然搖晃不久，我還是害怕。');
 assert.equal(completeEmotionEvent('聽音樂讓我的心情變好。後來去買蛋糕。','心情變好'),'聽音樂讓我的心情變好。');
});

test('one happy future event is not duplicated across joy source rows',async()=>{
 const raw='想到下週旅行，我很開心，也很期待。';
 const result=await generateGroundedSources(raw,async(system,payload)=>{
  if(system===SOURCE_STATE_SYSTEM)return {output:{states:[
   {phrase:'很開心',emotion:'Joy',effect:'unclear',holder:'writer'},
   {phrase:'很期待',emotion:'Anticipation',effect:'unclear',holder:'writer'}]}};
  if(payload.source_quote)return {output:{topic:'旅行的期待',cause_clause_ids:[1,2,3]}};
  if(payload.quote&&payload.explanation)return {output:{supported:true}};
  if(system.includes('辨識一筆調適行動'))return emptyExtraction(system);
  return {output:{supported:true,sentence_ids:[1]}};
 },()=>false,['Joy','Anticipation'],{Joy:40,Anticipation:60});
 assert.equal(result.emotion_sources.length,2);
 assert.equal(result.causes.length,1);
 assert.deepEqual(new Set(result.causes[0].emotions),new Set(['Joy','Anticipation']));
 assert.equal(result.causes[0].evidence,raw);
});

test('context expansion uses the actual selected occurrence of a repeated feeling',()=>{
 const {completeEmotionEvent}=load('emotionEvidence');
 const raw='早上我害怕考試。後來突然地震，我遠離櫃子。雖然搖晃不久，我還是害怕。';
 assert.equal(completeEmotionEvent(raw,'害怕','雖然搖晃不久，我還是害怕。'),'後來突然地震，我遠離櫃子。雖然搖晃不久，我還是害怕。');
});

test('model review cannot label mere observation as joy without a positive feeling',async()=>{
 const raw='我完全沒想到 AR 效果這麼逼真，忍不住轉頭觀察。';
 const result=await generateGroundedSources(raw,async(system,payload)=>{
  if(system===SOURCE_STATE_SYSTEM)return stateOutput('忍不住轉頭觀察','Joy');
  if(payload.source_quote)return {output:{topic:'AR',cause_clause_ids:[1,2]}};
  if(payload.quote&&payload.explanation)return {output:{supported:true}};
  if(system.includes('辨識一筆調適行動'))return emptyExtraction(system);
  return {output:{supported:true,sentence_ids:[1]}};
 },()=>false,['Joy'],{Joy:15,Surprise:85});
 assert.deepEqual(result.emotion_sources,[]);assert.deepEqual(result.causes,[]);
 const {hasExplicitJoy}=load('qwen/sourceAnalysis');
 for(const phrase of ['很開心','心情變得很好','感到有成就感','覺得幸福','享受音樂'])assert.equal(hasExplicitJoy(phrase),true);
 for(const phrase of ['很安心','非常可靠','很神奇','忍不住觀察','不開心','沒有很快樂'])assert.equal(hasExplicitJoy(phrase),false);
});

test('late real relief in selected events is checked with its own action context',async()=>{
 const raw='今天收到壞消息，我很難過。後來朋友幫我解決問題，讓我安心。';
 const result=await generateGroundedSources(raw,async(system,payload)=>{
  if(system===SOURCE_STATE_SYSTEM)return payload.quote===raw?{output:{states:[]}}:payload.quote.includes('安心')?stateOutput('安心','Trust','improved'):{output:{states:[]}};
  if(payload.source_quote)return {output:{topic:'朋友協助',cause_clause_ids:[1,2]}};
  if(payload.quote&&payload.explanation)return {output:{supported:true}};
  if(system.includes('辨識一筆調適行動'))return {output:{attempted:true,outcome:'improved',topic:'朋友協助',reason:'朋友協助後安心。',sentence_ids:[1,2],emotion:'Anger'}};
  return emptyExtraction(system);
 },()=>false,[],{Sadness:80,Trust:20});
 assert.equal(result.causes[0].type,'buffer');
 assert.deepEqual(result.causes[0].emotions,[]);
 assert.equal(result.causes[0].evidence,'後來朋友幫我解決問題，讓我安心。');
});

test('explicit cause of distress is not replaced by the later helper as a stressor label',async()=>{
 const raw='剛開始因為看不到周圍環境，我有點緊張，但夥伴耐心指引。';
 const result=await generateGroundedSources(raw,async(system,payload)=>{
  if(system===SOURCE_STATE_SYSTEM)return stateOutput('有點緊張','Fear');
  if(payload.source_quote)return {output:{topic:'夥伴耐心指引',cause_clause_ids:[1,2,3]}};
  if(payload.quote&&payload.explanation)return {output:{supported:true}};
  if(system.includes('辨識一筆調適行動'))return emptyExtraction(system);
  return {output:{supported:true,sentence_ids:[1]}};
 },()=>false,['Fear'],{Fear:10,Trust:90});
 assert.equal(result.causes[0].topic,'看不到周圍環境');
 assert.equal(result.causes[0].evidence,raw);
});

test('rejecting an invented cause label preserves explicit feelings without inventing a stressor',async()=>{
 const raw='我安慰朋友後，她放鬆了。但是我自己的難過沒有改善。';
 const result=await generateGroundedSources(raw,async(system,payload)=>{
  if(system===SOURCE_STATE_SYSTEM)return stateOutput('難過','Sadness','continued');
  if(payload.source_quote)return {output:{topic:'安慰朋友',cause_clause_ids:[1,2,3]}};
  if(payload.quote&&payload.explanation)return {output:{supported:!payload.explanation.startsWith('安慰朋友：')}};
  if(system.includes('辨識一筆調適行動'))return emptyExtraction(system);
  return {output:{supported:true,sentence_ids:[2]}};
 },()=>false,['Sadness'],{Sadness:100});
 assert.equal(result.emotion_sources[0].emotion,'Sadness');
 assert.equal(result.emotion_sources[0].evidence,raw);
 assert.deepEqual(result.causes,[]);
});

test('long mixed diaries retrieve late emotion evidence within bounded passages',async()=>{
 const raw=Array.from({length:14},(_,i)=>i===12?'同事肯定我的努力，我有點意外。':`第${i+1}件事情完成了。`).join('');
 const batches=[];
 const result=await generateGroundedSources(raw,async(system,payload)=>{
  if(system===SOURCE_STATE_SYSTEM)return stateOutput('有點意外','Surprise');
  if(payload.source_quote)return {output:{topic:'同事肯定',cause_clause_ids:[1,2]}};
  if(payload.quote&&payload.explanation)return {output:{supported:true}};
  if(system.includes('辨識一筆調適行動'))return emptyExtraction(system);
  batches.push(payload.diary_sentences);
  const found=payload.diary_sentences.find(x=>x.text.includes('有點意外'));
  return {output:{supported:!!found,sentence_ids:found?[found.id]:[]}};
 },()=>false,['Surprise'],{Surprise:90,Joy:10});
 assert.ok(batches.length>=2);
 assert.ok(batches.every(x=>x.length<=6));
 assert.equal(result.emotion_sources[0].emotion,'Surprise');
 assert.equal(result.emotion_sources[0].evidence,'同事肯定我的努力，我有點意外。');
 assert.deepEqual(parseSourceEmotionStates(stateOutput('我真的都沒事嗎？','Fear').output,'我真的都沒事嗎？'),[]);
});

test('daily workflow uses exactly one SLM analysis without separate assessment, support or source calls',async()=>{
 const raw='今天有人插隊，我很生氣。試著戴耳機後仍無法專心，心情沒有改善。';
 const output={...assessment,context:{...assessment.context,event_context:'遭人插隊。',emotional_context:'插隊引起生氣，戴耳機後未改善。'},comfort:'排隊秩序被打亂，感到不平衡和生氣是可以理解的。即使試過戴耳機，煩躁也沒有立刻離開，這些感受仍值得被看見。',suggestions:[],blessing:'',events:[
  {sentence_ids:[1],emotion:'Anger',feeling:'很生氣',category:'stressor',topic:'遭人插隊',explanation:'遭人插隊破壞秩序，引起不公平感與憤怒。',outcome:'unclear'},
  {sentence_ids:[2],emotion:'Other',feeling:'心情沒有改善',category:'buffer',topic:'戴耳機',explanation:'嘗試戴耳機但仍無法專心，情緒沒有改善。',outcome:'not_improved'}]};
 const h=setup();let calls=0;h.slm.analyzeDaily=async input=>{calls++;assert.equal(input.diary,raw);return run(output);};
 h.slm.assess=h.slm.respond=h.slm.causes=async()=>{throw Error('Repeated SLM call forbidden');};
 const result=await runLocalFeedback(raw,h.classify,h.slm);
 assert.equal(result.status,'completed');assert.equal(calls,1);assert.equal(result.source_analysis_version,'emotion-evidence-v5');
 assert.deepEqual(result.scores,scores);assert.equal(result.causes.length,1);assert.equal(result.causes[0].type,'stressor');
 assert.equal(result.causes[0].explanation,output.events[0].explanation);assert.equal(result.emotion_sources[0].evidence,'今天有人插隊，我很生氣。');
});
test('one-pass parser rejects fabricated or first-person source descriptions and does not turn failed coping into a buffer',()=>{
 const {parseDailyAnalysis}=load('qwen/dailyAnalysis');const raw='同事肯定努力，心情輕鬆了一些。';
 const base={...assessment,comfort:'這份努力被看見，讓忙碌的一天多了一些溫暖。',suggestions:[],blessing:'',events:[]};
 const event={sentence_ids:[1],emotion:'Other',feeling:'輕鬆了一些',category:'buffer',topic:'同事肯定',explanation:'同事肯定努力，使沉重心情緩和。',outcome:'improved'};
 assert.equal(parseDailyAnalysis({...base,events:[event]},raw).sources.causes[0].type,'buffer');
 for(const bad of [{...event,sentence_ids:[99]}, {...event,explanation:'我被同事肯定後放鬆。'}, {...event,outcome:'not_improved'}])assert.equal(parseDailyAnalysis({...base,events:[bad]},raw).sources.causes.length,0);
});
test('login session survives app restarts until explicit logout without storing a password',async()=>{
 const {persistSession,restoreSession,clearSession,AUTH_SESSION_KEY}=load('authSession');const values=new Map();
 const storage={getItemAsync:async key=>values.get(key)||null,setItemAsync:async(k,v)=>values.set(k,v),deleteItemAsync:async key=>values.delete(key)};
 const session={token:'synthetic-session-token',username:'Sabrina',avatar:'boy'};
 await persistSession(storage,session);assert.deepEqual(await restoreSession(storage),session);
 assert.equal(values.get(AUTH_SESSION_KEY).includes('password'),false);
 await clearSession(storage);assert.equal(await restoreSession(storage),null);
 values.set(AUTH_SESSION_KEY,'broken-json');assert.equal(await restoreSession(storage),null);
});

test('one-pass analysis still requires Chinese evidence for the translated primary emotion without another model call',async()=>{
 const raw='有人插隊，我很生氣。';const output={...assessment,comfort:'遭遇插隊的不公平感與不滿可以被理解。',suggestions:[],blessing:'',events:[{sentence_ids:[1],emotion:'Anger',feeling:'很生氣',category:'stressor',topic:'排隊被插隊',explanation:'遭人插隊，引起不公平感與憤怒。',outcome:'unclear'}]};
 for(const primary of ['Anger','Joy']){
  const distribution=Object.fromEntries(['Joy','Sadness','Anger','Fear','Anticipation','Surprise','Disgust','Trust'].map(e=>[e,e===primary?100:0]));
  const h=setup({classification:{scores:distribution,analysis:{...analysis,probabilities:Object.fromEntries(Object.keys(distribution).map(e=>[e,e===primary?1:0])),top_3:[{emotion:primary,probability:1,score:100}]},classification_translation:{version:'zh-en-faithful-v1'}}});
  let count=0;h.slm.analyzeDaily=async()=>{count++;return run(output);};
  const result=await runLocalFeedback(raw,h.classify,h.slm);
  assert.equal(count,1);assert.equal(result.status,primary==='Anger'?'completed':'unavailable');
  assert.deepEqual(result.scores,distribution);
 }
});

test('single-pass original evidence includes a dependent outcome and rejects role-inverted event wording',()=>{
 const {parseDailyAnalysis}=load('qwen/dailyAnalysis');
 const raw='朋友擔心我遲到。下班同事肯定努力。其實有點意外。突然有人注意到努力，被理解後心情輕鬆了一些。';
 const v={risk_level:'none',risk_evidence:[],summary:'朋友遲到打亂安排。同事給予肯定。',change:'同事肯定後放鬆。',comfort:'朋友遲到讓人不安，同事的肯定帶來理解與支持。',events:[{sentence_ids:[2,3],emotion:'Trust',category:'buffer',topic:'同事肯定',explanation:'同事肯定努力，使原本沉重的心情緩和。',outcome:'improved'}]};
 const result=parseDailyAnalysis(v,raw);
 assert.equal(result.assessment.context.event_context.includes('朋友遲到'),false);
 assert.equal(result.support.comfort.includes('朋友遲到'),false);
 assert.equal(result.sources.causes[0].type,'buffer');
 assert.ok(result.sources.causes[0].evidence.endsWith('心情輕鬆了一些。'));
});

test('completed phone translation is reused after restart when classification needs a retry',async()=>{
 const raw='有人插隊，我很生氣。';let stored=null,calls=0;
 const cache={get:async()=>stored,set:async(_,value)=>{stored=value;}};
 const generate=async()=>{calls++;return run({english:'Someone cut in line, and I felt angry.'});};
 const first=new TranslationService(generate,()=>false,cache);const result=await first.translate(raw);
 const reopened=new TranslationService(generate,()=>false,cache);assert.deepEqual(await reopened.translate(raw),result);assert.equal(calls,1);
 await reopened.translate(raw+'後來回家。');assert.equal(calls,2);
});

test('a translation failure records its real stage and preserves a resumable draft',async()=>{
 const h=setup();const failure=new Error('App 已離開前景。');failure.name='TranslationStageError';
 const result=await runLocalFeedback(diary,async()=>{throw failure;},h.slm);
 assert.equal(result.status,'unavailable');assert.equal(result.failure_stage,'translation');assert.equal(result.failure_reason,'App 已離開前景。');assert.equal(h.calls.length,0);
});


test('direct joy remains a positive source without claiming relief from previous distress',()=>{
 const {parseDailyAnalysis}=load('qwen/dailyAnalysis');
 const raw='今天朋友稱讚作品，讓我覺得很開心。';
 const value={risk_level:'none',risk_evidence:[],summary:'朋友稱讚作品。',change:'獲得肯定而開心。',comfort:'作品獲得朋友肯定，這份開心值得珍惜。',events:[{sentence_ids:[1],emotion:'Joy',category:'buffer',topic:'作品獲得肯定',explanation:'作品得到稱讚，帶來開心。',outcome:'improved'}]};
 const parsed=parseDailyAnalysis(value,raw);
 assert.equal(parsed.sources.causes[0].type,'joy');
 assert.equal(parsed.sources.causes.some(c=>c.type==='buffer'),false);
 assert.equal(parsed.sources.causes[0].evidence,raw);
});
