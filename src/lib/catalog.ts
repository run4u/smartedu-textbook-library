import type { TextbookResource } from '../data/fixtures';

export type CatalogFilters = { stage: string; subject: string; grade: string; volume: string; edition: string };
export const filterFields = ['stage', 'subject', 'grade', 'volume', 'edition'] as const;
export type FilterField = typeof filterFields[number];

export function filterResources(catalog: TextbookResource[], filters: CatalogFilters, query: string): TextbookResource[] {
  return catalog.filter((resource) => {
    if (filterFields.some((field) => filters[field] && resource[field] !== filters[field])) return false;
    const haystack = [resource.title, resource.stage, resource.subject, resource.grade, resource.volume, resource.edition, resource.resourceYear].join(' ');
    return query.trim().split(/\s+/).filter(Boolean).every((term) => haystack.toLowerCase().includes(term.toLowerCase()));
  });
}

export function computeFilterOptions(catalog: TextbookResource[], filters: CatalogFilters): Record<FilterField, string[]> {
  return Object.fromEntries(filterFields.map((field) => [field, [...new Set(catalog.filter((resource) => filterFields.every((other) => other === field || !filters[other] || resource[other] === filters[other])).map((resource) => resource[field]).filter(Boolean))].sort()])) as Record<FilterField, string[]>;
}

export function groupResources(resources: TextbookResource[]): [string, TextbookResource[]][] {
  const map = new Map<string, TextbookResource[]>();
  resources.forEach((resource) => {
    const key = [resource.stage, resource.subject, resource.grade, resource.volume, resource.edition].join('|');
    map.set(key, [...(map.get(key) ?? []), resource]);
  });
  return [...map.entries()];
}

export function getSelectableResources(resources: TextbookResource[], skipDownloaded: boolean): TextbookResource[] {
  return skipDownloaded ? resources.filter((resource) => resource.localState !== 'downloaded') : resources;
}

export function toggleAllSelection(current: Set<string>, selectable: TextbookResource[], allSelected: boolean): Set<string> {
  const next = new Set(current);
  if (allSelected) selectable.forEach((resource) => next.delete(resource.contentId));
  else selectable.forEach((resource) => next.add(resource.contentId));
  return next;
}

export function toggleSkipDownloaded(current: Set<string>, catalog: TextbookResource[], matching: TextbookResource[], enabled: boolean, preserveSelectAll: boolean): Set<string> {
  const next = new Set(current);
  if (enabled) catalog.filter((resource) => resource.localState === 'downloaded').forEach((resource) => next.delete(resource.contentId));
  else if (preserveSelectAll) matching.forEach((resource) => next.add(resource.contentId));
  return next;
}
