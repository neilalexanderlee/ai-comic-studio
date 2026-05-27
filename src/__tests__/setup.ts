/**
 * Vitest global test setup
 *
 * - Mocks the DB so unit tests never touch the real SQLite file.
 * - Provides a minimal AIProvider mock factory.
 */

import { vi } from "vitest";

vi.mock("server-only", () => ({}));

// ── DB mock ──────────────────────────────────────────────────────────────────
// Unit tests must not hit the real database.
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnValue([]),
    delete: vi.fn().mockReturnThis(),
  },
}));

// ── fs mock (unit tests don't touch disk) ───────────────────────────────────
vi.mock("node:fs", () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(""),
    existsSync: vi.fn().mockReturnValue(false),
    unlinkSync: vi.fn(),
  },
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(""),
  existsSync: vi.fn().mockReturnValue(false),
  unlinkSync: vi.fn(),
}));

// ── Minimal AIProvider mock factory ─────────────────────────────────────────
export function makeTextProvider(response: string = "enhanced prompt") {
  return {
    generateText: vi.fn().mockResolvedValue(response),
    generateImage: vi.fn().mockResolvedValue("/tmp/fake.png"),
  };
}
