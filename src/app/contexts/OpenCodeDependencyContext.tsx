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

import { useLocation } from "@solidjs/router";
import {
  createContext,
  createEffect,
  createSignal,
  onMount,
  useContext,
  type Accessor,
  type Component,
  type JSX,
} from "solid-js";
import {
  getOpenCodeDependencyStatus,
  type OpenCodeDependencyStatus,
} from "../lib/runs";

type OpenCodeDependencyContextValue = {
  state: Accessor<OpenCodeDependencyStatus>;
  reason: Accessor<string>;
  isModalVisible: Accessor<boolean>;
  refresh: (forceRefresh?: boolean) => Promise<OpenCodeDependencyStatus>;
  ensureAvailableForRequiredFlow: () => Promise<boolean>;
  showRequiredModal: () => void;
};

const OpenCodeDependencyContext =
  createContext<OpenCodeDependencyContextValue>();

export const OpenCodeDependencyProvider: Component<{
  children: JSX.Element;
}> = (props) => {
  const location = useLocation();
  const [state, setState] = createSignal<OpenCodeDependencyStatus>("unknown");
  const [reason, setReason] = createSignal("");
  const [isModalRequested, setIsModalRequested] = createSignal(false);
  let inflightRefresh: Promise<OpenCodeDependencyStatus> | null = null;

  const isUnavailableState = (value: OpenCodeDependencyStatus): boolean =>
    value === "missing" || value === "failure" || value === "checking";

  const refresh = async (
    forceRefresh = false,
  ): Promise<OpenCodeDependencyStatus> => {
    if (inflightRefresh && !forceRefresh) {
      return inflightRefresh;
    }

    setState("checking");
    const refreshPromise = (async () => {
      try {
        const result = await getOpenCodeDependencyStatus(forceRefresh);
        setState(result.state);
        setReason(result.reason?.trim() ?? "");
        if (result.state === "available") {
          setIsModalRequested(false);
        }
        return result.state;
      } catch (error) {
        setState("failure");
        setReason(
          error instanceof Error
            ? error.message.trim()
            : "Failed to check whether OpenCode is available.",
        );
        return "failure";
      } finally {
        inflightRefresh = null;
      }
    })();

    inflightRefresh = refreshPromise;
    return refreshPromise;
  };

  const ensureAvailableForRequiredFlow = async (): Promise<boolean> => {
    const currentState = state();
    if (currentState === "available") {
      return true;
    }

    let nextState: OpenCodeDependencyStatus = currentState;
    if (currentState === "unknown" || currentState === "checking") {
      nextState = await refresh(false);
    }

    if (nextState !== "available") {
      setIsModalRequested(true);
      return false;
    }

    return true;
  };

  createEffect(() => {
    if (
      location.pathname.startsWith("/runs/") &&
      (state() === "missing" || state() === "failure")
    ) {
      setIsModalRequested(true);
    }
  });

  onMount(() => {
    void refresh(false);
  });

  return (
    <OpenCodeDependencyContext.Provider
      value={{
        state,
        reason,
        isModalVisible: () => isModalRequested() && isUnavailableState(state()),
        refresh,
        ensureAvailableForRequiredFlow,
        showRequiredModal: () => setIsModalRequested(true),
      }}
    >
      {props.children}
    </OpenCodeDependencyContext.Provider>
  );
};

export const useOpenCodeDependency = (): OpenCodeDependencyContextValue => {
  const context = useContext(OpenCodeDependencyContext);
  if (!context) {
    throw new Error(
      "useOpenCodeDependency must be used within OpenCodeDependencyProvider.",
    );
  }
  return context;
};
