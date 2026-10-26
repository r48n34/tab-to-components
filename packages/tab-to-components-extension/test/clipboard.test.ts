// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { copyText, type ClipboardLike } from "../lib/clipboard";

interface FakeTextarea {
  value: string;
  style: { cssText?: string };
  setAttribute: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  setSelectionRange: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function fakeDocument(copySucceeds: boolean): {
  doc: Document;
  textarea: FakeTextarea;
  execCommand: ReturnType<typeof vi.fn>;
} {
  const textarea: FakeTextarea = {
    value: "",
    style: {},
    setAttribute: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    remove: vi.fn(),
  };
  const execCommand = vi.fn(() => copySucceeds);
  const doc = {
    createElement: vi.fn(() => textarea),
    body: { append: vi.fn() },
    documentElement: { append: vi.fn() },
    execCommand,
  };
  return { doc: doc as unknown as Document, textarea, execCommand };
}

describe("copyText", () => {
  it("uses the Clipboard API when it is available", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    const clipboard: ClipboardLike = { writeText };
    const { doc, execCommand } = fakeDocument(true);

    await expect(copyText("MyBox.tsx", { clipboard, document: doc })).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toBe("MyBox.tsx");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back to execCommand when the Clipboard API rejects", async () => {
    const clipboard: ClipboardLike = {
      writeText: vi.fn(async () => {
        throw new Error("denied");
      }),
    };
    const { doc, textarea, execCommand } = fakeDocument(true);

    await expect(
      copyText("app/components/MyBox.tsx", { clipboard, document: doc }),
    ).resolves.toBe(true);

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(textarea.value).toBe("app/components/MyBox.tsx");
    expect(textarea.setAttribute).toHaveBeenCalledWith("readonly", "");
    expect(textarea.remove).toHaveBeenCalledTimes(1);
  });

  it("uses the legacy path when no Clipboard API is available", async () => {
    const { doc, execCommand } = fakeDocument(true);
    await expect(copyText("a.tsx", { clipboard: null, document: doc })).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports failure when no clipboard method succeeds", async () => {
    const { doc } = fakeDocument(false);
    await expect(copyText("MyBox.tsx", { clipboard: null, document: doc })).resolves.toBe(false);
  });

  it("reports failure when there is no document for the legacy path", async () => {
    await expect(copyText("MyBox.tsx", { clipboard: null, document: null })).resolves.toBe(
      false,
    );
  });

  it("reports failure for empty text without touching the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    await expect(copyText("", { clipboard: { writeText } })).resolves.toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});
