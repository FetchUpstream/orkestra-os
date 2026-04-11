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

import { describe, expect, it } from "vitest";
import {
  buildQuestionWizardFinalAnswers,
  buildQuestionWizardConfirmSummary,
  createEmptyQuestionWizardDrafts,
  isQuestionWizardComplete,
  isQuestionWizardPromptComplete,
  toggleQuestionWizardCustomAnswer,
  toggleQuestionWizardOption,
  type QuestionWizardDraftAnswer,
  type QuestionWizardPrompt,
} from "../questionWizard";

describe("questionWizard", () => {
  it("builds single-select option-only answers", () => {
    const prompts: QuestionWizardPrompt[] = [
      {
        header: "One",
        question: "Pick one",
        options: [{ label: "A", description: "" }],
        multiple: false,
        custom: true,
      },
    ];
    const draft = toggleQuestionWizardOption(
      prompts[0]!,
      createEmptyQuestionWizardDrafts(1)[0]!,
      "A",
    );

    expect(buildQuestionWizardFinalAnswers(prompts, [draft])).toEqual([["A"]]);
  });

  it("prefers typed override for single-select answers", () => {
    const prompts: QuestionWizardPrompt[] = [
      {
        header: "One",
        question: "Pick one",
        options: [{ label: "A", description: "" }],
        multiple: false,
        custom: true,
      },
    ];
    const draft: QuestionWizardDraftAnswer = {
      selectedOptionLabels: ["A"],
      useCustomAnswer: true,
      customText: "Custom",
    };

    expect(buildQuestionWizardFinalAnswers(prompts, [draft])).toEqual([
      ["Custom"],
    ]);
  });

  it("builds multi-select answers with custom text and dedupes values", () => {
    const prompts: QuestionWizardPrompt[] = [
      {
        header: "Many",
        question: "Pick many",
        options: [
          { label: "A", description: "" },
          { label: "B", description: "" },
        ],
        multiple: true,
        custom: true,
      },
    ];
    const draft: QuestionWizardDraftAnswer = {
      selectedOptionLabels: ["A", "B", "A"],
      useCustomAnswer: true,
      customText: "B",
    };

    expect(buildQuestionWizardFinalAnswers(prompts, [draft])).toEqual([
      ["A", "B"],
    ]);
  });

  it("detects completeness and builds confirm summary in order", () => {
    const prompts: QuestionWizardPrompt[] = [
      {
        header: "One",
        question: "First?",
        options: [],
        multiple: false,
        custom: true,
      },
      {
        header: "Two",
        question: "Second?",
        options: [{ label: "B", description: "" }],
        multiple: false,
        custom: true,
      },
    ];
    const drafts: QuestionWizardDraftAnswer[] = [
      { selectedOptionLabels: [], useCustomAnswer: true, customText: "Alpha" },
      { selectedOptionLabels: ["B"], useCustomAnswer: false, customText: "" },
    ];

    expect(isQuestionWizardPromptComplete(prompts[0]!, drafts[0]!)).toBe(true);
    expect(isQuestionWizardComplete(prompts, drafts)).toBe(true);
    expect(buildQuestionWizardConfirmSummary(prompts, drafts)).toEqual([
      { header: "One", question: "First?", answers: ["Alpha"] },
      { header: "Two", question: "Second?", answers: ["B"] },
    ]);
  });

  it("does not count custom text unless custom mode is selected", () => {
    const prompt: QuestionWizardPrompt = {
      header: "One",
      question: "First?",
      options: [{ label: "A", description: "" }],
      multiple: false,
      custom: true,
    };
    const draft: QuestionWizardDraftAnswer = {
      selectedOptionLabels: [],
      useCustomAnswer: false,
      customText: "Alpha",
    };

    expect(isQuestionWizardPromptComplete(prompt, draft)).toBe(false);
    expect(buildQuestionWizardFinalAnswers([prompt], [draft])).toEqual([[]]);
  });

  it("ignores custom draft text when prompt.custom is false", () => {
    const prompt: QuestionWizardPrompt = {
      header: "One",
      question: "First?",
      options: [{ label: "A", description: "" }],
      multiple: false,
      custom: false,
    };
    const draft: QuestionWizardDraftAnswer = {
      selectedOptionLabels: ["A"],
      useCustomAnswer: true,
      customText: "Alpha",
    };

    expect(isQuestionWizardPromptComplete(prompt, draft)).toBe(true);
    expect(buildQuestionWizardFinalAnswers([prompt], [draft])).toEqual([["A"]]);
  });

  it("does not toggle custom mode when prompt.custom is false", () => {
    const prompt: QuestionWizardPrompt = {
      header: "One",
      question: "First?",
      options: [{ label: "A", description: "" }],
      multiple: false,
      custom: false,
    };
    const draft: QuestionWizardDraftAnswer = {
      selectedOptionLabels: ["A"],
      useCustomAnswer: false,
      customText: "",
    };

    expect(toggleQuestionWizardCustomAnswer(prompt, draft)).toEqual(draft);
  });

  it("single-select custom toggle clears normal options and does not autofill text", () => {
    const prompt: QuestionWizardPrompt = {
      header: "One",
      question: "First?",
      options: [{ label: "A", description: "" }],
      multiple: false,
      custom: true,
    };

    const selected = toggleQuestionWizardOption(
      prompt,
      createEmptyQuestionWizardDrafts(1)[0]!,
      "A",
    );
    expect(selected).toMatchObject({
      selectedOptionLabels: ["A"],
      useCustomAnswer: false,
      customText: "",
    });

    const custom = toggleQuestionWizardCustomAnswer(prompt, selected);
    expect(custom).toMatchObject({
      selectedOptionLabels: [],
      useCustomAnswer: true,
      customText: "",
    });
  });
});
