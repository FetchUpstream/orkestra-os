// Copyright 2026 Louis Scheepers
//
// This file is dual-licensed under:
//
// 1. The MIT License (MIT)
//    See: https://opensource.org/licenses/MIT
//
// 2. The Apache License, Version 2.0
//    See: https://www.apache.org/licenses/LICENSE-2.0
//
// SPDX-License-Identifier: MIT OR Apache-2.0

import type { RunModelOption, RunSelectionOption } from "./runs";

export type PersistedProjectRunDefaults = {
  agentId?: string | null;
  providerId?: string | null;
  modelId?: string | null;
};

export type ResolveProjectRunDefaultsInput = {
  persisted: PersistedProjectRunDefaults;
  agents?: RunSelectionOption[];
  providers: RunSelectionOption[];
  models: RunModelOption[];
};

export type ProjectRunDefaultsResolution = {
  agentId: string;
  providerId: string;
  modelId: string;
  validAsIs: boolean;
  repaired: boolean;
  requiresUserAction: boolean;
  reason:
    | "valid"
    | "agent_invalid"
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
  const requestedAgentId = normalize(input.persisted.agentId);
  const requestedProviderId = normalize(input.persisted.providerId);
  const requestedModelId = normalize(input.persisted.modelId);
  const agents = (input.agents ?? []).filter(
    (option) => normalize(option.id).length > 0,
  );

  const providers = input.providers.filter(
    (option) => normalize(option.id).length > 0,
  );
  const models = input.models.filter(
    (option) => normalize(option.id).length > 0,
  );

  if (providers.length === 0) {
    const hasValidatedAgents = agents.length > 0;
    const agentExists = agents.some((option) => option.id === requestedAgentId);
    const resolvedAgentId =
      !hasValidatedAgents || !requestedAgentId || agentExists
        ? requestedAgentId
        : "";
    const agentValidAsIs =
      !requestedAgentId ||
      !hasValidatedAgents ||
      requestedAgentId === resolvedAgentId;

    return {
      agentId: resolvedAgentId,
      providerId: "",
      modelId: "",
      validAsIs:
        requestedProviderId.length === 0 &&
        requestedModelId.length === 0 &&
        agentValidAsIs,
      repaired:
        requestedProviderId.length > 0 ||
        requestedModelId.length > 0 ||
        !agentValidAsIs,
      requiresUserAction: true,
      reason: !agentValidAsIs ? "agent_invalid" : "no_providers",
    };
  }

  const hasValidatedAgents = agents.length > 0;
  const agentExists = agents.some((option) => option.id === requestedAgentId);
  const agentId =
    !hasValidatedAgents || !requestedAgentId || agentExists
      ? requestedAgentId
      : "";
  const agentValidAsIs =
    !requestedAgentId || !hasValidatedAgents || requestedAgentId === agentId;

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
      agentId,
      providerId,
      modelId: "",
      validAsIs: false,
      repaired: true,
      requiresUserAction: true,
      reason: !agentValidAsIs ? "agent_invalid" : "no_models_for_provider",
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
    agentValidAsIs &&
    !!requestedProviderId &&
    !!requestedModelId &&
    providerExists &&
    modelBelongsToProvider;

  const repaired = !validAsIs || !agentValidAsIs;

  return {
    agentId,
    providerId,
    modelId,
    validAsIs,
    repaired,
    requiresUserAction: !providerId || !modelId,
    reason: validAsIs
      ? "valid"
      : !agentValidAsIs && reason === "valid"
        ? "agent_invalid"
        : reason,
  };
};

export const initializeProjectRunDefaults = (
  input: ResolveProjectRunDefaultsInput,
): ProjectRunDefaultsResolution => {
  const requestedAgentId = normalize(input.persisted.agentId);
  const requestedProviderId = normalize(input.persisted.providerId);
  const requestedModelId = normalize(input.persisted.modelId);
  const agents = (input.agents ?? []).filter(
    (option) => normalize(option.id).length > 0,
  );
  const providers = input.providers.filter(
    (option) => normalize(option.id).length > 0,
  );
  const models = input.models.filter(
    (option) => normalize(option.id).length > 0,
  );

  if (providers.length === 0 && models.length === 0) {
    const hasValidatedAgents = agents.length > 0;
    const agentExists = agents.some((option) => option.id === requestedAgentId);
    const agentId =
      !hasValidatedAgents || !requestedAgentId || agentExists
        ? requestedAgentId
        : "";
    const agentValidAsIs =
      !requestedAgentId || !hasValidatedAgents || requestedAgentId === agentId;

    return {
      agentId,
      providerId: requestedProviderId,
      modelId: requestedModelId,
      validAsIs: agentValidAsIs,
      repaired: !agentValidAsIs,
      requiresUserAction: false,
      reason: agentValidAsIs ? "valid" : "agent_invalid",
    };
  }

  return resolveProjectRunDefaults(input);
};

export const getProjectRunDefaultsMessage = (
  resolution: ProjectRunDefaultsResolution,
  actionLabel: string,
): string => {
  if (resolution.validAsIs) {
    return "";
  }

  if (resolution.requiresUserAction) {
    return `Project run defaults are incomplete. Select a provider and model before ${actionLabel}.`;
  }

  return "Project run defaults were repaired to available options.";
};
