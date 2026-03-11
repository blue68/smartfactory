/**
 * [artifact:前端代码] — 404 页面
 */

import { useNavigate } from 'react-router-dom';
import Button from '@/components/common/Button';
import styles from './NotFoundPage.module.css';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <span className={styles.code} aria-hidden="true">404</span>
        <h1 className={styles.title}>页面不存在</h1>
        <p className={styles.desc}>您访问的页面已移动或不存在，请返回首页。</p>
        <div className={styles.actions}>
          <Button variant="primary" onClick={() => navigate('/')}>返回首页</Button>
          <Button variant="ghost" onClick={() => navigate(-1)}>返回上一页</Button>
        </div>
      </div>
    </div>
  );
}
