import { getRunSelectionOptions, type RunSelectionOptions } from "./runs";

let cachedRunSelectionOptions: RunSelectionOptions | null = null;
let inflightRunSelectionOptions: Promise<RunSelectionOptions> | null = null;

const cloneSelectionOptions = (
  options: RunSelectionOptions,
): RunSelectionOptions => ({
  agents: [...options.agents],
  providers: [...options.providers],
  models: [...options.models],
});

const loadRunSelectionOptions = async (): Promise<RunSelectionOptions> => {
  const next = await getRunSelectionOptions();
  cachedRunSelectionOptions = cloneSelectionOptions(next);
  return cloneSelectionOptions(next);
};

export const readRunSelectionOptionsCache = (): RunSelectionOptions | null => {
  if (!cachedRunSelectionOptions) {
    return null;
  }
  return cloneSelectionOptions(cachedRunSelectionOptions);
};

export const getRunSelectionOptionsWithCache =
  async (): Promise<RunSelectionOptions> => {
    if (cachedRunSelectionOptions) {
      return cloneSelectionOptions(cachedRunSelectionOptions);
    }

    if (!inflightRunSelectionOptions) {
      inflightRunSelectionOptions = loadRunSelectionOptions().finally(() => {
        inflightRunSelectionOptions = null;
      });
    }

    return inflightRunSelectionOptions;
  };

export const primeRunSelectionOptionsCache = (): void => {
  void getRunSelectionOptionsWithCache().catch(() => {
    // Startup cache warmup failures are handled by local feature fallbacks.
  });
};

export const resetRunSelectionOptionsCacheForTests = (): void => {
  cachedRunSelectionOptions = null;
  inflightRunSelectionOptions = null;
};
