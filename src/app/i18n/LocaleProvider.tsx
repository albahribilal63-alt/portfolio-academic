import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { additionalMessages } from './messages';

export type Locale = 'ar' | 'fr';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (text: string, values?: Record<string, string>) => string;
}

const messages: Record<Locale, Record<string, string>> = {
  ar: {
    'Dashboard': 'لوحة التحكم',
    'Academic Profile': 'الملف الأكاديمي',
    'Academic Years': 'السنوات الجامعية',
    'Modules': 'الوحدات',
    'Activities': 'الأنشطة',
    'Files & Assets': 'الملفات والموارد',
    'Isolated Links': 'الروابط المعزولة',
    'Admin Portal': 'بوابة الإدارة',
    'Academic Portfolio': 'المحفظة الأكاديمية',
    'Admin Portal navigation': 'التنقل في بوابة الإدارة',
    'Admin sections': 'أقسام الإدارة',
    'Close navigation': 'إغلاق التنقل',
    'Open navigation': 'فتح التنقل',
    'Academic Portfolio & Isolated Assessment Hub': 'المحفظة الأكاديمية ومنصة التقييم المعزولة',
    'Local Development': 'بيئة تطوير محلية',
    'GitHub Connected': 'GitHub متصل',
    'Checking GitHub…': 'جارٍ التحقق من GitHub…',
    'GitHub Unavailable': 'GitHub غير متاح',
    'Sign out': 'تسجيل الخروج',
    'Switch to light theme': 'التبديل إلى الوضع الفاتح',
    'Switch to dark theme': 'التبديل إلى الوضع الداكن',
    'Language': 'اللغة',
    'Manage your academic portfolio structure and content.': 'أدر بنية محفظتك الأكاديمية ومحتواها.',
    "Manage the student's academic identity and institutional information.": 'إدارة الهوية الأكاديمية للطالب ومعلوماته المؤسسية.',
    'Organize the academic years that contain the portfolio modules.': 'تنظيم السنوات الجامعية التي تضم وحدات المحفظة.',
    'Manage academic modules and their descriptions.': 'إدارة الوحدات الأكاديمية وأوصافها.',
    'Organize documents, code, and academic attachments.': 'تنظيم المستندات والملفات البرمجية والمرفقات الأكاديمية.',
    'GitHub connection': 'اتصال GitHub',
    'Repository': 'المستودع',
    'Branch': 'الفرع',
    'Data file': 'ملف البيانات',
    'Current SHA': 'معرّف SHA الحالي',
    'Reading data file…': 'جارٍ قراءة ملف البيانات…',
    'Read data.json': 'قراءة data.json',
    'Administration workspace': 'مساحة الإدارة',
    'The administration modules will be activated progressively as the portfolio management system is implemented.': 'ستُفعّل وحدات الإدارة تدريجياً مع استكمال نظام إدارة المحفظة.',
    'Unsaved changes': 'تغييرات غير محفوظة',
    'You have unsaved changes.': 'لديك تغييرات غير محفوظة.',
    'Stay': 'البقاء',
    'Discard Changes': 'تجاهل التغييرات',
  },
  fr: {
    'Dashboard': 'Tableau de bord',
    'Academic Profile': 'Profil académique',
    'Academic Years': 'Années universitaires',
    'Modules': 'Modules',
    'Activities': 'Activités',
    'Files & Assets': 'Fichiers et ressources',
    'Isolated Links': 'Liens isolés',
    'Admin Portal': 'Portail d’administration',
    'Academic Portfolio': 'Portfolio académique',
    'Admin Portal navigation': 'Navigation du portail d’administration',
    'Admin sections': 'Sections d’administration',
    'Close navigation': 'Fermer la navigation',
    'Open navigation': 'Ouvrir la navigation',
    'Academic Portfolio & Isolated Assessment Hub': 'Portfolio académique et espace d’évaluation isolé',
    'Local Development': 'Développement local',
    'GitHub Connected': 'GitHub connecté',
    'Checking GitHub…': 'Vérification de GitHub…',
    'GitHub Unavailable': 'GitHub indisponible',
    'Sign out': 'Se déconnecter',
    'Switch to light theme': 'Passer au thème clair',
    'Switch to dark theme': 'Passer au thème sombre',
    'Language': 'Langue',
    'Manage your academic portfolio structure and content.': 'Gérez la structure et le contenu de votre portfolio académique.',
    "Manage the student's academic identity and institutional information.": 'Gérez l’identité académique et les informations institutionnelles de l’étudiant.',
    'Organize the academic years that contain the portfolio modules.': 'Organisez les années universitaires qui regroupent les modules du portfolio.',
    'Manage academic modules and their descriptions.': 'Gérez les modules académiques et leurs descriptions.',
    'Organize documents, code, and academic attachments.': 'Organisez les documents, le code et les pièces jointes académiques.',
    'GitHub connection': 'Connexion GitHub',
    'Repository': 'Dépôt',
    'Branch': 'Branche',
    'Data file': 'Fichier de données',
    'Current SHA': 'SHA actuel',
    'Reading data file…': 'Lecture du fichier de données…',
    'Read data.json': 'Lire data.json',
    'Administration workspace': 'Espace d’administration',
    'The administration modules will be activated progressively as the portfolio management system is implemented.': 'Les modules d’administration seront activés progressivement au fur et à mesure de la mise en place du système de gestion du portfolio.',
    'Unsaved changes': 'Modifications non enregistrées',
    'You have unsaved changes.': 'Des modifications ne sont pas enregistrées.',
    'Stay': 'Rester',
    'Discard Changes': 'Ignorer les modifications',
  },
};

const LocaleContext = createContext<LocaleContextValue | null>(null);
const STORAGE_KEY = 'academic-portfolio-locale';

function getInitialLocale(): Locale {
  try {
    const storedLocale = localStorage.getItem(STORAGE_KEY);
    if (storedLocale === 'ar' || storedLocale === 'fr') return storedLocale;
  } catch {
    // Keep the default locale when storage is unavailable.
  }
  return 'ar';
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(getInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // The current page locale still works when persistence is unavailable.
    }
  }, [locale]);

  const t = (text: string, values?: Record<string, string>) => {
    const translated = messages[locale][text] ?? additionalMessages[locale][text] ?? text;
    return Object.entries(values ?? {}).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, value), translated);
  };

  return <LocaleContext.Provider value={{ locale, setLocale, t }}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used within LocaleProvider.');
  return context;
}