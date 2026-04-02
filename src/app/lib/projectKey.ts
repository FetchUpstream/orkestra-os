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
