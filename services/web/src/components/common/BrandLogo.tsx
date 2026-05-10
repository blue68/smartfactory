import styles from './BrandLogo.module.css';

interface BrandLogoProps {
  className?: string;
  showText?: boolean;
  showSub?: boolean;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'inline' | 'stacked';
}

function joinClassNames(...classes: Array<string | false | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export default function BrandLogo({
  className,
  showText = true,
  showSub = true,
  size = 'md',
  variant = 'inline',
}: BrandLogoProps) {
  return (
    <div
      className={joinClassNames(
        styles.logo,
        styles[`logo--${variant}`],
        styles[`logo--${size}`],
        className,
      )}
    >
      <span className={styles.logo__icon} aria-hidden="true">
        <svg viewBox="0 0 64 64" role="img" focusable="false">
          <path
            className={styles.logo__factory}
            d="M14 43V30.5l8.2-5.4v5.4l8.3-5.4v5.4l7.8-5.1V43H14Z"
          />
          <path
            className={styles.logo__roof}
            d="M17 38.5h18.5M18.5 34.5h4.8M27 34.5h4.8"
          />
          <path
            className={styles.logo__flow}
            d="M39.5 19.5h6.7c2.4 0 4.3 1.9 4.3 4.3v4.7M44 39h5.2c2.2 0 4-1.8 4-4v-1.2"
          />
          <circle className={styles.logo__node} cx="38.5" cy="19.5" r="3.7" />
          <circle className={styles.logo__node} cx="50.5" cy="31" r="3.9" />
          <circle className={styles.logo__node} cx="42" cy="39" r="3.5" />
          <path className={styles.logo__spark} d="M31.5 18.5l3.2 3.2 6-7.2" />
        </svg>
      </span>

      {showText && (
        <span className={styles.logo__copy}>
          <span className={styles.logo__text}>智造管家</span>
          {showSub && <span className={styles.logo__sub}>SmartFactory Agent</span>}
        </span>
      )}
    </div>
  );
}
