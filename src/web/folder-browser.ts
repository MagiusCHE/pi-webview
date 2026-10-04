import type { DirectoryListing } from "../ide/protocol.ts";
import { t } from "./i18n.ts";
import { folderIcon } from "./icons.ts";

// Folder navigation and typed paths share the bridge's native filesystem lookup.
export function openFolderBrowser(
  start: string,
  listDirs: (path: string) => Promise<DirectoryListing | null>,
): Promise<string | null> {
  return new Promise((resolve) => {
    let request = 0;
    let closed = false;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const card = document.createElement("div");
    card.className = "modal folder-modal";
    const head = document.createElement("div");
    head.className = "modal-head";
    const title = document.createElement("span");
    title.className = "modal-title";
    title.textContent = t("chooseFolder");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "icon-btn";
    close.textContent = "✕";
    close.title = t("cancel");
    head.append(title, close);
    const pathLabel = document.createElement("label");
    pathLabel.className = "folder-path-label";
    pathLabel.htmlFor = "folder-path-input";
    pathLabel.textContent = t("folderPath");
    const pathRow = document.createElement("div");
    pathRow.className = "folder-path-row";
    const pathInput = document.createElement("input");
    pathInput.id = "folder-path-input";
    pathInput.type = "text";
    pathInput.className = "modal-input folder-path";
    pathInput.value = start;
    pathInput.autocomplete = "off";
    pathInput.spellcheck = false;
    pathInput.setAttribute("autocapitalize", "off");
    pathInput.setAttribute("aria-describedby", "folder-path-error");
    const goBtn = document.createElement("button");
    goBtn.type = "button";
    goBtn.className = "btn";
    goBtn.textContent = t("goToFolder");
    pathRow.append(pathInput, goBtn);
    const errorEl = document.createElement("div");
    errorEl.id = "folder-path-error";
    errorEl.className = "folder-error";
    errorEl.setAttribute("role", "alert");
    errorEl.hidden = true;
    const dirsEl = document.createElement("div");
    dirsEl.className = "folder-dirs";
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "btn primary";
    selectBtn.textContent = t("select");
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn";
    cancelBtn.textContent = t("cancel");
    actions.append(selectBtn, cancelBtn);
    card.append(head, pathLabel, pathRow, errorEl, dirsEl, actions);
    backdrop.appendChild(card);

    const done = (value: string | null): void => {
      if (closed) return;
      closed = true;
      request++;
      backdrop.remove();
      document.removeEventListener("keydown", esc);
      resolve(value);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") done(null);
    };
    document.addEventListener("keydown", esc);

    function showError(key: string | null): void {
      errorEl.textContent = key ? t(key) : "";
      errorEl.hidden = !key;
      pathInput.setAttribute("aria-invalid", String(!!key));
    }

    function setLoading(loading: boolean): void {
      const disabled = loading || !pathInput.value.trim();
      selectBtn.disabled = disabled;
      goBtn.disabled = disabled;
      dirsEl.setAttribute("aria-busy", String(loading));
    }

    function addFolder(name: string, path: string, parent = false): void {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = parent ? "folder-dir folder-up" : "folder-dir";
      btn.innerHTML = folderIcon();
      const label = document.createElement("span");
      label.textContent = name;
      btn.appendChild(label);
      btn.addEventListener("click", () => void load(path));
      dirsEl.appendChild(btn);
    }

    async function load(path: string, select = false): Promise<void> {
      if (closed) return;
      const pending = ++request;
      pathInput.value = path;
      showError(null);
      dirsEl.textContent = "";
      if (!path.trim()) {
        setLoading(false);
        showError("folderPathRequired");
        return;
      }
      setLoading(true);
      const placeholder = document.createElement("div");
      placeholder.className = "folder-dirs-empty";
      placeholder.textContent = t("loading");
      dirsEl.appendChild(placeholder);
      let listing: DirectoryListing | null;
      try {
        listing = await listDirs(path);
      } catch {
        listing = null;
      }
      // A late lookup must never overwrite edits or accept a superseded path.
      if (closed || pending !== request) return;
      setLoading(false);
      dirsEl.textContent = "";
      if (!listing) {
        showError("folderUnavailable");
        pathInput.focus();
        return;
      }
      pathInput.value = listing.path;
      if (select) {
        done(listing.path);
        return;
      }
      if (listing.parent) {
        addFolder(`.. (${t("parentFolder")})`, listing.parent, true);
      }
      if (listing.dirs.length === 0) {
        const empty = document.createElement("div");
        empty.className = "folder-dirs-empty";
        empty.textContent = "—";
        dirsEl.appendChild(empty);
      }
      for (const dir of listing.dirs) addFolder(dir.name, dir.path);
    }

    pathInput.addEventListener("input", () => {
      request++;
      showError(null);
      dirsEl.textContent = "";
      setLoading(false);
    });
    pathInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void load(pathInput.value);
      }
    });
    goBtn.addEventListener("click", () => void load(pathInput.value));
    selectBtn.addEventListener("click", () => void load(pathInput.value, true));
    cancelBtn.addEventListener("click", () => done(null));
    close.addEventListener("click", () => done(null));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) done(null);
    });

    document.body.appendChild(backdrop);
    pathInput.focus();
    pathInput.select();
    void load(start);
  });
}
