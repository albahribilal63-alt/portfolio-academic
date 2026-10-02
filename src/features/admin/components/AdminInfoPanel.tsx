import { Card } from '../../../components/ui/Card';
import { useLocale } from '../../../app/i18n/LocaleProvider';

export function AdminInfoPanel() {
  const { t } = useLocale();
  return (
    <Card className="admin-info-panel">
      <h2>{t('Administration workspace')}</h2>
      <p>{t('The administration modules will be activated progressively as the portfolio management system is implemented.')}</p>
    </Card>
  );
}