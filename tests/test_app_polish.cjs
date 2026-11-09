const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../EmotionApp2/node_modules/typescript');
const sourceRoot = path.join(__dirname, '../EmotionApp2/src');
function load(relative, imports, extra = {}) {
  const js = ts.transpileModule(fs.readFileSync(path.join(sourceRoot, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: name => {
    if (!(name in imports)) throw new Error(`Unexpected runtime dependency: ${name}`);
    return imports[name];
  }, ...extra });
  return exports;
}
test('model preparation downloads the selected 2B file and reuses a verified 4B file on higher RAM', async () => {
  const config = load('onDevice/qwen/config.ts', {});
  const policy = load('onDevice/qwen/policy.ts', {});
  const full = config.PHONE_MODELS['qwen3.5-4b-q4_k_m'];
  const lite = config.PHONE_MODELS['qwen3.5-2b-q4_k_m'];
  const directory = 'file:///test/models/';
  const fullUri = directory + full.filename;
  const files = new Map([[fullUri, full]]);
  const downloaded = [];
  const fsMock = {
    documentDirectory: 'file:///test/',
    makeDirectoryAsync: async () => {},
    getInfoAsync: async uri => files.has(uri) ? { exists: true, size: files.get(uri).bytes } : { exists: false },
    deleteAsync: async uri => { files.delete(uri); },
    moveAsync: async ({ from, to }) => { files.set(to, files.get(from)); files.delete(from); },
    createDownloadResumable: (url, uri) => ({ downloadAsync: async () => {
      downloaded.push(url);
      files.set(uri, lite);
      return { status: 200 };
    } }),
  };
  const storage = totalMemory => load('onDevice/qwen/storage.ts', {
    'expo-device': { totalMemory }, 'expo-file-system/legacy': fsMock,
    './config': config, './policy': policy,
    './diagnostics': { excludeFromBackup: async () => {}, fileDigest: async uri => files.get(uri), freeDiskBytes: async () => 2 * 1024 ** 3 },
  });
  const standard = storage(6 * 1024 ** 3);
  assert.equal(await standard.modelExists(), false);
  await Promise.all([standard.downloadModel(() => {}), standard.downloadModel(() => {})]);
  assert.deepEqual(downloaded, [lite.url]);
  assert.equal(await standard.verifyModel(), directory + lite.filename);
  assert.equal(await storage(null).verifyModel(), directory + lite.filename);
  assert.equal(await storage(8 * 1024 ** 3).verifyModel(), fullUri);
  assert.deepEqual(downloaded, [lite.url]);
});
function diaryStore() {
  const data = new Map();
  const storage = {
    setItem: async (key, value) => { data.set(key, value); },
    getAllKeys: async () => [...data.keys()],
    multiGet: async keys => keys.map(key => [key, data.get(key) || null]),
  };
  return { data, api: load('onDevice/diaryStore.ts', { '@react-native-async-storage/async-storage': storage }) };
}
function entry(id, createdAt, extra = {}) {
  return { id, owner: 'alice', content: `日記 ${id}`, kind: 'fragment', createdAt, syncStatus: 'pending', result: { status: 'unavailable' }, ...extra };
}
test('restores only the newest failed fragment and retains older originals', async () => {
  const { api, data } = diaryStore();
  await api.savePhoneDiary(entry('old', '2026-11-04T12:00:00Z'));
  await api.savePhoneDiary(entry('latest', '2026-11-06T12:00:00Z'));
  assert.equal((await api.latestRecoverableFragment('alice')).id, 'latest');
  assert.equal(data.size, 2);
});
test('a newer success, including unsynced feedback, suppresses an older failure', async () => {
  for (const syncStatus of ['pending', 'synced']) {
    const { api } = diaryStore();
    await api.savePhoneDiary(entry('old', '2026-11-04T12:00:00Z'));
    await api.savePhoneDiary(entry('success', '2026-11-06T12:00:00Z', { result: { status: 'completed' }, syncStatus }));
    assert.equal(await api.latestRecoverableFragment('alice'), null);
  }
});
test('recovers an interrupted draft without mixing accounts or daily summaries', async () => {
  const { api, data } = diaryStore();
  await api.savePhoneDiary(entry('draft', '2026-11-04T12:00:00Z', { result: undefined, syncStatus: 'draft' }));
  await api.savePhoneDiary(entry('other', '2026-11-06T12:00:00Z', { owner: 'bob' }));
  await api.savePhoneDiary(entry('daily', '2026-11-06T12:00:00Z', { kind: 'daily' }));
  data.set('phoneDiary:v1:alice:broken', 'broken-json');
  assert.equal((await api.latestRecoverableFragment('alice')).id, 'draft');
  assert.equal(await api.latestRecoverableFragment('nobody'), null);
  assert.equal((await api.pendingPhoneDiaries('alice')).length, 2);
});
function notificationSetup({ os = 'ios', granted = true, canAskAgain = true, iosStatus = 2, requestGranted = true } = {}) {
  const calls = [];
  const permissions = () => ({ granted, canAskAgain, ios: os === 'ios' ? { status: iosStatus } : undefined });
  const notifications = {
    IosAuthorizationStatus: { PROVISIONAL: 3, EPHEMERAL: 4 }, AndroidImportance: { HIGH: 4 },
    SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
    getPermissionsAsync: async () => { calls.push(['permissions']); return permissions(); },
    requestPermissionsAsync: async () => { calls.push(['request']); return { ...permissions(), granted: requestGranted, ios: { status: requestGranted ? 2 : 1 } }; },
    setNotificationChannelAsync: async (...args) => { calls.push(['channel', ...args]); },
    scheduleNotificationAsync: async payload => { calls.push(['schedule', payload]); return 'test-notification'; },
  };
  return { calls, api: load('notifications.ts', { 'react-native': { Platform: { OS: os } }, 'expo-notifications': notifications }) };
}
test('local notification schedules with foreground content without requesting a push token or network', async () => {
  const { api, calls } = notificationSetup();
  assert.equal(await api.sendLocalTestNotification(), 'test-notification');
  assert.deepEqual(calls.map(call => call[0]), ['permissions', 'schedule']);
  const payload = calls[1][1];
  assert.equal(payload.trigger.seconds, 3);
  assert.equal(payload.trigger.channelId, 'default');
  assert.equal(payload.content.sound, 'default');
  assert.equal(payload.content.data.type, 'local_test');
});
test('denied notification permission never schedules and never asks again when prohibited', async () => {
  const { api, calls } = notificationSetup({ granted: false, canAskAgain: false, iosStatus: 1 });
  await assert.rejects(api.sendLocalTestNotification(), /系統設定/);
  assert.deepEqual(calls.map(call => call[0]), ['permissions']);
});
test('a first request can grant permission; rejected requests do not claim a sent test', async () => {
  for (const requestGranted of [true, false]) {
    const { api, calls } = notificationSetup({ granted: false, iosStatus: 0, requestGranted });
    if (requestGranted) await api.sendLocalTestNotification();
    else await assert.rejects(api.sendLocalTestNotification(), /系統設定/);
    assert.equal(calls.some(call => call[0] === 'schedule'), requestGranted);
    assert.equal(calls.filter(call => call[0] === 'request').length, 1);
  }
});
test('provisional and ephemeral iOS grants are usable; provisional status explains quiet delivery', async () => {
  for (const iosStatus of [3, 4]) {
    const { api, calls } = notificationSetup({ granted: false, iosStatus });
    await api.sendLocalTestNotification();
    assert.equal(calls.some(call => call[0] === 'request'), false);
    if (iosStatus === 3) assert.match(await api.notificationStatus(), /安靜通知/);
  }
});
test('Android channel exists before permissions and scheduling; web clearly rejects', async () => {
  const { api, calls } = notificationSetup({ os: 'android' });
  await api.sendLocalTestNotification();
  assert.deepEqual(calls.map(call => call[0]), ['channel', 'permissions', 'schedule']);
  const web = notificationSetup({ os: 'web' });
  await assert.rejects(web.api.sendLocalTestNotification(), /手機安裝版/);
  assert.equal(web.calls.length, 0);
});
test('network requests abort on timeouts and release their timer after success', async () => {
  const timers = new Set();
  const extras = {
    AbortController,
    setTimeout: (callback, delay) => { const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay); timers.add(timer); return timer; },
    clearTimeout: timer => { timers.delete(timer); clearTimeout(timer); },
    fetch: async (_url, { signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('aborted'))); }),
  };
  const api = load('network.ts', {}, extras);
  await assert.rejects(api.fetchWithTimeout('http://test.invalid', {}, 5), /連線逾時/);
  assert.equal(timers.size, 0);
  extras.fetch = async () => ({ ok: true });
  const success = load('network.ts', {}, extras);
  assert.equal((await success.fetchWithTimeout('http://test.invalid')).ok, true);
  assert.equal(timers.size, 0);
});
