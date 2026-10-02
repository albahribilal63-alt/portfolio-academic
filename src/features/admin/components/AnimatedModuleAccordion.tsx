import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, BookOpen, Check, ChevronDown, Copy, ExternalLink, FileText, MoreHorizontal, Pencil, ShieldOff, Trash2 } from 'lucide-react';
import type { Activity, IsolatedLink, Module } from '../../../types/academic';
import { useLocale } from '../../../app/i18n/LocaleProvider';

export interface ModuleActivityLink {
  activity: Activity;
  link?: IsolatedLink;
  url?: string;
  pending: boolean;
}

interface AnimatedModuleAccordionProps {
  module: Module;
  yearName: string;
  moduleLink?: IsolatedLink;
  moduleUrl?: string;
  moduleLinkPending: boolean;
  activities: ModuleActivityLink[];
  expanded: boolean;
  menuOpen: boolean;
  disabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggleExpanded: () => void;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onCopyModuleLink: () => void;
  onToggleModuleLink: () => void;
  onCopyActivityLink: (linkId: string) => void;
  onToggleActivityLink: (linkId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function AnimatedModuleAccordion({
  module,
  yearName,
  moduleLink,
  moduleUrl,
  moduleLinkPending,
  activities,
  expanded,
  menuOpen,
  disabled,
  canMoveUp,
  canMoveDown,
  onToggleExpanded,
  onToggleMenu,
  onCloseMenu,
  onCopyModuleLink,
  onToggleModuleLink,
  onCopyActivityLink,
  onToggleActivityLink,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: AnimatedModuleAccordionProps) {
  const { t } = useLocale();
  const menuRef = useRef<HTMLDivElement>(null);
  const exercisesRef = useRef<HTMLDivElement>(null);
  const [expandedHeight, setExpandedHeight] = useState(0);

  useLayoutEffect(() => {
    const content = exercisesRef.current;
    if (!content) return undefined;
    const measure = () => setExpandedHeight(expanded ? content.scrollHeight : 0);
    measure();
    if (!expanded || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [expanded, activities.length]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function dismissOutside(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) onCloseMenu();
    }
    function dismissEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseMenu();
    }
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissEscape);
    };
  }, [menuOpen, onCloseMenu]);

  const moduleLinkActive = moduleLink?.status === 'active';
  const moduleLinkLabel = !moduleLink
    ? 'Link available after save'
    : moduleLinkPending
      ? 'Unsaved change'
      : moduleLinkActive
        ? 'Link active'
        : 'Link disabled';

  return (
    <article className="overflow-visible rounded-xl border border-border bg-surface shadow-sm transition-shadow duration-200 hover:shadow-md">
      <div className="relative flex items-start gap-3 p-4 sm:items-center sm:gap-4 sm:p-5">
        <button
          aria-controls={`module-exercises-${module.id}`}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-start outline-none focus-visible:ring-2 focus-visible:ring-accent sm:gap-4"
          onClick={onToggleExpanded}
          type="button"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-secondary text-accent sm:size-12">
            <BookOpen aria-hidden="true" size={21} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs font-semibold text-accent" dir="ltr">{module.code}</span>
              <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] text-text-muted">{yearName}</span>
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-text-muted">{t(module.visibility === 'public' ? 'Public' : module.visibility === 'private' ? 'Private' : 'Unlisted')}</span>
            </span>
              <span className="mt-1 block break-words text-sm font-semibold text-text-primary sm:text-base" dir="auto">{module.name}</span>
            <span className="mt-1 block text-xs text-text-muted">{activities.length} {t(activities.length === 1 ? 'exercise' : 'exercises')}</span>
            {module.description && <span className="mt-1 hidden max-w-xl truncate text-xs text-text-muted md:block" dir="auto">{module.description}</span>}
          </span>
          <ChevronDown aria-hidden="true" className={`size-5 shrink-0 text-text-muted transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
        </button>

        <div className="relative shrink-0" ref={menuRef}>
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={t('Options for module {module}', { module: module.name })}
            className="grid size-9 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={onToggleMenu}
            type="button"
          >
            <MoreHorizontal aria-hidden="true" size={19} />
          </button>
          {menuOpen && (
            <div className="absolute start-0 top-10 z-30 min-w-52 rounded-xl border border-border bg-surface p-1.5 shadow-xl" role="menu">
              <a
                className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-text-primary transition-colors hover:bg-surface-secondary ${!moduleUrl || !moduleLinkActive || moduleLinkPending ? 'pointer-events-none opacity-45' : ''}`}
                href={moduleUrl}
                onClick={onCloseMenu}
                rel="noreferrer"
                role="menuitem"
                target="_blank"
                tabIndex={!moduleUrl || !moduleLinkActive || moduleLinkPending ? -1 : 0}
              >
                <ExternalLink aria-hidden="true" size={16} />{t('Open public module link')}
              </a>
              <button
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start text-sm text-text-primary transition-colors hover:bg-surface-secondary disabled:opacity-45"
                disabled={!moduleUrl || !moduleLinkActive || moduleLinkPending}
                onClick={() => { onCopyModuleLink(); onCloseMenu(); }}
                role="menuitem"
                type="button"
              >
                <Copy aria-hidden="true" size={16} />{t('Copy module public link')}
              </button>
              <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start text-sm text-text-primary transition-colors hover:bg-surface-secondary" onClick={() => { onEdit(); onCloseMenu(); }} role="menuitem" type="button">
                <Pencil aria-hidden="true" size={16} />{t('Edit module item')}
              </button>
              <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start text-sm text-text-primary transition-colors hover:bg-surface-secondary disabled:opacity-45" disabled={!canMoveUp || disabled} onClick={() => { onMoveUp(); onCloseMenu(); }} role="menuitem" type="button">
                <ArrowUp aria-hidden="true" size={16} />{t('Move module item up')}
              </button>
              <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start text-sm text-text-primary transition-colors hover:bg-surface-secondary disabled:opacity-45" disabled={!canMoveDown || disabled} onClick={() => { onMoveDown(); onCloseMenu(); }} role="menuitem" type="button">
                <ArrowDown aria-hidden="true" size={16} />{t('Move module item down')}
              </button>
              <div className="my-1 border-t border-border" role="separator" />
              <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start text-sm text-danger transition-colors hover:bg-surface-secondary" onClick={() => { onDelete(); onCloseMenu(); }} role="menuitem" type="button">
                <Trash2 aria-hidden="true" size={16} />{t('Delete module item')}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${moduleLinkActive ? 'bg-success' : moduleLink ? 'bg-danger' : 'bg-text-muted'}`} />
          <span className={`text-xs font-medium ${moduleLinkActive ? 'text-success' : 'text-text-muted'}`}>{t(moduleLinkLabel)}</span>
          {module.description && <span className="hidden max-w-md truncate text-xs text-text-muted md:inline">{module.description}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <button className="rounded-lg px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-40" disabled={!moduleUrl || !moduleLinkActive || moduleLinkPending} onClick={onCopyModuleLink} type="button">{t('Copy link')}</button>
          <button aria-label={moduleLinkActive ? t('Disable module link') : t('Enable module link')} className="grid size-8 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-surface-secondary disabled:opacity-40" disabled={!moduleLink || disabled} onClick={onToggleModuleLink} title={moduleLinkActive ? t('Disable module link') : t('Enable module link')} type="button">
            {moduleLinkActive ? <ShieldOff aria-hidden="true" size={15} /> : <Check aria-hidden="true" size={15} />}
          </button>
          <button aria-label={t('Move module up')} className="hidden size-8 place-items-center rounded-lg text-text-muted hover:bg-surface-secondary disabled:opacity-35 sm:grid" disabled={disabled || !canMoveUp} onClick={onMoveUp} title={t('Move Up')} type="button"><ArrowUp aria-hidden="true" size={15} /></button>
          <button aria-label={t('Move module down')} className="hidden size-8 place-items-center rounded-lg text-text-muted hover:bg-surface-secondary disabled:opacity-35 sm:grid" disabled={disabled || !canMoveDown} onClick={onMoveDown} title={t('Move Down')} type="button"><ArrowDown aria-hidden="true" size={15} /></button>
        </div>
      </div>

      <div
        aria-hidden={!expanded}
        className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out motion-reduce:transition-none ${expanded ? 'opacity-100' : 'opacity-0'}`}
        id={`module-exercises-${module.id}`}
        style={{ maxHeight: expanded ? `${expandedHeight}px` : '0px' }}
      >
        <div className="border-t border-border bg-surface-secondary p-3 sm:p-4" ref={exercisesRef}>
          {activities.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-text-muted">{t('No exercises in this module yet.')}</p>
          ) : (
            <ul className="grid gap-2.5">
              {activities.map(({ activity, link, url, pending }, index) => {
                const linkIsActive = link?.status === 'active';
                return (
                  <li className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm transition-colors hover:border-accent sm:flex-row sm:items-center sm:justify-between sm:p-3.5" key={activity.id}>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-secondary text-text-secondary">
                        <FileText aria-hidden="true" size={17} />
                      </span>
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-semibold text-text-primary" dir="auto"><span className="me-1.5 text-xs text-text-muted" dir="ltr">{String(index + 1).padStart(2, '0')}</span>{activity.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                          <span>{t(activity.type.charAt(0).toUpperCase() + activity.type.slice(1))}</span>
                          <span aria-hidden="true">·</span>
                          <span className={linkIsActive ? 'text-success' : 'text-text-muted'}>{t(pending ? 'Unsaved change' : linkIsActive ? 'Activity link active' : link ? 'Link disabled' : 'Link available after save')}</span>
                        </span>
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
                      {url && linkIsActive && !pending ? (
                        <>
                          <a className="inline-flex items-center gap-1.5 rounded-lg bg-accent-strong px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90" href={url} rel="noreferrer" tabIndex={expanded ? 0 : -1} target="_blank"><ExternalLink aria-hidden="true" size={14} />{t('Open activity')}</a>
                          <button aria-label={t('Copy activity link for {activity}', { activity: activity.title })} className="grid size-9 place-items-center rounded-lg border border-border text-text-secondary transition-colors hover:bg-surface-secondary" onClick={() => link && onCopyActivityLink(link.id)} tabIndex={expanded ? 0 : -1} title={t('Copy link')} type="button"><Copy aria-hidden="true" size={15} /></button>
                        </>
                      ) : (
                        <button aria-label={linkIsActive ? t('Revoke activity link') : t('Activate activity link')} className="grid size-9 place-items-center rounded-lg border border-border text-text-secondary transition-colors hover:bg-surface-secondary disabled:opacity-40" disabled={!link || disabled} onClick={() => link && onToggleActivityLink(link.id)} tabIndex={expanded ? 0 : -1} title={linkIsActive ? t('Revoke activity link') : t('Activate activity link')} type="button">
                          {linkIsActive ? <ShieldOff aria-hidden="true" size={15} /> : <Check aria-hidden="true" size={15} />}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}

interface AnimatedDisclosureProps {
  id: string;
  title: string;
  metadata?: string;
  count: number;
  countLabel: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function AnimatedDisclosure({
  id,
  title,
  metadata,
  count,
  countLabel,
  expanded,
  onToggle,
  children,
  icon,
  actions,
}: AnimatedDisclosureProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(0);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;
    content.toggleAttribute('inert', !expanded);
    const measure = () => setContentHeight(expanded ? content.scrollHeight : 0);
    measure();
    if (!expanded || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [expanded, children]);

  return (
    <article className="overflow-visible rounded-xl border border-border bg-surface shadow-sm transition-shadow duration-200 hover:shadow-md" dir="rtl" lang="ar">
      <div className="flex items-start gap-3 p-4 sm:items-center sm:gap-4 sm:p-5">
        <button aria-controls={id} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-right outline-none focus-visible:ring-2 focus-visible:ring-accent sm:gap-4" onClick={onToggle} type="button">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-secondary text-accent sm:size-12">{icon ?? <BookOpen aria-hidden="true" size={21} />}</span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm font-semibold text-text-primary sm:text-base" dir="auto">{title}</span>
            {metadata && <span className="mt-1 block break-words text-xs text-text-muted" dir="auto">{metadata}</span>}
            <span className="mt-1 block text-xs text-text-muted">{count} {countLabel}</span>
          </span>
          <ChevronDown aria-hidden="true" className={`size-5 shrink-0 text-text-muted transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div aria-hidden={!expanded} className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-in-out motion-reduce:transition-none ${expanded ? 'opacity-100' : 'opacity-0'}`} id={id} style={{ maxHeight: expanded ? `${contentHeight}px` : '0px' }}>
        <div className="border-t border-border bg-surface-secondary p-3 sm:p-4" ref={contentRef}>{children}</div>
      </div>
    </article>
  );
}