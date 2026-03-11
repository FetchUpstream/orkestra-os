const KEY_MIN_LENGTH = 2;
const KEY_MAX_LENGTH = 4;

export const normalizeProjectKey = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const recommendProjectKey = (name: string) => {
  const cleaned = normalizeProjectKey(name);
  if (!cleaned) return "PRJ";
  return cleaned.slice(0, 3);
};

export const isValidProjectKey = (value: string) => {
  const normalized = normalizeProjectKey(value);
  return normalized.length >= KEY_MIN_LENGTH && normalized.length <= KEY_MAX_LENGTH;
};
