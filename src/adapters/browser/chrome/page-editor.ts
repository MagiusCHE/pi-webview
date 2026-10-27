// Generic access to code editors living in the page's main world. The whole body
// is injected with chrome.scripting.executeScript({ world: "MAIN" }), so it must
// stay self-contained: no imports, no outer references, no eval.
//
// No editor brand is encoded here. Editors are recognised by the *shape of the
// API they expose* to the page, and any future editor following one of those
// shapes works without changing this file:
//
//   value-api        getValue()/setValue() on an instance attached to its DOM
//                    container (optionally with a doc exposing replaceRange)
//   offset-document  <host>.state.doc with toString()/length/line(n) plus a
//                    dispatch({changes}) function
//   model-registry   a global registry exposing getModels(), each model with
//                    getValue()/setValue() and offset/edit helpers
//   dom-field        the standard editing pipeline only (textarea, text input,
//                    contenteditable): readable and writable, but the app model
//                    cannot be inspected, so the result is DOM-verified only
//
// Every write is guarded by the content hash the caller read first and verified
// by re-reading; the result always states the verification level.

export interface PageEditorEditInput {
  fromLine: number;
  fromColumn: number;
  toLine: number;
  toColumn: number;
  text: string;
}

export interface PageEditorRequestInput {
  action: "list" | "read" | "replace" | "apply";
  editorId?: string;
  text?: string;
  expectedHash?: string;
  edits?: PageEditorEditInput[];
  filters?: { visibleOnly?: boolean; editableOnly?: boolean };
}

export interface PageEditorHandleInfo {
  editorId: string;
  kind: string;
  verificationLevel: string;
  label?: string;
  modelUri?: string;
  language?: string;
  readOnly: boolean;
  visible: boolean;
  length: number;
  lines: number;
  hash: string;
}

export interface PageEditorResult {
  ok: boolean;
  error?: string;
  warning?: string;
  url?: string;
  editors?: PageEditorHandleInfo[];
  editorKind?: string;
  verificationLevel?: string;
  content?: string;
  contentLength?: number;
  contentLines?: number;
  contentHash?: string;
  previousHash?: string;
  changed?: boolean;
  verified?: boolean;
}

export function pageEditorOperation(request: PageEditorRequestInput): PageEditorResult {
  const MAX_CONTENT = 400_000;
  const MAX_SCAN_ELEMENTS = 50_000;
  const MAX_KEYS = 200;
  const MAX_HANDLES = 40;
  const MAX_DOM_FIELDS = 10;

  const hashOf = (text: string): string => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `fnv1a32:${hash.toString(16).padStart(8, "0")}:${text.length}`;
  };
  const lineCountOf = (text: string): number => (text.match(/\n/g)?.length ?? 0) + 1;
  const isVisible = (element: Element | undefined): boolean => {
    if (!element) return false;
    try {
      const rect = element.getBoundingClientRect();
      // off-screen helper fields are rendered but not visible or operable
      return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0;
    } catch {
      return false;
    }
  };
  const labelOf = (element: Element | undefined): string | undefined => {
    if (!element) return undefined;
    const holder = element.closest("[aria-label]");
    const candidate =
      holder?.getAttribute("aria-label")?.trim() ||
      element.getAttribute("aria-label")?.trim() ||
      element.id ||
      element.closest("[data-testid]")?.getAttribute("data-testid") ||
      (element as HTMLInputElement).name ||
      undefined;
    return candidate && candidate.length <= 200 ? candidate : undefined;
  };
  const callable = (value: unknown): value is (...args: any[]) => any =>
    typeof value === "function";

  // Editor objects in the wild expose getters and methods that can throw (wrong
  // receiver, missing state, blocked access). A probe must never abort the whole
  // scan: an exception is reported as "unknown", not as "no editor".
  const probeErrors: string[] = [];
  // Cross-origin Window proxies throw SecurityError on ANY named property read,
  // so even `value.nodeType` must be guarded on hot paths.
  const guarded = <T>(probe: () => T): T | undefined => {
    try {
      return probe();
    } catch {
      return undefined;
    }
  };
  let scannedElements = 0;
  const safe = <T>(label: string, probe: () => T): T | undefined => {
    try {
      return probe();
    } catch (error) {
      if (probeErrors.length < 5) {
        probeErrors.push(
          `${label}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return undefined;
    }
  };

  interface Handle {
    id: string;
    kind: string;
    verificationLevel: "model" | "dom-only";
    read: () => string;
    write: (text: string) => void;
    range: (from: number, to: number, text: string) => void;
    offset: (line: number, column: number) => number;
    readOnly: () => boolean;
    label?: string;
    modelUri?: string;
    language?: string;
    visible: boolean;
    /** DOM fields cannot guarantee that the application model follows. */
    warning?: string;
  }

  // --- candidate discovery --------------------------------------------------
  const seenObjects = new Set<unknown>();
  const isCandidateObject = (value: unknown): value is Record<string, any> => {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      return false;
    }
    if (value === window || value === document) return false;
    // A cross-origin Window throws on any property read, including nodeType
    // `undefined` means the read threw (cross-origin Window); a plain object
    // without nodeType yields null and stays a candidate.
    const nodeType = guarded(() => (value as { nodeType?: unknown }).nodeType ?? null);
    if (nodeType === undefined) return false;
    // DOM nodes expose nodeType: their editor instance, if any, is an own prop
    return typeof nodeType !== "number";
  };

  // Framework internals are expandos too and outnumber real editors on a large
  // page: skipping them by name keeps the scan linear and never starves it.
  const FRAMEWORK_KEY =
    /^(?:__react|__vue|__ngContext|__svelte|__zone_symbol__|_reactListening|jQuery\d*$)/;
  const MAX_NESTED_KEYS = 60;

  const ownKeys = (object: Record<string, any>, limit: number): string[] => {
    try {
      return Object.keys(object).slice(0, limit);
    } catch {
      return [];
    }
  };

  const readKey = (object: Record<string, any>, key: string): unknown => {
    try {
      return object[key];
    } catch {
      return undefined;
    }
  };

  // Global side: model registries live in small namespaces on window.
  const scanGlobals = (root: Record<string, any>): void => {
    for (const key of ownKeys(root, 5_000)) {
      if (FRAMEWORK_KEY.test(key)) continue;
      const namespace = readKey(root, key);
      if (!isCandidateObject(namespace)) continue;
      consider(namespace as Record<string, any>, undefined);
      const childKeys = ownKeys(namespace as Record<string, any>, MAX_NESTED_KEYS);
      // large objects are data stores, not namespaces
      if (childKeys.length > 50) continue;
      for (const childKey of childKeys) {
        if (FRAMEWORK_KEY.test(childKey)) continue;
        const child = readKey(namespace as Record<string, any>, childKey);
        if (isCandidateObject(child)) {
          consider(child as Record<string, any>, undefined);
        }
      }
    }
  };

  const handles: Handle[] = [];

  const baseInfo = (handle: Handle) => {
    const text = handle.read();
    return {
      editorId: handle.id,
      kind: handle.kind,
      verificationLevel: handle.verificationLevel,
      ...(handle.label ? { label: handle.label } : {}),
      ...(handle.modelUri ? { modelUri: handle.modelUri } : {}),
      ...(handle.language ? { language: handle.language } : {}),
      readOnly: handle.readOnly(),
      visible: handle.visible,
      length: text.length,
      lines: lineCountOf(text),
      hash: hashOf(text),
    };
  };

  const register = (handle: Handle): void => {
    const count = handles.filter((item) => item.kind === handle.kind).length;
    handles.push({ ...handle, id: `${handle.kind}:${count}` });
  };

  // Shape-first: each candidate object is tested against the capability shapes
  // immediately, so nothing is collected and no global budget can be exhausted.
  function consider(object: Record<string, any>, element: Element | undefined): void {
    if (!isCandidateObject(object) || seenObjects.has(object)) return;
    if (handles.length >= MAX_HANDLES) return;
    seenObjects.add(object);
    const valueApi = valueApiHandle(object, element);
    if (valueApi) register(valueApi);
    const offsetDocument = offsetDocumentHandle(object, element);
    if (offsetDocument) register(offsetDocument);
    for (const handle of modelRegistryHandles(object, element)) register(handle);
  }

  // The scan runs after the shape builders exist: it calls them through
  // consider(), which needs register() and the builders initialized first.
  const scanPages = (): void => {
    scanGlobals(window as any);

    let elements: Element[] = [];
    try {
      elements = Array.from(document.querySelectorAll("*")).slice(0, MAX_SCAN_ELEMENTS);
    } catch {
      elements = [];
    }
    scannedElements = elements.length;
    for (const element of elements) {
      if (handles.length >= MAX_HANDLES) break;
      // an editor handle is normally an own expando of its container element
      for (const key of ownKeys(element as any, MAX_KEYS)) {
        if (FRAMEWORK_KEY.test(key)) continue;
        const value = readKey(element as any, key);
        if (!isCandidateObject(value)) continue;
        consider(value as Record<string, any>, element);
        // one nested level covers wrappers such as { env: { editor } } or
        // { cmView: { view } }, still per element and framework-filtered
        for (const childKey of ownKeys(value as Record<string, any>, MAX_NESTED_KEYS)) {
          if (FRAMEWORK_KEY.test(childKey)) continue;
          const child = readKey(value as Record<string, any>, childKey);
          if (isCandidateObject(child)) {
            consider(child as Record<string, any>, element);
          }
        }
      }
    }
  };

  // --- shape: value API -----------------------------------------------------
  interface EditSurface {
    replace(from: number, to: number, text: string): void;
    offset(line: number, column: number): number;
  }

  // Editors expose their editing surface in a few recurring shapes; resolve them
  // by capability so sessions, documents and editor objects all work.
  const resolveSurface = (object: Record<string, any>): EditSurface | undefined => {
    const doc = safe("getDoc", () =>
      callable(object.getDoc) ? object.getDoc() : object.doc,
    );
    if (
      doc &&
      callable(doc.replaceRange) &&
      callable(doc.posFromIndex) &&
      callable(doc.indexFromPos) &&
      callable(doc.getLine)
    ) {
      return {
        replace: (from, to, text) => {
          doc.replaceRange(text, doc.posFromIndex(from), doc.posFromIndex(to));
        },
        offset: (line, column) => {
          const lineText = doc.getLine(line - 1);
          if (typeof lineText !== "string") {
            throw new Error(`Line ${line} does not exist in this editor.`);
          }
          if (column > lineText.length + 1) {
            throw new Error(`Column ${column} is outside line ${line}.`);
          }
          return doc.indexFromPos({ line: line - 1, ch: column - 1 });
        },
      };
    }
    const session = safe("session", () =>
      callable(object.replace) && callable(object.getLine) ? object : object.session,
    );
    if (
      session &&
      callable(session.replace) &&
      callable(session.getLine) &&
      callable(session.doc?.indexToPosition) &&
      callable(session.doc?.positionToIndex)
    ) {
      return {
        replace: (from, to, text) => {
          session.replace(
            {
              start: session.doc.indexToPosition(from),
              end: session.doc.indexToPosition(to),
            },
            text,
          );
        },
        offset: (line, column) => {
          const lineCount = callable(session.getLength) ? session.getLength() : 0;
          if (lineCount && line > lineCount) {
            throw new Error(`Line ${line} does not exist in this editor.`);
          }
          const lineText = String(session.getLine(line - 1) ?? "");
          if (column > lineText.length + 1) {
            throw new Error(`Column ${column} is outside line ${line}.`);
          }
          return session.doc.positionToIndex({ row: line - 1, column: column - 1 }, 0);
        },
      };
    }
    if (
      doc &&
      callable(doc.replace) &&
      callable(doc.indexToPosition) &&
      callable(doc.positionToIndex) &&
      callable(doc.getLine)
    ) {
      return {
        replace: (from, to, text) => {
          doc.replace(
            { start: doc.indexToPosition(from), end: doc.indexToPosition(to) },
            text,
          );
        },
        offset: (line, column) => {
          const lineText = String(doc.getLine(line - 1) ?? "");
          if (lineText === undefined) {
            throw new Error(`Line ${line} does not exist in this editor.`);
          }
          if (column > lineText.length + 1) {
            throw new Error(`Column ${column} is outside line ${line}.`);
          }
          return doc.positionToIndex({ row: line - 1, column: column - 1 }, 0);
        },
      };
    }
    return undefined;
  };

  const valueApiHandle = (
    object: Record<string, any>,
    element: Element | undefined,
  ): Handle | undefined => {
    if (!callable(object.getValue) || !callable(object.setValue)) return undefined;
    const surface = resolveSurface(object);
    return {
      id: "",
      kind: "value-api",
      verificationLevel: "model",
      read: () => String(object.getValue()),
      write: (text) => {
        object.setValue(text);
      },
      range: (from, to, text) => {
        if (!surface) {
          throw new Error(
            "This editor exposes values only: use replace instead of targeted edits.",
          );
        }
        surface.replace(from, to, text);
      },
      offset: (line, column) => {
        if (!surface) {
          throw new Error(
            "This editor exposes values only: use replace instead of targeted edits.",
          );
        }
        return surface.offset(line, column);
      },
      // Prefer the option API and stop at the first boolean answer: some handles
      // expose getReadOnly() but throw when it is called unbound (real case).
      readOnly: () => {
        const fromOption = safe("option", () => object.getOption?.("readOnly"));
        if (typeof fromOption === "boolean") return fromOption;
        const fromGetter = safe("getReadOnly", () => object.getReadOnly?.());
        if (typeof fromGetter === "boolean") return fromGetter;
        return safe("readOnlyFlag", () => object.readOnly === true) === true;
      },
      label: labelOf(element),
      language: safe("language", () => {
        const mode = callable(object.getMode) ? object.getMode() : undefined;
        return mode?.name ?? object.session?.getMode?.()?.$id;
      }),
      visible: isVisible(element),
    };
  };

  // --- shape: offset document ----------------------------------------------
  const offsetDocumentHandle = (
    object: Record<string, any>,
    element: Element | undefined,
  ): Handle | undefined => {
    // the state object is replaced on every change: always resolve it again
    const liveHost = (): Record<string, any> =>
      safe("liveHost", () =>
        object.state && typeof object.state === "object" ? object.state : object,
      ) ?? object;
    const initial = liveHost();
    if (!initial?.doc) return undefined;
    const dispatch = safe("dispatch", () =>
      callable(object.dispatch) ? object.dispatch : initial.dispatch,
    );
    if (!callable(dispatch)) return undefined;
    const liveDoc = (): Record<string, any> | undefined => liveHost()?.doc;
    const probe = safe("liveDoc", () => liveDoc());
    if (!probe || !callable(probe.toString) || typeof probe.length !== "number") {
      return undefined;
    }
    if (!callable(probe.line)) return undefined;
    return {
      id: "",
      kind: "offset-document",
      verificationLevel: "model",
      read: () => String(liveDoc()?.toString() ?? ""),
      write: (text) => {
        const doc = liveDoc();
        if (!doc) throw new Error("The editor document is no longer available.");
        dispatch({ changes: { from: 0, to: doc.length, insert: text } });
      },
      range: (from, to, text) => {
        dispatch({ changes: { from, to, insert: text } });
      },
      offset: (line, column) => {
        const doc = liveDoc();
        if (!doc) throw new Error("The editor document is no longer available.");
        if (typeof doc.lines === "number" && line > doc.lines) {
          throw new Error(`Line ${line} does not exist in this editor.`);
        }
        const lineInfo = doc.line(line);
        if (column > lineInfo.length + 1) {
          throw new Error(`Column ${column} is outside line ${line}.`);
        }
        return lineInfo.from + column - 1;
      },
      readOnly: () => liveHost()?.readOnly === true,
      label: labelOf(element),
      visible: isVisible(element),
    };
  };

  // --- shape: model registry -----------------------------------------------
  const modelRegistryHandles = (
    object: Record<string, any>,
    element: Element | undefined,
  ): Handle[] => {
    if (!callable(object.getModels)) return [];
    let models: unknown[] = [];
    try {
      models = Array.from(object.getModels() as unknown[]);
    } catch {
      return [];
    }
    const result: Handle[] = [];
    for (const candidate of models) {
      const model = candidate as Record<string, any>;
      if (!isCandidateObject(model)) continue;
      if (!callable(model.getValue) || !callable(model.setValue)) continue;
      const canOffset =
        callable(model.getOffsetAt) &&
        (callable(model.getLineCount) === false || true) &&
        callable(model.getLineMaxColumn);
      const canEdit = callable(model.pushEditOperations) || callable(model.applyEdits);
      const RangeCtor = object.Range;
      const uri = safe("modelUri", () =>
        model.uri && callable(model.uri.toString)
          ? String(model.uri.toString())
          : undefined,
      );
      result.push({
        id: "",
        kind: "model-registry",
        verificationLevel: "model",
        read: () => String(model.getValue()),
        write: (text) => {
          model.setValue(text);
        },
        range: (from, to, text) => {
          if (callable(model.pushEditOperations)) {
            model.pushEditOperations(
              [],
              [
                {
                  range: {
                    startPosition: model.getPositionAt(from),
                    endPosition: model.getPositionAt(to),
                  },
                  text,
                },
              ],
              () => null,
            );
            return;
          }
          if (callable(model.applyEdits) && callable(RangeCtor)) {
            const start = model.getPositionAt(from);
            const end = model.getPositionAt(to);
            model.applyEdits([
              {
                range: new (RangeCtor as any)(
                  start.lineNumber,
                  start.column,
                  end.lineNumber,
                  end.column,
                ),
                text,
              },
            ]);
            return;
          }
          throw new Error(
            "This editor model does not accept targeted edits: use replace instead.",
          );
        },
        offset: (line, column) => {
          if (!canOffset) {
            throw new Error(
              "This editor model exposes values only: use replace instead of targeted edits.",
            );
          }
          if (callable(model.getLineCount) && line > (model.getLineCount() as number)) {
            throw new Error(`Line ${line} does not exist in this editor.`);
          }
          if (column > (model.getLineMaxColumn(line) as number)) {
            throw new Error(`Column ${column} is outside line ${line}.`);
          }
          return model.getOffsetAt({ lineNumber: line, column });
        },
        readOnly: () =>
          safe("modelReadOnly", () =>
            callable(model.isReadOnly) ? model.isReadOnly() : false,
          ) === true,
        label: labelOf(element),
        ...(uri ? { modelUri: uri } : {}),
        language: safe("modelLanguage", () =>
          callable(model.getLanguageId) ? String(model.getLanguageId()) : undefined,
        ),
        visible: Boolean(element) && isVisible(element),
      });
      if (canEdit) continue;
    }
    return result;
  };

  scanPages();

  // --- shape: DOM field fallback -------------------------------------------
  const domFieldHandles = (): Handle[] => {
    const selectors = [
      "textarea",
      'input[type="text"]',
      'input[type="search"]',
      'input[type="url"]',
      'input[type="email"]',
      'input[type="tel"]',
      "input:not([type])",
      '[contenteditable="true"]',
    ];
    const found: Handle[] = [];
    const seen = new Set<Element>();
    for (const selector of selectors) {
      let nodes: Element[] = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch {
        nodes = [];
      }
      for (const node of nodes) {
        if (seen.has(node)) continue;
        seen.add(node);
        if (node.closest("[data-pi-webview-ignore]")) continue;
        const field = node as HTMLTextAreaElement & HTMLInputElement;
        const editable = Boolean((node as HTMLElement).isContentEditable);
        const isField =
          node instanceof HTMLTextAreaElement ||
          (node instanceof HTMLInputElement &&
            node.type !== "password" &&
            node.type !== "hidden");
        if (!isField && !editable) continue;
        const read = (): string =>
          isField ? String(field.value ?? "") : String(node.textContent ?? "");
        const write = (text: string): void => {
          if (isField) {
            const prototype =
              node instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
            if (!setter) throw new Error("The field value cannot be changed.");
            setter.call(node, text);
            node.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
            node.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
            return;
          }
          (node as HTMLElement).focus({ preventScroll: true });
          const range = document.createRange();
          range.selectNodeContents(node);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          if (!document.execCommand("insertText", false, text)) {
            node.textContent = text;
            node.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          }
          return;
        };
        found.push({
          id: "",
          kind: "dom-field",
          verificationLevel: "dom-only",
          read,
          write,
          range: () => {
            throw new Error(
              "A DOM field has no document model: use replace, or a structured action.",
            );
          },
          offset: () => {
            throw new Error(
              "A DOM field has no document model: use replace, or a structured action.",
            );
          },
          readOnly: () =>
            isField
              ? Boolean(field.readOnly || field.disabled)
              : node.getAttribute("contenteditable") !== "true",
          label: labelOf(node),
          visible: isVisible(node),
          warning:
            "This field exposes no editor API: the change was applied through the standard editing pipeline and verified only on the DOM, not on the application model." +
            (isVisible(node) ? "" : " The field is not visible on the page."),
        });
        if (found.length >= MAX_DOM_FIELDS) return found;
      }
    }
    return found;
  };

  // ids must be unique inside the frame: index the DOM fallback by position,
  // never by "how many of the same kind were already collected"
  const allHandles = handles.slice();
  for (const handle of domFieldHandles()) {
    const index = allHandles.filter((item) => item.kind === "dom-field").length;
    allHandles.push({ ...handle, id: `dom-field:${index}` });
  }
  const idCounts = new Map<string, number>();
  for (const handle of allHandles) {
    idCounts.set(handle.id, (idCounts.get(handle.id) ?? 0) + 1);
  }
  const duplicatedIds = [...idCounts].filter(([, count]) => count > 1).map(([id]) => id);
  const filters = request.filters ?? {};
  const matchesFilters = (handle: Handle): boolean => {
    if (filters.visibleOnly && !handle.visible) return false;
    if (filters.editableOnly && handle.readOnly()) return false;
    return true;
  };
  const listed = allHandles.filter(matchesFilters);

  if (request.action === "list") {
    if (listed.length === 0) {
      return {
        ok: false,
        error:
          allHandles.length === 0
            ? `No editable surface was found in this page: no editor exposing a value, offset-document or model-registry API, and no textarea, text input or contenteditable field. Nothing can be read or written reliably here. Inspected ${scannedElements} element(s)${probeErrors.length > 0 ? `; rejected probes: ${probeErrors.join("; ")}` : ""}.`
            : `No editable surface matches the requested filters (${allHandles.length} found without filters).`,
      };
    }
    return {
      ok: true,
      url: location.href,
      ...(duplicatedIds.length > 0
        ? { warning: `Duplicate editor ids: ${duplicatedIds.join(", ")}` }
        : {}),
      editors: listed
        .map((handle) => {
          const info = safe("describeEditor", () => baseInfo(handle));
          if (!info) return undefined;
          return {
            ...info,
            ...(handle.warning ? { warning: handle.warning } : {}),
          };
        })
        .filter((info): info is NonNullable<typeof info> =>
          Boolean(info),
        ) as unknown as PageEditorHandleInfo[],
    };
  }

  const matches = allHandles.filter((item) => item.id === request.editorId);
  if (matches.length > 1) {
    return {
      ok: false,
      url: location.href,
      error:
        `Editor ${request.editorId} is ambiguous in this frame (${matches.length} targets share that id). ` +
        "Refusing to read or write. Call browser_page_editor with action list and the visibleOnly/editableOnly filters to pick a unique target.",
    };
  }
  const handle = matches[0];
  if (!handle) {
    return {
      ok: false,
      url: location.href,
      error:
        `Editor ${request.editorId} is not available in this frame. ` +
        "Call browser_page_editor with action list again: the page or editor may have changed.",
    };
  }

  const current = handle.read();
  const currentHash = hashOf(current);
  const verification = handle.verificationLevel;
  const warningSuffix = handle.warning ? { warning: handle.warning } : {};

  if (request.action === "read") {
    if (current.length > MAX_CONTENT) {
      return {
        ok: false,
        url: location.href,
        editorKind: handle.kind,
        verificationLevel: verification,
        contentLength: current.length,
        contentLines: lineCountOf(current),
        contentHash: currentHash,
        error:
          `This document is ${current.length} characters, above the ${MAX_CONTENT}-character read limit. ` +
          "Use targeted edits or read a smaller region instead of the whole document.",
      };
    }
    return {
      ok: true,
      url: location.href,
      editorKind: handle.kind,
      verificationLevel: verification,
      content: current,
      contentLength: current.length,
      contentLines: lineCountOf(current),
      contentHash: currentHash,
      ...warningSuffix,
    };
  }

  if (request.expectedHash !== currentHash) {
    return {
      ok: false,
      url: location.href,
      editorKind: handle.kind,
      verificationLevel: verification,
      contentLength: current.length,
      contentHash: currentHash,
      error:
        `The content changed since it was read (expected ${request.expectedHash}, found ${currentHash}). ` +
        "Read again before writing.",
    };
  }

  let expected: string;
  try {
    if (request.action === "replace") {
      expected = request.text ?? "";
    } else {
      const edits = request.edits ?? [];
      const ranges: Array<{ from: number; to: number; text: string }> = [];
      for (const edit of edits) {
        ranges.push({
          from: handle.offset(edit.fromLine, edit.fromColumn),
          to: handle.offset(edit.toLine, edit.toColumn),
          text: edit.text,
        });
      }
      ranges.sort((left, right) => left.from - right.from || left.to - right.to);
      for (let index = 0; index < ranges.length; index += 1) {
        const range = ranges[index]!;
        if (range.from < 0 || range.to > current.length || range.from > range.to) {
          return {
            ok: false,
            url: location.href,
            editorKind: handle.kind,
            verificationLevel: verification,
            contentHash: currentHash,
            error: `Edit ${index + 1} is outside the document.`,
          };
        }
        const previous = ranges[index - 1];
        if (previous && range.from < previous.to) {
          return {
            ok: false,
            url: location.href,
            editorKind: handle.kind,
            verificationLevel: verification,
            contentHash: currentHash,
            error: `Edit ${index + 1} overlaps with edit ${index}.`,
          };
        }
      }
      let cursor = 0;
      let built = "";
      for (const range of ranges) {
        built += current.slice(cursor, range.from) + range.text;
        cursor = range.to;
      }
      expected = built + current.slice(cursor);
    }
  } catch (error) {
    return {
      ok: false,
      url: location.href,
      editorKind: handle.kind,
      verificationLevel: verification,
      contentHash: currentHash,
      error: `${
        error instanceof Error ? error.message : String(error)
      } — the change was not applied; read the document again and retry.`,
    };
  }

  try {
    if (request.action === "replace") {
      handle.write(expected);
    } else {
      const ranges = (request.edits ?? [])
        .map((edit) => ({
          from: handle.offset(edit.fromLine, edit.fromColumn),
          to: handle.offset(edit.toLine, edit.toColumn),
          text: edit.text,
        }))
        .sort((left, right) => right.from - left.from);
      for (const range of ranges) handle.range(range.from, range.to, range.text);
    }
  } catch (error) {
    return {
      ok: false,
      url: location.href,
      editorKind: handle.kind,
      verificationLevel: verification,
      contentHash: currentHash,
      error: `${
        error instanceof Error ? error.message : String(error)
      } — the editor rejected the change; read the document again and retry.`,
    };
  }

  const updated = handle.read();
  const verified = updated === expected;
  const result: PageEditorResult = {
    ok: true,
    url: location.href,
    editorKind: handle.kind,
    verificationLevel: verification,
    contentLength: updated.length,
    contentLines: lineCountOf(updated),
    contentHash: hashOf(updated),
    previousHash: currentHash,
    changed: updated !== current,
    verified,
    ...warningSuffix,
  };
  if (!verified) {
    result.ok = false;
    result.error =
      "The re-read content differs from the expected document: the change may have been reformatted or rejected.";
  }
  return result;
}
