export function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .trim();
}

export function fuzzyIncludes(source, query) {
  const normalizedSource = normalizeSearchText(source);
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  return normalizedSource.includes(normalizedQuery);
}

export function filterByFuzzyQuery(items, query, pickText) {
  if (!query) return items;
  return items.filter((item) => fuzzyIncludes(pickText(item), query));
}
