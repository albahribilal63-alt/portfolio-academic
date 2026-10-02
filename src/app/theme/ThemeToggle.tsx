import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { IconButton } from '../../components/ui/IconButton';
import { useLocale } from '../i18n/LocaleProvider';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useLocale();
  const nextTheme = theme === 'light' ? 'dark' : 'light';

  return (
    <IconButton
      className="theme-toggle"
      label={t(`Switch to ${nextTheme} theme`)}
      onClick={toggleTheme}
    >
      {theme === 'light' ? <Moon aria-hidden="true" size={18} /> : <Sun aria-hidden="true" size={18} />}
    </IconButton>
  );
}