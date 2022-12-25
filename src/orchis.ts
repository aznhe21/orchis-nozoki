import {
  CLSID,
  CLSIDString,
  CLSID_ControlPanel,
  CLSID_MyComputer,
  CLSID_NetworkExplorerFolder,
  CLSID_Printers,
  CLSID_RecycleBin,
  FOLDERID_Favorites,
  Known_CLSID_ControlPanel,
  Known_CLSID_HomeGroup,
  Known_CLSID_UsersFiles,
  Known_CLSID_UsersLibraries,
} from "./clsid.js";

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

export class OcsError extends Error {}

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
        throw new OcsError("Launchersが不正");
      }

      const launcherCount = launchers["LauncherCount"];
      if (typeof launcherCount !== "number") {
        throw new OcsError("LauncherCountが不正");
      }

      const ocsLaunchers = [];
      for (let i = 1; i <= launcherCount; i++) {
        const launcher = launchers[i.toString()];
        if (!(launcher && ocsIsSection(launcher))) {
          throw new OcsError("Launcher要素が不正");
        }

        ocsLaunchers.push(parseLauncher(launcher));
      }

      return new Ocs(ocsLaunchers);
    }
    function parseLauncher(launcher: OcsSection): OcsLauncher {
      const title = launcher["Title"];
      const menu = launcher["Menu"];
      if (!(typeof title === "string" && menu !== undefined && ocsIsSection(menu))) {
        throw new OcsError("Launcherが不正");
      }

      const ocsItems = parseMenu(menu);
      return new OcsLauncher(title, ocsItems);
    }
    function parseMenu(menu: OcsSection): OcsItem[] {
      const items = menu["Items"];
      if (typeof items !== "number") {
        throw new OcsError("Menuが不正");
      }

      const ocsItems = [];
      for (let i = 0; i < items; i++) {
        const item = menu[i.toString()];
        if (!(item && ocsIsSection(item))) {
          throw new OcsError("Menu要素が不正");
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
            throw new OcsError("起動項目が不正");
          }

          return new OcsItemLaunch(itemID, caption);
        }

        case 1: {
          const itemID = item["ItemID"];
          const caption = item["Caption"];
          if (!(itemID instanceof Uint8Array && typeof caption === "string")) {
            throw new OcsError("フォルダー項目が不正");
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
            throw new OcsError("サブメニュー項目が不正");
          }

          const ocsItems = [];
          for (let i = 0; i < items; i++) {
            const subitem = item[i.toString()];
            if (!(subitem && ocsIsSection(subitem))) {
              throw new OcsError("サブメニュー要素が不正");
            }

            ocsItems.push(parseItem(subitem));
          }

          return new OcsItemSubmenu(caption, ocsItems);
        }

        case 4: {
          const id = item["ID"];
          const caption = item["Caption"];
          if (!(typeof id === "number" && typeof caption === "string")) {
            throw new OcsError("特殊項目が不正");
          }

          return new OcsItemSpecial(id, caption);
        }

        default: {
          return new OcsItemUnknown();
        }
      }
    }

    const root = parseOcs(text);
    return parseRoot(root);
  }

  constructor(public launchers: OcsLauncher[]) {}
}

export class OcsLauncher {
  constructor(public title: string, public items: OcsItem[]) {}
}

export type OcsItem = OcsItemLaunch | OcsItemFolder | OcsItemSeparator | OcsItemSubmenu | OcsItemSpecial | OcsItemUnknown;

export class OcsItemLaunch {
  #itemCache?: Item;

  constructor(public itemID: Uint8Array, public caption: string) {}

  item(): Item {
    return this.#itemCache ??= Item.parse(this.itemID);
  }
}

export class OcsItemFolder {
  #itemCache?: Item;

  constructor(public itemID: Uint8Array, public caption: string) {}

  item(): Item {
    return this.#itemCache ??= Item.parse(this.itemID);
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

export class OrchisError extends Error {}

function readItemComponents(itemID: Uint8Array): Array<Uint8Array> {
  const components = [];
  while (true) {
    if (itemID.length < 2) {
      throw new OrchisError("パスの要素数が足りません");
    }

    const len = itemID[0] | (itemID[1] << 8);
    if (len === 0) {
      break;
    }

    components.push(itemID.subarray(2, len));
    itemID = itemID.subarray(len);
  }
  return components;
}

function parseNameComponent(cur: Uint8Array): string {
  const isComponent = (cur[0] & 0b00110000) === 0b00110000;
  // よく分からないけどこのフラグが立ってたら間のデータが長い
  const isNazoLong = (cur[0] & 0b01000000) === 0b01000000;
  // 0: ?, 1: dir, 2: file, 3: ?
  const type = cur[0] & 0b00000011;
  // 8.3形式の代わりにUnicodeの短い名前
  const isUnicodeShort = !isNazoLong && (cur[0] & 0b00000100) !== 0;
  // const isSpecial = (cur[0] & 0b10000000) != 0;
  if (!isComponent) {
    throw new OrchisError(`不明なパスコンポーネント：${cur[0].toString(16)}`);
  }
  let i = isNazoLong ? 22 : 12;
  if (isUnicodeShort) {
    let max = Infinity;
    switch (type) {
      case 1:
        // よく分からないけどディレクトリの場合最大でも6文字
        max = 6 * 2;
        break;
      case 2:
        // よく分からないけどディレクトリの場合最大でも10文字
        max = 10 * 2;
        break;
    }

    // skip unicode short
    let n = 0;
    while (n < max && i + n < cur.length && (cur[i + n + 0] !== 0x00 || cur[i + n + 1] !== 0x00)) {
      n += 2;
    }
    if (n < max) {
      n += 2;
    }

    i += n;
    if (i >= cur.length) {
      throw new OrchisError("オーバーラン：UnicodeShort");
    }
  } else {
    // skip 8.3
    while (i < cur.length && cur[i] !== 0x00) {
      i++;
    }
    if (i >= cur.length) {
      throw new OrchisError("オーバーラン：8.3");
    }

    i++;
    if ((i - 12) % 2 === 1) {
      // 文字数は偶数
      if (cur[i] !== 0x00) {
        console.error("思ってたんと違う：8.3");
      }
      i++;
    }
  }
  if (isNazoLong) {
    i += 34;
  }
  // 大体0x2eや0x2aだけどそれ以外の場合もある
  i += cur[i + 16];

  let name = "";
  while (i < cur.length && (cur[i + 0] !== 0x00 || cur[i + 1] !== 0x00)) {
    name += String.fromCharCode(cur[i + 0] | (cur[i + 1] << 8));
    i += 2;
  }

  return name;
}

type Registry = Record<CLSIDString, string | undefined>;

export abstract class Item {
  static parse(itemID: Uint8Array): Item {
    const components = readItemComponents(itemID);
    if (components.length === 0) {
      return new DesktopItem();
    }

    if (components[0][0] !== 0x1f) {
      throw new OrchisError(`不明なコンポーネント：${components[0][0].toString(16)}`);
    }

    const rootID = new CLSID(components[0].subarray(2, 18));
    if (components.length === 1) {
      return new RootItem(rootID);
    }

    if (rootID.equals(CLSID_MyComputer)) {
      switch (components[1][0]) {
        case 0x2e:
          const secondID = new CLSID(components[1].subarray(2, 18));
          const clsids = [
            secondID,
            ...components.slice(2).map((c) => {
              if (c[0] !== 0x71) {
                throw new OrchisError(`不明なCLSIDコンポーネント：${c[0].toString(16)}`);
              }
              return new CLSID(c.subarray(12, 28));
            }),
          ];
          return new SpecialFolderItem(clsids);

        case 0x2f:
          let drive = "";
          for (let i = 1; i < components[1].length && components[1][i] !== 0x00; i++) {
            drive += String.fromCharCode(components[1][i]);
          }
          if (drive[drive.length - 1] === "\\") {
            drive = drive.slice(0, -1);
          }

          return new PathItem([drive, ...components.slice(2).map(parseNameComponent)]);
      }
      throw new OrchisError(`不明なPCコンポーネント：${components[1][0].toString(16)}`);
    }

    if (rootID.equals(Known_CLSID_UsersFiles)) {
      if (components[0].length === 18) {
        // どう言う構造か謎だが、この場合は%USERPROFILE%に続くパスが続いてるっぽい
        return new PathItem(["%USERPROFILE%", ...components.slice(1).map(parseNameComponent)]);
      }

      if (components.length > 2) {
        throw new OrchisError(`ユーザーファイルコンポーネントが過多：${components.length}`);
      }

      return new UsersFilesItem(new CLSID(components[1].subarray(12, 28)));
    }

    if (rootID.equals(CLSID_NetworkExplorerFolder)) {
      if (components.length < 3) {
        throw new OrchisError(`ネットワークコンポーネントが過小：${components.length}`);
      }
      const part = components[2].subarray(3);
      const nul = part.findIndex((n) => n === 0);
      const folder = String.fromCharCode(...part.subarray(0, nul));
      return new NetworkItem(folder, components.slice(3).map(parseNameComponent));
    }

    if (rootID.equals(Known_CLSID_UsersLibraries)) {
      if (components.length > 2) {
        throw new OrchisError(`ライブラリコンポーネントが過多：${components.length}`);
      }

      const secondID = new CLSID(components[1].subarray(12, 28));
      return new LibraryItem(secondID);
    }

    if (rootID.equals(CLSID_ControlPanel)) {
      if (components.length > 2) {
        throw new OrchisError(`コンパネコンポーネントが過多：${components.length}`);
      }

      const secondID = new CLSID(components[1].subarray(12, 28));
      return new ControlPanelItem(secondID);
    }

    if (rootID.equals(Known_CLSID_ControlPanel)) {
      if (components.length > 2) {
        throw new OrchisError(`コンパネコンポーネントが過多：${components.length}`);
      }
      return new ControlPanelItem();
    }

    throw new OrchisError("不明な項目");
  }

  abstract toString(): string;
}

export class DesktopItem extends Item {
  toString(): string {
    return "デスクトップ";
  }
}

export class PathItem extends Item {
  readonly #components: string[];

  constructor(components: string[]) {
    super();
    this.#components = components;
  }

  get components(): ReadonlyArray<string> {
    return this.#components;
  }

  toString(): string {
    if (this.#components.length === 1) {
      return `${this.#components[0]}\\`; // C:\
    }
    return this.#components.join("\\");
  }
}

export class NetworkItem extends Item {
  readonly #folder: string;
  readonly #components: string[];

  constructor(folder: string, components: string[]) {
    super();
    this.#folder = folder;
    this.#components = components;
  }

  toString(): string {
    return [this.#folder, ...this.#components].join("\\");
  }
}

export class MyComputerItem extends Item {
  toString(): string {
    return "PC（マイコンピュータ）";
  }
}

// CLSID単体のやつ
export class RootItem extends Item {
  static readonly #REGISTRY: Registry = {
    [CLSID_MyComputer.toString()]: "PC（マイコンピュータ）",
    [CLSID_RecycleBin.toString()]: "ごみ箱",
    [CLSID_NetworkExplorerFolder.toString()]: "ネットワーク",
    [Known_CLSID_UsersLibraries.toString()]: "ライブラリ",
    [Known_CLSID_HomeGroup.toString()]: "ホームグループ",
  };

  readonly #clsid: CLSID;

  constructor(clsid: CLSID) {
    super();
    this.#clsid = clsid;
  }

  toString(): string {
    return RootItem.#REGISTRY[this.#clsid.toString()] ?? "不明";
  }
}

export class SpecialFolderItem extends Item {
  static readonly #REGISTRY: Registry = {
    "{0DB7E03F-FC29-4DC6-9020-FF41B59E513A}": "3Dオブジェクト",
    "{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}": "デスクトップ",
    "{088E3905-0323-4B02-9826-5D99428E115F}": "ダウンロード",
    "{374DE290-123F-4565-9164-39C4925E467B}": "ダウンロード",
    "{A8CDFF1C-4878-43BE-B5FD-F8091C1C60D0}": "ドキュメント",
    "{D3162B92-9365-467A-956B-92703ACA08AF}": "ドキュメント",
    "{24AD3AD4-A569-4530-98E1-AB02F9417AA8}": "ピクチャ",
    "{3ADD1653-EB32-4CB0-BBD7-DFA0ABB5ACCA}": "ピクチャ",
    "{A0953C92-50DC-43BF-BE83-3742FED03C9C}": "ビデオ",
    "{F86FA3AB-70D2-4FC7-9C99-FCBF05467F3A}": "ビデオ",
    "{1CF1260C-4DD0-4EBB-811F-33C572699FDE}": "ミュージック",
    "{3DFDF296-DBEC-4FB4-81D1-6A3438BCF4DE}": "ミュージック",
  };
  readonly #clsids: CLSID[];

  constructor(clsids: CLSID[]) {
    super();
    this.#clsids = clsids;
  }

  toString(): string {
    return (
      (this.#clsids.length === 1 && SpecialFolderItem.#REGISTRY[this.#clsids[0].toString()]) ||
      this.#clsids.map((c) => `::${c.toString()}`).join("\\")
    );
  }
}

// {59031A47-3F72-44A7-89C5-5595FE6B30EE}以下
export class UsersFilesItem extends Item {
  static readonly #REGISTRY: Registry = {
    [FOLDERID_Favorites.toString()]: "お気に入り",
    // フォーマッタによる一行化阻止
  };

  readonly #clsid: CLSID;

  constructor(clsid: CLSID) {
    super();
    this.#clsid = clsid;
  }

  toString(): string {
    return UsersFilesItem.#REGISTRY[this.#clsid.toString()] ?? "不明なユーザーファイル項目";
  }
}

// {031E4825-7B94-4DC3-B131-E946B44C8DD5}以下
export class LibraryItem extends Item {
  static readonly #REGISTRY: Registry = {
    "{7B0DB17D-9CD2-4A93-9733-46CC89022E7C}": "ドキュメント",
    "{2112AB0A-C86A-4FFE-A368-0DE96E47012E}": "ミュージック",
    "{A990AE9F-A03B-4E80-94BC-9912D7504104}": "ピクチャ",
    "{491E922F-5643-4AF4-A7EB-4E7A138D8174}": "ビデオ",
  };

  readonly #clsid: CLSID;

  constructor(clsid: CLSID) {
    super();
    this.#clsid = clsid;
  }

  toString(): string {
    return LibraryItem.#REGISTRY[this.#clsid.toString()] ?? "不明なライブラリ項目";
  }
}

export class ControlPanelItem extends Item {
  static readonly #REGISTRY: Registry = {
    [CLSID_Printers.toString()]: "プリンタ",
    // フォーマッタによる一行化阻止
  };

  readonly #clsid?: CLSID;

  constructor(clsid?: CLSID) {
    super();
    this.#clsid = clsid;
  }

  toString(): string {
    if (this.#clsid === undefined) {
      return "コントロールパネル";
    }
    return ControlPanelItem.#REGISTRY[this.#clsid.toString()] ?? "不明なコントロールパネル項目";
  }
}
