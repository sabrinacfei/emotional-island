import React, { useState, useRef, useEffect, createContext, useContext } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Dimensions,
  PanResponder, ActivityIndicator, TextInput, Image, Alert,
  KeyboardAvoidingView, Platform, Animated, Modal, ImageBackground,
  FlatList,
  DimensionValue
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import Svg, { Line, Path, Circle, Text as SvgText, Rect, Polygon, G } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useFonts,
  NotoSerifTC_400Regular,
  NotoSerifTC_500Medium,
  NotoSerifTC_700Bold,
} from '@expo-google-fonts/noto-serif-tc';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();
const { width: SW, height: SH } = Dimensions.get('window');
declare const process: { env?: Record<string, string | undefined> };

const EXPO_EXTRA = (Constants.expoConfig?.extra || {}) as { apiUrl?: string };
const BASE_URL = process.env?.EXPO_PUBLIC_API_URL || EXPO_EXTRA.apiUrl || 'http://192.168.0.124:8000';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const FONT_REG = 'NotoSerifTC_400Regular';
const FONT_MED = 'NotoSerifTC_500Medium';
const FONT_SEMI = 'NotoSerifTC_600SemiBold';
const FONT_BOLD = 'NotoSerifTC_700Bold';

const C = {
  bg: '#FAF6F0',
  card: '#FFFFFF',
  line: '#E8E0D5',
  accent: '#7A9E6A',
  text: '#3D2B1F',
  sub: '#7A6A5A',
  muted: '#8A7A6A',
  danger: '#C0392B',
};

// ─── 情緒常數（對齊 HTML 的 EC）───
const EC: Record<string, { l: string; c: string }> = {
  Joy:          { l: '喜悅', c: '#F3D89D' },
  Sadness:      { l: '悲傷', c: '#7E9AB9' },
  Fear:         { l: '恐懼', c: '#AD8A62' },
  Anger:        { l: '憤怒', c: '#B87979' },
  Anticipation: { l: '期待', c: '#D6A800' },
  Surprise:     { l: '驚訝', c: '#9A7AA5' },
  Disgust:      { l: '厭惡', c: '#919189' },
  Trust:        { l: '信任', c: '#7FBB71' },
};

// 每種情緒對應查哪一類標籤（對齊 HTML EMO_SRC）
const EMO_SRC: Record<string, string[]> = {
  Joy:          ['jt'],
  Trust:        ['jt', 'bt'],
  Anticipation: ['jt', 'st'],
  Surprise:     ['jt'],
  Sadness:      ['st'],
  Fear:         ['st'],
  Anger:        ['st'],
  Disgust:      ['st'],
};

const TL: Record<string, string> = {
  time: '時間壓力', schoolwork: '課業壓力', future: '對未來的焦慮', relationships: '人際關係',
  family: '家庭', health: '健康', money: '金錢', self_image: '自我形象', other: '其他',
  family_support: '家人支持', friend_support: '朋友支持', rest: '休息', routine: '日常作息',
  exercise: '運動', none: '無', friend_time: '朋友相處', family_time: '家人相處',
  achievement: '成就感', relief: '如釋重負', gratitude: '感恩',
};

// 正負情緒
const POS_EMO = ['Joy', 'Trust', 'Anticipation', 'Surprise'];
const NEG_EMO = ['Sadness', 'Anger', 'Fear', 'Disgust'];

const EMO_KEYS = Object.keys(EC);

const MOOD_TREE: Record<string, { img: any; label: string; color: string }> = {
  Joy:          { img: require('./assets/joy.png'),         label: '喜悅', color: '#F3D89D' },
  Sadness:      { img: require('./assets/sad.png'),         label: '悲傷', color: '#7E9AB9' },
  Fear:         { img: require('./assets/fear.png'),        label: '恐懼', color: '#AD8A62' },
  Anger:        { img: require('./assets/Anger.png'),       label: '憤怒', color: '#B87979' },
  Anticipation: { img: require('./assets/Anticipation.png'), label: '期待', color: '#D6A800' },
  Surprise:     { img: require('./assets/Surprise.png'),    label: '驚訝', color: '#9A7AA5' },
  Disgust:      { img: require('./assets/Disgust.png'),     label: '厭惡', color: '#919189' },
  Trust:        { img: require('./assets/Trust.png'),       label: '信任', color: '#7FBB71' },
};
const HOME_MOOD_TREE: Record<string, any> = {
  Trust:        require('./assets/Trust1.png'),
  Disgust:      require('./assets/Disgust1.png'),
  Surprise:     require('./assets/Surprise1.png'),
  Anticipation: require('./assets/Anticipation1.png'),
  Anger:        require('./assets/Anger1.png'),
  Fear:         require('./assets/Fear2.png'),
  Sadness:      require('./assets/Sadness1.png'),
  Joy:          require('./assets/Joy1.png'),
};
const ACHIEVEMENT_ASSETS: Record<string, any> = {
  first_planting: require('./assets/First＿planting.png'),
  watering: require('./assets/water.png'),
  growing: require('./assets/growing.png'),
  self_care: require('./assets/Self-care.png'),
};
const ACHIEVEMENT_META: Record<string, { label: string; img: any; unit: string }> = {
  first_planting: { label: '初次種植', img: require('./assets/First＿planting.png'), unit: '次' },
  watering: { label: '持續澆灌', img: require('./assets/water.png'), unit: '天' },
  growing: { label: '茁壯成長', img: require('./assets/growing.png'), unit: '次' },
  self_care: { label: '自我關懷', img: require('./assets/Self-care.png'), unit: '次' },
};
const FEATURE_ASSETS = {
  leaf: require('./assets/leaf.png'),
  planting: require('./assets/Planting.png'),
  collect: require('./assets/collect.png'),
  feeling: require('./assets/Feeling.png'),
  starOff: require('./assets/start1.png'),
  starOn: require('./assets/start2.png'),
  gear: require('./assets/gear_icon_no_bg.png'),
  trash: require('./assets/trash.png'),
};
const AVATAR_OPTIONS = [
  { key: 'boy',  label: '男孩', img: require('./assets/Boy.png') },
  { key: 'girl', label: '女孩', img: require('./assets/girl.png') },
  { key: 'bear', label: '小熊', img: require('./assets/bear.png') },
  { key: 'pig',  label: '小豬', img: require('./assets/pig.png') },
];
function getAvatarSource(avatarKey: string) {
  const found = AVATAR_OPTIONS.find(a => a.key === avatarKey);
  return found?.img || require('./assets/Boy.png');
}

const WEEK_DAYS = ['日', '一', '二', '三', '四', '五', '六'];
const TREE_POSITIONS = [
  { x: 0.76, y: 0.57 }, { x: 0.40, y: 0.68 }, { x: 0.62, y: 0.66 }, { x: 0.31, y: 0.60 }, { x: 0.70, y: 0.62 },
  { x: 0.45, y: 0.56 }, { x: 0.58, y: 0.58 }, { x: 0.40, y: 0.63 }, { x: 0.68, y: 0.64 }, { x: 0.50, y: 0.52 },
];

type TreeRecord = {
  id: string;
  date: string;
  mood: string;
  summary?: string;
  scores?: Record<string, number>;
  raw?: any;
};

const AuthContext = createContext({
  token: '',
  username: '',
  avatar: '',
  setUsername: (_n: string) => {},
  setAvatar: (_u: string) => {},
  logout: () => {},
});

// ─── 工具函式 ───

function norm(scores: Record<string, number> = {}): Record<string, number> {
  const dec = Object.values(scores).some(v => v > 0 && v <= 1);
  return dec
    ? Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Math.round(v * 100)]))
    : scores;
}

// 對齊 
function calcScore(e: Record<string, number> = {}) {
  const scale = Object.values(e).some(v => v > 1) ? 1 : 100;
  const pos = POS_EMO.reduce((s, k) => s + (e[k] || 0) * scale, 0);
  const neg = NEG_EMO.reduce((s, k) => s + (e[k] || 0) * scale, 0);
  return Math.max(0, Math.min(100, Math.round(pos * 0.6 - neg * 0.4 + 50)));
}

function toTreeRecord(d: any): TreeRecord {
  return {
    id: String(d.id || d._id || d.analyzed_at || Math.random()),
    date: d.date_label || d.analyzed_at?.slice(0, 10) || d.date || '',
    mood: d.dominant_emotions?.[0] || d.dominantEmotion || 'Joy',
    summary: d.daily_summary || d.summary || d.one_line_summary || d.analysis_notes || '',
    scores: d.scores || d.average_scores || {},
    raw: d,
  };
}

function getTopEmotions(scores: Record<string, number> = {}, limit = 3) {
  const ns = norm(scores);
  return Object.entries(ns)
    .sort((a, b) => (b[1] || 0) - (a[1] || 0))
    .filter(([, v]) => v > 0)
    .slice(0, limit);
}

// 對齊 HTML getEmoSource：根據 EMO_SRC 取對應 tag 的說明
function getEmoSource(raw: any, key: string, scoreVal: number): string {
  const savedReason = raw?.emotion_reasons?.[key] || raw?.emotionReasons?.[key];
  if (savedReason) return savedReason;
  if (!raw || scoreVal === 0) {
    return `MongoDB 尚未儲存${EC[key]?.l || key}的具體原因。`;
  }
  const cats = EMO_SRC[key] || ['st'];
  const lines: string[] = [];
  cats.forEach(c => {
    const list: any[] = c === 'st' ? (raw.st || raw.stressor_tags || [])
                       : c === 'bt' ? (raw.bt || raw.buffer_tags || [])
                       :              (raw.jt || raw.joy_tags || []);
    list.filter((t: any) => (t.t || t.tag) !== 'none' && (t.r || t.reason || t.text || t.label)).forEach((t: any) => lines.push(t.r || t.reason || t.text || t.label));
  });
  if (!lines.length) {
    const all = [
      ...(raw.st || []), ...(raw.bt || []), ...(raw.jt || []),
    ].filter((t: any) => (t.t || t.tag) !== 'none' && (t.r || t.reason || t.text || t.label)).map((t: any) => t.r || t.reason || t.text || t.label);
    return all.length
      ? all.join('；也因為') + '，共同影響了今天的情緒。'
      : `MongoDB 尚未儲存${EC[key]?.l || key}的具體原因。`;
  }
  return lines.join('；也因為') + '。';
}

function emotionTagsFromResult(result: any) {
  const tags = result?.emotionTags || result?.emotion_tags || result?.stressor_tags || [];
  if (Array.isArray(tags)) {
    return tags
      .map((t: any) => typeof t === 'string' ? t : (TL[t.tag] || t.tag || t.label))
      .filter(Boolean)
      .slice(0, 5);
  }
  return [];
}


function normalizeReasonTags(list: any[] = []) {
  return (Array.isArray(list) ? list : [])
    .map((t: any) => ({
      t: t?.t || t?.tag || t?.label || '',
      r: t?.r || t?.reason || t?.text || t?.description || '',
    }))
    .filter((t: any) => t.t && t.t !== 'none' && t.r);
}

function getTagGroups(raw: any) {
  return {
    st: normalizeReasonTags(raw?.st || raw?.stressor_tags || raw?.stressors || []),
    bt: normalizeReasonTags(raw?.bt || raw?.buffer_tags || raw?.buffers || []),
    jt: normalizeReasonTags(raw?.jt || raw?.joy_tags || raw?.joy_sources || []),
  };
}

function aggregateImpact(records: TreeRecord[]) {
  const makeBucket = () => new Map<string, { tag: string; score: number; reasons: string[] }>();
  const st = makeBucket();
  const jt = makeBucket();
  const bt = makeBucket();

  const add = (bucket: Map<string, { tag: string; score: number; reasons: string[] }>, tag: string, reason: string, score: number) => {
    if (!tag || tag === 'none' || score <= 0) return;
    const current = bucket.get(tag) || { tag, score: 0, reasons: [] };
    current.score += score;
    if (reason && !current.reasons.includes(reason)) current.reasons.push(reason);
    bucket.set(tag, current);
  };

  records.forEach(record => {
    const scores = norm(record.scores || {});
    const negative = NEG_EMO.reduce((sum, key) => sum + (scores[key] || 0), 0);
    const positive = (scores.Joy || 0) + (scores.Trust || 0) + (scores.Anticipation || 0);
    const buffer = (scores.Trust || 0) + Math.round(positive * 0.35);
    const groups = getTagGroups(record.raw);
    groups.st.forEach((t: any) => add(st, t.t, t.r, negative));
    groups.jt.forEach((t: any) => add(jt, t.t, t.r, positive));
    groups.bt.forEach((t: any) => add(bt, t.t, t.r, buffer));
  });

  const toList = (bucket: Map<string, { tag: string; score: number; reasons: string[] }>) => {
    const total = Array.from(bucket.values()).reduce((sum, item) => sum + item.score, 0) || 1;
    return Array.from(bucket.values())
      .map(item => ({
        ...item,
        percent: Math.round((item.score / total) * 100),
        label: TL[item.tag] || item.tag,
      }))
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 5);
  };

  return {
    stressors: toList(st),
    joys: toList(jt),
    buffers: toList(bt),
  };
}

function TagReasonSection({ raw }: { raw?: any }) {
  const groups = getTagGroups(raw);
  const renderGroup = (title: string, list: any[], bg: string, color: string) => {
    if (!list.length) return null;
    return (
      <View style={{ marginTop: 10 }}>
        <Text style={s.sectionLabel}>{title}</Text>
        {list.map((t: any, i: number) => (
          <View key={`${title}-${i}`} style={s.tagRow}>
            <View style={[s.pill, { backgroundColor: bg }]}>
              <Text style={[s.mini, { color }]}>{TL[t.t] || t.t}</Text>
            </View>
            <Text style={[s.body, { flex: 1 }]}>{t.r}</Text>
          </View>
        ))}
      </View>
    );
  };

  if (!groups.st.length && !groups.bt.length && !groups.jt.length) {
    return <Text style={[s.mini, { color: '#bbb' }]}>MongoDB 目前沒有這天的標籤來源資料。</Text>;
  }

  return (
    <View>
      {renderGroup('壓力來源', groups.st, '#D85A3022', '#D85A30')}
      {renderGroup('情緒緩衝', groups.bt, '#1D9E7522', '#1D9E75')}
      {renderGroup('快樂來源', groups.jt, '#7F77DD22', '#7F77DD')}
    </View>
  );
}

function getSafeDaysInMonth(year: number, month: number) {
  const y = Number.isFinite(year) ? year : new Date().getFullYear();
  const m = Number.isFinite(month) && month >= 1 && month <= 12 ? month : new Date().getMonth() + 1;
  const days = new Date(y, m, 0).getDate();
  return Number.isFinite(days) && days > 0 ? days : 31;
}

function getSafeFirstDow(year: number, month: number) {
  const y = Number.isFinite(year) ? year : new Date().getFullYear();
  const m = Number.isFinite(month) && month >= 1 && month <= 12 ? month : new Date().getMonth() + 1;
  const dow = new Date(y, m - 1, 1).getDay();
  return Number.isFinite(dow) && dow >= 0 && dow <= 6 ? dow : 0;
}

function getMonthWeekCount(_year: number, _month: number) {
  return 4;
}

function getMonthWeekRange(year: number, month: number, week: number) {
  const safeWeek = Math.max(1, Math.min(4, Number.isFinite(week) ? week : 1));
  const lastDay = getSafeDaysInMonth(year, month);
  if (safeWeek === 1) return { startDay: 1, endDay: Math.min(7, lastDay), lastDay };
  if (safeWeek === 2) return { startDay: 8, endDay: Math.min(14, lastDay), lastDay };
  if (safeWeek === 3) return { startDay: 15, endDay: Math.min(21, lastDay), lastDay };
  return { startDay: Math.min(22, lastDay), endDay: lastDay, lastDay };
}

function getDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function recordMatchesMonth(record: TreeRecord, year: number, month: number) {
  return record.date?.startsWith(`${year}-${String(month).padStart(2, '0')}-`);
}

function isWeekComplete(records: TreeRecord[], year: number, month: number, week: number) {
  const { startDay, endDay } = getMonthWeekRange(year, month, week);
  const days = new Set(records.filter(r => recordMatchesMonth(r, year, month)).map(r => Number(r.date?.slice(8, 10))).filter(Boolean));
  for (let day = startDay; day <= endDay; day++) {
    if (!days.has(day)) return false;
  }
  return true;
}

// ─── UI 元件 ───

function ScreenBg({ source, children }: any) {
  return (
    <ImageBackground source={source} style={{ flex: 1 }} resizeMode="cover">
      {children}
    </ImageBackground>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={s.backBtn}>
      <Image source={require('./assets/return.png')} style={{ width: 26, height: 26 }} resizeMode="contain" />
    </TouchableOpacity>
  );
}

function countTagLabels(records: TreeRecord[], groupKey: 'st' | 'bt' | 'jt', limit = 3) {
  const counts = new Map<string, number>();
  records.forEach(record => {
    const list = getTagGroups(record.raw)[groupKey] || [];
    list.forEach((item: any) => {
      const label = TL[item.t] || item.t;
      if (label && label !== '無') counts.set(label, (counts.get(label) || 0) + 1);
    });
  });
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label]) => label);
}

function getRecentRecords(records: TreeRecord[], limit = 28) {
  return [...records]
    .filter(r => r.date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
    .reverse();
}

function buildJourneyOverview(records: TreeRecord[]) {
  const recent = getRecentRecords(records, 28);
  const totals: Record<string, number> = Object.fromEntries(EMO_KEYS.map(k => [k, 0]));
  recent.forEach(record => {
    const scores = norm(record.scores || {});
    EMO_KEYS.forEach(k => { totals[k] += scores[k] || 0; });
  });
  const totalValue = Object.values(totals).reduce((sum, v) => sum + v, 0) || 1;
  const distribution = EMO_KEYS.map(key => ({
    key,
    label: EC[key].l,
    color: EC[key].c,
    percent: Math.round((totals[key] / totalValue) * 100),
  })).sort((a, b) => b.percent - a.percent);
  const topMoods = distribution.filter(item => item.percent > 0).slice(0, 3).map(item => item.label);
  const stress = countTagLabels(recent, 'st', 4);
  const support = [...countTagLabels(recent, 'bt', 3), ...countTagLabels(recent, 'jt', 3)]
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 4);
  const joyTrust = (totals.Joy || 0) + (totals.Trust || 0);
  const sadFear = (totals.Sadness || 0) + (totals.Fear || 0);
  const angerDisgust = (totals.Anger || 0) + (totals.Disgust || 0);
  const weather = joyTrust >= sadFear + angerDisgust ? '晴天' : sadFear > joyTrust ? '小雨轉多雲' : '微風';
  const commonTree = distribution[0]?.label || '心情';
  return {
    recent,
    distribution,
    topMoods,
    stress,
    support,
    weather,
    treeCount: recent.length,
    commonTree,
    summary: recent.length
      ? `這段時間你最常出現的是${topMoods.join('、') || '多種心情'}，${stress.length ? `壓力多半和${stress.slice(0, 2).join('、')}有關。` : '小島上留下了不少真實的心情痕跡。'}`
      : '開始記錄後，小島精靈會在這裡整理你的心情旅程。',
    message: recent.length
      ? '你不需要每天都很快樂，只要願意誠實記錄自己的心情，就已經是在照顧自己了。'
      : '等你種下第一棵心情樹，這裡就會慢慢長出屬於你的回顧。',
  };
}

function EmotionDonut({ records, size = 116 }: { records: TreeRecord[]; size?: number }) {
  const overview = buildJourneyOverview(records);
  const radius = size * 0.36;
  const strokeWidth = 12;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const parts = overview.distribution.filter(item => item.percent > 0);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <Circle cx={center} cy={center} r={radius} stroke="#EFE7DA" strokeWidth={strokeWidth} fill="none" />
        {parts.map(item => {
          const dash = (item.percent / 100) * circumference;
          const currentOffset = offset;
          offset += dash;
          return (
            <G key={item.key} rotation={-90} originX={center} originY={center}>
              <Circle
                cx={center}
                cy={center}
                r={radius}
                stroke={item.color}
                strokeWidth={strokeWidth}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${Math.max(1, dash)} ${circumference}`}
                strokeDashoffset={-currentOffset}
              />
            </G>
          );
        })}
      </Svg>
      <Image source={MOOD_TREE[overview.distribution[0]?.key || 'Trust']?.img || MOOD_TREE.Trust.img} style={{ position: 'absolute', width: size * 0.46, height: size * 0.46 }} resizeMode="contain" />
    </View>
  );
}

function AchievementPopup({ popup, onClose }: { popup: any; onClose: () => void }) {
  const pulse = useRef(new Animated.Value(0.78)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.78, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  const asset = ACHIEVEMENT_ASSETS[popup?.key] || FEATURE_ASSETS.leaf;
  return (
    <TouchableOpacity style={s.achievementOverlay} activeOpacity={1} onPress={onClose}>
      <Animated.Image source={asset} style={[s.achievementPopupImage, { opacity: pulse, transform: [{ scale: pulse.interpolate({ inputRange: [0.78, 1], outputRange: [0.96, 1.04] }) }] }]} resizeMode="contain" />
      <Text style={s.achievementPopupTitle}>{popup?.title || '新的成就'}</Text>
      <Text style={s.achievementPopupHint}>按任意一個地方確認</Text>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────
// 柱狀圖元件（對齊 HTML drawBar）
// ─────────────────────────────────────────────────────────
interface BarChartProps {
  scores: Record<string, number>;          // normalized 0~100
  raw?: any;                               // for getEmoSource
}

function EmotionBarChart({ scores, raw }: BarChartProps) {
  const [popup, setPopup] = useState<{ key: string; text: string } | null>(null);

  const chartW = 560;
  const chartH = 286;
  const PL = 54, PR = 28, PT = 48, PB = 62;
  const gW = chartW - PL - PR;
  const gH = chartH - PT - PB;

  const bW = Math.floor((gW / EMO_KEYS.length) * 0.55);
  const gap = gW / EMO_KEYS.length;

  const gridValues = [0, 25, 50, 75, 100];

  const handleBarPress = (key: string) => {
    const val = scores[key] || 0;
    const text = getEmoSource(raw, key, val);
    setPopup({ key, text });
  };

  return (
    <View>
      {/* SVG 圖表 */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 8 }}>
      <Svg width={chartW} height={chartH}>
        {/* 格線 + Y 軸標籤 */}
        {gridValues.map(v => {
          const y = PT + gH - (v / 100) * gH;
          return (
            <G key={v}>
              <Line x1={PL} y1={y} x2={chartW - PR} y2={y} stroke="#f0f0f0" strokeWidth={1} />
              <SvgText
                x={PL - 4}
                y={y + 4}
                fontSize={14}
                fill="#bbb"
                textAnchor="end"
              >
                {v}%
              </SvgText>
            </G>
          );
        })}

        {/* 柱狀 */}
        {EMO_KEYS.map((key, i) => {
          const val = scores[key] || 0;
          const x = PL + i * gap + (gap - bW) / 2;
          const bH = (val / 100) * gH;
          const y = PT + gH - bH;
          const r = 4;
          const color = EC[key].c;

          // 圓角柱（上方圓角，對齊 HTML quadraticCurveTo 效果）
          const barPath = bH > 0
            ? `M ${x + r} ${y} L ${x + bW - r} ${y} Q ${x + bW} ${y} ${x + bW} ${y + r} L ${x + bW} ${y + bH} L ${x} ${y + bH} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`
            : '';

          const labelX = x + bW / 2;

          return (
            <G key={key}>
              {/* 點擊區域（整列高度，對齊 HTML barHitBoxes y:PT h:gH+PB-10）*/}
              <Rect
                x={x}
                y={PT}
                width={bW}
                height={gH + PB - 10}
                fill="transparent"
                onPress={() => handleBarPress(key)}
              />
              {/* 圓角柱 */}
              {bH > 0 && (
                <Path d={barPath} fill={color + 'cc'} />
              )}
              {/* 數值標籤 */}
              {val > 0 && (
                <SvgText x={labelX} y={y - 7} fontSize={14} fill={color} textAnchor="middle">
                  {val}%
                </SvgText>
              )}
              {/* 情緒名稱 */}
              <SvgText
                x={labelX}
                y={PT + gH + 18}
                fontSize={14}
                fill="#888"
                textAnchor="middle"
              >
                {EC[key].l}
              </SvgText>
            </G>
          );
        })}
      </Svg>
      </ScrollView>

      <Text style={s.chartHint}>點擊柱狀圖查看情緒來源</Text>

      {/* Popup（對齊 HTML ePopup）*/}
      {popup && (
        <View style={[s.emoPopup, { borderLeftColor: EC[popup.key].c, backgroundColor: EC[popup.key].c + '18' }]}>
          <View style={s.emoPopupHdr}>
            <Text style={[s.emoPopupTitle, { color: EC[popup.key].c }]}>
              {EC[popup.key].l}　{scores[popup.key] || 0}%
            </Text>
            <TouchableOpacity onPress={() => setPopup(null)}>
              <Text style={s.emoPopupClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.emoPopupBody}>{popup.text}</Text>
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// 折線圖元件（對齊 HTML drawLine）
// ─────────────────────────────────────────────────────────
interface LineChartProps {
  records: TreeRecord[];
  month: number;
  year: number;
  onDayChange?: (idx: number) => void;
}

function EmotionLineChart({ records, month, year, onDayChange }: LineChartProps) {
  const guideXRef = useRef<number>(-1);
  const [guideX, setGuideXState] = useState(-1);
  const lineXRef = useRef<number[]>([]);

  const chartW = 580;
  const chartH = 350;
  const PL = 62, PR = 34, PT = 56, PB = 66;
  const gW = chartW - PL - PR;
  const gH = chartH - PT - PB;
  const moodScores = records.map(r => calcScore(norm(r.scores || {})));

  const lineX = records.map((_, i) =>
    records.length === 1 ? PL + gW / 2 : PL + i * (gW / (records.length - 1))
  );
  lineXRef.current = lineX;

  useEffect(() => {
    const init = lineX[records.length - 1];
    guideXRef.current = init;
    setGuideXState(init);
    onDayChange?.(records.length - 1);
  }, [records.length]);

  const findNearest = (gx: number) => {
    let ci = 0, minD = Infinity;
    lineXRef.current.forEach((x, i) => {
      const d = Math.abs(x - gx);
      if (d < minD) { minD = d; ci = i; }
    });
    return ci;
  };

  const clampedGuide = Math.max(PL, Math.min(chartW - PR, guideX < 0 ? lineX[records.length - 1] : guideX));
  const si = Math.min(findNearest(clampedGuide), records.length - 1);
  const gx = clampedGuide;
  const hY = PT + gH + 8;
  const diamondPath = `M ${gx} ${hY - 7} L ${gx + 6} ${hY} L ${gx} ${hY + 7} L ${gx - 6} ${hY} Z`;

  const containerWidthRef = useRef(chartW);
  const updateByX = (rawX: number) => {
    const svgX = (rawX / containerWidthRef.current) * chartW;
    const clamped = Math.max(PL, Math.min(chartW - PR, svgX));
    guideXRef.current = clamped;
    setGuideXState(clamped);
    const idx = findNearest(clamped);
    onDayChange?.(idx);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => updateByX(evt.nativeEvent.locationX),
      onPanResponderMove: (evt) => updateByX(evt.nativeEvent.locationX),
    })
  ).current;

  const selectedRecord = records[si];
  const selectedDayLabel = selectedRecord ? `${month}/${Number(selectedRecord.date.slice(8, 10))}` : '';
  const selectedScore = moodScores[si] ?? 50;
  const ttW = selectedDayLabel.length * 8 + 16;
  let ttX = gx - ttW / 2;
  if (ttX < PL) ttX = PL;
  if (ttX + ttW > chartW - PR) ttX = chartW - PR - ttW;
  const tooltipY = PT - 2;

  const makeMoodPath = () => {
    const pts = moodScores.map((v, i) => ({ x: lineX[i], y: PT + gH - (v / 100) * gH }));
    return pts.reduce((a, p, i) => i === 0 ? `M ${p.x} ${p.y}` : `${a} L ${p.x} ${p.y}`, '');
  };

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 8 }}>
    <View
      {...panResponder.panHandlers}
      onLayout={e => { containerWidthRef.current = e.nativeEvent.layout.width; }}
      style={{ width: chartW }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text style={[s.mini, { color: C.sub }]}>低落</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={{ width: 36, height: 3, borderRadius: 2, backgroundColor: C.accent }} />
          <Text style={[s.mini, { color: C.accent, fontFamily: FONT_BOLD }]}>心情指數 {selectedScore}%</Text>
        </View>
        <Text style={[s.mini, { color: C.sub }]}>開心</Text>
      </View>

      <Svg width={chartW} height={chartH}>
        {[0, 25, 50, 75, 100].map(v => {
          const y = PT + gH - (v / 100) * gH;
          const label = v === 0 ? '低落' : v === 50 ? '平穩' : v === 100 ? '開心' : `${v}`;
          return (
            <G key={v}>
              <Line x1={PL} y1={y} x2={chartW - PR} y2={y} stroke="#f0f0f0" strokeWidth={1} />
              <SvgText x={PL - 7} y={y + 5} fontSize={13} fill="#aaa" textAnchor="end">{label}</SvgText>
            </G>
          );
        })}

        {records.map((r, i) => (
          <SvgText key={i} x={lineX[i]} y={chartH - PB + 22} fontSize={13} fill="#aaa" textAnchor="middle">
            {`${month}/${Number(r.date.slice(8, 10))}`}
          </SvgText>
        ))}

        <Path
          d={makeMoodPath()}
          fill="none"
          stroke={C.accent}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.96}
        />

        {records.map((r, i) => {
          const v = moodScores[i] || 0;
          const y = PT + gH - (v / 100) * gH;
          return (
            <Circle
              key={`${r.id}-${i}`}
              cx={lineX[i]}
              cy={y}
              r={i === si ? 6 : 4}
              fill={i === si ? C.accent : '#fff'}
              stroke={C.accent}
              strokeWidth={2}
              onPress={() => {
                guideXRef.current = lineX[i];
                setGuideXState(lineX[i]);
                onDayChange?.(i);
              }}
            />
          );
        })}

        <Line x1={gx} y1={PT} x2={gx} y2={PT + gH} stroke="#1a1a1a" strokeWidth={1.4} strokeDasharray="4,3" />
        <Path d={diamondPath} fill="#1a1a1a" />

        {selectedDayLabel.length > 0 && (
          <G>
            <Rect x={ttX} y={tooltipY} width={ttW} height={22} rx={5} fill="#1a1a1a" />
            <SvgText x={ttX + 8} y={tooltipY + 15} fontSize={12} fill="#fff" textAnchor="start">{selectedDayLabel}</SvgText>
          </G>
        )}
      </Svg>
      <Text style={s.chartHint}>心情指數由正向情緒與負向情緒加權而成</Text>
    </View>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────
// WelcomeScreen
// ─────────────────────────────────────────────────────────
function WelcomeScreen({ onStart, onLogin }: any) {
  const fadeAnim = useRef(new Animated.Value(0.78)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(fadeAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
          Animated.timing(fadeAnim, { toValue: 0.82, duration: 1400, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(floatAnim, { toValue: -3, duration: 1400, useNativeDriver: true }),
          Animated.timing(floatAnim, { toValue: 0, duration: 1400, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, []);

  return (
    <ScreenBg source={require('./assets/welcome.png')}>
      <View style={s.welcomePage}>
        <Animated.View style={[s.welcomeTextArea, { opacity: fadeAnim, transform: [{ translateY: floatAnim }] }]}>
          <View style={s.welcomeTitleRow}>
            <Text style={s.welcomeAppName}>心情小島</Text>
            <Text style={s.welcomeLeaf}>🌱</Text>
          </View>
          <Text style={s.welcomeSlogan}>每一段心情，{'\n'}都值得被好好安放。</Text>
        </Animated.View>
        <TouchableOpacity style={s.welcomeStartBtn} onPress={onStart}>
          <Text style={s.welcomeStartText}>開始旅程</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onLogin} style={s.welcomeLoginLink}>
          <Text style={s.welcomeLoginText}>已有帳號？ <Text style={s.welcomeLoginStrong}>登入</Text></Text>
        </TouchableOpacity>
      </View>
    </ScreenBg>
  );
}

// ─────────────────────────────────────────────────────────
// LoginScreen
// ─────────────────────────────────────────────────────────
function LoginScreen({ mode, setMode, onLoggedIn }: any) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) { Alert.alert('請填寫 Email 和密碼'); return; }
    setAuthLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) });
      const data = await res.json();
      if (res.ok) onLoggedIn(data.token, data.user.username, false, data.user.avatar, data.user.onboarding_seen);
      else Alert.alert('登入失敗', data.detail || '請確認帳號密碼');
    } catch { Alert.alert('無法連接到後端伺服器'); } finally { setAuthLoading(false); }
  };

  const handleRegister = async () => {
    if (!regUsername.trim() || !regEmail.trim() || !regPassword.trim()) { Alert.alert('請填寫所有欄位'); return; }
    if (regPassword !== regConfirm) { Alert.alert('密碼不一致'); return; }
    if (regPassword.length < 6) { Alert.alert('密碼至少 6 個字元'); return; }
    setAuthLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: regUsername.trim(), email: regEmail.trim(), password: regPassword }) });
      const data = await res.json();
      if (res.ok) onLoggedIn(data.token, data.user.username, true, data.user.avatar, data.user.onboarding_seen);
      else Alert.alert('註冊失敗', data.detail || '請稍後再試');
    } catch { Alert.alert('無法連接到後端伺服器'); } finally { setAuthLoading(false); }
  };

  if (mode === 'register') {
    return (
      <ScreenBg source={require('./assets/login.png')}>
        <ScrollView contentContainerStyle={s.loginScroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={s.loginBackCircle} onPress={() => setMode('login')}>
            <Image source={require('./assets/return.png')} style={{ width: 20, height: 20 }} resizeMode="contain" />
          </TouchableOpacity>
          <View style={s.loginHeader}>
            <Text style={s.loginTitle}>建立帳號</Text>
            <Text style={s.loginSubtitle}>開始你的心情小島旅程</Text>
          </View>
          <View style={s.loginForm}>
            <TextInput style={s.loginInput} placeholder="暱稱" placeholderTextColor={C.muted} value={regUsername} onChangeText={setRegUsername} />
            <TextInput style={s.loginInput} placeholder="電子郵件" placeholderTextColor={C.muted} value={regEmail} onChangeText={setRegEmail} autoCapitalize="none" keyboardType="email-address" />
            <TextInput style={s.loginInput} placeholder="密碼" placeholderTextColor={C.muted} value={regPassword} onChangeText={setRegPassword} secureTextEntry />
            <TextInput style={s.loginInput} placeholder="確認密碼" placeholderTextColor={C.muted} value={regConfirm} onChangeText={setRegConfirm} secureTextEntry />
          </View>
          <TouchableOpacity style={s.loginBtn} onPress={handleRegister} disabled={authLoading}>
            {authLoading ? <ActivityIndicator color="white" /> : <Text style={s.loginBtnText}>立即註冊</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={s.registerSwitch} onPress={() => setMode('login')}>
            <Text style={s.smallHint}>已有帳號？ <Text style={s.greenText}>登入</Text></Text>
          </TouchableOpacity>
        </ScrollView>
      </ScreenBg>
    );
  }

  return (
    <ScreenBg source={require('./assets/login.png')}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.loginPage}>
          <TouchableOpacity style={s.loginBackCircle} onPress={() => setMode('register')}>
            <Image source={require('./assets/return.png')} style={{ width: 20, height: 20 }} resizeMode="contain" />
          </TouchableOpacity>
          <View style={s.loginHeader}>
            <Text style={s.loginTitle}>歡迎回來 🌱</Text>
            <Text style={s.loginSubtitle}>登入你的心情小島</Text>
          </View>
          <View style={s.loginForm}>
            <TextInput style={s.loginInput} placeholder="電子郵件" placeholderTextColor={C.muted} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <TextInput style={s.loginInput} placeholder="密碼" placeholderTextColor={C.muted} value={password} onChangeText={setPassword} secureTextEntry />
            <TouchableOpacity style={s.forgotBtn}><Text style={s.forgotText}>忘記密碼？</Text></TouchableOpacity>
          </View>
          <TouchableOpacity style={s.loginBtn} onPress={handleLogin} disabled={authLoading}>
            {authLoading ? <ActivityIndicator color="white" /> : <Text style={s.loginBtnText}>登入</Text>}
          </TouchableOpacity>
          <View style={s.dividerRow}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>或使用其他方式登入</Text>
            <View style={s.dividerLine} />
          </View>
          <View style={s.socialRow}>
            {['G', 'f'].map(x => <TouchableOpacity key={x} style={s.socialBtn}><Text style={s.socialText}>{x}</Text></TouchableOpacity>)}
          </View>
          <TouchableOpacity style={s.registerSwitch} onPress={() => setMode('register')}>
            <Text style={s.smallHint}>還沒有帳號？ <Text style={s.greenText}>立即註冊</Text></Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </ScreenBg>
  );
}

// ─────────────────────────────────────────────────────────
// OnboardingScreen
// ─────────────────────────────────────────────────────────
function OnboardingScreen({ onDone }: any) {
  const [page, setPage] = useState(0);

  const onboardingPages = [
    { key: 'features' },
    { key: 'position' },
    { key: 'review' },
  ];

  const onScrollEnd = (e: any) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / SW);
    setPage(index);
  };

  const finishOnboarding = async () => {
    onDone();
  };

  const renderPage = ({ item }: any) => {
    if (item.key === 'features') {
      return (
        <View style={s.onboardPageV2}>
          <OnboardHeader />
          <View style={s.featureCardsWrapV2}>
            <View style={s.featureCardV2}>
              <Image source={require('./assets/sad.png')} style={s.featureIconV2} resizeMode="contain" />
              <View style={s.featureTextBoxV2}>
                <Text style={s.featureTitleV2}>記錄心情</Text>
                <Text style={s.featureDescV2}>寫下每一天的心情，{`\n`}讓情緒被看見。</Text>
              </View>
            </View>
            <View style={s.featureCardV2}>
              <Image source={require('./assets/Trust.png')} style={s.featureIconV2} resizeMode="contain" />
              <View style={s.featureTextBoxV2}>
                <Text style={s.featureTitleV2}>種下心情樹</Text>
                <Text style={s.featureDescV2}>心情會長成一棵樹，{`\n`}種在你的小島上。</Text>
              </View>
            </View>
            <View style={s.featureCardV2}>
              <View style={s.featureChartIconV2}>
                <Svg width="52" height="42" viewBox="0 0 52 42">
                  <Line x1="7" y1="35" x2="45" y2="35" stroke="#DED7CA" strokeWidth="1.4" />
                  <Line x1="7" y1="8" x2="7" y2="35" stroke="#DED7CA" strokeWidth="1.4" />
                  <Path d="M9 29 L19 21 L28 25 L43 11" fill="none" stroke="#6F8F88" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                  <Circle cx="9" cy="29" r="2.3" fill="#6F8F88" />
                  <Circle cx="19" cy="21" r="2.3" fill="#6F8F88" />
                  <Circle cx="28" cy="25" r="2.3" fill="#6F8F88" />
                  <Circle cx="43" cy="11" r="2.3" fill="#6F8F88" />
                </Svg>
              </View>
              <View style={s.featureTextBoxV2}>
                <Text style={s.featureTitleV2}>回顧成長</Text>
                <Text style={s.featureDescV2}>看見自己的情緒變化，{`\n`}陪伴自己慢慢成長。</Text>
              </View>
            </View>
          </View>
        </View>
      );
    }

    if (item.key === 'position') {
      return (
        <View style={s.onboardPageV2}>
          <OnboardHeader />
          <View style={s.function2CardV2}>
            <Image source={require('./assets/Function2.png')} style={s.function2ImageV2} resizeMode="cover" />
          </View>
          <View style={s.onboardTextAreaV2}>
            <Text style={s.onboardMainTitleV2}>每一種心情，都有它的位置</Text>
            <Text style={s.onboardDescV2}>不論是開心、難過、期待或生氣，{`\n`}都可以被好好安放在你的小島上。</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={s.onboardPageV2}>
        <OnboardHeader />
        <View style={s.reviewPreviewWrapV2}>
          <View style={s.reviewTrendCardV2}>
            <Svg width="100%" height="116" style={{ position: 'absolute', top: 16, left: 0 }}>
              <Path d="M 32 68 C 70 40, 94 26, 128 64 S 194 92, 226 56 S 288 20, 338 62" fill="none" stroke="#D9D4C8" strokeWidth="2" />
            </Svg>
            {[
              { img: require('./assets/joy.png'), date: '5/18', left: 16, top: 57 },
              { img: require('./assets/Trust.png'), date: '5/19', left: 78, top: 24 },
              { img: require('./assets/sad.png'), date: '5/20', left: 140, top: 66 },
              { img: require('./assets/Surprise.png'), date: '5/21', left: 202, top: 51 },
              { img: require('./assets/Anticipation.png'), date: '5/22', left: 264, top: 20 },
              { img: require('./assets/Trust.png'), date: '5/24', left: 326, top: 58 },
            ].map((x, i) => (
              <View key={i} style={[s.reviewTreePointV2, { left: x.left, top: x.top }]}>
                <Image source={x.img} style={s.reviewSmallTreeV2} resizeMode="contain" />
                <Text style={s.reviewDateV2}>{x.date}</Text>
              </View>
            ))}
          </View>
          <View style={s.reviewAnalysisCardV2}>
            <Text style={s.reviewCardTitleV2}>5/22 心情分析</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
              <Image source={require('./assets/sad.png')} style={s.reviewMainTreeV2} resizeMode="contain" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.reviewEmotionTextV2}>主要情緒：難過 😢</Text>
                <Text style={s.reviewPercentV2}>65%</Text>
                {[
                  { label: '難過', value: '65%', color: '#8FA9C1', width: '65%' },
                  { label: '開心', value: '15%', color: '#E8D56A', width: '15%' },
                  { label: '期待', value: '10%', color: '#9FBF84', width: '10%' },
                  { label: '平靜', value: '5%',  color: '#B99AC8', width: '5%' },
                  { label: '生氣', value: '5%',  color: '#E98173', width: '5%' },
                ].map((bar) => (
                  <View key={bar.label} style={s.reviewBarRowV2}>
                    <Text style={s.reviewBarLabelV2}>{bar.label}</Text>
                    <View style={s.reviewBarBgV2}>
                      <View style={[s.reviewBarFillV2, { width: bar.width as DimensionValue, backgroundColor: bar.color }]} />
                    </View>
                    <Text style={s.reviewBarValueV2}>{bar.value}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>
        <View style={s.onboardTextAreaV2}>
          <Text style={s.onboardMainTitleV2}>回顧你的心情旅程</Text>
          <Text style={s.onboardDescV2}>透過趨勢和分析，了解自己的情緒變化，{`\n`}讓每一步都成為更好的自己。</Text>
        </View>
      </View>
    );
  };

  return (
    <ScreenBg source={require('./assets/Function.png')}>
      <View style={{ flex: 1 }}>
        <FlatList
          data={onboardingPages}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(item) => item.key}
          renderItem={renderPage}
          onMomentumScrollEnd={onScrollEnd}
        />
        <View style={s.onboardDotsV2}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[s.onboardDotV2, page === i && s.onboardDotActiveV2]} />
          ))}
        </View>
        {page === 2 && (
          <TouchableOpacity style={s.onboardFinalBtnV2} onPress={finishOnboarding} activeOpacity={0.86}>
            <Text style={s.onboardFinalBtnTextV2}>開始探索小島</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScreenBg>
  );
}

function OnboardHeader() {
  return (
    <View style={s.onboardHeaderV2}>
      <View style={s.onboardHeaderTitleRowV2}>
        <Text style={s.onboardTopTitleV2}>歡迎來到心情小島</Text>
        <Text style={s.onboardLeafV2}>🌱</Text>
      </View>
      <Text style={s.onboardTopSubtitleV2}>在這裡，你可以...</Text>
    </View>
  );
}

function SwipeNoticeItem({ item, onPress, onDelete }: any) {
  const translateX = useRef(new Animated.Value(0)).current;
  const swiped = useRef(false);
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderGrant: () => { swiped.current = false; },
      onPanResponderMove: (_, gesture) => {
        const x = Math.max(-150, Math.min(gesture.dx, 150));
        if (Math.abs(x) > 8) swiped.current = true;
        translateX.setValue(x);
      },
      onPanResponderRelease: (_, gesture) => {
        if (Math.abs(gesture.dx) > 125) {
          const target = gesture.dx > 0 ? SW : -SW;
          Animated.timing(translateX, { toValue: target, duration: 180, useNativeDriver: true }).start(() => onDelete(item));
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
      },
    })
  ).current;

  return (
    <View style={s.noticeSwipeWrap}>
      <View style={s.noticeDeleteBg}>
        <Image source={FEATURE_ASSETS.trash} style={[s.noticeTrashIcon, s.noticeTrashLeft]} resizeMode="contain" />
        <Image source={FEATURE_ASSETS.trash} style={[s.noticeTrashIcon, s.noticeTrashRight]} resizeMode="contain" />
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        <TouchableOpacity
          style={[s.noticeItem, s.noticeSwipeItem, item.severity === 'urgent' && { borderColor: '#C0392B', borderWidth: 1 }]}
          onPress={() => { if (!swiped.current) onPress(item); }}
          activeOpacity={0.86}
        >
          <Text style={s.noticeItemTitle}>{item.title}</Text>
          <Text style={s.noticeBody}>{item.message}</Text>
          <Text style={s.noticeAction}>{item.actionText || '查看'}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// HomeScreen
// ─────────────────────────────────────────────────────────
function HomeScreen({ navigation }: any) {
  const { token, username, avatar } = useContext(AuthContext);
  const [trees, setTrees] = useState<TreeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [todayStatus, setTodayStatus] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => { const unsub = navigation.addListener('focus', () => { fetchTrees(); fetchNotifications(); }); return unsub; }, [navigation, token]);
  useEffect(() => { if (token) { fetchTrees(); fetchNotifications(); } }, [token]);

  const fetchTrees = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${BASE_URL}/history`, { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      setTrees((Array.isArray(data) ? data : []).map(toTreeRecord).reverse());
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

const safeJson = async (res: Response) => {
  const text = await res.text();

  try {
    return text ? JSON.parse(text) : null;
  } catch (err) {
    console.log('Response is not JSON:', text);
    return null;
  }
};

  const fetchNotifications = async () => {
    if (!token) return;

    try {
      const h = { Authorization: `Bearer ${token}` };

      const statusRes = await fetch(`${BASE_URL}/daily-diary/today/status`, { headers: h });
      const statusData = await safeJson(statusRes);

      if (statusRes.ok && statusData) {
        setTodayStatus(statusData);
      } else {
        console.log('today status failed:', statusRes.status, statusData);
      }

      const res = await fetch(`${BASE_URL}/notifications`, { headers: h });
      const data = await safeJson(res);

      if (res.ok && data) {
        setNotifications(Array.isArray(data?.notifications) ? data.notifications : []);
        setUnreadCount(Number(data?.unread_count || 0));
      } else {
        console.log('notifications failed:', res.status, data);
        setNotifications([]);
        setUnreadCount(0);
      }
    } catch (e) {
      console.error(e);
      setNotifications([]);
      setUnreadCount(0);
    }
  };

  const openDiary = () => navigation.navigate('Diary');
  const markNotificationsRead = async () => {
    setUnreadCount(0);
    try {
      await fetch(`${BASE_URL}/notifications/read`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({}) });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (e) { console.error(e); }
  };

  const clearNotifications = async () => {
    try {
      await fetch(`${BASE_URL}/notifications/clear`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    } catch (e) { console.error(e); }
    setUnreadCount(0);
    setNotifications([]);
  };

  const dismissNotification = async (item: any) => {
    setNotifications(prev => prev.filter(n => n.id !== item.id));
    if (!item.read) setUnreadCount(prev => Math.max(0, prev - 1));
    try {
      await fetch(`${BASE_URL}/notifications/${item.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    } catch (e) { console.error(e); }
  };

  const openNoticePanel = () => {
    setNoticeOpen(true);
    if (unreadCount > 0) markNotificationsRead();
  };

  const openNoticeTarget = (item: any) => {
    setNoticeOpen(false);
    const target = item?.targetScreen;
    const params = item?.targetParams || {};
    if (target === 'DiaryScreen') navigation.navigate('Diary');
    else if (target === 'DailyDiaryEditScreen') {
      const d = todayStatus?.daily_diary;
      navigation.navigate('DailyDiaryEdit', { date: params.date || d?.date_label || todayStatus?.date, diary: d });
    } else if (target === 'DayTreeScreen') {
      const rec = trees.find(t => t.date === params.date);
      navigation.navigate('DayTree', { date: params.date, record: rec || null });
    } else if (target === 'DayAnalysisScreen') {
      const rec = trees.find(t => t.date === params.date);
      rec ? navigation.navigate('DayAnalysis', { date: rec.date, record: rec }) : navigation.navigate('MainTabs', { screen: 'TrendTab' });
    } else if (target === 'WeeklyAnalysisScreen') navigation.navigate('WeeklyAnalysis', params);
    else if (target === 'FavoritesScreen') navigation.navigate('Favorites');
    else if (target === 'SupportResourceScreen') Alert.alert('支持資源', '1925 安心專線\n1980 生命線\n如果你現在有傷害自己的念頭，請立刻聯絡身邊可信任的人或當地緊急服務。');
    else navigation.navigate('MainTabs', { screen: 'TrendTab' });
  };

  return (
    <View style={{ flex: 1 }}>
      <ImageBackground source={require('./assets/Homepage.png')} style={{ flex: 1 }} resizeMode="cover">
        <View style={s.homeHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => navigation.navigate('ProfileTab')} activeOpacity={0.85}>
              <Image source={getAvatarSource(avatar)} style={s.avatar} resizeMode="cover" />
            </TouchableOpacity>
            <View style={{ marginLeft: 10 }}>
              <Text style={s.homeHi}>Hi, {username}</Text>
              <Text style={s.homeRole}>心情小島居民</Text>
            </View>
          </View>
          <TouchableOpacity activeOpacity={0.85} onPress={openNoticePanel} style={s.homeElfWrap}>
            <Image source={require('./assets/elves.png')} style={s.homeElf} resizeMode="contain" />
            {unreadCount > 0 && (
              <View style={s.elfBadge}>
                <Text style={s.elfBadgeText}>{Math.min(unreadCount, 9)}</Text>
              </View>
            )}
            <Text style={s.homeElfText}>小島精靈</Text>
          </TouchableOpacity>
        </View>

        <View style={s.homePromptWrap}>
          <Text style={s.homePrompt}>今天想把哪一段心情，{`\n`}種在你的小島上呢？</Text>
        </View>

        {!loading && trees.length > 0 && (
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            {trees.slice(0, 10).map((tree, i) => {
              const pos = TREE_POSITIONS[i % TREE_POSITIONS.length];
              const treeSize = trees.length > 5 ? 34 : 42;
              return (
                <TouchableOpacity key={tree.id} onPress={() => navigation.navigate('DayTree', { date: tree.date, record: tree })} style={{ position: 'absolute', left: SW * pos.x - treeSize / 2, top: SH * pos.y - treeSize / 2, zIndex: 50, elevation: 50 }}>
                  <Image source={HOME_MOOD_TREE[tree.mood] || HOME_MOOD_TREE.Joy} style={{ width: treeSize, height: treeSize, opacity: 0.96 }} resizeMode="contain" />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={s.homeShovelWrap}>
          <TouchableOpacity onPress={openDiary} style={s.shovelCircle}>
            <Image source={require('./assets/shovel.png')} style={{ width: 60, height: 60 }} resizeMode="contain" />
          </TouchableOpacity>
        </View>
      </ImageBackground>

      <Modal visible={noticeOpen} transparent animationType="fade" onRequestClose={() => setNoticeOpen(false)}>
        <View style={s.noticeOverlay}>
          <View style={s.noticeCard}>
            <TouchableOpacity style={s.noticeClose} onPress={() => setNoticeOpen(false)}><Text style={s.noticeCloseText}>×</Text></TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <Image source={require('./assets/elves.png')} style={{ width: 58, height: 58, marginRight: 10 }} resizeMode="contain" />
              <View style={{ flex: 1 }}><Text style={s.noticeTitle}>小島精靈通知</Text><Text style={s.noticeSub}>{notifications.length ? '你的心情提醒都放在這裡' : '沒有最新通知囉'}</Text></View>
            </View>
            <ScrollView style={s.noticeListScroll} contentContainerStyle={s.noticeListContent} showsVerticalScrollIndicator={false}>
              {notifications.length ? notifications.slice(0, 12).map(item => (
                <SwipeNoticeItem key={item.id} item={item} onPress={openNoticeTarget} onDelete={dismissNotification} />
              )) : (
                <View style={s.noticeItem}>
                  <Text style={s.noticeBody}>沒有最新通知囉</Text>
                </View>
              )}
            </ScrollView>
            <View style={s.noticeFooter}>
              {notifications.length > 0 && (
                <TouchableOpacity style={s.noticeClear} onPress={clearNotifications}>
                  <Text style={s.noticeClearText}>全部清除</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.noticeClear} onPress={() => setNoticeOpen(false)}><Text style={s.noticeClearText}>我知道了</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────
// DiaryScreen
// ─────────────────────────────────────────────────────────
function DiaryScreen({ navigation }: any) {
  const { token } = useContext(AuthContext);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleAnalyze = async () => {
    if (!content.trim()) { Alert.alert('請先寫下一點今天的心情'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/diary`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ content: content.trim() }) });
      const data = await res.json();
      if (res.ok) { setResult(data); setContent(''); }
      else Alert.alert('送出失敗', data.detail || '請稍後再試');
    } catch { Alert.alert('無法連接到後端伺服器'); } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenBg source={require('./assets/journal.png')}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 28, paddingTop: 60, paddingBottom: 40 }}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={[s.title, { fontSize: 24, textAlign: 'center', marginTop: -42 }]}>寫小日記</Text>
          <View style={{ height: 90 }} />
          <Text style={[s.title, { fontSize: 22, textAlign: 'center' }]}>今天發生了什麼事呢？</Text>
          <Text style={[s.body, { textAlign: 'center', color: C.sub, marginBottom: 22 }]}>可以分很多次分享，小島精靈會在晚上幫你整理成今天日記。</Text>
          <View style={s.diaryBox}>
            <TextInput style={s.diaryInput} placeholder="寫下一小段心情、事件、想法..." placeholderTextColor={C.muted} value={content} onChangeText={setContent} multiline maxLength={1000} textAlignVertical="top" />
            <Text style={s.wordCount}>{content.length} / 1000</Text>
          </View>
          <View style={s.tipCard}>
            <Image source={require('./assets/Diary_Island.png')} style={{ width: 72, height: 54 }} resizeMode="contain" />
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={s.label}>溫柔提醒 🌱</Text>
              <Text style={[s.body, { color: C.sub }]}>不需要一次寫完，想到什麼就慢慢補給小島精靈。</Text>
            </View>
          </View>
          <TouchableOpacity style={[s.primaryBtn, loading && { opacity: 0.65 }]} onPress={handleAnalyze} disabled={loading}>
            {loading ? <ActivityIndicator color="white" /> : <Text style={s.primaryBtnText}>分享我的心情給小島精靈</Text>}
          </TouchableOpacity>
          {result && (
            <View style={s.elfFeedbackWrap}>
              <View style={s.elfSmallCard}><Text style={s.label}>安慰</Text><Text style={s.body}>{result.comfort || result.feedback || '今天辛苦了，謝謝你願意分享。'}</Text></View>
              <View style={s.elfSmallCard}><Text style={s.label}>建議你可以...</Text>{(result.suggestions || ['喝一點水', '慢慢呼吸一下']).slice(0, 3).map((x: string) => <Text key={x} style={s.body}>・{x}</Text>)}</View>
              <View style={s.elfBlessCard}><Image source={require('./assets/elves.png')} style={{ width: 70, height: 70, marginRight: 12 }} resizeMode="contain" /><View style={{ flex: 1 }}><Text style={s.label}>小島精靈想對你說...</Text><Text style={s.body}>{result.blessing || '願你今天被溫柔接住，明天也能慢慢長出新的力量。'}</Text></View></View>
            </View>
          )}
        </ScrollView>
      </ScreenBg>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────
// AIAnalysisScreen
// ─────────────────────────────────────────────────────────
function AIAnalysisScreen({ navigation, route }: any) {
  const { result } = route.params || {};
  return (
    <ScreenBg source={require('./assets/Sentiment_Analysis.png')}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 58, paddingBottom: 80 }}>
        <BackButton onPress={() => navigation.navigate('MainTabs', { screen: 'HomeTab' })} />
        <Text style={[s.title, { fontSize: 24, textAlign: 'center', marginTop: -42 }]}>小島精靈回覆</Text>
        <View style={{ height: 70 }} />
        <View style={s.elfSmallCard}><Text style={s.label}>安慰</Text><Text style={s.body}>{result?.comfort || result?.feedback || '今天辛苦了，謝謝你願意分享。'}</Text></View>
        <View style={s.elfSmallCard}><Text style={s.label}>建議你可以...</Text>{(result?.suggestions || ['喝一點水', '慢慢呼吸一下']).slice(0, 3).map((x: string) => <Text key={x} style={s.body}>・{x}</Text>)}</View>
        <View style={s.elfBlessCard}><Image source={require('./assets/elves.png')} style={{ width: 78, height: 78, marginRight: 12 }} resizeMode="contain" /><View style={{ flex: 1 }}><Text style={s.label}>小島精靈想對你說...</Text><Text style={s.body}>{result?.blessing || '願你今天被溫柔接住，明天也能慢慢長出新的力量。'}</Text></View></View>
      </ScrollView>
    </ScreenBg>
  );
}

// ─────────────────────────────────────────────────────────
// CalendarScreen
// ─────────────────────────────────────────────────────────
function CalendarScreen({ navigation }: any) {
  const { token } = useContext(AuthContext);
  const [records, setRecords] = useState<TreeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const daysInMonth = getSafeDaysInMonth(year, month);
  const firstDow = getSafeFirstDow(year, month);
  const monthWeekCount = getMonthWeekCount(year, month);
  const weeks = Array.from({ length: Math.max(0, monthWeekCount) }, (_, i) => i + 1);
  const calendarCells = [
    ...Array.from({ length: Math.max(0, firstDow) }, () => null),
    ...Array.from({ length: Math.max(0, daysInMonth) }, (_, i) => i + 1),
  ];

  useEffect(() => { const unsub = navigation.addListener('focus', fetchRecords); return unsub; }, [navigation, token]);
  useEffect(() => { if (token) fetchRecords(); }, [token]);

  const fetchRecords = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${BASE_URL}/history`, { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      setRecords((Array.isArray(data) ? data : []).map(toTreeRecord));
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const recordByDay = (day: number) => records.find(r => recordMatchesMonth(r, year, month) && Number(r.date?.slice(8, 10)) === day);
  const openDay = (day: number) => navigation.navigate('DayTree', { date: getDateKey(year, month, day), record: recordByDay(day) || null });

  if (loading) return <View style={[s.center, { backgroundColor: C.bg }]}><ActivityIndicator color={C.accent} /></View>;

  return (
    <ScreenBg source={require('./assets/calendar_bg.png')}>
      <ScrollView contentContainerStyle={s.calendarPageTuned} showsVerticalScrollIndicator={false}>
        <View style={s.calendarTopRow}>
          <TouchableOpacity style={s.monthPillNoBorder} onPress={() => setMonthPickerOpen(true)} activeOpacity={0.85}>
            <Text style={s.monthTextBig}>{month}月</Text>
          </TouchableOpacity>
          <View />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.weekScrollTuned}>
          {weeks.map((week) => {
            const complete = isWeekComplete(records, year, month, week);
            const { startDay, endDay } = getMonthWeekRange(year, month, week);
            return (
              <TouchableOpacity key={week} style={[s.weekCardTuned, !complete && s.weekCardDisabled]} activeOpacity={complete ? 0.85 : 1} disabled={!complete} onPress={() => complete && navigation.navigate('WeeklyAnalysis', { week, year, month, startDay, endDay })}>
                <Text style={[s.weekCardTitleTuned, !complete && { opacity: 0.45 }]}>第{week}週</Text>
                <Text style={[s.weekCardSubTuned, !complete && { opacity: 0.45 }]}>週狀態</Text>
                <View style={[s.weekStatusLineTuned, !complete && s.weekStatusLineMuted]} />
                <Image source={require('./assets/Diary_Island.png')} style={[s.weekIslandImageTuned, !complete && { opacity: 0.20 }]} resizeMode="contain" />
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <View style={s.weekdayRow}>
          {WEEK_DAYS.map(d => <Text key={d} style={s.weekdayTextTuned}>{d}</Text>)}
        </View>
        <View style={s.calendarGridTuned}>
          {calendarCells.map((day, idx) => {
            const rec = day ? recordByDay(day) : null;
            return (
              <TouchableOpacity key={idx} disabled={!day} style={s.calendarCellTuned} onPress={() => day && openDay(day)}>
                <Text style={s.calendarDayTextTuned}>{day || ''}</Text>
                {rec
                  ? <Image source={MOOD_TREE[rec.mood]?.img || MOOD_TREE.Joy.img} style={s.calendarTreeTuned} resizeMode="contain" />
                  : <View style={s.calendarTreePlaceholderTuned} />
                }
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={s.calendarHintTuned}>點擊日期，查看當天心情小樹</Text>
      </ScrollView>
      <Modal visible={monthPickerOpen} transparent animationType="fade" onRequestClose={() => setMonthPickerOpen(false)}>
        <View style={s.noticeOverlay}>
          <View style={s.monthPickerCard}>
            <Text style={s.noticeTitle}>選擇月份</Text>
            <View style={s.yearSwitcher}>
              <TouchableOpacity onPress={() => setYear(y => y - 1)} style={s.yearSwitchBtn}><Text style={s.body}>‹</Text></TouchableOpacity>
              <Text style={s.monthPickerYear}>{year}</Text>
              <TouchableOpacity onPress={() => setYear(y => y + 1)} style={s.yearSwitchBtn}><Text style={s.body}>›</Text></TouchableOpacity>
            </View>
            <View style={s.monthGrid}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                <TouchableOpacity key={m} style={[s.monthChoice, m === month && s.monthChoiceActive]} onPress={() => { setMonth(m); setMonthPickerOpen(false); }}>
                  <Text style={[s.monthChoiceText, m === month && { color: '#fff' }]}>{m}月</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </ScreenBg>
  );
}

// ─────────────────────────────────────────────────────────
// DayTreeScreen
// ─────────────────────────────────────────────────────────
function DayTreeScreen({ navigation, route }: any) {
  const { token } = useContext(AuthContext);
  const { date, record } = route.params || {};
  const rec: TreeRecord | null = record || null;
  const mood = rec?.mood || 'Joy';
  const treeInfo = MOOD_TREE[mood] || MOOD_TREE.Joy;
  const scores = norm(rec?.scores || {});
  const top = getTopEmotions(scores, 1)[0];
  const topKey = top?.[0] || mood;
  const topVal = top?.[1] || scores[mood] || 0;
  const dailyText = rec?.raw?.daily_content || rec?.raw?.dailyContent || rec?.raw?.final_content || rec?.raw?.daily_summary || rec?.summary || '';
  const [favorited, setFavorited] = useState(false);

  useEffect(() => {
    const loadFavoriteState = async () => {
      if (!token || !rec?.id) return;
      try {
        const res = await fetch(`${BASE_URL}/favorites`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        setFavorited(Array.isArray(data) && data.some((item: any) => item.analysisId === rec.id || item.analysis?.id === rec.id));
      } catch (e) { console.error(e); }
    };
    loadFavoriteState();
  }, [token, rec?.id]);

  const toggleFavorite = async () => {
    if (!rec?.id) return;
    try {
      const res = await fetch(`${BASE_URL}/favorites/${rec.id}/toggle`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setFavorited(!!data.favorited);
      else Alert.alert('收藏失敗', data.detail || '請稍後再試');
    } catch { Alert.alert('網路錯誤'); }
  };

  return (
    <ScreenBg source={require('./assets/Tree_of_the_Day.png')}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 56, paddingBottom: 90 }}>
        <BackButton onPress={() => navigation.navigate('MainTabs', { screen: 'TrendTab' })} />
        {rec && (
          <TouchableOpacity style={s.favoriteStarBtn} onPress={toggleFavorite} activeOpacity={0.85}>
            <Image source={favorited ? FEATURE_ASSETS.starOn : FEATURE_ASSETS.starOff} style={s.favoriteStarImg} resizeMode="contain" />
          </TouchableOpacity>
        )}
        <Text style={[s.title, { textAlign: 'center', marginTop: -40 }]}>{date || rec?.date || '今天'}</Text>
        <View style={{ alignItems: 'center', marginVertical: 44 }}>
          {rec
            ? <Image source={treeInfo.img} style={{ width: 210, height: 210 }} resizeMode="contain" />
            : <Image source={require('./assets/soil.png')} style={{ width: 210, height: 210 }} resizeMode="contain" />
          }
        </View>
        {rec ? (
          <>
            <View style={s.dayInfoRow}>
              <Text style={s.body}>●  {EC[topKey]?.l || treeInfo.label}　{topKey}</Text>
              <Text style={s.body}>{topVal}%</Text>
            </View>
            <TouchableOpacity style={s.resultCard} onPress={() => navigation.navigate('DailyDiaryView', { date: rec.date, record: rec, diary: dailyText })} activeOpacity={0.86}>
              <Text style={s.label}>今日小語</Text>
              <Text style={[s.body, { marginTop: 8 }]}>{rec.summary || '這一天的小日記已整理成今天日記。'}</Text>
              <Text style={[s.mini, { color: C.accent, marginTop: 10 }]}>點一下查看當天日記</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.primaryBtn, { backgroundColor: '#E8E0D5' }]} onPress={() => navigation.navigate('DayAnalysis', { date: rec.date, record: rec })}>
              <Text style={[s.primaryBtnText, { color: C.text }]}>查看當日分析　›</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={s.resultCard}>
            <Text style={s.title}>今天還沒有種下心情樹</Text>
            <Text style={s.body}>寫下一段小日記，晚點就能長出今天的心情樹。</Text>
          </View>
        )}
      </ScrollView>
    </ScreenBg>
  );
}

function DailyDiaryViewScreen({ navigation, route }: any) {
  const { date, record, diary } = route.params || {};
  const rec: TreeRecord | null = record || null;
  const content = diary || rec?.raw?.daily_content || rec?.raw?.final_content || rec?.summary || '目前沒有統整日記內容。';
  return (
    <ScreenBg source={require('./assets/journal.png')}>
      <View style={{ flex: 1 }}>
        <View style={s.fullDiaryHeader}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={[s.title, s.fullDiaryHeaderTitle]}>{date || rec?.date}</Text>
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={s.fullDiaryScroll}
        >
          <Text style={s.fullDiaryTitle}>當天完整日記</Text>
          <Text style={s.fullDiaryBody}>{content}</Text>
        </ScrollView>
        {rec && (
          <TouchableOpacity style={s.fullDiaryBottomBtn} onPress={() => navigation.navigate('DayAnalysis', { date: rec.date, record: rec })}>
            <Text style={s.primaryBtnText}>查看當日分析　›</Text>
          </TouchableOpacity>
        )}
      </View>
    </ScreenBg>
  );
}

// ─────────────────────────────────────────────────────────
// DayAnalysisScreen（還原柱狀圖，完整對齊 HTML）
// ─────────────────────────────────────────────────────────
function DayAnalysisScreen({ navigation, route }: any) {
  const { date, record } = route.params || {};
  const rec: TreeRecord | null = record || null;
  const dominantMood = rec?.mood || 'Joy';
  const treeInfo = MOOD_TREE[dominantMood] || MOOD_TREE.Joy;
  const scores = norm(rec?.scores || {});
  const top = getTopEmotions(scores, 3);

  return (
    <ScreenBg source={require('./assets/Tree_of_the_Day.png')}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 56, paddingBottom: 90 }}>
        <BackButton onPress={() => navigation.navigate('MainTabs', { screen: 'TrendTab' })} />
        <Text style={[s.title, { textAlign: 'center', marginTop: -40 }]}>
          {date || rec?.date}　心情分析
        </Text>

        {/* 主要情緒卡片 */}
        <View style={[s.resultCard, { flexDirection: 'row', alignItems: 'center', marginTop: 30 }]}>
          <Image source={treeInfo.img} style={{ width: 150, height: 150 }} resizeMode="contain" />
          <View style={{ flex: 1, marginLeft: 18 }}>
            <Text style={[s.label, { fontSize: 20, lineHeight: 30 }]}>主要情緒</Text>
            {top.map(([k, v]) => (
              <Text key={k} style={[s.body, { color: EC[k]?.c || C.text, fontSize: 19, lineHeight: 31 }]}>
                {EC[k]?.l || k}　{v}%
              </Text>
            ))}
          </View>
        </View>

        {/* ── 柱狀圖（完整對齊 HTML barC）── */}
        <View style={s.resultCard}>
          <Text style={[s.label, { marginBottom: 16 }]}>情緒分析</Text>
          <EmotionBarChart scores={scores} raw={rec?.raw} />
        </View>

        <View style={s.resultCard}>
          <Text style={[s.label, { marginBottom: 12 }]}>壓力來源、情緒緩衝、快樂來源</Text>
          <TagReasonSection raw={rec?.raw} />
        </View>
      </ScrollView>
    </ScreenBg>
  );
}

// ─────────────────────────────────────────────────────────
// WeeklyAnalysisScreen（還原折線圖，完整對齊 HTML）
// ─────────────────────────────────────────────────────────
function WeeklyAnalysisScreen({ navigation, route }: any) {
  const { token } = useContext(AuthContext);
  const week = route?.params?.week || 1;
  const year = route?.params?.year || 2026;
  const month = route?.params?.month || 5;
  const startDay = route?.params?.startDay || (week - 1) * 7 + 1;
  const endDay = route?.params?.endDay || Math.min(startDay + 6, new Date(year, month, 0).getDate());

  const [records, setRecords] = useState<TreeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  // activeIndex 由折線圖的 onDayChange 更新
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => { if (token) fetchWeekRecords(); }, [token, week, year, month, startDay, endDay]);

  const fetchWeekRecords = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${BASE_URL}/history`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      const allRecords = (Array.isArray(data) ? data : []).map(toTreeRecord);
      const weekRecords = allRecords
        .filter((r: TreeRecord) => {
          const d = Number(r.date?.slice(8, 10));
          return recordMatchesMonth(r, year, month) && d >= startDay && d <= endDay;
        })
        .sort((a: TreeRecord, b: TreeRecord) => a.date.localeCompare(b.date));
      setRecords(weekRecords);
      setActiveIndex(weekRecords.length - 1);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  if (loading) {
    return <View style={[s.center, { backgroundColor: C.bg }]}><ActivityIndicator color={C.accent} /></View>;
  }

  if (records.length < 7) {
    return (
      <ScreenBg source={require('./assets/Weekly_Analysis.png')}>
        <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 56 }}>
          <BackButton onPress={() => navigation.navigate('MainTabs', { screen: 'TrendTab' })} />
          <Text style={[s.title, { textAlign: 'center', marginTop: -40 }]}>情緒走勢</Text>
          <View style={s.weekEmptyCard}>
            <Text style={s.weekEmptyTitle}>第{week}週心情趨勢尚未完成 🌱</Text>
            <Text style={s.weekEmptyText}>這一週需要完整記錄 {month}/{startDay}～{month}/{endDay}，才會產生週狀態折線圖。</Text>
            <Text style={s.weekEmptyText}>目前已完成 {records.length} / 7 天。</Text>
          </View>
        </View>
      </ScreenBg>
    );
  }

  const si = Math.min(activeIndex, records.length - 1);
  const at = records[si];
  const dominantMood = at?.mood || 'Joy';
  const treeInfo = MOOD_TREE[dominantMood] || MOOD_TREE.Joy;
  const scores = norm(at?.scores || {});
  const top3 = getTopEmotions(scores, 3);

  const tagGroups = getTagGroups(at?.raw);
  const stList = tagGroups.st;
  const btList = tagGroups.bt;
  const jtList = tagGroups.jt;

  return (
    <ScreenBg source={require('./assets/Weekly_Analysis.png')}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 56, paddingBottom: 90 }}>
        <BackButton onPress={() => navigation.navigate('MainTabs', { screen: 'TrendTab' })} />
        <Text style={[s.title, { textAlign: 'center', marginTop: -40 }]}>情緒走勢</Text>

        <Text style={[s.title, { fontSize: 22, marginTop: 28 }]}>第{week}週心情趨勢 🌱</Text>
        <Text style={[s.body, { color: C.sub, marginBottom: 16 }]}>
          {month}/{startDay}～{month}/{endDay}，拖動輔助線查看當天詳情
        </Text>
        <Text style={[s.mini, { color: '#ccc', textAlign: 'center', marginBottom: 10 }]}>
          綜合正負情緒計算出每日情緒分數，拖動輔助線查看當天詳情
        </Text>

        {/* ── 折線圖（完整對齊 HTML lineC）── */}
        <View style={s.resultCard}>
          <EmotionLineChart
            records={records}
            month={month}
            year={year}
            onDayChange={(idx) => setActiveIndex(idx)}
          />
        </View>

        <TouchableOpacity
          style={[s.primaryBtn, { marginTop: 0, marginBottom: 14 }]}
          onPress={() => navigation.navigate('WeeklyImpact', { records, week, month, startDay, endDay })}
          activeOpacity={0.86}
        >
          <Text style={s.primaryBtnText}>查看事件影響情緒原因　›</Text>
        </TouchableOpacity>

        {/* ── Detail Card（對齊 HTML dcard）── */}
        <View style={s.resultCard}>
          {/* 日期 + 主要情緒 badges */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={[s.label, { color: C.accent }]}>{at.date}</Text>
              <Text style={[s.body, { color: C.sub, marginTop: 4 }]}>{at.summary || ''}</Text>
            </View>
            <Image source={treeInfo.img} style={{ width: 72, height: 72 }} resizeMode="contain" />
          </View>

          {/* Dominant emotion badges（對齊 HTML renderDom）*/}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {top3.map(([k, v]) => (
              <View key={k} style={[s.emoBadge, { backgroundColor: EC[k].c + '22' }]}>
                <Text style={[s.mini, { color: EC[k].c, fontFamily: FONT_BOLD }]}>
                  {EC[k].l} {v}%
                </Text>
              </View>
            ))}
          </View>

          {/* Tags（對齊 HTML renderTags）*/}
          {stList.length > 0 && (
            <>
              <Text style={s.sectionLabel}>壓力來源</Text>
              {stList.map((t: any, i: number) => (
                <View key={i} style={s.tagRow}>
                  <View style={[s.pill, { backgroundColor: '#D85A3022' }]}>
                    <Text style={[s.mini, { color: '#D85A30' }]}>{TL[t.t] || t.t}</Text>
                  </View>
                  <Text style={[s.body, { flex: 1 }]}>{t.r}</Text>
                </View>
              ))}
            </>
          )}
          {btList.length > 0 && (
            <>
              <Text style={s.sectionLabel}>情緒緩衝</Text>
              {btList.map((t: any, i: number) => (
                <View key={i} style={s.tagRow}>
                  <View style={[s.pill, { backgroundColor: '#1D9E7522' }]}>
                    <Text style={[s.mini, { color: '#1D9E75' }]}>{TL[t.t] || t.t}</Text>
                  </View>
                  <Text style={[s.body, { flex: 1 }]}>{t.r}</Text>
                </View>
              ))}
            </>
          )}
          {jtList.length > 0 && (
            <>
              <Text style={s.sectionLabel}>快樂來源</Text>
              {jtList.map((t: any, i: number) => (
                <View key={i} style={s.tagRow}>
                  <View style={[s.pill, { backgroundColor: '#7F77DD22' }]}>
                    <Text style={[s.mini, { color: '#7F77DD' }]}>{TL[t.t] || t.t}</Text>
                  </View>
                  <Text style={[s.body, { flex: 1 }]}>{t.r}</Text>
                </View>
              ))}
            </>
          )}
          {stList.length === 0 && btList.length === 0 && jtList.length === 0 && (
            <Text style={[s.mini, { color: '#bbb' }]}>這天沒有記錄標籤資料</Text>
          )}
        </View>
      </ScrollView>
    </ScreenBg>
  );
}

// ─────────────────────────────────────────────────────────
// WeeklyImpactScreen
// ─────────────────────────────────────────────────────────
function WeeklyImpactScreen({ navigation, route }: any) {
  const { records = [], week, month, startDay, endDay } = route.params || {};
  const impact = aggregateImpact(records);

  const renderImpactGroup = (title: string, lead: string, list: any[], color: string) => (
    <View style={s.resultCard}>
      <Text style={[s.label, { color }]}>{title}</Text>
      <Text style={[s.body, { color: C.sub, marginTop: 6, marginBottom: 12 }]}>{lead}</Text>
      {list.length ? list.map((item: any, index: number) => (
        <View key={`${title}-${item.tag}`} style={{ marginTop: index === 0 ? 0 : 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <View style={[s.pill, { backgroundColor: color + '22' }]}>
              <Text style={[s.mini, { color, fontFamily: FONT_BOLD }]}>{item.label}</Text>
            </View>
            <Text style={[s.body, { color, fontFamily: FONT_BOLD }]}>{item.percent}%</Text>
          </View>
          <View style={{ height: 8, borderRadius: 8, backgroundColor: '#EEE8DE', overflow: 'hidden', marginBottom: 6 }}>
            <View style={{ width: `${Math.max(4, item.percent)}%` as DimensionValue, height: 8, backgroundColor: color, borderRadius: 8 }} />
          </View>
          <Text style={[s.mini, { color: C.sub }]}>
            {item.reasons.slice(0, 2).join('；') || '這週有此類事件，但 MongoDB 尚未儲存原因。'}
          </Text>
        </View>
      )) : (
        <Text style={[s.mini, { color: '#aaa' }]}>這週沒有足夠的標籤資料。</Text>
      )}
    </View>
  );

  return (
    <ScreenBg source={require('./assets/Weekly_Analysis.png')}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 56, paddingBottom: 90 }}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={[s.title, { textAlign: 'center', marginTop: -40 }]}>事件影響統整</Text>
        <Text style={[s.body, { color: C.sub, marginTop: 28, marginBottom: 16 }]}>
          第{week}週 {month}/{startDay}～{month}/{endDay}，依照每日標籤與情緒分數統整。
        </Text>
        {renderImpactGroup('負面情緒值最高的事件', '系統統計這週面對哪些壓力來源時，低落、焦慮、憤怒等負向情緒最明顯。', impact.stressors, '#D85A30')}
        {renderImpactGroup('開心與放鬆值最高的事件', '系統統計這週哪些事件最常伴隨喜悅、信任、期待等正向情緒。', impact.joys, '#7A9E6A')}
        {renderImpactGroup('情緒緩衝值最高的來源', '系統統計這週哪些支持或休息來源，最能緩衝情緒壓力。', impact.buffers, '#4E8FA8')}
      </ScrollView>
    </ScreenBg>
  );
}

// ─────────────────────────────────────────────────────────
// Other screens (unchanged)
// ─────────────────────────────────────────────────────────
function OptionModal({ visible, title, options, suffix = '', onPick, onClose }: any) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.noticeOverlay}>
        <View style={s.optionCard}>
          <Text style={s.noticeTitle}>{title}</Text>
          {options.map((op: string) => (
            <TouchableOpacity key={op} style={s.optionItem} onPress={() => onPick(op)}>
              <Text style={s.body}>{op}{suffix}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={s.avatarModalCancel} onPress={onClose}>
            <Text style={s.avatarModalCancelText}>取消</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function WheelSelector({ options, value, onChange, suffix = '' }: any) {
  const ITEM_H = 56;
  const PAD = 82;
  const listRef = useRef<FlatList<string>>(null);
  const activeIndex = Math.max(0, options.findIndex((op: string) => String(op) === String(value)));

  useEffect(() => {
    const timer = setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: activeIndex * ITEM_H, animated: false });
    }, 60);
    return () => clearTimeout(timer);
  }, [activeIndex]);

  const pickByOffset = (offsetY: number) => {
    const idx = Math.max(0, Math.min(options.length - 1, Math.round(offsetY / ITEM_H)));
    onChange(options[idx]);
    listRef.current?.scrollToOffset({ offset: idx * ITEM_H, animated: true });
  };

  return (
    <View style={s.wheelBox}>
      <View pointerEvents="none" style={s.wheelHighlight} />
      <FlatList
        ref={listRef}
        data={options}
        keyExtractor={(op) => String(op)}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        bounces={false}
        getItemLayout={(_, index) => ({ length: ITEM_H, offset: ITEM_H * index, index })}
        contentContainerStyle={{ paddingVertical: PAD }}
        onMomentumScrollEnd={(e) => pickByOffset(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={(e) => pickByOffset(e.nativeEvent.contentOffset.y)}
        renderItem={({ item: op }) => {
          const selected = String(op) === String(value);
          const idx = options.findIndex((item: string) => String(item) === String(op));
          return (
            <TouchableOpacity key={op} style={s.wheelItem} onPress={() => { onChange(op); listRef.current?.scrollToOffset({ offset: Math.max(0, idx) * ITEM_H, animated: true }); }} activeOpacity={0.8}>
              <Text style={[s.wheelItemText, selected && s.wheelItemTextActive]}>{op}{suffix}</Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

function DailyDiaryEditScreen({ navigation, route }: any) {
  const { token } = useContext(AuthContext);
  const { date, diary } = route.params || {};
  const [content, setContent] = useState(diary?.content || diary?.draft_content || '');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!content.trim()) { Alert.alert('請先留下今天日記內容'); return; }
    setLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/daily-diary/${date}/finalize`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ final_content: content.trim() }) });
      const data = await res.json();
      if (res.ok) { Alert.alert('已完成', '當日日記已完成並產生情緒分析'); navigation.navigate('MainTabs', { screen: 'TrendTab' }); }
      else Alert.alert('儲存失敗', data.detail || '請稍後再試');
    } catch { Alert.alert('無法連接到後端伺服器'); } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenBg source={require('./assets/journal.png')}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 58, paddingBottom: 90 }}>
          <BackButton onPress={() => navigation.goBack()} />
          <Text style={[s.title, { textAlign: 'center', marginTop: -40 }]}>編輯今天日記</Text>
          <Text style={[s.body, { textAlign: 'center', color: C.sub, marginTop: 12, marginBottom: 22 }]}>你可以調整小島精靈整理好的內容，按下完成後才會分析柱狀圖。</Text>
          <View style={[s.diaryBox, { minHeight: 360 }]}>
            <TextInput style={[s.diaryInput, { minHeight: 320 }]} value={content} onChangeText={setContent} multiline textAlignVertical="top" />
          </View>
          <TouchableOpacity style={[s.primaryBtn, loading && { opacity: 0.65 }]} onPress={save} disabled={loading}>
            {loading ? <ActivityIndicator color="white" /> : <Text style={s.primaryBtnText}>完成編輯並產生分析</Text>}
          </TouchableOpacity>
        </ScrollView>
      </ScreenBg>
    </KeyboardAvoidingView>
  );
}

function ProfileScreen({ navigation }: any) {
  const { token, username, avatar, setUsername, setAvatar, logout } = useContext(AuthContext);
  const [editName, setEditName] = useState(username);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [records, setRecords] = useState<TreeRecord[]>([]);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [popups, setPopups] = useState<any[]>([]);
  const [settings, setSettings] = useState({ generate_time: '21:00', edit_window_minutes: 30 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingEditor, setSettingEditor] = useState<'time' | 'window' | null>(null);
  const [draftGenerateTime, setDraftGenerateTime] = useState(settings.generate_time);
  const [draftWindow, setDraftWindow] = useState(String(settings.edit_window_minutes));
  const [avatarModalVisible, setAvatarModalVisible] = useState(false);
  const [testingNotification, setTestingNotification] = useState(false);

  useEffect(() => { setEditName(username); }, [username]);
  useEffect(() => {
    setDraftGenerateTime(settings.generate_time);
    setDraftWindow(String(settings.edit_window_minutes));
  }, [settings.generate_time, settings.edit_window_minutes]);
  useEffect(() => { if (token) loadProfileData(); }, [token]);
  useEffect(() => {
    const unsub = navigation.addListener('focus', () => { if (token) loadProfileData(); });
    return unsub;
  }, [navigation, token]);

  const loadProfileData = async () => {
    try {
      const h = { Authorization: `Bearer ${token}` };
      const his = await fetch(`${BASE_URL}/history`, { headers: h });
      const hd = await his.json();
      setRecords((Array.isArray(hd) ? hd : []).map(toTreeRecord));
      const rs = await fetch(`${BASE_URL}/daily-diary/settings`, { headers: h });
      const sd = await rs.json();
      if (sd?.generate_time) setSettings(sd);
      const favRes = await fetch(`${BASE_URL}/favorites`, { headers: h });
      const favData = await favRes.json();
      setFavorites(Array.isArray(favData) ? favData : []);
      const achRes = await fetch(`${BASE_URL}/achievements`, { headers: h });
      const achData = await achRes.json();
      setAchievements(Array.isArray(achData?.achievements) ? achData.achievements : []);
      setPopups(Array.isArray(achData?.popups) ? achData.popups : []);
    } catch (e) { console.error(e); }
  };

  const saveSettings = async (patch: any) => {
    try {
      const res = await fetch(`${BASE_URL}/daily-diary/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(patch) });
      const data = await res.json();
      if (res.ok) setSettings(data);
      else Alert.alert('設定失敗', data.detail || '請稍後再試');
    } catch { Alert.alert('網路錯誤'); }
  };

  const openSettingEditor = (kind: 'time' | 'window') => {
    setDraftGenerateTime(settings.generate_time);
    setDraftWindow(String(settings.edit_window_minutes));
    setSettingsOpen(false);
    setTimeout(() => setSettingEditor(kind), 120);
  };

  const saveSettingEditor = async () => {
    if (settingEditor === 'time') await saveSettings({ generate_time: draftGenerateTime });
    if (settingEditor === 'window') await saveSettings({ edit_window_minutes: Number(draftWindow) });
    setSettingEditor(null);
  };

  const sendTestPhoneNotification = async () => {
    setTestingNotification(true);
    try {
      const registration = await registerForPushNotifications(token);
      if (!registration.ok) {
        Alert.alert('手機通知尚未開啟', registration.message);
        return;
      }
      const res = await fetch(`${BASE_URL}/push-token/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(result.detail || '雲端後端尚未送出測試通知，請確認已重新部署。');
      }
      if (!result.ok) {
        const reason = Array.isArray(result.errors) ? result.errors.join('\n') : 'Expo 尚未接受這封通知。';
        Alert.alert('通知送出失敗', reason);
        return;
      }
      Alert.alert('測試通知已送出', '請查看手機通知中心。若沒有出現，請確認你使用的是 EAS 安裝版且已允許通知。');
    } catch (e: any) {
      Alert.alert('測試失敗', e?.message || '請確認網路與雲端後端狀態。');
    } finally {
      setTestingNotification(false);
    }
  };

  const chooseAvatar = async (key: string) => { setAvatar(key); setAvatarModalVisible(false); };

  const saveUsername = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${BASE_URL}/me`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ username: editName.trim() }) });
      const data = await res.json();
      if (data.username) { setUsername(data.username); setEditing(false); }
      else Alert.alert('儲存失敗');
    } catch { Alert.alert('網路錯誤'); } finally { setSaving(false); }
  };

  const overview = buildJourneyOverview(records);
  const days = new Set(records.map(r => r.date).filter(Boolean)).size;
  const achievementCount = (key: string) => achievements.find(a => a.key === key)?.count || 0;
  const favoriteRecords = favorites
    .map((item: any) => item.analysis ? toTreeRecord(item.analysis) : toTreeRecord(item))
    .filter((r: TreeRecord) => r.date)
    .sort((a: TreeRecord, b: TreeRecord) => b.date.localeCompare(a.date));
  const activePopup = popups[0];
  const dismissPopup = async () => {
    if (!activePopup?.id) { setPopups(prev => prev.slice(1)); return; }
    setPopups(prev => prev.slice(1));
    try {
      await fetch(`${BASE_URL}/achievements/read`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ ids: [activePopup.id] }) });
    } catch (e) { console.error(e); }
  };

  return (
    <View style={s.profileV2Page}>
      <ScrollView contentContainerStyle={s.profileV2Scroll} showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={s.profileGear} onPress={() => setSettingsOpen(true)} activeOpacity={0.85}>
          <Image source={FEATURE_ASSETS.gear} style={s.profileGearImage} resizeMode="contain" />
        </TouchableOpacity>
        <View style={s.profileHeaderV2}>
          <TouchableOpacity onPress={() => setAvatarModalVisible(true)} activeOpacity={0.85}>
            <Image source={getAvatarSource(avatar)} style={s.profileAvatarV2} resizeMode="cover" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={s.profileNameV2}>{username || '小樹夥伴'} 🌱</Text>
            <Text style={s.profileSubV2}>與情緒共處的第 {days || 0} 天</Text>
            <View style={s.profilePillV2}><Image source={FEATURE_ASSETS.leaf} style={{ width: 14, height: 14 }} resizeMode="contain" /><Text style={s.profilePillText}>持續成長中</Text></View>
          </View>
        </View>

        <View style={s.profileStatsV2}>
          <View style={s.profileStatV2}><Image source={FEATURE_ASSETS.leaf} style={s.profileStatIcon} resizeMode="contain" /><Text style={s.profileStatNum}>{days}</Text><Text style={s.profileStatLabel}>記錄天數</Text></View>
          <View style={s.profileStatDivider} />
          <View style={s.profileStatV2}><Image source={FEATURE_ASSETS.planting} style={s.profileStatIcon} resizeMode="contain" /><Text style={s.profileStatNum}>{records.length}</Text><Text style={s.profileStatLabel}>心情樹種植</Text></View>
          <View style={s.profileStatDivider} />
          <View style={s.profileStatV2}><Image source={FEATURE_ASSETS.collect} style={s.profileStatIcon} resizeMode="contain" /><Text style={s.profileStatNum}>{favorites.length}</Text><Text style={s.profileStatLabel}>我的收藏</Text></View>
        </View>

        <View style={s.profileCardV2}>
          <View style={s.profileCardTitleRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Image source={FEATURE_ASSETS.feeling} style={s.profileSectionIcon} resizeMode="contain" />
              <Text style={s.profileCardTitle}>心情探索旅程</Text>
            </View>
            <Text style={s.profileCardHint}>近 28 天</Text>
          </View>
          <View style={s.journeyTopRow}>
            <EmotionDonut records={records} size={108} />
            <View style={{ flex: 1, marginLeft: 16 }}>
              {overview.distribution.slice(0, 6).map(item => (
                <View key={item.key} style={s.donutLegendRow}>
                  <View style={[s.donutDot, { backgroundColor: item.color }]} />
                  <Text style={s.donutLegendText}>{item.label}</Text>
                  <Text style={s.donutLegendPercent}>{item.percent}%</Text>
                </View>
              ))}
            </View>
          </View>
          <Text style={s.profileJourneySummary}>{overview.summary}</Text>
        </View>

        <View style={s.profileCardV2}>
          <View style={s.profileCardTitleRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Image source={FEATURE_ASSETS.leaf} style={s.profileSectionIcon} resizeMode="contain" />
              <Text style={s.profileCardTitle}>我的成就</Text>
            </View>
          </View>
          <View style={s.achievementGrid}>
            {Object.keys(ACHIEVEMENT_META).map(key => {
              const meta = ACHIEVEMENT_META[key];
              return (
                <View key={key} style={s.achievementTile}>
                  <Image source={meta.img} style={s.achievementIcon} resizeMode={(key === 'growing' || key === 'self_care') ? 'cover' : 'contain'} />
                  <Text style={s.achievementName}>{meta.label}</Text>
                  <Text style={s.achievementCount}>{key === 'first_planting' && achievementCount(key) > 0 ? '已達成' : `${achievementCount(key)} ${meta.unit}`}</Text>
                </View>
              );
            })}
          </View>
        </View>

        <TouchableOpacity style={s.profileCardV2} onPress={() => navigation.navigate('Favorites')} activeOpacity={0.86}>
          <View style={s.profileCardTitleRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Image source={FEATURE_ASSETS.collect} style={s.profileSectionIcon} resizeMode="contain" />
              <Text style={s.profileCardTitle}>我的收藏</Text>
            </View>
            <Text style={s.profileCardHint}>查看全部 ›</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingTop: 8 }}>
            {favoriteRecords.slice(0, 4).map(item => (
              <Image key={`${item.id}-${item.date}`} source={MOOD_TREE[item.mood]?.img || MOOD_TREE.Joy.img} style={s.favoriteMiniImg} resizeMode="contain" />
            ))}
          </ScrollView>
        </TouchableOpacity>

      </ScrollView>

      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <View style={s.settingModalOverlay}>
          <View style={s.optionCard}>
            <Text style={s.noticeTitle}>小島設定</Text>
            <TouchableOpacity style={s.settingListRow} onPress={() => openSettingEditor('time')} activeOpacity={0.85}>
              <View style={{ flex: 1 }}>
                <Text style={s.settingListTitle}>整理時間</Text>
                <Text style={s.settingListSub}>每天 {settings.generate_time} 自動整理當日日記</Text>
              </View>
              <Text style={s.settingListValue}>{settings.generate_time} ›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.settingListRow} onPress={() => openSettingEditor('window')} activeOpacity={0.85}>
              <View style={{ flex: 1 }}>
                <Text style={s.settingListTitle}>修改期限</Text>
                <Text style={s.settingListSub}>產生後 {settings.edit_window_minutes} 分鐘內可修改</Text>
              </View>
              <Text style={s.settingListValue}>{settings.edit_window_minutes} 分鐘 ›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.settingListRow} onPress={sendTestPhoneNotification} activeOpacity={0.85} disabled={testingNotification}>
              <View style={{ flex: 1 }}>
                <Text style={s.settingListTitle}>手機通知</Text>
                <Text style={s.settingListSub}>接收小島精靈的整理完成與心情提醒</Text>
              </View>
              {testingNotification
                ? <ActivityIndicator color={C.accent} />
                : <Text style={s.settingListValue}>傳送測試 ›</Text>}
            </TouchableOpacity>
            <View style={s.settingAccountBox}>
              <Text style={s.settingListTitle}>個人資料</Text>
              {editing ? (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <TextInput style={[s.authInput, { flex: 1, height: 48, marginBottom: 0 }]} value={editName} onChangeText={setEditName} />
                  <TouchableOpacity style={[s.primaryBtn, { width: 82, height: 48, marginTop: 0 }]} onPress={saveUsername} disabled={saving}>
                    {saving ? <ActivityIndicator color="white" /> : <Text style={[s.primaryBtnText, { fontSize: 14, letterSpacing: 1 }]}>儲存</Text>}
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={() => setEditing(true)} style={[s.settingRow, { paddingVertical: 12 }]}>
                  <Text style={s.body}>暱稱：{username}</Text><Text style={[s.body, { color: C.accent }]}>編輯</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.logoutBtnV2} onPress={() => Alert.alert('確認登出', '確定要登出嗎？', [{ text: '取消', style: 'cancel' }, { text: '登出', style: 'destructive', onPress: logout }])}>
                <Text style={[s.body, { color: C.danger }]}>登出</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={s.avatarModalCancel} onPress={() => setSettingsOpen(false)} activeOpacity={0.85}>
              <Text style={s.avatarModalCancelText}>完成</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal visible={!!settingEditor} transparent animationType="slide" onRequestClose={() => setSettingEditor(null)}>
        <View style={s.settingEditorOverlay}>
          <View style={s.settingEditorSheet}>
            <Text style={s.settingEditorTitle}>{settingEditor === 'time' ? '整理時間' : '修改期限'}</Text>
            <Text style={s.settingEditorDesc}>
              {settingEditor === 'time'
                ? '選擇小島精靈每天整理小日記的時間。到時間後會自動產生統整日記。'
                : '選擇統整日記產生後還能修改多久。時間過後會自動定稿並分析。'}
            </Text>
            {settingEditor === 'time' ? (
              <WheelSelector options={['19:00','20:00','21:00','22:00','23:00','23:59']} value={draftGenerateTime} onChange={setDraftGenerateTime} />
            ) : (
              <WheelSelector options={['15','30','45','60','90','120']} value={draftWindow} onChange={setDraftWindow} suffix=" 分鐘" />
            )}
            <View style={s.settingEditorActions}>
              <TouchableOpacity style={s.settingEditorCancel} onPress={() => setSettingEditor(null)} activeOpacity={0.85}>
                <Text style={s.settingEditorCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.settingEditorSave} onPress={saveSettingEditor} activeOpacity={0.85}>
                <Text style={s.settingEditorSaveText}>儲存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={avatarModalVisible} transparent animationType="fade" onRequestClose={() => setAvatarModalVisible(false)}>
        <View style={s.avatarModalOverlay}>
          <View style={s.avatarModalCard}>
            <Text style={s.avatarModalTitle}>選擇頭像</Text>
            <Text style={s.avatarModalSubtitle}>選一個代表你的島民頭像</Text>
            <View style={s.avatarOptionGrid}>
              {AVATAR_OPTIONS.map((item) => (
                <TouchableOpacity key={item.key} style={[s.avatarOption, avatar === item.key && s.avatarOptionSelected]} onPress={() => chooseAvatar(item.key)} activeOpacity={0.85}>
                  <Image source={item.img} style={s.avatarOptionImage} resizeMode="cover" />
                  <Text style={s.avatarOptionText}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={s.avatarModalCancel} onPress={() => setAvatarModalVisible(false)} activeOpacity={0.85}>
              <Text style={s.avatarModalCancelText}>取消</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {activePopup && <AchievementPopup popup={activePopup} onClose={dismissPopup} />}
    </View>
  );
}

function FavoritesScreen({ navigation }: any) {
  const { token } = useContext(AuthContext);
  const [favorites, setFavorites] = useState<TreeRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${BASE_URL}/favorites`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        const rows = (Array.isArray(data) ? data : [])
          .map((item: any) => item.analysis ? toTreeRecord(item.analysis) : toTreeRecord(item))
          .filter((item: TreeRecord) => item.date)
          .sort((a: TreeRecord, b: TreeRecord) => b.date.localeCompare(a.date));
        setFavorites(rows);
      } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => {
    load();
  }, [token]);
  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [navigation, token]);

  return (
    <ScreenBg source={require('./assets/Personal_Page.png')}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 56, paddingBottom: 90 }}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={[s.title, { textAlign: 'center', marginTop: -40 }]}>我的收藏</Text>
        <View style={{ height: 42 }} />
        {loading ? <ActivityIndicator color={C.accent} /> : favorites.length ? favorites.map(item => (
          <TouchableOpacity key={`${item.id}-${item.date}`} style={s.favoriteListItem} onPress={() => navigation.navigate('DayTree', { date: item.date, record: item })} activeOpacity={0.86}>
            <Image source={MOOD_TREE[item.mood]?.img || MOOD_TREE.Joy.img} style={s.favoriteListTree} resizeMode="contain" />
            <View style={{ flex: 1 }}>
              <Text style={s.favoriteListDate}>{item.date}</Text>
              <Text style={s.body}>{item.summary || '這天的心情樹已收藏。'}</Text>
            </View>
            <Text style={s.favoriteListArrow}>›</Text>
          </TouchableOpacity>
        )) : (
          <View style={s.resultCard}>
            <Text style={s.label}>還沒有收藏</Text>
            <Text style={[s.body, { marginTop: 8 }]}>在當日樹右上角按下星星，就能把那棵心情樹放到這裡。</Text>
          </View>
        )}
      </ScrollView>
    </ScreenBg>
  );
}

// ─────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────
function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ tabBarActiveTintColor: C.accent, tabBarInactiveTintColor: C.muted, tabBarStyle: { backgroundColor: 'rgba(250,246,240,0.46)', borderTopWidth: 0, borderTopColor: C.line, height: 70, borderTopLeftRadius: 28, borderTopRightRadius: 28, position: 'absolute' }, tabBarLabelStyle: { fontFamily: FONT_REG, fontSize: 12 }, headerShown: false }}>
      <Tab.Screen name="HomeTab" component={HomeScreen} options={{ tabBarLabel: '首頁', tabBarIcon: () => <Image source={require('./assets/Homepage_icon.png')} style={{ width: 50, height: 50 }} resizeMode="contain" /> }} />
      <Tab.Screen name="TrendTab" component={CalendarScreen} options={{ tabBarLabel: '趨勢', tabBarIcon: () => <Image source={require('./assets/calendar.png')} style={{ width: 50, height: 50 }} resizeMode="contain" /> }} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} options={{ tabBarLabel: '我的', tabBarIcon: () => <Image source={require('./assets/personal.png')} style={{ width: 50, height: 50 }} resizeMode="contain" /> }} />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen name="Diary" component={DiaryScreen} />
      <Stack.Screen name="AIAnalysis" component={AIAnalysisScreen} />
      <Stack.Screen name="DailyDiaryEdit" component={DailyDiaryEditScreen} />
      <Stack.Screen name="DailyDiaryView" component={DailyDiaryViewScreen} />
      <Stack.Screen name="DayTree" component={DayTreeScreen} />
      <Stack.Screen name="DayAnalysis" component={DayAnalysisScreen} />
      <Stack.Screen name="WeeklyAnalysis" component={WeeklyAnalysisScreen} />
      <Stack.Screen name="WeeklyImpact" component={WeeklyImpactScreen} />
      <Stack.Screen name="Favorites" component={FavoritesScreen} />
    </Stack.Navigator>
  );
}

type PushRegistrationResult = { ok: boolean; message: string; pushToken?: string };

async function registerForPushNotifications(authToken: string): Promise<PushRegistrationResult> {
  if (!authToken || Platform.OS === 'web') {
    return { ok: false, message: '此裝置不支援手機推播。' };
  }
  if (!Device.isDevice) {
    console.log('[push] Expo push notifications need a physical device.');
    return { ok: false, message: '手機推播必須在實體手機上測試。' };
  }
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: '小島精靈通知',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#7A9E6A',
      });
    }

    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== 'granted') {
      console.log('[push] notification permission not granted');
      return { ok: false, message: '請到 iPhone 的「設定 > 通知 > Emotional Island」允許通知。' };
    }

    const constantsAny: any = Constants;
    const projectId =
      constantsAny?.easConfig?.projectId ||
      constantsAny?.expoConfig?.extra?.eas?.projectId ||
      constantsAny?.manifest2?.extra?.eas?.projectId;
    const tokenResult = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const uploadRes = await fetch(`${BASE_URL}/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        token: tokenResult.data,
        platform: Platform.OS,
        device_id: Device.deviceName || `${Platform.OS}-device`,
      }),
    });
    if (!uploadRes.ok) {
      const error = await uploadRes.json().catch(() => ({}));
      throw new Error(error.detail || '無法將手機通知連結到帳號。');
    }
    return { ok: true, message: '手機通知已連結。', pushToken: tokenResult.data };
  } catch (e) {
    console.log('[push] failed to register push token', e);
    return { ok: false, message: (e as any)?.message || '取得手機推播識別碼失敗。請使用 EAS 安裝版重試。' };
  }
}

// ─────────────────────────────────────────────────────────
// App Entry
// ─────────────────────────────────────────────────────────
export default function App() {
  const [fontsLoaded] = useFonts({
    NotoSerifTC_400Regular,
    NotoSerifTC_500Medium,
    NotoSerifTC_700Bold,
  });

  const [token, setToken] = useState('');
  const [username, setUsernameState] = useState('');
  const [avatar, setAvatarState] = useState('boy');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [entry, setEntry] = useState<'welcome' | 'auth' | 'onboarding' | 'main'>('welcome');

  useEffect(() => {
    const loadAvatar = async () => {
      if (!username) { setAvatarState('boy'); return; }
      const savedKey = await AsyncStorage.getItem(`userAvatar:${username}`);
      setAvatarState(savedKey || 'boy');
      if (token) {
        try {
          const res = await fetch(`${BASE_URL}/me`, { headers: { Authorization: `Bearer ${token}` } });
          const data = await res.json();
          if (data?.avatar) setAvatarState(data.avatar);
        } catch {}
      }
    };
    loadAvatar();
  }, [username, token]);

  useEffect(() => {
    if (token) registerForPushNotifications(token);
  }, [token]);

  const saveAvatar = async (key: string) => {
    if (!username) return;
    setAvatarState(key);
    await AsyncStorage.setItem(`userAvatar:${username}`, key);
    if (token) {
      try {
        await fetch(`${BASE_URL}/me`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ avatar: key }) });
      } catch {}
    }
  };

  const logout = () => {
    setToken('');
    setUsernameState('');
    setAvatarState('boy');
    setEntry('welcome');
    setAuthMode('login');
  };

  const handleLoggedIn = async (t: string, u: string, firstRegister: boolean, avatarKey?: string, onboardingSeen?: boolean) => {
    setToken(t);
    setUsernameState(u);
    if (avatarKey) {
      setAvatarState(avatarKey);
      await AsyncStorage.setItem(`userAvatar:${u}`, avatarKey);
    }
    const localSeen = await AsyncStorage.getItem(`onboardingSeen:${u}`);
    setEntry(firstRegister || (!onboardingSeen && localSeen !== 'true') ? 'onboarding' : 'main');
  };

  if (!fontsLoaded) {
    return <View style={[s.center, { backgroundColor: C.bg }]}><ActivityIndicator color={C.accent} /></View>;
  }

  if (!token && entry === 'welcome') {
    return (
      <WelcomeScreen
        onStart={() => { setAuthMode('register'); setEntry('auth'); }}
        onLogin={() => { setAuthMode('login'); setEntry('auth'); }}
      />
    );
  }

  if (!token) {
    return <LoginScreen mode={authMode} setMode={setAuthMode} onLoggedIn={handleLoggedIn} />;
  }

  if (entry === 'onboarding') {
    return <OnboardingScreen onDone={async () => {
      if (username) await AsyncStorage.setItem(`onboardingSeen:${username}`, 'true');
      if (token) {
        try {
          await fetch(`${BASE_URL}/me`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ onboarding_seen: true }) });
        } catch {}
      }
      setEntry('main');
    }} />;
  }

  return (
    <AuthContext.Provider value={{ token, username, avatar, setUsername: setUsernameState, setAvatar: saveAvatar, logout }}>
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </AuthContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────
const s = StyleSheet.create({
  greenText: { color: '#7A9E6A', fontFamily: FONT_BOLD },
  primaryBtn: { height: 56, borderRadius: 28, backgroundColor: '#7A9E6A', justifyContent: 'center', alignItems: 'center', shadowColor: '#7A9E6A', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.22, shadowRadius: 14, elevation: 6 },
  primaryBtnText: { color: '#FFFFFF', fontSize: 18, lineHeight: 24, fontFamily: FONT_BOLD, letterSpacing: 3, includeFontPadding: false },
  mini: { fontSize: 13, lineHeight: 20, color: '#8A7A6A', fontFamily: FONT_MED, includeFontPadding: false },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  bigTitle: { fontSize: 28, fontFamily: FONT_BOLD, color: '#3A2E25' },
  title: { fontSize: 20, fontFamily: FONT_BOLD, color: '#3A2E25', marginBottom: 4 },
  label: { fontSize: 13, fontFamily: FONT_BOLD, color: '#8A7A6A', letterSpacing: 0.5 },
  body: { fontSize: 14, fontFamily: FONT_REG, color: '#3A2E25', lineHeight: 22 },
  btnText: { color: 'white', fontSize: 17, fontFamily: FONT_BOLD },
  diaryInput: { fontSize: 16, fontFamily: FONT_REG, color: '#3A2E25', minHeight: 160, textAlignVertical: 'top', lineHeight: 28 },
  authInput: { width: '100%', height: 50, borderWidth: 1, borderColor: '#E8E0D5', borderRadius: 10, paddingHorizontal: 16, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.9)', fontSize: 16, fontFamily: Platform.OS === 'ios' ? 'PingFang TC' : FONT_REG, color: '#3A2E25' },

  // ── 柱狀圖相關 ──
  chartHint: { fontSize: 15, lineHeight: 22, color: '#aaa', textAlign: 'center', marginTop: 8, marginBottom: 12, fontFamily: FONT_REG },
  emoPopup: { borderRadius: 12, borderWidth: 1, borderColor: '#eee', borderLeftWidth: 3, padding: 14, marginTop: 4 },
  emoPopupHdr: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  emoPopupTitle: { fontSize: 17, fontFamily: FONT_BOLD },
  emoPopupClose: { fontSize: 16, color: '#ccc' },
  emoPopupBody: { fontSize: 16, color: '#555', lineHeight: 27 },

  // ── 折線圖 detail card ──
  emoBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  sectionLabel: { fontSize: 12, color: '#aaa', fontFamily: FONT_BOLD, marginTop: 14, marginBottom: 6 },
  tagRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  pill: { paddingHorizontal: 10, paddingVertical: 2, borderRadius: 5 },

  emotionLegendWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  emotionLegendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 6 },
  emotionLegendDot: { width: 10, height: 10, borderRadius: 5, marginRight: 5 },
  emotionLegendText: { fontSize: 11, color: C.sub, fontFamily: FONT_MED, includeFontPadding: false },

  // Welcome
  welcomePage: { flex: 1 },
  welcomeTextArea: { position: 'absolute', top: SH * 0.625, left: 0, right: 0, width: '100%', alignItems: 'center', justifyContent: 'center' },
  welcomeTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%', paddingLeft: 30 },
  welcomeAppName: { textAlign: 'center', fontSize: 31, lineHeight: 42, fontFamily: FONT_BOLD, color: '#3D2B1F', letterSpacing: 5, includeFontPadding: false },
  welcomeLeaf: { marginLeft: 12, marginTop: 1, fontSize: 28, lineHeight: 34 },
  welcomeSlogan: { marginTop: 18, textAlign: 'center', fontSize: 16, lineHeight: 31, fontFamily: FONT_MED, color: '#7A6A5A', letterSpacing: 2, includeFontPadding: false },
  welcomeStartBtn: { position: 'absolute', left: 36, right: 36, bottom: 92, height: 54, borderRadius: 27, backgroundColor: '#7A9E6A', justifyContent: 'center', alignItems: 'center' },
  welcomeStartText: { color: '#FFFFFF', fontSize: 18, lineHeight: 24, fontFamily: FONT_BOLD, letterSpacing: 4, includeFontPadding: false },
  welcomeLoginLink: { position: 'absolute', left: 0, right: 0, bottom: 58, alignItems: 'center', justifyContent: 'center' },
  welcomeLoginText: { textAlign: 'center', fontSize: 14, lineHeight: 22, fontFamily: FONT_MED, color: '#8A7A6A', letterSpacing: 1.5, includeFontPadding: false },
  welcomeLoginStrong: { color: '#5A4A3A', fontFamily: FONT_BOLD },

  // Home
  homeElfWrap: { alignItems: 'center', justifyContent: 'center', right: -12, marginTop: 4 },
  homeElf: { width: 70, height: 70 },
  homeElfText: { marginTop: -12, fontSize: 13, lineHeight: 15, fontFamily: FONT_MED, color: '#5A4A3A', includeFontPadding: false, backgroundColor: 'rgba(255,255,255,0.78)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden', textAlign: 'center' },
  elfBadge: { position: 'absolute', left: 2, top: 2, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: '#D94B3D', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, borderWidth: 2, borderColor: '#fff' },
  elfBadgeText: { color: '#fff', fontSize: 12, fontFamily: FONT_BOLD, includeFontPadding: false },
  profileAvatar: { width: 104, height: 104, borderRadius: 52, backgroundColor: 'rgba(255,255,255,0.72)' },
  avatarModalOverlay: { flex: 1, backgroundColor: 'rgba(61,43,31,0.28)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26 },
  avatarModalCard: { width: '100%', borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.96)', paddingHorizontal: 22, paddingTop: 24, paddingBottom: 18, borderWidth: 1, borderColor: 'rgba(232,224,213,0.95)', shadowColor: '#3D2B1F', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 22, elevation: 10 },
  avatarModalTitle: { textAlign: 'center', fontSize: 22, lineHeight: 30, fontFamily: FONT_BOLD, color: '#3D2B1F', letterSpacing: 1.5, includeFontPadding: false },
  avatarModalSubtitle: { marginTop: 6, marginBottom: 20, textAlign: 'center', fontSize: 13, lineHeight: 20, fontFamily: FONT_MED, color: '#8A7A6A', letterSpacing: 0.8, includeFontPadding: false },
  avatarOptionGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16 },
  avatarOption: { width: '47%', alignItems: 'center', paddingVertical: 14, borderRadius: 22, backgroundColor: 'rgba(250,246,240,0.78)', borderWidth: 1, borderColor: 'rgba(232,224,213,0.9)' },
  avatarOptionSelected: { borderColor: '#7A9E6A', backgroundColor: 'rgba(122,158,106,0.12)' },
  avatarOptionImage: { width: 82, height: 82, borderRadius: 41, backgroundColor: 'rgba(255,255,255,0.8)' },
  avatarOptionText: { marginTop: 8, fontSize: 14, lineHeight: 20, fontFamily: FONT_MED, color: '#5A4A3A', includeFontPadding: false },
  avatarModalCancel: { marginTop: 20, height: 48, borderRadius: 24, backgroundColor: '#7A9E6A', alignItems: 'center', justifyContent: 'center' },
  avatarModalCancelText: { color: '#FFFFFF', fontSize: 16, lineHeight: 22, fontFamily: FONT_BOLD, letterSpacing: 2, includeFontPadding: false },

  // Login
  loginPage: { flex: 1, paddingHorizontal: 24, paddingTop: 42 },
  loginScroll: { paddingHorizontal: 24, paddingTop: 42, paddingBottom: 40, minHeight: SH },
  loginBackCircle: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.68)', alignItems: 'center', justifyContent: 'center' },
  loginHeader: { alignItems: 'center', marginTop: 38, marginBottom: 74 },
  loginTitle: { fontSize: 27, fontFamily: FONT_BOLD, color: C.text, letterSpacing: 2.5 },
  loginSubtitle: { marginTop: 8, fontSize: 13, fontFamily: FONT_REG, color: C.sub, letterSpacing: 1 },
  loginForm: { marginTop: 0 },
  loginInput: { height: 52, borderWidth: 1, borderColor: 'rgba(232,224,213,0.95)', borderRadius: 14, paddingHorizontal: 18, marginBottom: 14, backgroundColor: 'rgba(255,255,255,0.87)', fontSize: 15, fontFamily: FONT_REG, color: C.text },
  forgotBtn: { alignSelf: 'flex-end', marginTop: -2, marginBottom: 22 },
  forgotText: { fontSize: 12, color: C.accent, fontFamily: FONT_REG, letterSpacing: 0.5 },
  loginBtn: { height: 52, borderRadius: 26, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center' },
  loginBtnText: { color: '#FFFFFF', fontSize: 16, fontFamily: FONT_BOLD, letterSpacing: 1.3 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 26, marginBottom: 18 },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(232,224,213,0.95)' },
  dividerText: { marginHorizontal: 12, color: C.muted, fontFamily: FONT_REG, fontSize: 12, letterSpacing: 0.5 },
  socialRow: { flexDirection: 'row', justifyContent: 'center', gap: 24, marginBottom: 28 },
  socialBtn: { width: 58, height: 44, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.92)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.line },
  socialText: { fontSize: 17, fontFamily: FONT_BOLD, color: C.text },
  registerSwitch: { alignItems: 'center' },
  smallHint: { color: C.sub, fontSize: 13, fontFamily: FONT_REG, letterSpacing: 0.5 },

  // Onboarding V2
  onboardPageV2: { width: SW, height: SH, paddingHorizontal: 28 },
  onboardHeaderV2: { height: SH * 0.18, paddingTop: SH * 0.073, alignItems: 'center', justifyContent: 'flex-start' },
  onboardHeaderTitleRowV2: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  onboardTopTitleV2: { fontSize: 21, lineHeight: 30, fontFamily: FONT_BOLD, color: '#3D2B1F', letterSpacing: 2.2, includeFontPadding: false },
  onboardLeafV2: { marginLeft: 8, fontSize: 22, lineHeight: 26 },
  onboardTopSubtitleV2: { marginTop: 12, fontSize: 13, lineHeight: 20, fontFamily: FONT_MED, color: '#8A7A6A', letterSpacing: 1.4, includeFontPadding: false },
  featureCardsWrapV2: { height: SH * 0.45, justifyContent: 'center', gap: 16 },
  featureCardV2: { width: '100%', height: 104, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.74)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, shadowColor: '#000', shadowOpacity: 0.035, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  featureIconV2: { width: 78, height: 78 },
  featureChartIconV2: { width: 78, height: 78, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.70)', alignItems: 'center', justifyContent: 'center' },
  featureTextBoxV2: { marginLeft: 24, flex: 1 },
  featureTitleV2: { fontSize: 18, lineHeight: 27, fontFamily: FONT_BOLD, color: '#3D2B1F', letterSpacing: 1.2, includeFontPadding: false },
  featureDescV2: { marginTop: 7, fontSize: 13, lineHeight: 23, fontFamily: FONT_MED, color: '#7A6A5A', letterSpacing: 0.8, includeFontPadding: false },
  function2CardV2: { width: SW * 0.88, height: SW * 0.88 * 0.92, alignSelf: 'center', marginTop: SH * 0.015, borderRadius: 22, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.72)' },
  function2ImageV2: { width: '100%', height: '100%' },
  reviewPreviewWrapV2: { width: SW * 0.88, alignSelf: 'center', marginTop: SH * 0.002 },
  reviewTrendCardV2: { width: '100%', height: 145, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.76)', marginBottom: 12, overflow: 'hidden' },
  reviewTreePointV2: { position: 'absolute', alignItems: 'center', width: 45 },
  reviewSmallTreeV2: { width: 40, height: 40 },
  reviewDateV2: { marginTop: 2, fontSize: 10, lineHeight: 14, fontFamily: FONT_MED, color: '#5D5D41' },
  reviewAnalysisCardV2: { width: '100%', height: 215, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.76)', paddingHorizontal: 18, paddingVertical: 16 },
  reviewCardTitleV2: { fontSize: 14, lineHeight: 20, fontFamily: FONT_BOLD, color: '#3D2B1F', includeFontPadding: false },
  reviewMainTreeV2: { width: 92, height: 92 },
  reviewEmotionTextV2: { fontSize: 12, lineHeight: 18, fontFamily: FONT_MED, color: '#5D5D41' },
  reviewPercentV2: { fontSize: 28, lineHeight: 36, fontFamily: FONT_BOLD, color: '#3D2B1F', marginVertical: 3 },
  reviewBarRowV2: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  reviewBarLabelV2: { width: 34, fontSize: 9, fontFamily: FONT_MED, color: '#5D5D41' },
  reviewBarBgV2: { flex: 1, height: 7, borderRadius: 4, backgroundColor: '#E7E1D5', overflow: 'hidden' },
  reviewBarFillV2: { height: '100%', borderRadius: 4 },
  reviewBarValueV2: { width: 30, textAlign: 'right', fontSize: 9, fontFamily: FONT_MED, color: '#5D5D41' },
  onboardTextAreaV2: { height: SH * 0.19, alignItems: 'center', justifyContent: 'center' },
  onboardMainTitleV2: { fontSize: 22, lineHeight: 32, fontFamily: FONT_BOLD, color: '#3D2B1F', textAlign: 'center', letterSpacing: 1.4, includeFontPadding: false },
  onboardDescV2: { marginTop: 10, fontSize: 13, lineHeight: 23, fontFamily: FONT_MED, color: '#7A6A5A', textAlign: 'center', letterSpacing: 0.7, includeFontPadding: false },
  onboardDotsV2: { position: 'absolute', left: 0, right: 0, bottom: SH * 0.147, height: 18, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  onboardDotV2: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(141,151,120,0.22)' },
  onboardDotActiveV2: { width: 18, backgroundColor: '#7A9E6A' },
  onboardFinalBtnV2: { position: 'absolute', left: 58, right: 58, bottom: SH * 0.08, height: 52, borderRadius: 28, backgroundColor: '#94A68C', alignItems: 'center', justifyContent: 'center' },
  onboardFinalBtnTextV2: { color: '#FFFFFF', fontSize: 16, lineHeight: 24, fontFamily: FONT_BOLD, letterSpacing: 2, includeFontPadding: false },

  // Calendar
  calendarPageTuned: { paddingTop: 56, paddingBottom: 118 },
  calendarTopRow: { paddingHorizontal: 28, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 },
  monthPillNoBorder: { paddingHorizontal: 20, paddingVertical: 9, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.72)' },
  monthTextBig: { fontSize: 21, color: C.text, fontFamily: FONT_REG },
  moreCircle: { width: 58, height: 58, borderRadius: 29, backgroundColor: 'rgba(255,255,255,0.72)', alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 24, color: C.text, marginTop: -8 },
  weekScrollTuned: { gap: 16, paddingHorizontal: 24, paddingBottom: 28, alignItems: 'flex-start' },
  weekCardTuned: { width: 178, height: 104, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.62)', paddingHorizontal: 16, paddingVertical: 13, overflow: 'hidden' },
  weekCardDisabled: { opacity: 0.70, backgroundColor: 'rgba(255,255,255,0.44)' },
  weekCardTitleTuned: { fontSize: 14, lineHeight: 20, color: C.text, fontFamily: FONT_BOLD, includeFontPadding: false },
  weekCardSubTuned: { fontSize: 18, lineHeight: 24, color: C.text, fontFamily: FONT_BOLD, marginTop: 3, includeFontPadding: false },
  weekIslandImageTuned: { position: 'absolute', right: 10, bottom: 13, width: 74, height: 48, opacity: 0.62 },
  weekStatusLineTuned: { position: 'absolute', left: 16, bottom: 17, width: 78, height: 3, borderRadius: 2, backgroundColor: '#A6BF8E', opacity: 0.85 },
  weekStatusLineMuted: { backgroundColor: '#D9D2C8', opacity: 0.35 },
  weekdayRow: { flexDirection: 'row', paddingHorizontal: 26, marginTop: 2, marginBottom: 6 },
  weekdayTextTuned: { width: (SW - 52) / 7, textAlign: 'center', fontSize: 16, lineHeight: 24, color: C.sub, fontFamily: FONT_REG },
  calendarGridTuned: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 26 },
  calendarCellTuned: { width: (SW - 52) / 7, height: 54, alignItems: 'center', justifyContent: 'flex-start', marginBottom: 3, paddingTop: 2 },
  calendarDayTextTuned: { fontSize: 15, lineHeight: 20, color: C.sub, fontFamily: FONT_REG, includeFontPadding: false },
  calendarTreeTuned: { width: 30, height: 30, marginTop: 0 },
  calendarTreePlaceholderTuned: { width: 30, height: 30, marginTop: 0 },
  calendarHintTuned: { marginTop: 24, textAlign: 'center', fontSize: 17, color: C.sub, fontFamily: FONT_BOLD },
  monthPickerCard: { width: '100%', borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.98)', padding: 20, borderWidth: 1, borderColor: C.line },
  yearSwitcher: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, marginVertical: 18 },
  yearSwitchBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#F5F0E8', alignItems: 'center', justifyContent: 'center' },
  monthPickerYear: { fontSize: 22, fontFamily: FONT_BOLD, color: C.text },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  monthChoice: { width: '30%', height: 42, borderRadius: 14, backgroundColor: '#F5F0E8', alignItems: 'center', justifyContent: 'center' },
  monthChoiceActive: { backgroundColor: C.accent },
  monthChoiceText: { fontSize: 15, color: C.text, fontFamily: FONT_BOLD },

  // Misc
  backBtn: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.7)', zIndex: 20 },
  avatar: { width: 66, height: 66, borderRadius: 33, backgroundColor: 'rgba(255,255,255,0.35)' },
  homeHeader: { position: 'absolute', top: 90, left: 28, right: 28, zIndex: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  homeHi: { fontFamily: FONT_BOLD, fontSize: 18, color: C.text },
  homeRole: { fontFamily: FONT_REG, fontSize: 12, color: C.sub },
  homePromptWrap: { alignSelf: 'center', marginTop: 250, paddingHorizontal: 0, paddingVertical: 0, backgroundColor: 'transparent', borderWidth: 0, transform: [{ translateX: 12 }] },
  homePrompt: { textAlign: 'center', fontFamily: FONT_BOLD, fontSize: 19, lineHeight: 34, color: '#5A4A3A', letterSpacing: 2, includeFontPadding: false, textShadowColor: 'rgba(255,255,255,0.95)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  homeShovelWrap: { position: 'absolute', right: 34, bottom: 118, zIndex: 60, elevation: 60 },
  shovelCircle: { width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center', shadowColor: '#3D2B1F', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 8 },
  diaryBox: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 20, borderWidth: 1, borderColor: C.line, padding: 18, marginBottom: 20, minHeight: 310 },
  wordCount: { textAlign: 'right', fontSize: 12, fontFamily: FONT_REG, color: C.muted },
  tipCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.78)', borderRadius: 18, padding: 14, marginBottom: 18, borderWidth: 1, borderColor: C.line },
  resultCard: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 18, marginBottom: 16 },
  tag: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: 'rgba(250,246,240,0.9)', borderWidth: 1, borderColor: C.line },
  dayInfoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 16, borderWidth: 1, borderColor: C.line, paddingVertical: 12, paddingHorizontal: 18, marginBottom: 10 },
  favoriteStarBtn: { position: 'absolute', top: 56, right: 24, zIndex: 30, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  favoriteStarImg: { width: 30, height: 30 },
  fullDiaryHeader: { position: 'absolute', top: 56, left: 24, right: 24, zIndex: 5 },
  fullDiaryHeaderTitle: { textAlign: 'center', marginTop: -40, fontSize: 23 },
  fullDiaryScroll: { paddingHorizontal: 44, paddingTop: 255, paddingBottom: 190, minHeight: SH + 80 },
  fullDiaryTitle: { fontSize: 28, lineHeight: 38, fontFamily: FONT_BOLD, color: C.text, marginBottom: 28 },
  fullDiaryBody: { fontSize: 18, lineHeight: 36, fontFamily: FONT_REG, color: C.text },
  fullDiaryBottomBtn: { position: 'absolute', left: 28, right: 28, bottom: 82, height: 56, borderRadius: 30, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', shadowColor: '#7A9E6A', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 14, elevation: 8 },
  statsCard: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 18, borderWidth: 1, borderColor: C.line, marginBottom: 16 },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 18, borderRightWidth: 1, borderRightColor: C.line },
  weekEmptyCard: { marginTop: 80, borderRadius: 24, paddingHorizontal: 24, paddingVertical: 30, backgroundColor: 'rgba(255,255,255,0.82)', alignItems: 'center' },
  weekEmptyTitle: { fontSize: 22, lineHeight: 32, fontFamily: FONT_BOLD, color: '#3D2B1F', textAlign: 'center', includeFontPadding: false },
  weekEmptyText: { marginTop: 14, fontSize: 15, lineHeight: 26, fontFamily: FONT_MED, color: '#7A6A5A', textAlign: 'center', includeFontPadding: false },
  elfFeedbackWrap: { marginTop: 18 },
  elfSmallCard: { backgroundColor: 'rgba(255,255,255,0.76)', borderRadius: 18, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(232,224,213,0.55)' },
  elfBlessCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(238,246,226,0.72)', borderRadius: 22, padding: 18, marginBottom: 14 },
  noticeOverlay: { flex: 1, backgroundColor: 'rgba(61,43,31,0.22)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  settingModalOverlay: { flex: 1, backgroundColor: 'rgba(61,43,31,0.22)', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 28, paddingBottom: 34 },
  noticeCard: { width: '100%', maxHeight: SH * 0.78, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.96)', padding: 20, borderWidth: 1, borderColor: C.line },
  noticeClose: { position: 'absolute', right: 14, top: 10, zIndex: 3, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  noticeCloseText: { fontSize: 28, color: C.muted, fontFamily: FONT_REG },
  noticeTitle: { fontSize: 20, color: C.text, fontFamily: FONT_BOLD },
  noticeSub: { fontSize: 13, color: C.sub, fontFamily: FONT_REG, marginTop: 2 },
  noticeListScroll: { maxHeight: SH * 0.56 },
  noticeListContent: { paddingBottom: 6 },
  noticeSwipeWrap: { marginTop: 10, borderRadius: 18, overflow: 'hidden', backgroundColor: '#D84B3A' },
  noticeDeleteBg: { ...StyleSheet.absoluteFillObject, backgroundColor: '#D84B3A', justifyContent: 'center' },
  noticeTrashIcon: { position: 'absolute', width: 30, height: 30, tintColor: '#FFFFFF' },
  noticeTrashLeft: { left: 22 },
  noticeTrashRight: { right: 22 },
  noticeItem: { backgroundColor: '#F5F0E8', borderRadius: 18, padding: 16, marginTop: 10 },
  noticeSwipeItem: { marginTop: 0 },
  noticeItemTitle: { fontSize: 15, lineHeight: 22, color: C.text, fontFamily: FONT_BOLD, marginBottom: 4 },
  noticeBody: { fontSize: 16, lineHeight: 26, color: C.text, fontFamily: FONT_REG },
  noticeAction: { fontSize: 14, lineHeight: 22, color: C.accent, fontFamily: FONT_BOLD, marginTop: 8 },
  noticeFooter: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 8 },
  noticeClear: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 18, marginTop: 8 },
  noticeClearText: { color: C.accent, fontSize: 15, fontFamily: FONT_MED },
  profileV2Page: { flex: 1, backgroundColor: '#FFFDF8' },
  profileV2Scroll: { paddingHorizontal: 22, paddingTop: 60, paddingBottom: 130 },
  profileGear: { position: 'absolute', top: 50, right: 22, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.96)', alignItems: 'center', justifyContent: 'center', zIndex: 5, shadowColor: '#3D2B1F', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  profileGearImage: { width: 23, height: 23 },
  profileHeaderV2: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, paddingRight: 48 },
  profileAvatarV2: { width: 74, height: 74, borderRadius: 37, backgroundColor: '#F8F1E7', borderWidth: 1, borderColor: C.line },
  profileNameV2: { fontSize: 22, lineHeight: 30, fontFamily: FONT_BOLD, color: C.text },
  profileSubV2: { fontSize: 12, lineHeight: 18, fontFamily: FONT_REG, color: C.sub, marginTop: 3 },
  profilePillV2: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 8, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: '#F1F7E9', gap: 5 },
  profilePillText: { fontSize: 12, fontFamily: FONT_BOLD, color: '#6B965D' },
  profileStatsV2: { height: 72, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EFE7DA', flexDirection: 'row', alignItems: 'center', marginBottom: 12, shadowColor: '#3D2B1F', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  profileStatV2: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  profileStatIcon: { width: 28, height: 28, marginBottom: 0 },
  profileStatNum: { fontSize: 17, lineHeight: 21, fontFamily: FONT_BOLD, color: C.text },
  profileStatLabel: { fontSize: 10, lineHeight: 15, fontFamily: FONT_REG, color: C.sub },
  profileStatDivider: { width: 1, height: 40, backgroundColor: '#EFE7DA' },
  profileCardV2: { borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EFE7DA', padding: 14, marginBottom: 12, shadowColor: '#3D2B1F', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  profileCardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  profileSectionIcon: { width: 22, height: 22, marginRight: 8 },
  profileCardTitle: { fontSize: 15, lineHeight: 22, fontFamily: FONT_BOLD, color: C.text },
  profileCardHint: { fontSize: 12, lineHeight: 18, fontFamily: FONT_REG, color: C.sub },
  journeyTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  donutLegendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  donutDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  donutLegendText: { flex: 1, fontSize: 12, lineHeight: 16, fontFamily: FONT_REG, color: C.text },
  donutLegendPercent: { fontSize: 12, lineHeight: 16, fontFamily: FONT_BOLD, color: C.sub },
  profileInsight: { fontSize: 13, lineHeight: 23, fontFamily: FONT_REG, color: C.text, marginBottom: 8 },
  profileJourneySummary: { fontSize: 13, lineHeight: 22, fontFamily: FONT_REG, color: C.text, marginTop: 2 },
  profileTagBlock: { marginTop: 6 },
  profileMiniTitle: { fontSize: 13, lineHeight: 20, fontFamily: FONT_BOLD, color: C.sub, marginBottom: 7 },
  profileTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  profileTag: { overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, backgroundColor: '#FCECE7', color: '#D85A30', fontSize: 12, fontFamily: FONT_BOLD },
  profileElfMessage: { marginTop: 14, fontSize: 13, lineHeight: 23, fontFamily: FONT_REG, color: C.sub, backgroundColor: '#F7F4EC', borderRadius: 12, padding: 12 },
  achievementGrid: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  achievementTile: { flex: 1, minHeight: 92, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  achievementIcon: { width: 58, height: 58, marginBottom: 6 },
  achievementIconWide: { width: 58, height: 58 },
  achievementName: { fontSize: 11, lineHeight: 16, fontFamily: FONT_BOLD, color: C.text, textAlign: 'center' },
  achievementCount: { fontSize: 11, lineHeight: 16, fontFamily: FONT_REG, color: C.sub, marginTop: 2 },
  favoriteMiniTile: { width: 54, height: 54, borderRadius: 12, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  favoriteMiniImg: { width: 58, height: 58 },
  logoutBtnV2: { marginTop: 14, paddingVertical: 12, alignItems: 'center', borderRadius: 12, backgroundColor: '#FFF6F5' },
  settingExplainRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(232,224,213,0.55)' },
  settingListRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: 'rgba(232,224,213,0.65)' },
  settingListTitle: { fontSize: 18, lineHeight: 26, fontFamily: FONT_BOLD, color: C.text },
  settingListSub: { marginTop: 5, fontSize: 13, lineHeight: 20, fontFamily: FONT_REG, color: C.sub },
  settingListValue: { marginLeft: 12, fontSize: 15, lineHeight: 22, fontFamily: FONT_BOLD, color: C.accent },
  settingAccountBox: { paddingTop: 16, paddingBottom: 4 },
  settingEditorOverlay: { flex: 1, backgroundColor: 'rgba(30,24,20,0.35)', justifyContent: 'flex-end' },
  settingEditorSheet: { borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: '#FFFDF8', paddingHorizontal: 24, paddingTop: 26, paddingBottom: 34, borderWidth: 1, borderColor: C.line },
  settingEditorTitle: { fontSize: 24, lineHeight: 34, fontFamily: FONT_BOLD, color: C.text, textAlign: 'center' },
  settingEditorDesc: { marginTop: 10, marginBottom: 16, fontSize: 14, lineHeight: 24, fontFamily: FONT_REG, color: C.sub, textAlign: 'center' },
  wheelBox: { height: 220, borderRadius: 24, overflow: 'hidden', backgroundColor: '#F5F0E8', marginBottom: 20 },
  wheelHighlight: { position: 'absolute', left: 18, right: 18, top: 82, height: 56, borderRadius: 28, backgroundColor: 'rgba(122,158,106,0.18)', zIndex: 1 },
  wheelScroll: { paddingVertical: 74 },
  wheelItem: { height: 56, justifyContent: 'center', alignItems: 'center' },
  wheelItemText: { fontSize: 22, lineHeight: 30, fontFamily: FONT_MED, color: 'rgba(61,43,31,0.38)' },
  wheelItemTextActive: { fontSize: 30, lineHeight: 38, fontFamily: FONT_BOLD, color: C.text },
  settingEditorActions: { flexDirection: 'row', gap: 12 },
  settingEditorCancel: { flex: 1, height: 52, borderRadius: 26, backgroundColor: '#EFE7DA', alignItems: 'center', justifyContent: 'center' },
  settingEditorCancelText: { fontSize: 16, fontFamily: FONT_BOLD, color: C.sub },
  settingEditorSave: { flex: 1, height: 52, borderRadius: 26, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  settingEditorSaveText: { fontSize: 16, fontFamily: FONT_BOLD, color: '#FFFFFF' },
  achievementOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 100, backgroundColor: 'rgba(0,0,0,0.56)', alignItems: 'center', justifyContent: 'center' },
  achievementPopupImage: { width: 210, height: 210 },
  achievementPopupTitle: { marginTop: 12, color: '#FFFFFF', fontSize: 24, lineHeight: 32, fontFamily: FONT_BOLD },
  achievementPopupHint: { marginTop: 14, color: 'rgba(255,255,255,0.86)', fontSize: 15, lineHeight: 22, fontFamily: FONT_REG },
  favoriteListItem: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: C.line, padding: 14, marginBottom: 12 },
  favoriteListTree: { width: 64, height: 64, marginRight: 12 },
  favoriteListDate: { fontSize: 16, lineHeight: 24, fontFamily: FONT_BOLD, color: C.text, marginBottom: 4 },
  favoriteListArrow: { fontSize: 28, color: C.sub, marginLeft: 8 },
  optionCard: { width: '100%', borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.98)', padding: 20, borderWidth: 1, borderColor: C.line },
  optionItem: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(232,224,213,0.55)' },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
});
