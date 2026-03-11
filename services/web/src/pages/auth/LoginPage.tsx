/**
 * [artifact:前端代码] — 登录页
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/api/auth';
import { config } from '@/config';
import { ApiError } from '@/types/api';
import Button from '@/components/common/Button';
import styles from './LoginPage.module.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [form, setForm] = useState({
    username: '',
    password: '',
    tenantCode: config.tenantCode,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.username || !form.password) {
      setError('请输入账号和密码');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await authApi.login(form);
      setAuth(data.user, data.accessToken, data.refreshToken);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('登录失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        {/* Logo */}
        <div className={styles.logo}>
          <span className={styles.logo__icon} aria-hidden="true">⚙️</span>
          <h1 className={styles.logo__text}>智造管家</h1>
          <p className={styles.logo__sub}>SmartFactory Agent</p>
        </div>

        {/* 表单 */}
        <form className={styles.form} onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className={styles.field}>
            <label htmlFor="username" className={styles.label}>账号</label>
            <input
              id="username"
              name="username"
              type="text"
              className={styles.input}
              value={form.username}
              onChange={handleChange}
              placeholder="请输入登录账号"
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="password" className={styles.label}>密码</label>
            <input
              id="password"
              name="password"
              type="password"
              className={styles.input}
              value={form.password}
              onChange={handleChange}
              placeholder="请输入密码"
              autoComplete="current-password"
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="tenantCode" className={styles.label}>工厂编码</label>
            <input
              id="tenantCode"
              name="tenantCode"
              type="text"
              className={styles.input}
              value={form.tenantCode}
              onChange={handleChange}
              placeholder="工厂唯一编码"
              autoComplete="organization"
            />
          </div>

          {error && (
            <div className="alert alert--error" role="alert">
              <span className="alert__icon" aria-hidden="true">❌</span>
              <div className="alert__body">
                <div className="alert__desc">{error}</div>
              </div>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            loading={loading}
          >
            登录
          </Button>
        </form>

        <p className={styles.footer}>智造管家 · 让中小工厂用上 AI</p>
      </div>
    </div>
  );
}
