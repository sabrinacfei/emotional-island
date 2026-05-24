import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// ← 改成你的電腦 IP，讓手機也能連到
const BASE_URL = 'http://127.0.0.1:8001';

const api = axios.create({ baseURL: BASE_URL });

// 每次 request 自動帶 token
api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── 認證 ──
export const register = (username: string, email: string, password: string) =>
  api.post('/register', { username, email, password });

export const login = (email: string, password: string) =>
  api.post('/login', { email, password });

export const getMe = () => api.get('/me');

// ── 日記 ──
export const submitDiary = (content: string) =>
  api.post('/diary', { content });

export const getDiary = () => api.get('/diary');

// ── 情緒分析 ──
export const getHistory = () => api.get('/history');

export const getTrends = () => api.get('/trends');

export default api;
