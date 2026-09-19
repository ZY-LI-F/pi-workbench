/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { appendArchive } from "../../../secure-files";

/**
 * Append-only JSONL record of what the mechanism did on each provider request.
 *
 * The caller derives the ledger path from the active Pi session.
 */
export type Ledger = (entry: Record<string, unknown>) => Promise<void>;

export function createLedger(path: string): Ledger {
	return async (entry) => {
		await appendArchive(path, `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`);
	};
}
