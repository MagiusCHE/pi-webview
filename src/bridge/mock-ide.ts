// IDE simulation for testing the IDE bridge protocol without a real IDE
// (plan 0001, --mock-ide flag). Deterministic and fake responses.

import type { Frame, IdeEvent, IdeRequest, IdeResponse } from "../ide/protocol.ts";

export type MockSend = (frame: Frame) => void;

export interface MockIde {
  handle(req: IdeRequest, send: MockSend): void;
}

export function createMockIde(log: (msg: string) => void): MockIde {
  const respond = (send: MockSend, req: IdeRequest, data?: unknown, error?: string) => {
    if (!req.id) return;
    const res: IdeResponse = error
      ? { id: req.id, ok: false, error }
      : { id: req.id, ok: true, data };
    send({ channel: "ide", payload: res });
  };

  return {
    handle(req, send) {
      switch (req.type) {
        case "attachSelection": {
          const evt: IdeEvent = {
            type: "selection_changed",
            filePath: "/mock/project/src/app.ts",
            workspaceFolder: "/mock/project",
            ranges: [
              {
                text: "const x = 1;",
                selection: {
                  start: { line: 3, character: 0 },
                  end: { line: 3, character: 12 },
                },
              },
            ],
          };
          log("[mock-ide] attachSelection → selection_changed finto");
          send({ channel: "ide", payload: evt });
          respond(send, req);
          break;
        }
        case "openFile":
          log(`[mock-ide] openFile ${req.path} (no-op)`);
          respond(send, req);
          break;
        case "showQuickPick":
          log(`[mock-ide] showQuickPick "${req.title ?? ""}" → primo item`);
          respond(send, req, req.items[0]);
          break;
        case "showInputBox":
          log(`[mock-ide] showInputBox "${req.title ?? ""}" → testo mock`);
          respond(send, req, "testo mock da mock-ide");
          break;
        case "showMessage":
          log(`[mock-ide] showMessage [${req.kind ?? "info"}] ${req.message}`);
          respond(send, req);
          break;
        case "clipboardWrite":
          log(`[mock-ide] clipboardWrite (${req.text.length} caratteri)`);
          respond(send, req);
          break;
        case "workspaceInfo":
          log("[mock-ide] workspaceInfo → cartella finta");
          respond(send, req, { folders: ["/mock/project"], name: "mock-project" });
          break;
        default:
          respond(
            send,
            req,
            undefined,
            `mock-ide: richiesta non supportata: ${(req as IdeRequest).type}`,
          );
      }
    },
  };
}
