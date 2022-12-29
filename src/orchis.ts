import * as idl from "./idl.js";

function parseInt10(n: string): number {
  return Number.parseInt(n, 10);
}

type OcsValue = string | number | Uint8Array | OcsSection;
type OcsSection = { [K in string]?: OcsValue };

function ocsIsSection(value: OcsValue): value is OcsSection {
  return typeof value === "object" && !(value instanceof Uint8Array);
}

function parseOcs(text: string): OcsSection {
  const data: OcsSection = {};

  let section: OcsSection | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    let m;
    if ((m = line.match(/^\[([^\]]+)\]$/))) {
      // [Section]
      const keys = m[1].split("\\");
      const last = keys.pop()!;

      let parent = data;
      for (const key of keys) {
        const next = parent[key];
        if (next && ocsIsSection(next)) {
          parent = next;
        } else {
          parent = parent[key] = {};
        }
      }

      parent[last] = section = {};
    } else if ((m = line.match(/^([^=]+)=([a-z]{2}):(.*)$/))) {
      // Key=Type:Value
      const [, key, type, value] = m;
      if (section === undefined) {
        console.log("セクション前に値がある");
        continue;
      }

      let parsed;
      switch (type) {
        case "dw":
          parsed = parseInt10(value);
          break;
        case "ws":
          parsed = String.fromCharCode(...value.split(",").map(parseInt10));
          break;
        case "bn":
          parsed = Uint8Array.from(value.split(",").map(parseInt10));
          break;
        default:
          console.log(`不明な型：${type}`);
          continue;
      }

      section[key] = parsed;
    } else {
      console.log(`不正な行：${line}`);
    }
  }

  return data;
}

export class OcsError extends Error {
  constructor(message?: string) {
    super(message ?? "設定ファイルが異常です");
  }
}

export class Ocs {
  static parse(text: string): Ocs {
    // [Launchers]
    // LauncherCount=dw:1
    // [Launchers\1]
    // Title=ws:...
    // [Launchers\1\Menu]
    // Items=dw:1
    // [Launchers\1\Menu\0]
    // Type=dw:...
    // Caption=ws:...
    // ItemID=bn:...
    // Items=dw:...
    // [Launchers\1\Menu\0\0]
    // ...
    function parseRoot(root: OcsSection): Ocs {
      const launchers = root["Launchers"];
      if (!(launchers && ocsIsSection(launchers))) {
        console.log("Launchersが不正");
        throw new OcsError();
      }

      const launcherCount = launchers["LauncherCount"];
      if (!(typeof launcherCount === "number")) {
        console.log("LauncherCountが不正");
        throw new OcsError();
      }

      const ocsLaunchers = [];
      for (let i = 1; i <= launcherCount; i++) {
        const launcher = launchers[i.toString()];
        if (!(launcher && ocsIsSection(launcher))) {
          console.log("Launcher要素が不正");
          throw new OcsError();
        }

        ocsLaunchers.push(parseLauncher(launcher));
      }

      return new Ocs(ocsLaunchers);
    }
    function parseLauncher(launcher: OcsSection): OcsLauncher {
      const title = launcher["Title"];
      const menu = launcher["Menu"];
      if (!(typeof title === "string" && menu !== undefined && ocsIsSection(menu))) {
        console.log("設定ファイルが異常です");
        throw new OcsError();
      }

      const ocsItems = parseMenu(menu);
      return new OcsLauncher(title, ocsItems);
    }
    function parseMenu(menu: OcsSection): OcsItem[] {
      const items = menu["Items"];
      if (!(typeof items === "number")) {
        console.log("Menuが不正");
        throw new OcsError();
      }

      const ocsItems = [];
      for (let i = 0; i < items; i++) {
        const item = menu[i.toString()];
        if (!(item && ocsIsSection(item))) {
          console.log("Menu要素が不正");
          throw new OcsError();
        }

        ocsItems.push(parseItem(item));
      }

      return ocsItems;
    }
    function parseItem(item: OcsSection): OcsItem {
      switch (item["Type"]) {
        case 0: {
          const itemID = item["ItemID"];
          const caption = item["Caption"];
          if (!(itemID instanceof Uint8Array && typeof caption === "string")) {
            console.log("起動項目が不正");
            throw new OcsError();
          }

          const parameter = item["Parameter"];
          if (!(parameter === undefined || typeof parameter === "string")) {
            console.log("起動項目が不正");
            throw new OcsError();
          }

          const verb = item["Verb"];
          if (!(verb === undefined || typeof verb === "string")) {
            console.log("起動項目が不正");
            throw new OcsError();
          }

          const showCmd = item["ShowCmd"];
          if (!(typeof showCmd === "number")) {
            console.log("起動項目が不正");
            throw new OcsError();
          }

          return new OcsItemLaunch(itemID, caption, parameter, verb, showCmd);
        }

        case 1: {
          const itemID = item["ItemID"];
          const caption = item["Caption"];
          if (!(itemID instanceof Uint8Array && typeof caption === "string")) {
            console.log("フォルダー項目が不正");
            throw new OcsError();
          }

          return new OcsItemFolder(itemID, caption);
        }

        case 2: {
          return new OcsItemSeparator();
        }

        case 3: {
          const caption = item["Caption"];
          const items = item["Items"];
          if (!(typeof caption === "string" && typeof items === "number")) {
            console.log("サブメニュー項目が不正");
            throw new OcsError();
          }

          const ocsItems = [];
          for (let i = 0; i < items; i++) {
            const subitem = item[i.toString()];
            if (!(subitem && ocsIsSection(subitem))) {
              console.log("サブメニュー要素が不正");
              throw new OcsError();
            }

            ocsItems.push(parseItem(subitem));
          }

          return new OcsItemSubmenu(caption, ocsItems);
        }

        case 4: {
          const id = item["ID"];
          const caption = item["Caption"];
          if (!(typeof id === "number" && typeof caption === "string")) {
            console.log("特殊項目が不正");
            throw new OcsError();
          }

          return new OcsItemSpecial(id, caption);
        }

        default: {
          return new OcsItemUnknown();
        }
      }
    }

    const root = parseOcs(text);
    if (Object.keys(root).length === 0) {
      console.log("ファイルが空");
      throw new OcsError();
    }
    return parseRoot(root);
  }

  constructor(public launchers: OcsLauncher[]) {}
}

export class OcsLauncher {
  constructor(public title: string, public items: OcsItem[]) {}
}

export type OcsItem = OcsItemLaunch | OcsItemFolder | OcsItemSeparator | OcsItemSubmenu | OcsItemSpecial | OcsItemUnknown;

export class OcsItemLaunch {
  static #SHOW_CMD = ["通常のウィンドウ", "最小化", "最大化"];
  #displayName?: string;

  constructor(
    public itemID: Uint8Array,
    public caption: string,
    public parameter: string | undefined,
    public verb: string | undefined,
    public showCmd: number,
  ) {}

  displayName(): string {
    return this.#displayName ??= idl.getPathFromItemID(this.itemID);
  }

  verbString(): string {
    switch (this.verb) {
      case undefined:
      case "open":
        return "開く";

      case "runas":
        return "管理者として実行";

      default:
        return this.verb;
    }
  }

  showCmdString(): string | undefined {
    return this.showCmd !== undefined && this.showCmd >= 1 && this.showCmd <= OcsItemLaunch.#SHOW_CMD.length
      ? OcsItemLaunch.#SHOW_CMD[this.showCmd - 1]
      : undefined;
  }
}

export class OcsItemFolder {
  #displayName?: string;

  constructor(public itemID: Uint8Array, public caption: string) {}

  displayName(): string {
    return this.#displayName ??= idl.getPathFromItemID(this.itemID);
  }
}

export class OcsItemSeparator {
  constructor() {}
}

export class OcsItemSubmenu {
  constructor(public caption: string, public items: OcsItem[]) {}
}

export class OcsItemSpecial {
  static readonly #ITEMS: Record<number, string | undefined> = {
    144: "ファイル名を指定して実行",
    138: "検索",
    143: "ネットワークドライブの割り当て",
    142: "ネットワークドライブの切断",
    146: "ハードウェアの安全な取り外し",
    176: "フォルダオプション",
    133: "終了オプションダイアログ",
    181: "シャットダウン",
    183: "再起動",
    185: "スリープ",
    186: "休止状態",
    182: "サインアウト",
    270: "コンピュータのロック",
    161: "メールの作成",
    173: "ウェブサイトを開く",
    168: "複数項目を同時に実行させる",
    175: "ホットキーの実行",
  };
  constructor(public id: number, public caption: string) {}

  description(): string {
    return OcsItemSpecial.#ITEMS[this.id] ?? "不明な特殊項目";
  }
}

export class OcsItemUnknown {
  constructor() {}
}
