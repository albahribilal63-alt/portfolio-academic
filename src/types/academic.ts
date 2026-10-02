export type Visibility = 'public' | 'private' | 'unlisted';
export const MAX_PROFILE_PHOTO_BYTES = 700_000;

export type AssetKind = 'document' | 'code' | 'image' | 'link' | 'other';
export type AcademicFileType = 'PDF' | 'DOCX' | 'XLSX' | 'ZIP' | 'CODE';

export interface SiteInformation {
  title?: string;
  description?: string;
}

export type ProfilePhotoType = 'JPEG' | 'PNG' | 'WEBP';

export interface ProfilePhoto {
  id: string;
  path: string;
  type: ProfilePhotoType;
}

export interface Profile {
  lastName?: string;
  firstName?: string;
  filiere?: string;
  section?: string;
  tdGroup?: string;
  name?: string;
  title?: string;
  institution?: string;
  biography?: string;
  cne?: string;
  apogee?: string;
  program?: string;
  branch?: string;
  semester?: string;
  photo?: ProfilePhoto;
}

export interface LegacyAsset {
  id: string;
  name: string;
  kind: AssetKind;
  url: string;
  mimeType?: string;
  sizeBytes?: number;
  order?: number;
  visibility?: Visibility;
}

export interface Asset {
  id: string;
  activityId: string;
  name: string;
  type: AcademicFileType;
  path: string;
  order: number;
  visibility: Visibility;
}

export type ActivityType = 'lesson' | 'exercise' | 'project' | 'quiz' | 'lab' | 'workshop' | 'reading' | 'other';

export interface Activity {
  id: string;
  moduleId: string;
  title: string;
  description?: string;
  type: ActivityType;
  order: number;
  visibility: Visibility;
}

export interface LegacyActivity {
  id: string;
  title: string;
  description?: string;
  order?: number;
  visibility?: Visibility;
  assets: LegacyAsset[];
}

export interface IsolatedLinkMetadata {
  enabled?: boolean;
  scope?: string;
}

export type IsolatedScopeType = 'module' | 'activity';
export type IsolatedLinkStatus = 'active' | 'revoked';

export interface IsolatedLink {
  id: string;
  tokenHash: string;
  tokenCiphertext: string;
  scopeType: IsolatedScopeType;
  scopeId: string;
  purpose?: 'primary-professor';
  status: IsolatedLinkStatus;
  expiresAt: string | null;
}

export interface ProfessorFeedback {
  isolatedLinkId: string;
  activityId: string;
  professorName: string;
  score: number;
  comments: string;
  observations: string;
  submittedAt: string;
}

export interface YearModule {
  id: string;
  title: string;
  code?: string;
  description?: string;
  order?: number;
  visibility?: Visibility;
  isolatedLink?: IsolatedLinkMetadata;
  activities: LegacyActivity[];
}

export interface Module {
  id: string;
  yearId: string;
  code: string;
  name: string;
  description?: string;
  order: number;
  visibility: Visibility;
}

export interface AcademicYear {
  id: string;
  name: string;
  status: AcademicYearStatus;
  order: number;
  modules?: YearModule[];
}
export type AcademicYearStatus = 'previous' | 'current' | 'upcoming';

export interface AcademicArchive {
  site: SiteInformation;
  profile?: Profile;
  years: AcademicYear[];
  modules?: Module[];
  activities?: Activity[];
  assets?: Asset[];
  isolatedLinks?: IsolatedLink[];
  professorFeedback?: ProfessorFeedback[];
}