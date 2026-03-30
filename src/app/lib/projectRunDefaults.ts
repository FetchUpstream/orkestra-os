import type { RunModelOption, RunSelectionOption } from "./runs";

export type PersistedProjectRunDefaults = {
  providerId?: string | null;
  modelId?: string | null;
};

export type ResolveProjectRunDefaultsInput = {
  persisted: PersistedProjectRunDefaults;
  providers: RunSelectionOption[];
  models: RunModelOption[];
};

export type ProjectRunDefaultsResolution = {
  providerId: string;
  modelId: string;
  validAsIs: boolean;
  repaired: boolean;
  requiresUserAction: boolean;
  reason:
    | "valid"
    | "no_providers"
    | "provider_missing"
    | "provider_invalid"
    | "model_missing"
    | "model_invalid"
    | "model_provider_mismatch"
    | "no_models_for_provider";
};

const normalize = (value: string | null | undefined): string =>
  value?.trim() || "";

export const filterModelsForProvider = (
  models: RunModelOption[],
  providerId: string,
): RunModelOption[] => {
  const normalizedProviderId = normalize(providerId);
  if (!normalizedProviderId) {
    return models;
  }
  return models.filter(
    (option) =>
      !option.providerId || option.providerId === normalizedProviderId,
  );
};

export const resolveProjectRunDefaults = (
  input: ResolveProjectRunDefaultsInput,
): ProjectRunDefaultsResolution => {
  const requestedProviderId = normalize(input.persisted.providerId);
  const requestedModelId = normalize(input.persisted.modelId);

  const providers = input.providers.filter(
    (option) => normalize(option.id).length > 0,
  );
  const models = input.models.filter(
    (option) => normalize(option.id).length > 0,
  );

  if (providers.length === 0) {
    return {
      providerId: "",
      modelId: "",
      validAsIs:
        requestedProviderId.length === 0 && requestedModelId.length === 0,
      repaired: requestedProviderId.length > 0 || requestedModelId.length > 0,
      requiresUserAction: true,
      reason: "no_providers",
    };
  }

  const providerExists = providers.some(
    (option) => option.id === requestedProviderId,
  );
  const model = models.find((option) => option.id === requestedModelId);

  let providerId = "";
  let reason: ProjectRunDefaultsResolution["reason"] = "valid";

  if (providerExists) {
    providerId = requestedProviderId;
  } else if (requestedModelId && model?.providerId) {
    const inferredProviderId = normalize(model.providerId);
    const inferredProviderExists = providers.some(
      (option) => option.id === inferredProviderId,
    );
    if (inferredProviderExists) {
      providerId = inferredProviderId;
      reason = requestedProviderId ? "provider_invalid" : "provider_missing";
    }
  }

  if (!providerId) {
    providerId = providers[0]?.id || "";
    reason = requestedProviderId ? "provider_invalid" : "provider_missing";
  }

  const modelsForProvider = filterModelsForProvider(models, providerId);
  if (modelsForProvider.length === 0) {
    return {
      providerId,
      modelId: "",
      validAsIs: false,
      repaired: true,
      requiresUserAction: true,
      reason: "no_models_for_provider",
    };
  }

  const modelBelongsToProvider =
    !!model &&
    (!model.providerId || normalize(model.providerId) === providerId);

  let modelId = "";
  if (requestedModelId && modelBelongsToProvider) {
    modelId = requestedModelId;
  } else {
    modelId = modelsForProvider[0]?.id || "";
    if (!requestedModelId) {
      reason = reason === "valid" ? "model_missing" : reason;
    } else if (!model) {
      reason = "model_invalid";
    } else {
      reason = "model_provider_mismatch";
    }
  }

  const validAsIs =
    !!requestedProviderId &&
    !!requestedModelId &&
    providerExists &&
    modelBelongsToProvider;

  return {
    providerId,
    modelId,
    validAsIs,
    repaired: !validAsIs,
    requiresUserAction: !providerId || !modelId,
    reason: validAsIs ? "valid" : reason,
  };
};
