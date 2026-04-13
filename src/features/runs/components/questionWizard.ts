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

export type QuestionWizardOption = {
  label: string;
  value: string;
  description: string;
};

export type QuestionWizardPrompt = {
  question: string;
  header: string;
  options: QuestionWizardOption[];
  multiple: boolean;
  custom: boolean;
};

export type QuestionWizardDraftAnswer = {
  selectedOptionValues: string[];
  useCustomAnswer: boolean;
  customText: string;
};

export type QuestionWizardConfirmSummaryItem = {
  header: string;
  question: string;
  answers: string[];
};

const normalizeText = (value: string): string => value.trim();

const dedupeStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped;
};

export const createEmptyQuestionWizardDrafts = (
  promptCount: number,
): QuestionWizardDraftAnswer[] => {
  return Array.from({ length: Math.max(0, promptCount) }, () => ({
    selectedOptionValues: [],
    useCustomAnswer: false,
    customText: "",
  }));
};

export const getQuestionWizardDraft = (
  drafts: QuestionWizardDraftAnswer[],
  promptIndex: number,
): QuestionWizardDraftAnswer => {
  return (
    drafts[promptIndex] ?? {
      selectedOptionValues: [],
      useCustomAnswer: false,
      customText: "",
    }
  );
};

export const buildQuestionWizardFinalAnswers = (
  prompts: QuestionWizardPrompt[],
  drafts: QuestionWizardDraftAnswer[],
): string[][] => {
  return prompts.map((prompt, index) => {
    const draft = getQuestionWizardDraft(drafts, index);
    const customText = normalizeText(draft.customText);
    const selectedOptionValues = dedupeStrings(draft.selectedOptionValues);

    if (prompt.multiple) {
      return dedupeStrings([
        ...selectedOptionValues,
        ...(prompt.custom && draft.useCustomAnswer && customText
          ? [customText]
          : []),
      ]);
    }

    if (prompt.custom && draft.useCustomAnswer && customText) {
      return [customText];
    }

    return selectedOptionValues.length > 0 ? [selectedOptionValues[0]] : [];
  });
};

export const isQuestionWizardPromptComplete = (
  prompt: QuestionWizardPrompt,
  draft: QuestionWizardDraftAnswer,
): boolean => {
  const customText = normalizeText(draft.customText);
  if (prompt.custom && draft.useCustomAnswer && customText.length > 0) {
    return true;
  }

  return dedupeStrings(draft.selectedOptionValues).length > 0;
};

export const isQuestionWizardComplete = (
  prompts: QuestionWizardPrompt[],
  drafts: QuestionWizardDraftAnswer[],
): boolean => {
  return prompts.every((prompt, index) =>
    isQuestionWizardPromptComplete(
      prompt,
      getQuestionWizardDraft(drafts, index),
    ),
  );
};

export const buildQuestionWizardConfirmSummary = (
  prompts: QuestionWizardPrompt[],
  drafts: QuestionWizardDraftAnswer[],
): QuestionWizardConfirmSummaryItem[] => {
  const finalAnswers = buildQuestionWizardFinalAnswers(prompts, drafts);
  return prompts.map((prompt, index) => ({
    header: prompt.header,
    question: prompt.question,
    answers: (finalAnswers[index] ?? []).map((answer) => {
      const matchingOption = prompt.options.find(
        (option) => option.value === answer,
      );
      return matchingOption?.label ?? answer;
    }),
  }));
};

export const toggleQuestionWizardOption = (
  prompt: QuestionWizardPrompt,
  draft: QuestionWizardDraftAnswer,
  optionValue: string,
): QuestionWizardDraftAnswer => {
  const nextValue = optionValue.trim();
  if (!nextValue) {
    return draft;
  }

  const previousSelected = dedupeStrings(draft.selectedOptionValues);
  const alreadySelected = previousSelected.includes(nextValue);

  if (prompt.multiple) {
    return {
      ...draft,
      selectedOptionValues: alreadySelected
        ? previousSelected.filter((value) => value !== nextValue)
        : [...previousSelected, nextValue],
    };
  }

  return {
    ...draft,
    selectedOptionValues: alreadySelected ? [] : [nextValue],
    useCustomAnswer: false,
  };
};

export const toggleQuestionWizardCustomAnswer = (
  prompt: QuestionWizardPrompt,
  draft: QuestionWizardDraftAnswer,
): QuestionWizardDraftAnswer => {
  if (!prompt.custom) {
    return draft;
  }

  const nextUseCustomAnswer = !draft.useCustomAnswer;
  return {
    ...draft,
    selectedOptionValues:
      !prompt.multiple && nextUseCustomAnswer ? [] : draft.selectedOptionValues,
    useCustomAnswer: nextUseCustomAnswer,
  };
};

export const updateQuestionWizardCustomText = (
  draft: QuestionWizardDraftAnswer,
  customText: string,
): QuestionWizardDraftAnswer => {
  return {
    ...draft,
    customText,
  };
};
