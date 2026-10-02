import { Card } from '../../../components/ui/Card';
import type { GithubConnectionState } from '../types/state';
import { useLocale } from '../../../app/i18n/LocaleProvider';

interface AdminConnectionPanelProps {
  connection: GithubConnectionState;
  sha: string;
}

export function AdminConnectionPanel({ connection, sha }: AdminConnectionPanelProps) {
  const { t } = useLocale();
  return (
    <Card className="admin-connection-panel">
      <div className="admin-connection-heading">
        <h2>{t('GitHub connection')}</h2>
        <span className={`admin-connection-state is-${connection.status}`} role="status">
          {connection.status === 'connected' ? t('GitHub Connected') : connection.status === 'loading' ? t('Checking GitHub…') : t('GitHub Unavailable')}
        </span>
      </div>

      {connection.status === 'connected' && (
        <dl className="admin-connection-details">
          <div><dt>{t('Repository')}</dt><dd>{connection.details.repository}</dd></div>
          <div><dt>{t('Branch')}</dt><dd>{connection.details.branch}</dd></div>
          <div><dt>{t('Data file')}</dt><dd>{connection.details.dataPath}</dd></div>
        </dl>
      )}

      {connection.status === 'error' && <p className="admin-connection-error" role="alert">{t(connection.message)}</p>}

      {connection.status === 'connected' && (
        <dl className="admin-connection-details admin-data-result">
          <div><dt>{t('Data file')}</dt><dd>{connection.details.dataPath}</dd></div>
          <div><dt>{t('Branch')}</dt><dd>{connection.details.branch}</dd></div>
          <div><dt>{t('Current SHA')}</dt><dd className="admin-data-sha">{sha}</dd></div>
        </dl>
      )}
    </Card>
  );
}