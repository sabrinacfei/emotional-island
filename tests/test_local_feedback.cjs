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
test('long diary reduction always runs a final synthesis rather than returning joined fragments', async () => {
  const calls = [];
  const sources = [0,1].map(i=>({id:String(i),timestamp:String(i),content:'原始片段'+i+'x'.repeat(80)}));
  const prose='我先完成報告，到了晚上和朋友散步，心情逐漸放鬆。';
  const result=await composeDaily(sources,async segments=>{
    calls.push(segments);
    if(segments.map(s=>s.content).join('').length>100) throw new RangeError('measured prompt budget');
    return {diary:segments.length===1?'精簡事件'+segments[0].timestamp:prose};
  },e=>e instanceof RangeError);
  assert.equal(result,prose); assert.equal(calls.length,4);
  assert.deepEqual(calls[3].map(s=>s.content),['精簡事件0','精簡事件1']);
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
