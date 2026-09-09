export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .trim();
}

export function matchesPlayerName(name: string, query: string): boolean {
  const normalizedQuery = normalizeSearchText(query);
  return (
    normalizedQuery.length > 0 &&
    normalizeSearchText(name).includes(normalizedQuery)
  );
}
