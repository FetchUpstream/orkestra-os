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

import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  type Component,
} from "solid-js";

type DirectorySearchResult = {
  path: string;
  directoryName: string;
  parentPath: string;
};

type Props = {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  required?: boolean;
  disabled?: boolean;
  onInput: (value: string) => void;
  searchDirectories: (
    query: string,
    limit?: number,
  ) => Promise<DirectorySearchResult[]>;
};

const SEARCH_DEBOUNCE_MS = 180;

const RepositoryPathPicker: Component<Props> = (props) => {
  const [isFocused, setIsFocused] = createSignal(false);
  const [debouncedQuery, setDebouncedQuery] = createSignal("");
  const [results, setResults] = createSignal<DirectorySearchResult[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [errorText, setErrorText] = createSignal("");
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  let activeRequestVersion = 0;
  const dropdownId = `repository-path-picker-${props.ariaLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`;

  const hasQuery = () => props.value.trim().length > 0;
  const isOpen = () => isFocused();

  const selectResult = (result: DirectorySearchResult) => {
    props.onInput(result.path);
    setHighlightedIndex(0);
    setResults([]);
    setErrorText("");
    setIsFocused(false);
  };

  createEffect(() => {
    const query = props.value.trim();
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, SEARCH_DEBOUNCE_MS);
    onCleanup(() => window.clearTimeout(timeoutId));
  });

  createEffect(() => {
    const query = debouncedQuery();
    const requestVersion = ++activeRequestVersion;

    if (!isFocused()) {
      setIsLoading(false);
      return;
    }

    if (!query) {
      setResults([]);
      setIsLoading(false);
      setErrorText("");
      setHighlightedIndex(0);
      return;
    }

    setIsLoading(true);
    setErrorText("");
    void props
      .searchDirectories(query, 24)
      .then((nextResults) => {
        if (
          requestVersion !== activeRequestVersion ||
          debouncedQuery() !== query
        ) {
          return;
        }
        setResults(nextResults);
        setHighlightedIndex(0);
      })
      .catch(() => {
        if (
          requestVersion !== activeRequestVersion ||
          debouncedQuery() !== query
        ) {
          return;
        }
        setResults([]);
        setErrorText("Failed to search local repositories.");
        setHighlightedIndex(0);
      })
      .finally(() => {
        if (requestVersion === activeRequestVersion) {
          setIsLoading(false);
        }
      });
  });

  return (
    <div
      class="repository-path-picker"
      onFocusIn={() => setIsFocused(true)}
      onFocusOut={() => {
        queueMicrotask(() => {
          if (!document.activeElement?.closest(".repository-path-picker")) {
            setIsFocused(false);
          }
        });
      }}
    >
      <input
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onKeyDown={(event) => {
          const nextResults = results();
          if (!isOpen()) return;

          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (nextResults.length === 0) return;
            setHighlightedIndex((prev) => (prev + 1) % nextResults.length);
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            if (nextResults.length === 0) return;
            setHighlightedIndex(
              (prev) => (prev - 1 + nextResults.length) % nextResults.length,
            );
          }

          if (event.key === "Enter" && nextResults[highlightedIndex()]) {
            event.preventDefault();
            selectResult(nextResults[highlightedIndex()]!);
          }

          if (event.key === "Escape") {
            event.preventDefault();
            setIsFocused(false);
          }
        }}
        placeholder={props.placeholder}
        aria-label={props.ariaLabel}
        required={props.required}
        aria-expanded={isOpen()}
        aria-autocomplete="list"
        aria-controls={dropdownId}
        disabled={props.disabled}
      />
      <p class="field-help">
        Search common local Git repositories, or enter a path manually.
      </p>
      <Show when={isOpen()}>
        <div
          id={dropdownId}
          class="repository-path-picker-dropdown"
          role="listbox"
        >
          <Show when={errorText()}>
            {(message) => (
              <div class="repository-path-picker-row repository-path-picker-row--error">
                {message()}
              </div>
            )}
          </Show>
          <Show when={!errorText()}>
            <Show
              when={results().length > 0}
              fallback={
                <div class="repository-path-picker-row repository-path-picker-row--empty">
                  {isLoading()
                    ? "Searching local repositories…"
                    : hasQuery()
                      ? "No matching repositories"
                      : "Type to search local repositories"}
                </div>
              }
            >
              <For each={results()}>
                {(result, index) => (
                  <button
                    type="button"
                    class={`repository-path-picker-row repository-path-picker-option ${highlightedIndex() === index() ? "is-highlighted" : ""}`}
                    role="option"
                    onMouseEnter={() => setHighlightedIndex(index())}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      selectResult(result);
                    }}
                  >
                    <span class="repository-path-picker-title">
                      {result.directoryName}
                    </span>
                    <span class="repository-path-picker-subtitle">
                      {result.parentPath}
                    </span>
                    <span class="repository-path-picker-path">
                      {result.path}
                    </span>
                  </button>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default RepositoryPathPicker;
