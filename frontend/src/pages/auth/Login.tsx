import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../stores/auth';
import { useToast } from '../../stores/toast';
import * as authApi from '../../services/auth';

type AuthMode = 'login' | 'register';
type LoginMethod = 'password' | 'code';

type LoginLocationState = {
  from?: string;
};

type ApiErrorResponse = {
  response?: {
    data?: { detail?: unknown };
    status?: number;
  };
};

type AuthIconProps = {
  size?: number;
  className?: string;
};

type FeatureCard = {
  title: string;
  description: string;
  accent: 'green' | 'blue' | 'purple' | 'orange';
  icon: React.ReactNode;
};

type WorkflowStep = {
  title: string;
  description: string;
  accent: 'green' | 'blue' | 'orange' | 'purple';
  icon: React.ReactNode;
};

type RegisterFormState = {
  username: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  code: string;
  agreed: boolean;
};

type LoginFormState = {
  email: string;
  password: string;
  code: string;
};

const isApiErrorResponse = (value: unknown): value is ApiErrorResponse => {
  return typeof value === 'object' && value !== null && 'response' in value;
};

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const VERIFICATION_CODE_PATTERN = /^\d{6}$/;

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const normalizeVerificationCode = (code: string) => code.trim();
const sanitizeVerificationCodeInput = (code: string) => code.replace(/\D/g, '').slice(0, 6);

const isValidEmail = (email: string) => EMAIL_PATTERN.test(email);
const isValidVerificationCode = (code: string) => VERIFICATION_CODE_PATTERN.test(code);

const CubeIcon: React.FC<AuthIconProps> = ({ size = 20, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const WandIcon: React.FC<AuthIconProps> = ({ size = 22, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 4V2" />
    <path d="M15 16v-2" />
    <path d="M8 9h2" />
    <path d="M20 9h2" />
    <path d="M17.8 11.8 19 13" />
    <path d="M15 9h.01" />
    <path d="M17.8 6.2 19 5" />
    <path d="m3 21 9-9" />
    <path d="M12.2 6.2 11 5" />
  </svg>
);

const LayersIcon: React.FC<AuthIconProps> = ({ size = 22, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 2 10 6-10 6L2 8l10-6Z" />
    <path d="m2 17 10 6 10-6" />
    <path d="m2 12 10 6 10-6" />
  </svg>
);

const PrinterIcon: React.FC<AuthIconProps> = ({ size = 22, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 9V2h12v7" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <path d="M6 14h12v8H6z" />
  </svg>
);

const ShieldIcon: React.FC<AuthIconProps> = ({ size = 18, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67 0C7.5 20.65 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.25-2.45a1.4 1.4 0 0 1 1.5 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const UserIcon: React.FC<AuthIconProps> = ({ size = 18, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const MailIcon: React.FC<AuthIconProps> = ({ size = 18, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a2 2 0 0 1-2.06 0L2 7" />
  </svg>
);

const EyeIcon: React.FC<AuthIconProps & { hidden: boolean }> = ({ hidden, size = 18, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {hidden ? (
      <>
        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
        <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
        <path d="m2 2 20 20" />
        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      </>
    ) : (
      <>
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    )}
  </svg>
);

const BuildingIcon: React.FC<AuthIconProps> = ({ size = 18, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 21h18" />
    <path d="M5 21V7l8-4v18" />
    <path d="M19 21V11l-6-3" />
    <path d="M9 9h.01" />
    <path d="M9 13h.01" />
    <path d="M9 17h.01" />
    <path d="M17 14h.01" />
    <path d="M17 18h.01" />
  </svg>
);

const AlertIcon: React.FC<AuthIconProps> = ({ size = 18, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const authFeatures: FeatureCard[] = [
  { title: 'AI 创作工作台', description: '图片、文字或本地模型进入 3D 编辑', accent: 'green', icon: <WandIcon /> },
  { title: 'G-code 处理工作台', description: '切片、MAG_ON/MAG_OFF 与路径预览', accent: 'blue', icon: <LayersIcon /> },
  { title: '打印机管理', description: 'Moonraker/Fluidd 设备状态与任务投递', accent: 'purple', icon: <PrinterIcon /> },
];

const authSteps: WorkflowStep[] = [
  { title: '生成或导入模型', description: '图生3D、文生3D、上传模型文件', accent: 'green', icon: <UserIcon /> },
  { title: '处理 G-code', description: '标注区域、切片并生成磁场指令', accent: 'blue', icon: <LayersIcon /> },
  { title: '投递到设备', description: '保存项目后直接上传到在线打印机', accent: 'orange', icon: <PrinterIcon /> },
];

const AuthBrand: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <Link to="/" className={`auth-brand ${compact ? 'auth-brand-compact' : ''}`}>
    <span className="auth-brand-icon"><CubeIcon /></span>
    <span className="auth-brand-text">创客学堂</span>
  </Link>
);

const AuthTopBar: React.FC<{ mode: AuthMode; onSwitch: (mode: AuthMode) => void }> = ({ mode, onSwitch }) => {
  return (
    <header className="auth-topbar">
      <AuthBrand />
      <nav className="auth-topnav" aria-label="认证页导航">
        <Link to="/">首页</Link>
        <Link to="/models">模型库</Link>
        <Link to="/ai">AI 创作</Link>
        <Link to="/editor">G-code</Link>
        <Link to="/projects">项目中心</Link>
        <Link to="/device">设备</Link>
      </nav>
      <button type="button" className="auth-top-link" onClick={() => onSwitch(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? '立即注册' : '去登录'}
      </button>
    </header>
  );
};

const AuthVisual: React.FC<{ mode: AuthMode }> = ({ mode }) => {
  const isLogin = mode === 'login';

  return (
    <section className="auth-visual" aria-labelledby="auth-visual-title">
      <div className="auth-gift-badge">
        <CubeIcon size={18} />
        {isLogin ? 'AI 模型与 4D 打印闭环' : '邮箱验证后进入 4D 打印工作台'}
      </div>
      <h1 id="auth-visual-title" className="auth-hero-title">
        {isLogin ? (
          <>登录创客学堂，<span>继续你的 4D 打印</span>项目</>
        ) : (
          <>创建账号，接入 <span>4D 打印</span>工作台</>
        )}
      </h1>
      <p className="auth-hero-copy">
        {isLogin
          ? '从模型库和 AI 创作进入，标注磁性区域，生成 G-code，再投递到在线打印机'
          : '模型资产、磁性区域、切片任务与打印设备集中管理'}
      </p>

      <div className="auth-feature-grid">
        {authFeatures.map((item) => (
          <article key={item.title} className="auth-feature-card">
            <span className={`auth-feature-icon auth-accent-${item.accent}`}>{item.icon}</span>
            <span>
              <strong>{item.title}</strong>
              <small>{item.description}</small>
            </span>
          </article>
        ))}
      </div>

      <div className="auth-steps-panel">
        <div className="auth-panel-title">{isLogin ? '三步继续你的打印流程' : '三步开启 4D 打印之旅'}</div>
        <div className="auth-step-line">
          {authSteps.map((step, index) => (
            <div key={step.title} className="auth-step-item">
              <span className={`auth-step-number auth-accent-${step.accent}`}>{index + 1}</span>
              <span>
                <strong>{step.title}</strong>
                <small>{step.description}</small>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

const LoginForm: React.FC<{
  email: string;
  password: string;
  code: string;
  method: LoginMethod;
  loading: boolean;
  showPassword: boolean;
  codeSending: boolean;
  codeCountdown: number;
  codeHint: string;
  wechatLoading: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onMethodChange: (method: LoginMethod) => void;
  onTogglePassword: () => void;
  onSendCode: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onSwitchRegister: () => void;
  onWeChatLogin: () => void;
  developerMode: boolean;
  developerLoading: boolean;
  onDeveloperLogin: () => void;
}> = ({
  email,
  password,
  code,
  method,
  loading,
  showPassword,
  codeSending,
  codeCountdown,
  codeHint,
  wechatLoading,
  onEmailChange,
  onPasswordChange,
  onCodeChange,
  onMethodChange,
  onTogglePassword,
  onSendCode,
  onSubmit,
  onSwitchRegister,
  onWeChatLogin,
  developerMode,
  developerLoading,
  onDeveloperLogin,
}) => (
  <form onSubmit={onSubmit} className="auth-form">
    <div className="auth-login-method-tabs" role="tablist" aria-label="登录方式">
      <button
        type="button"
        role="tab"
        aria-selected={method === 'password'}
        className={method === 'password' ? 'active' : ''}
        onClick={() => onMethodChange('password')}
      >
        密码登录
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={method === 'code'}
        className={method === 'code' ? 'active' : ''}
        onClick={() => onMethodChange('code')}
      >
        邮箱验证码
      </button>
    </div>

    <div className="auth-field">
      <label htmlFor="login-email">邮箱</label>
      <input
        id="login-email"
        type="email"
        autoComplete="username"
        placeholder="请输入邮箱地址"
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
        required
      />
    </div>

    {method === 'password' ? (
      <div className="auth-field">
        <label htmlFor="login-password">密码</label>
        <div className="auth-input-shell">
          <input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="请输入密码"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            required
          />
          <button type="button" className="auth-input-icon" onClick={onTogglePassword} aria-label={showPassword ? '隐藏密码' : '显示密码'}>
            <EyeIcon hidden={!showPassword} />
          </button>
        </div>
      </div>
    ) : (
      <div className="auth-field">
        <label htmlFor="login-code">邮箱验证码</label>
        <div className="auth-code-row">
          <input
            id="login-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="请输入验证码"
            value={code}
            onChange={(event) => onCodeChange(sanitizeVerificationCodeInput(event.target.value))}
            pattern="[0-9]{6}"
            title="请输入 6 位数字验证码"
            required
          />
          <button type="button" onClick={onSendCode} disabled={codeSending || codeCountdown > 0 || !email.trim()}>
            {codeSending ? '发送中...' : codeCountdown > 0 ? `${codeCountdown}s` : '获取验证码'}
          </button>
        </div>
        {codeHint && <p className="auth-code-hint">{codeHint}</p>}
      </div>
    )}

    <div className="auth-form-row">
      <label className="auth-checkbox">
        <input type="checkbox" checked readOnly />
        <span>保持登录</span>
      </label>
      <button type="button" className="auth-link-button" disabled>忘记密码?</button>
    </div>

    <button type="submit" className="auth-submit" disabled={loading}>{loading ? '登录中...' : method === 'code' ? '验证码登录' : '登录'}</button>
    <button type="button" className="auth-secondary-action" onClick={() => onMethodChange(method === 'password' ? 'code' : 'password')}>
      <ShieldIcon />{method === 'password' ? '切换邮箱验证码登录' : '切换密码登录'}
    </button>

    <p className="auth-switch-copy">还没有账号？<button type="button" onClick={onSwitchRegister}>立即注册</button></p>

    {developerMode && (
      <button type="button" className="auth-secondary-action" onClick={onDeveloperLogin} disabled={loading || wechatLoading || developerLoading}>
        <BuildingIcon />{developerLoading ? '进入开发者模式...' : '开发者模式'}
      </button>
    )}

    <div className="auth-divider"><span>其他方式登录</span></div>
    <div className="auth-social-grid">
      <button type="button" className="auth-social-button auth-social-wechat" onClick={onWeChatLogin} disabled={loading || wechatLoading}>
        {wechatLoading ? '连接中...' : '微信登录'}
      </button>
      <button type="button" className="auth-social-button" disabled><BuildingIcon />企业账号登录</button>
    </div>

    <p className="auth-policy-copy">登录即表示你同意 <Link to="/terms">《用户协议》</Link> 与 <Link to="/privacy">《隐私政策》</Link></p>
  </form>
);

const RegisterForm: React.FC<{
  form: RegisterFormState;
  loading: boolean;
  showPassword: boolean;
  onFormChange: (nextForm: RegisterFormState) => void;
  onTogglePassword: () => void;
  onSendCode: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onSwitchLogin: () => void;
  codeSending: boolean;
  codeCountdown: number;
  codeHint: string;
}> = ({ form, loading, showPassword, onFormChange, onTogglePassword, onSendCode, onSubmit, onSwitchLogin, codeSending, codeCountdown, codeHint }) => (
  <form onSubmit={onSubmit} className="auth-form auth-form-register">
    <div className="auth-field">
      <label htmlFor="register-username">用户名</label>
      <div className="auth-input-shell auth-input-with-leading">
        <UserIcon />
        <input
          id="register-username"
          type="text"
          autoComplete="name"
          placeholder="请输入用户名"
          value={form.username}
          onChange={(event) => onFormChange({ ...form, username: event.target.value })}
          required
        />
      </div>
    </div>

    <div className="auth-field">
      <label htmlFor="register-email">邮箱</label>
      <div className="auth-input-shell auth-input-with-leading">
        <MailIcon />
        <input
          id="register-email"
          type="email"
          autoComplete="email"
          placeholder="请输入邮箱地址"
          value={form.email}
          onChange={(event) => onFormChange({ ...form, email: event.target.value })}
          required
        />
      </div>
    </div>

    <div className="auth-field">
      <label htmlFor="register-phone">手机号</label>
      <div className="auth-phone-row">
        <button type="button" className="auth-country-code">+86</button>
        <input
          id="register-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="请输入手机号"
          value={form.phone}
          onChange={(event) => onFormChange({ ...form, phone: event.target.value })}
          pattern="1[3-9][0-9]{9}"
          title="请输入 11 位中国大陆手机号"
          required
        />
      </div>
    </div>

    <div className="auth-field">
      <label htmlFor="register-password">设置密码</label>
      <div className="auth-input-shell">
        <input
          id="register-password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder="请设置 8-16 位密码，包含字母和数字"
          value={form.password}
          onChange={(event) => onFormChange({ ...form, password: event.target.value })}
          minLength={8}
          pattern="(?=.*[a-zA-Z])(?=.*\d).{8,16}"
          title="密码需为 8-16 位，包含字母和数字"
          required
        />
        <button type="button" className="auth-input-icon" onClick={onTogglePassword} aria-label={showPassword ? '隐藏密码' : '显示密码'}>
          <EyeIcon hidden={!showPassword} />
        </button>
      </div>
    </div>

    <div className="auth-field">
      <label htmlFor="register-confirm-password">确认密码</label>
      <div className="auth-input-shell">
        <input
          id="register-confirm-password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder="请再次输入密码"
          value={form.confirmPassword}
          onChange={(event) => onFormChange({ ...form, confirmPassword: event.target.value })}
          required
        />
        <button type="button" className="auth-input-icon" onClick={onTogglePassword} aria-label={showPassword ? '隐藏密码' : '显示密码'}>
          <EyeIcon hidden={!showPassword} />
        </button>
      </div>
    </div>

    <div className="auth-field">
      <label htmlFor="register-code">验证码</label>
      <div className="auth-code-row">
        <input
          id="register-code"
          type="text"
          inputMode="numeric"
          placeholder="请输入验证码"
          value={form.code}
          onChange={(event) => onFormChange({ ...form, code: sanitizeVerificationCodeInput(event.target.value) })}
          pattern="[0-9]{6}"
          title="请输入 6 位数字验证码"
          required
        />
        <button type="button" onClick={onSendCode} disabled={codeSending || codeCountdown > 0 || !form.email.trim()}>
          {codeSending ? '发送中...' : codeCountdown > 0 ? `${codeCountdown}s` : '获取验证码'}
        </button>
      </div>
      {codeHint && <p className="auth-code-hint">{codeHint}</p>}
    </div>

    <label className="auth-checkbox auth-agreement">
      <input
        type="checkbox"
        checked={form.agreed}
        onChange={(event) => onFormChange({ ...form, agreed: event.target.checked })}
      />
      <span>我已阅读并同意 <Link className="auth-policy-link" to="/terms" onClick={(event) => event.stopPropagation()}>《用户协议》</Link> 和 <Link className="auth-policy-link" to="/privacy" onClick={(event) => event.stopPropagation()}>《隐私政策》</Link></span>
    </label>

    <button type="submit" className="auth-submit" disabled={loading}>{loading ? '注册中...' : '立即注册'}</button>
    <p className="auth-switch-copy">已有账号？<button type="button" onClick={onSwitchLogin}>去登录</button></p>
  </form>
);

const Login: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: AuthMode = searchParams.get('tab') === 'register' ? 'register' : 'login';
  const [loading, setLoading] = useState(false);
  const [wechatLoading, setWeChatLoading] = useState(false);
  const [developerLoading, setDeveloperLoading] = useState(false);
  const [wechatHandled, setWechatHandled] = useState(false);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password');
  const [loginCodeSending, setLoginCodeSending] = useState(false);
  const [loginCodeCountdown, setLoginCodeCountdown] = useState(0);
  const [loginCodeHint, setLoginCodeHint] = useState('');
  const [codeSending, setCodeSending] = useState(false);
  const [codeCountdown, setCodeCountdown] = useState(0);
  const [verificationCodeHint, setVerificationCodeHint] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const { showToast } = useToast();
  const developerMode = import.meta.env.DEV;

  const [loginForm, setLoginForm] = useState<LoginFormState>({ email: '', password: '', code: '' });
  const [registerForm, setRegisterForm] = useState({
    username: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    code: '',
    agreed: false,
  });
  const [errorMsg, setErrorMsg] = useState('');

  const getRedirectTarget = () => {
    const redirectParam = searchParams.get('redirect');
    if (redirectParam && redirectParam.startsWith('/') && !redirectParam.startsWith('//')) {
      return redirectParam;
    }
    const state = location.state as LoginLocationState | null;
    return state?.from && state.from.startsWith('/') && !state.from.startsWith('//') ? state.from : '/';
  };

  useEffect(() => {
    if (codeCountdown <= 0) return undefined;
    const timer = window.setTimeout(() => {
      setCodeCountdown((value) => Math.max(value - 1, 0));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [codeCountdown]);

  useEffect(() => {
    if (loginCodeCountdown <= 0) return undefined;
    const timer = window.setTimeout(() => {
      setLoginCodeCountdown((value) => Math.max(value - 1, 0));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [loginCodeCountdown]);

  const extractError = (error: unknown, fallback: string): string => {
    const detail = isApiErrorResponse(error) ? error.response : undefined;
    if (detail?.status === 429) return '请求过于频繁，请稍后再试';
    const dataDetail = detail?.data?.detail;
    if (typeof dataDetail === 'string') return dataDetail;
    if (Array.isArray(dataDetail) && dataDetail.length > 0) {
      const first = dataDetail[0];
      if (typeof first === 'object' && first !== null && 'msg' in first && typeof first.msg === 'string') {
        return first.msg;
      }
    }
    return fallback;
  };

  const switchTab = (tab: AuthMode) => {
    setErrorMsg('');
    setShowPassword(false);
    setLoginCodeHint('');
    if (tab === 'register') {
      setSearchParams({ tab: 'register' }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  };

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    if (!code || !state || wechatHandled) return;
    setWechatHandled(true);
    setWeChatLoading(true);
    setErrorMsg('');
    void authApi.loginWithWeChat(code, state)
      .then((data) => {
        login(data.access_token, data.user);
        showToast('微信登录成功', 'success');
        navigate(data.redirect_url || '/', { replace: true });
      })
      .catch((error: unknown) => {
        const msg = extractError(error, '微信登录失败，请重新扫码');
        setErrorMsg(msg);
        showToast(msg, 'error');
        setSearchParams({}, { replace: true });
      })
      .finally(() => setWeChatLoading(false));
  }, [searchParams, wechatHandled, login, navigate, setSearchParams, showToast]);

  const clearError = () => {
    if (errorMsg) setErrorMsg('');
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg('');
    const email = normalizeEmail(loginForm.email);
    if (!isValidEmail(email)) {
      const msg = '请输入正确的邮箱地址';
      setErrorMsg(msg);
      showToast(msg, 'error');
      return;
    }
    if (loginMethod === 'code' && !isValidVerificationCode(normalizeVerificationCode(loginForm.code))) {
      const msg = '请先获取并填写邮箱验证码';
      setErrorMsg(msg);
      showToast(msg, 'error');
      return;
    }
    setLoading(true);
    try {
      const data = loginMethod === 'code'
        ? await authApi.loginWithCode(email, loginForm.code)
        : await authApi.login(email, loginForm.password);
      login(data.access_token, data.user);
      showToast('登录成功', 'success');
      navigate(getRedirectTarget(), { replace: true });
    } catch (error: unknown) {
      const msg = extractError(error, '登录失败，请检查账号和密码');
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeveloperLogin = async () => {
    setDeveloperLoading(true);
    setErrorMsg('');
    try {
      const storageKey = '4d-print-developer-client-id';
      let clientId = localStorage.getItem(storageKey);
      if (!clientId) {
        clientId = typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(storageKey, clientId);
      }
      const data = await authApi.developerLogin(clientId);
      login(data.access_token, data.user);
      showToast('已进入开发者模式', 'success');
      navigate(getRedirectTarget(), { replace: true });
    } catch (error: unknown) {
      const msg = extractError(error, '开发者模式进入失败，请确认后端处于开发环境');
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setDeveloperLoading(false);
    }
  };

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorMsg('');
    if (registerForm.password !== registerForm.confirmPassword) {
      const msg = '两次输入的密码不一致';
      setErrorMsg(msg);
      showToast(msg, 'error');
      return;
    }
    if (!registerForm.agreed) {
      const msg = '请先阅读并同意用户协议和隐私政策';
      setErrorMsg(msg);
      showToast(msg, 'error');
      return;
    }
    const email = normalizeEmail(registerForm.email);
    const verificationCode = normalizeVerificationCode(registerForm.code);
    if (!isValidEmail(email)) {
      const msg = '请输入正确的邮箱地址';
      setErrorMsg(msg);
      showToast(msg, 'error');
      return;
    }
    if (!isValidVerificationCode(verificationCode)) {
      const msg = '请先获取并填写邮箱验证码';
      setErrorMsg(msg);
      showToast(msg, 'error');
      return;
    }
    setLoading(true);
    try {
      const data = await authApi.register(
        registerForm.username,
        email,
        registerForm.phone,
        registerForm.password,
        verificationCode,
      );
      login(data.access_token, data.user);
      showToast('注册成功，欢迎加入', 'success');
      navigate(getRedirectTarget(), { replace: true });
    } catch (error: unknown) {
      const msg = extractError(error, '注册失败，请重试');
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSendVerificationCode = async () => {
    const email = normalizeEmail(registerForm.email);
    if (!email) {
      const msg = '请先填写邮箱地址';
      setErrorMsg(msg);
      showToast(msg, 'error');
      return;
    }
    if (!isValidEmail(email)) {
      const msg = '请输入正确的邮箱地址';
      setErrorMsg(msg);
      showToast(msg, 'error');
      return;
    }
    setCodeSending(true);
    setErrorMsg('');
    setVerificationCodeHint('');
    try {
      const result = await authApi.sendVerificationCode(email, 'register');
      const hint = result.dev_code ? `开发模式验证码：${result.dev_code}` : '验证码已发送，请查收邮箱';
      setVerificationCodeHint(hint);
      setCodeCountdown(60);
      showToast(result.message, 'success');
    } catch (error: unknown) {
      const msg = extractError(error, '验证码发送失败，请稍后再试');
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setCodeSending(false);
    }
  };

  const handleSendLoginVerificationCode = async () => {
    const email = normalizeEmail(loginForm.email);
    if (!email) {
      const msg = '请先填写邮箱地址';
      setErrorMsg(msg);
      showToast(msg, 'error');
      return;
    }
    if (!isValidEmail(email)) {
      const msg = '请输入正确的邮箱地址';
      setErrorMsg(msg);
      showToast(msg, 'error');
      return;
    }
    setLoginCodeSending(true);
    setErrorMsg('');
    setLoginCodeHint('');
    try {
      const result = await authApi.sendVerificationCode(email, 'login');
      const hint = result.dev_code ? `开发模式验证码：${result.dev_code}` : '验证码已发送，请查收邮箱';
      setLoginCodeHint(hint);
      setLoginCodeCountdown(60);
      showToast(result.message, 'success');
    } catch (error: unknown) {
      const msg = extractError(error, '验证码发送失败，请稍后再试');
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setLoginCodeSending(false);
    }
  };

  const handleWeChatLogin = async () => {
    setWeChatLoading(true);
    setErrorMsg('');
    try {
      const authUrl = await authApi.getWeChatLoginUrl(getRedirectTarget());
      window.location.assign(authUrl);
    } catch (error: unknown) {
      const msg = extractError(error, '微信登录暂未配置');
      setErrorMsg(msg);
      showToast(msg, 'error');
      setWeChatLoading(false);
    }
  };

  const handleLoginFormChange = (field: keyof typeof loginForm, value: string) => {
    clearError();
    setLoginForm((current) => {
      if (field === 'email' && normalizeEmail(value) !== normalizeEmail(current.email)) {
        setLoginCodeHint('');
        setLoginCodeCountdown(0);
        return { ...current, email: value, code: '' };
      }
      return { ...current, [field]: value };
    });
  };

  const handleLoginMethodChange = (method: LoginMethod) => {
    clearError();
    setLoginMethod(method);
  };

  const handleRegisterFormChange = (nextForm: typeof registerForm) => {
    clearError();
    const emailChanged = normalizeEmail(nextForm.email) !== normalizeEmail(registerForm.email);
    if (emailChanged) {
      setVerificationCodeHint('');
      setCodeCountdown(0);
    }
    setRegisterForm(emailChanged ? { ...nextForm, code: '' } : nextForm);
  };

  return (
    <div className={`auth-page auth-page-${activeTab}`}>
      <div className="auth-surface auth-surface-left" />
      <div className="auth-surface auth-surface-right" />
      <AuthTopBar mode={activeTab} onSwitch={switchTab} />

      <main className={`auth-layout auth-layout-${activeTab}`}>
        <AuthVisual mode={activeTab} />

        <section className="auth-card-shell" aria-label={activeTab === 'login' ? '登录表单' : '注册表单'}>
          <div className={`auth-card auth-card-${activeTab}`}>
            <div className="auth-card-cube" aria-hidden="true"><CubeIcon size={76} /></div>
            <div className="auth-card-header">
              <h2>{activeTab === 'login' ? '欢迎登录' : '创建你的账号'}</h2>
              <p>{activeTab === 'login' ? '登录后继续你的4D打印创作之旅' : '加入创客学堂，开启你的 4D 打印之旅'}</p>
            </div>

            {errorMsg && (
              <div role="alert" className="auth-error-alert">
                <AlertIcon />
                <span>{errorMsg}</span>
              </div>
            )}

            {activeTab === 'login' ? (
              <LoginForm
                email={loginForm.email}
                password={loginForm.password}
                code={loginForm.code}
                method={loginMethod}
                loading={loading}
                showPassword={showPassword}
                codeSending={loginCodeSending}
                codeCountdown={loginCodeCountdown}
                codeHint={loginCodeHint}
                wechatLoading={wechatLoading}
                onEmailChange={(value) => handleLoginFormChange('email', value)}
                onPasswordChange={(value) => handleLoginFormChange('password', value)}
                onCodeChange={(value) => handleLoginFormChange('code', value)}
                onMethodChange={handleLoginMethodChange}
                onTogglePassword={() => setShowPassword((value) => !value)}
                onSendCode={handleSendLoginVerificationCode}
                onSubmit={handleLogin}
                onSwitchRegister={() => switchTab('register')}
                onWeChatLogin={handleWeChatLogin}
                        developerMode={developerMode}
                        developerLoading={developerLoading}
                        onDeveloperLogin={handleDeveloperLogin}
              />
            ) : (
              <RegisterForm
                form={registerForm}
                loading={loading}
                showPassword={showPassword}
                onFormChange={handleRegisterFormChange}
                onTogglePassword={() => setShowPassword((value) => !value)}
                onSendCode={handleSendVerificationCode}
                onSubmit={handleRegister}
                onSwitchLogin={() => switchTab('login')}
                codeSending={codeSending}
                codeCountdown={codeCountdown}
                codeHint={verificationCodeHint}
              />
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default Login;
