import axios from 'axios';

const authClient = axios.create({
  baseURL: '', // vite proxy 会处理 /api 路由
  headers: { 'Content-Type': 'application/json' },
});

authClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

authClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const url: string = error?.config?.url || '';
    const authAttemptPaths = ['/api/users/login', '/api/users/login/code', '/api/users/register', '/api/users/wechat/login'] as const;
    const isAuthAttempt = authAttemptPaths.some((path) => url.includes(path));
    if (error?.response?.status === 401 && !isAuthAttempt) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      const target = `${window.location.pathname}${window.location.search}`;
      window.location.href = target && target !== '/login' ? `/login?redirect=${encodeURIComponent(target)}` : '/login';
    }
    return Promise.reject(error);
  },
);

export type AuthUser = {
  readonly id: number;
  readonly username: string;
  readonly email: string;
  readonly phone?: string | null;
  readonly avatar_path?: string | null;
  readonly is_admin?: boolean;
  readonly email_verified?: boolean;
};

export type AuthTokenResponse = {
  readonly access_token: string;
  readonly token_type: string;
  readonly user: AuthUser;
};

export type WeChatLoginResponse = AuthTokenResponse & {
  readonly redirect_url: string;
};

export type VerificationPurpose = 'register' | 'login';

export interface VerificationCodeResponse {
  success: boolean;
  message: string;
  dev_code?: string | null;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const normalizeVerificationCode = (code: string) => code.trim();

export const sendVerificationCode = async (email: string, purpose: VerificationPurpose = 'register'): Promise<VerificationCodeResponse> => {
  const response = await authClient.post('/api/users/verification-code', { email: normalizeEmail(email), purpose });
  return response.data;
};

export const register = async (
  username: string,
  email: string,
  phone: string,
  password: string,
  verificationCode: string,
): Promise<AuthTokenResponse> => {
  const response = await authClient.post('/api/users/register', {
    username,
    email: normalizeEmail(email),
    phone,
    password,
    verification_code: normalizeVerificationCode(verificationCode),
  });
  return response.data;
};

export const login = async (email: string, password: string): Promise<AuthTokenResponse> => {
  const response = await authClient.post('/api/users/login', { email: normalizeEmail(email), password });
  return response.data;
};

export const loginWithCode = async (email: string, verificationCode: string): Promise<AuthTokenResponse> => {
  const response = await authClient.post('/api/users/login/code', {
    email: normalizeEmail(email),
    verification_code: normalizeVerificationCode(verificationCode),
  });
  return response.data;
};

export const getWeChatLoginUrl = async (redirect: string): Promise<string> => {
  const response = await authClient.get('/api/users/wechat/login-url', { params: { redirect } });
  return response.data.auth_url;
};

export const loginWithWeChat = async (code: string, state: string): Promise<WeChatLoginResponse> => {
  const response = await authClient.post('/api/users/wechat/login', { code, state });
  return response.data;
};

export const getMe = async () => {
  const response = await authClient.get('/api/users/me');
  return response.data;
};

export const updateProfile = async (username: string, email: string) => {
  const response = await authClient.put('/api/users/me', { username, email });
  return response.data;
};

export const uploadAvatar = async (file: File) => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await authClient.post('/api/users/me/avatar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const logout = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
};
