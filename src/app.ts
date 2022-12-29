import * as Orchis from "./orchis.js";

window.addEventListener("DOMContentLoaded", () => {
  (window as { app?: App }).app = new App();
});

function clearChildren(parent: HTMLElement): void {
  while (parent.firstChild) {
    parent.firstChild.remove();
  }
}

class App {
  #eFileDialog: HTMLDialogElement;
  #eFileInput: HTMLInputElement;

  #eLauncherSelect: HTMLSelectElement;
  #eLauncher: HTMLDivElement;
  #eInfo: HTMLDivElement;

  #ocs?: Orchis.Ocs;
  #items: Orchis.OcsItem[] = [];

  debug = false;

  constructor() {
    this.#eFileDialog = document.getElementById("file-dialog")! as HTMLDialogElement;
    this.#eFileInput = document.createElement("input")!;
    this.#eFileInput.type = "file";
    this.#eFileInput.accept = ".ocs";

    let closeTimer: number | undefined;
    document.body.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types.includes("Files")) {
        if (!this.#eFileDialog.open) {
          this.#eFileDialog.show();
        }
        if (closeTimer) {
          clearTimeout(closeTimer);
          closeTimer = undefined;
        }

        e.dataTransfer.dropEffect = "copy";
        e.preventDefault();
      }
    });
    document.body.addEventListener("dragleave", () => {
      // ファイルを開く前ではダイアログを閉じない
      if (this.#ocs) {
        if (!closeTimer) {
          clearTimeout(closeTimer);
        }
        closeTimer = setTimeout(() => this.#eFileDialog.close(), 100);
      }
    });
    document.body.addEventListener("drop", async (e) => {
      e.preventDefault();
      if (e.dataTransfer?.files.length === 1) {
        this.processText(await e.dataTransfer.files[0].text());
      }

      if (this.#ocs !== undefined) {
        // ファイルが開かれたか、あるいは既に開かれていた場合はダイアログを閉じる
        this.#eFileDialog.close();
      }
    });

    for (const area of document.querySelectorAll<HTMLElement>(".file-area")) {
      area.addEventListener("click", (e) => {
        if (e.button === 0) {
          this.#eFileInput.click();
        }
      });
    }
    this.#eFileInput.addEventListener("input", async () => {
      if (this.#eFileInput.files?.length === 1) {
        this.processText(await this.#eFileInput.files[0].text());

        // ファイルが開かれた場合はダイアログを閉じる
        if (this.#ocs !== undefined) {
          this.#eFileDialog.close();
        }
      }
    });

    this.#eLauncherSelect = document.getElementById("launcher-select")! as HTMLSelectElement;
    this.#eLauncher = document.getElementById("launcher")! as HTMLDivElement;
    this.#eInfo = document.getElementById("info")! as HTMLDivElement;

    this.#eLauncherSelect.addEventListener("input", () => {
      const launcher = this.#ocs?.launchers?.[this.#eLauncherSelect.selectedIndex];
      if (launcher) {
        this.#processLauncher(launcher);
      }
    });
    this.#eLauncher.addEventListener("mouseover", (e) => {
      if (this.#eLauncher.querySelector(".item.locked")) {
        return;
      }

      const eItem = (e.target as HTMLElement | null)?.closest<HTMLElement>(".item");
      if (!eItem?.dataset.index) {
        return;
      }

      const index = Number.parseInt(eItem.dataset.index, 10);
      const item = this.#items[index];
      if (!item) {
        return;
      }

      this.#selectItem(eItem, item);
    });
    this.#eLauncher.addEventListener("click", (e) => {
      const eItem = (e.target as HTMLElement | null)?.closest<HTMLElement>(".item");
      if (!eItem?.dataset.index) {
        return;
      }

      const index = Number.parseInt(eItem.dataset.index, 10);
      const item = this.#items[index];
      if (!item) {
        return;
      }

      // 既に選択されている項目と同じ項目をクリックした場合に選択方法を切り替える
      let doLock = false;
      const currentSelected = this.#eLauncher.querySelector<HTMLElement>(".selected");
      if (currentSelected?.dataset.index) {
        const currentIndex = Number.parseInt(currentSelected.dataset.index);

        doLock = currentIndex !== index || !currentSelected.classList.contains("locked");
        currentSelected.classList.remove("locked");
      }

      if (this.#selectItem(eItem, item) && doLock) {
        eItem.classList.add("locked");
      }
    });
  }

  processText(text: string): void {
    try {
      this.#ocs = Orchis.Ocs.parse(text);
    } catch (e) {
      if (!(e instanceof Orchis.OcsError)) {
        throw e;
      }
      alert(e.message);
      return;
    }

    this.#items = [];
    clearChildren(this.#eLauncherSelect);
    clearChildren(this.#eLauncher);
    clearChildren(this.#eInfo);
    this.#eLauncher.scrollTop = 0;
    document.body.classList.add("loaded");

    for (let i = 0; i < this.#ocs.launchers.length; i++) {
      const launcher = this.#ocs.launchers[i];
      this.#eLauncherSelect.append(this.#createLauncherOption(i, launcher));
    }
    if (this.#ocs.launchers.length > 0) {
      this.#processLauncher(this.#ocs.launchers[0]);
    }
  }

  #processLauncher(launcher: Orchis.OcsLauncher): void {
    clearChildren(this.#eLauncher);
    for (const item of launcher.items) {
      this.#eLauncher.append(this.#createItem(item));
    }
  }

  #selectItem(eItem: HTMLElement, item: Orchis.OcsItem): boolean {
    const eInfo = this.#createInfo(item);
    if (!eInfo) {
      return false;
    }

    this.#eLauncher.querySelector(".item.selected")?.classList.remove("selected");
    eItem.classList.add("selected");

    clearChildren(this.#eInfo);
    this.#eInfo.append(eInfo);
    return true;
  }

  #createLauncherOption(index: number, launcher: Orchis.OcsLauncher): HTMLElement {
    const eOption = document.createElement("option");
    eOption.value = index.toString();
    eOption.textContent = launcher.title;
    return eOption;
  }

  #createItem(item: Orchis.OcsItem): HTMLElement {
    const index = this.#items.length;
    this.#items.push(item);

    const eItem = document.createElement("div");
    eItem.classList.add("item");
    eItem.dataset.index = index.toString();

    const addCaption = (caption: string) => {
      const eCaption = document.createElement("div");
      eCaption.classList.add("caption");
      eCaption.textContent = caption;
      eItem.append(eCaption);
    };

    if (item instanceof Orchis.OcsItemSubmenu) {
      addCaption(item.caption);

      const eChildren = document.createElement("div");
      eChildren.classList.add("children");

      for (const subitem of item.items) {
        eChildren.append(this.#createItem(subitem));
      }
      eItem.append(eChildren);
    } else if (item instanceof Orchis.OcsItemSeparator) {
      eItem.classList.add("separator");
    } else if (item instanceof Orchis.OcsItemFolder || item instanceof Orchis.OcsItemLaunch || item instanceof Orchis.OcsItemSpecial) {
      addCaption(item.caption);
    } else if (item instanceof Orchis.OcsItemUnknown) {
      eItem.classList.add("unknown");
      addCaption("未対応項目");
    } else {
      throw new Error("unreachable");
    }

    return eItem;
  }

  #createInfo(item: Orchis.OcsItem): HTMLElement | undefined {
    function toBin(arr: Uint8Array): string {
      return Array.from(arr, (n) => n.toString(16).padStart(2, "0").slice(-2)).join(" ");
    }

    const info = new Map<string, string>();
    if (item instanceof Orchis.OcsItemSubmenu) {
      info.set("項目名", item.caption);
      info.set("種類", "サブメニュー");
      info.set("項目数", item.items.length.toString());
    } else if (item instanceof Orchis.OcsItemFolder) {
      let path;
      try {
        path = item.displayName();
      } catch (e) {
        path = `エラー：${e instanceof Error ? e.message : String(e)}`;
      }

      info.set("項目名", item.caption);
      info.set("種類", "フォルダ項目");
      info.set("参照先", path);

      if (this.debug) {
        info.set("ItemID", toBin(item.itemID));
      }
    } else if (item instanceof Orchis.OcsItemLaunch) {
      let path;
      try {
        path = item.displayName();
      } catch (e) {
        path = `エラー：${e instanceof Error ? e.message : String(e)}`;
      }

      info.set("項目名", item.caption);
      info.set("種類", "起動項目");
      info.set("参照先", path);
      info.set("パラメータ", item.parameter ?? "（なし）");
      info.set("実行時の大きさ", item.showCmdString() ?? "不明");
      info.set("実行時の動作", item.verbString());

      if (this.debug) {
        info.set("ItemID", toBin(item.itemID));
      }
    } else if (item instanceof Orchis.OcsItemSpecial) {
      info.set("項目名", item.caption);
      info.set("種類", "特殊項目");
      info.set("内容", item.description());
    } else {
      return;
    }

    const eInfo = document.createElement("dl");
    for (const [k, v] of info.entries()) {
      const eTerm = document.createElement("dt");
      const eDetails = document.createElement("dd");

      eTerm.textContent = k;
      eDetails.textContent = v;
      eInfo.append(eTerm, eDetails);
    }
    return eInfo;
  }
}
