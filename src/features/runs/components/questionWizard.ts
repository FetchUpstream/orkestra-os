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
  selectedOptionLabels: string[];
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
    selectedOptionLabels: [],
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
      selectedOptionLabels: [],
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
    const selectedOptionLabels = dedupeStrings(draft.selectedOptionLabels);

    if (prompt.multiple) {
      return dedupeStrings([
        ...selectedOptionLabels,
        ...(prompt.custom && draft.useCustomAnswer && customText
          ? [customText]
          : []),
      ]);
    }

    if (prompt.custom && draft.useCustomAnswer && customText) {
      return [customText];
    }

    return selectedOptionLabels.length > 0 ? [selectedOptionLabels[0]] : [];
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

  return dedupeStrings(draft.selectedOptionLabels).length > 0;
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
    answers: finalAnswers[index] ?? [],
  }));
};

export const toggleQuestionWizardOption = (
  prompt: QuestionWizardPrompt,
  draft: QuestionWizardDraftAnswer,
  optionLabel: string,
): QuestionWizardDraftAnswer => {
  const nextLabel = optionLabel.trim();
  if (!nextLabel) {
    return draft;
  }

  const previousSelected = dedupeStrings(draft.selectedOptionLabels);
  const alreadySelected = previousSelected.includes(nextLabel);

  if (prompt.multiple) {
    return {
      ...draft,
      selectedOptionLabels: alreadySelected
        ? previousSelected.filter((label) => label !== nextLabel)
        : [...previousSelected, nextLabel],
    };
  }

  return {
    ...draft,
    selectedOptionLabels: alreadySelected ? [] : [nextLabel],
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
    selectedOptionLabels:
      !prompt.multiple && nextUseCustomAnswer ? [] : draft.selectedOptionLabels,
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
