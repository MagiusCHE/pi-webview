interface ChromeRuntime {
  sendMessage(message: unknown): Promise<unknown>;
}

interface ChromeI18n {
  getMessage(name: string): string;
  getUILanguage(): string;
}

interface ChromeApi {
  runtime: ChromeRuntime;
  i18n: ChromeI18n;
}

declare const chrome: ChromeApi;

const allowButton = document.getElementById("allow") as HTMLButtonElement;
const cancelButton = document.getElementById("cancel") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLParagraphElement;
const ownerWindowId = (() => {
  const value = new URL(location.href).searchParams.get("ownerWindowId");
  const parsed = value === null ? undefined : Number(value);
  return Number.isInteger(parsed) && parsed !== undefined && parsed >= 0
    ? parsed
    : undefined;
})();

function message(key: string): string {
  return chrome.i18n.getMessage(key) || key;
}

function setStatus(
  key: string,
  state: "error" | "success" | "waiting" = "waiting",
): void {
  status.textContent = message(key);
  status.dataset.state = state;
}

function localizePage(): void {
  document.documentElement.lang = chrome.i18n.getUILanguage().split("-")[0] || "en";
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n;
    if (key) element.textContent = message(key);
  }
}

async function reportPermission(granted: boolean): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "microphone_permission_result",
    ownerWindowId,
    granted,
  });
}

async function requestMicrophone(): Promise<void> {
  allowButton.disabled = true;
  cancelButton.disabled = true;
  setStatus("microphonePermissionRequesting");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    await reportPermission(true);
    setStatus("microphonePermissionGranted", "success");
    window.setTimeout(() => window.close(), 600);
  } catch {
    await reportPermission(false).catch(() => undefined);
    setStatus("microphonePermissionDenied", "error");
    allowButton.disabled = false;
    cancelButton.disabled = false;
  }
}

localizePage();
allowButton.addEventListener("click", () => void requestMicrophone());
cancelButton.addEventListener("click", () => window.close());
