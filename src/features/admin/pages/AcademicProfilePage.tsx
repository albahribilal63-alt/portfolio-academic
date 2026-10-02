import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Trash2, UserRound } from 'lucide-react';
import { AdminApiRequestError, adminApi } from '../services/adminApi';
import { MAX_PROFILE_PHOTO_BYTES, type AcademicArchive } from '../../../types/academic';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { LoadingState } from '../../../components/ui/LoadingState';
import { AdminPageContainer } from '../components/AdminPageContainer';
import { useLocale } from '../../../app/i18n/LocaleProvider';
import { useAdminData } from '../data/AdminDataProvider';
import {
  createProfileUpdate,
  hasProfileFormChanged,
  profileToForm,
  validateProfileForm,
  type ProfileFormErrors,
  type ProfileFormField,
  type ProfileFormValues,
} from '../profile/profileForm';

interface AcademicProfilePageProps {
  onRequireLogin: () => void;
  onUnsavedChanges: (hasChanges: boolean) => void;
}

interface ProfileFieldProps {
  id: ProfileFormField;
  label: string;
  placeholder: string;
  autoComplete: string;
  value: string;
  error?: string;
  onChange: (field: ProfileFormField, value: string) => void;
}

type ProfileSaveStatus =
  | { kind: 'validation' | 'error' | 'conflict' | 'success'; message: string }
  | null;

function ProfileField({ id, label, placeholder, autoComplete, value, error, onChange }: ProfileFieldProps) {
  const { t } = useLocale();
  const errorId = `${id}-error`;
  return (
    <div className="profile-field">
      <label htmlFor={`profile-${id}`}>{t(label)}</label>
      <input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? 'true' : undefined}
          autoComplete={autoComplete}
          id={`profile-${id}`}
          name={id}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(id, event.target.value)}
          placeholder={t(placeholder)}
          required
          type="text"
          value={value}
        />
      {error && <p className="profile-field-error" id={errorId}>{t(error)}</p>}
    </div>
  );
}

export function AcademicProfilePage({ onRequireLogin, onUnsavedChanges }: AcademicProfilePageProps) {
  const { t } = useLocale();
  const { data: initialData, sha: initialSha, refresh, replaceArchive } = useAdminData();
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('ready');
  const [remoteData, setRemoteData] = useState<AcademicArchive>(initialData);
  const [sha, setSha] = useState(initialSha);
  const [formData, setFormData] = useState<ProfileFormValues>(() => profileToForm(initialData.profile));
  const [originalProfile, setOriginalProfile] = useState<ProfileFormValues>(() => profileToForm(initialData.profile));
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [saveStatus, setSaveStatus] = useState<ProfileSaveStatus>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);
  const hasUnsavedChanges = remoteData !== null && hasProfileFormChanged(formData, originalProfile);
  const isBusy = isReloading || isSaving || isSavingPhoto;

  function applyRemoteData(data: AcademicArchive, currentSha: string) {
    const profile = profileToForm(data.profile);
    replaceArchive(data, currentSha);
    setRemoteData(data);
    setSha(currentSha);
    setFormData(profile);
    setOriginalProfile(profile);
    setErrors({});
    setSaveStatus(null);
  }

  useEffect(() => () => onUnsavedChanges(false), [onUnsavedChanges]);

  useEffect(() => {
    onUnsavedChanges(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChanges]);

  useEffect(() => {
    if (saveStatus?.kind !== 'success') return undefined;
    const timer = window.setTimeout(() => setSaveStatus(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  function handleFieldChange(field: ProfileFormField, value: string) {
    setFormData((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (saveStatus?.kind === 'validation') setSaveStatus(null);
  }

  function discardChanges() {
    setFormData(originalProfile);
    setErrors({});
    setSaveStatus(null);
  }

  async function reloadCurrentData() {
    if (hasUnsavedChanges && !window.confirm(t('Reloading will discard your unsaved changes.'))) return;
    setIsReloading(true);
    setSaveStatus(null);
    try {
      const result = await refresh();
      applyRemoteData(result.data, result.sha);
      setLoadState('ready');
    } catch (error) {
      if (error instanceof AdminApiRequestError && error.status === 401) {
        onRequireLogin();
        return;
      }
      setSaveStatus({ kind: 'error', message: 'GitHub access is currently unavailable.' });
    } finally {
      setIsReloading(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!remoteData || !sha || isBusy) return;

    const validation = validateProfileForm(formData);
    setErrors(validation.errors);
    if (!validation.valid) {
      setSaveStatus({ kind: 'validation', message: 'Please correct the highlighted fields.' });
      return;
    }

    const updatedData = createProfileUpdate(remoteData, validation.values);
    setIsSaving(true);
    setSaveStatus(null);
    try {
      const result = await adminApi.updateData(updatedData, sha, 'Update academic profile');
      applyRemoteData(result.data, result.contentSha);
      setSaveStatus({ kind: 'success', message: 'Academic profile saved successfully.' });
    } catch (error) {
      if (error instanceof AdminApiRequestError && error.status === 401) {
        onRequireLogin();
        return;
      }
      if (error instanceof AdminApiRequestError && error.status === 409) {
        setSaveStatus({
          kind: 'conflict',
          message: 'Academic data changed on GitHub. Reload the current version before saving.',
        });
      } else if (error instanceof AdminApiRequestError && error.code.startsWith('GITHUB_')) {
        setSaveStatus({ kind: 'error', message: 'GitHub access is currently unavailable.' });
      } else {
        setSaveStatus({ kind: 'error', message: 'Unable to save the academic profile.' });
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function saveProfilePhoto(event: ChangeEvent<HTMLInputElement>) {
    const photo = event.target.files?.[0];
    event.target.value = '';
    if (!photo) return;
    if (hasUnsavedChanges) {
      setPhotoError('Save or discard academic profile changes before changing the photo.');
      return;
    }
    if (photo.size > MAX_PROFILE_PHOTO_BYTES) {
      setPhotoError('Choose an image smaller than 700 KB.');
      return;
    }
    setPhotoError('');
    setIsSavingPhoto(true);
    try {
      const upload = await adminApi.uploadProfilePhoto(photo);
      const updatedData: AcademicArchive = {
        ...remoteData!,
        profile: { ...remoteData!.profile, photo: upload.photo ?? undefined },
      };
      applyRemoteData(updatedData, upload.contentSha ?? sha);
      setSaveStatus({ kind: 'success', message: upload.cleanupPending ? 'Photo updated; the previous repository image still needs cleanup.' : 'Profile photo saved to GitHub.' });
    } catch (error) {
      if (error instanceof AdminApiRequestError && error.status === 401) onRequireLogin();
      else setPhotoError(error instanceof Error ? error.message : 'Unable to save the profile photo.');
    } finally {
      setIsSavingPhoto(false);
    }
  }

  async function removeProfilePhoto() {
    if (hasUnsavedChanges) {
      setPhotoError('Save or discard academic profile changes before removing the photo.');
      return;
    }
    setPhotoError('');
    setIsSavingPhoto(true);
    try {
      const result = await adminApi.deleteProfilePhoto();
      const updatedProfile = { ...remoteData!.profile };
      delete updatedProfile.photo;
      applyRemoteData({ ...remoteData!, profile: updatedProfile }, result.contentSha ?? sha);
      setSaveStatus({ kind: 'success', message: result.cleanupPending ? 'Photo removed from the profile; the old image still needs cleanup.' : 'Profile photo removed.' });
    } catch (error) {
      if (error instanceof AdminApiRequestError && error.status === 401) onRequireLogin();
      else setPhotoError(error instanceof Error ? error.message : 'Unable to remove the profile photo.');
    } finally {
      setIsSavingPhoto(false);
    }
  }

  const profileMissing = remoteData !== null && remoteData.profile === undefined;

  return (
    <AdminPageContainer>
      <div className="profile-page-content">
        <header className="profile-page-heading">
          <h2>{t('Academic Profile')}</h2>
          <p>{t("Manage the student's academic identity and institutional information.")}</p>
        </header>

        {loadState === 'loading' && <LoadingState label={t('Loading academic profile...')} />}

        {loadState === 'error' && (
          <div className="profile-load-error">
            <p role="alert">{t('GitHub access is currently unavailable.')}</p>
            <Button disabled={isReloading} onClick={() => { void reloadCurrentData(); }}>
              {isReloading ? t('Reloading...') : t('Reload Current Data')}
            </Button>
          </div>
        )}

        {loadState === 'ready' && remoteData && (
          <form className="profile-form" noValidate onSubmit={saveProfile}>
            <Card className="profile-card">
              <h3>{t('Informations académiques')}</h3>
              <div className="profile-photo-editor">
                {remoteData.profile?.photo ? (
                  <img alt={t('Academic profile')} src={`/api/admin/profile-photo?v=${encodeURIComponent(remoteData.profile.photo.id)}`} />
                ) : (
                  <span className="profile-photo-placeholder" aria-label={t('No profile photo')}><UserRound aria-hidden="true" size={25} /></span>
                )}
                <div className="profile-photo-actions">
                  <strong>{t('Profile photo')}</strong>
                  <p>{t('JPEG, PNG or WebP · max 700 KB')}</p>
                  <div>
                    <Button disabled={isBusy || hasUnsavedChanges} onClick={() => photoInput.current?.click()} variant="secondary"><Camera aria-hidden="true" size={15} />{isSavingPhoto ? t('Saving photo...') : remoteData.profile?.photo ? t('Change photo') : t('Add photo')}</Button>
                    {remoteData.profile?.photo && <Button aria-label={t('Remove profile photo')} disabled={isBusy || hasUnsavedChanges} onClick={() => { void removeProfilePhoto(); }} variant="quiet"><Trash2 aria-hidden="true" size={16} />{t('Remove')}</Button>}
                  </div>
                  {photoError && <p className="profile-photo-error" role="alert">{t(photoError)}</p>}
                </div>
                <input accept="image/jpeg,image/png,image/webp" aria-label={t('Choose profile photo')} className="profile-photo-input" onChange={(event) => { void saveProfilePhoto(event); }} ref={photoInput} type="file" />
              </div>
              <div className="profile-fields-grid">
                <ProfileField
                  autoComplete="family-name"
                  error={errors.lastName}
                  id="lastName"
                  label="Nom"
                  onChange={handleFieldChange}
                  placeholder="Saisir le nom"
                  value={formData.lastName}
                />
                <ProfileField
                  autoComplete="given-name"
                  error={errors.firstName}
                  id="firstName"
                  label="Prénom"
                  onChange={handleFieldChange}
                  placeholder="Saisir le prénom"
                  value={formData.firstName}
                />
                <ProfileField autoComplete="off" error={errors.filiere} id="filiere" label="Filière" onChange={handleFieldChange} placeholder="Saisir la filière" value={formData.filiere} />
                <ProfileField autoComplete="off" error={errors.section} id="section" label="Section" onChange={handleFieldChange} placeholder="Saisir la section" value={formData.section} />
                <ProfileField autoComplete="off" error={errors.tdGroup} id="tdGroup" label="Groupe TD" onChange={handleFieldChange} placeholder="Saisir le groupe TD" value={formData.tdGroup} />
              </div>
            </Card>

            <div className="profile-action-bar">
              <span className="profile-dirty-state" role="status">
                {hasUnsavedChanges ? t('Unsaved changes') : ''}
              </span>
              <div className="profile-action-buttons">
                <Button disabled={isBusy} onClick={() => { void reloadCurrentData(); }}>
                  {isReloading ? t('Reloading...') : t('Reload Current Data')}
                </Button>
                <Button disabled={!hasUnsavedChanges || isBusy} onClick={discardChanges}>
                  {t('Discard Changes')}
                </Button>
                <Button disabled={!hasUnsavedChanges || isBusy} type="submit" variant="primary">
                  {isSaving ? t('Saving...') : t('Save Changes')}
                </Button>
              </div>
            </div>

            <div aria-live="polite" className={`profile-save-status${saveStatus ? ` is-${saveStatus.kind}` : ''}`}>
              {profileMissing && (
                <div className="profile-not-configured" role="status">
                  <strong>{t('Academic profile is not configured')}</strong>
                  <p>{t("Enter the student's academic information below.")}</p>
                </div>
              )}
              {saveStatus && (
                <p role={saveStatus.kind === 'success' ? 'status' : 'alert'}>{t(saveStatus.message)}</p>
              )}
            </div>
          </form>
        )}
      </div>
    </AdminPageContainer>
  );
}