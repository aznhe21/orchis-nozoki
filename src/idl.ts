// 参考：https://github.com/wine-mirror/wine/tree/wine-7.22/dlls/shell32

import {
  CLSID,
  CLSID_ControlPanel,
  CLSID_MyComputer,
  CLSID_NetworkExplorerFolder,
  CLSID_Printers,
  CLSID_RecycleBin,
  CLSID_ShellDesktop,
  FOLDERID_Favorites,
  Known_CLSID_ControlPanel,
  Known_CLSID_UsersFiles,
  Known_CLSID_UsersLibraries,
} from "./clsid.js";

function readAsciiString(arr: Uint8Array): string {
  let text = "";
  for (let i = 0; i < arr.length && arr[i] !== 0; i++) {
    text += String.fromCharCode(arr[i]);
  }
  return text;
}

function readString(arr: Uint8Array): string {
  let text = "";
  for (let i = 0; i + 1 < arr.length && (arr[i + 0] !== 0 || arr[i + 1] !== 0); i += 2) {
    text += String.fromCharCode(arr[i + 0] | (arr[i + 1] << 8));
  }
  return text;
}

export class IdlError extends Error {}

export class ItemIDList {
  data: Uint8Array;
  cb: number;
  type: number;

  constructor(data: Uint8Array) {
    if (data.length < 2) {
      throw new IdlError("ItemIDListの要素数が足りません");
    }

    this.data = data;
    this.cb = this.data[0] | (this.data[1] << 8);
    this.type = this.cb === 0 ? 0 : this.data[2];
  }

  getNext(): ItemIDList | undefined {
    if (this.cb === 0) {
      return undefined;
    }
    return new ItemIDList(this.data.subarray(this.cb));
  }

  isDesktop(): boolean {
    return this.cb === 0;
  }

  getCLSID(): CLSID | undefined {
    if (this.type === 0x1F || this.type === 0x2E) {
      return this.GUIDStruct_guid();
    }
    if (this.type === 0x71) {
      return this.ExtGUIDStruct_guid();
    }
    return undefined;
  }

  getText(): string {
    const fileNameW = this.FileStructW_name();
    if (fileNameW !== undefined) {
      return fileNameW;
    }

    switch (this.type) {
      case 0x23:
      case 0x25:
      case 0x29:
      case 0x2F:
        return this.DriveStruct_driveName();

      case 0x1F:
      case 0x2E:
      case 0x71:
        const riid = this.type !== 0x71 ? this.GUIDStruct_guid() : this.ExtGUIDStruct_guid();
        return getClassName(riid);
    }

    console.log(`不明な種類のCLSID：${this.type.toString(16)}`);
    return "";
  }

  // typedef struct tagGUIDStruct
  // {
  //     BYTE dummy; /* offset 01 is unknown */
  //     GUID guid;  /* offset 02 */
  // } GUIDStruct;
  GUIDStruct_guid(): CLSID {
    return new CLSID(this.data.subarray(4, 4 + 16));
  }

  // Wineにはない独自定義
  // typedef struct tagExtGUIDStruct
  // {
  //     BYTE dummy[11]; /* offset 01 is unknown */
  //     GUID guid;      /* offset 12 */
  // } ExtGUIDStruct;
  ExtGUIDStruct_guid(): CLSID {
    return new CLSID(this.data.subarray(14, 14 + 16));
  }

  // typedef struct tagDriveStruct
  // {
  //     CHAR szDriveName[20];	/*01*/
  //     WORD unknown;		/*21*/
  // } DriveStruct;
  DriveStruct_driveName(): string {
    return readAsciiString(this.data.subarray(3, 3 + 20));
  }

  // typedef struct tagFileStruct
  // {
  //     BYTE dummy;			/*01 is 0x00 for files or dirs */
  //     DWORD dwFileSize;		/*02*/
  //     WORD uFileDate;		/*06*/
  //     WORD uFileTime;		/*08*/
  //     WORD uFileAttribs;		/*10*/
  //     CHAR szNames[1];		/*12*/
  //     /* Here are coming two strings. The first is the long name.
  //     The second the dos name when needed or just 0x00 */
  // } FileStruct;
  //

  // typedef struct tagFileStructW {
  //     WORD cbLen;
  //     BYTE dummy1[6];
  //     WORD uCreationDate;
  //     WORD uCreationTime;
  //     WORD uLastAccessDate;
  //     WORD uLastAccessTime;
  //     BYTE dummy2[4];
  //     WCHAR wszName[1];
  // } FileStructW;
  FileStructW_name(): string | undefined {
    const cbOffset = this.data[this.cb - 2] | (this.data[this.cb - 1] << 8);
    const fileStructW = this.data.subarray(cbOffset, this.cb);
    if ((cbOffset & 1) || cbOffset < 2 + 1 + 12 || cbOffset > this.cb - 2 - 22) {
      return undefined;
    }

    const cbLen = fileStructW[0] | (fileStructW[1] << 8);
    if (this.cb < cbOffset + cbLen) {
      return undefined;
    }
    if (this.cb > cbOffset + cbLen) {
      // 謎のデータが付いてることがある
      const extraLen = fileStructW[cbLen + 0] | (fileStructW[cbLen + 1] << 8);
      if (this.cb !== cbOffset + cbLen + extraLen) {
        return undefined;
      }
    }

    // Wineにおけるdummy2の先頭2バイト
    const nameOffset = fileStructW[16] | (fileStructW[17] << 8);
    if (nameOffset + 2 >= fileStructW.length) {
      return undefined;
    }
    return readString(fileStructW.subarray(nameOffset, this.cb));
  }

  // struct
  // { WORD dummy;		/*01*/
  //   CHAR szNames[1];	/*03*/
  // } network;
  NetworkStruct_name(): string {
    return readAsciiString(this.data.subarray(5, this.cb));
  }

  // typedef struct tagValueW
  // {
  //     WCHAR name[1];
  // } ValueWStruct;
  //
}

class Path {
  path = "";

  append(path: string): void {
    if (this.path && !this.path.endsWith("\\")) {
      this.path += "\\";
    }
    this.path += path;
  }
}

type Item = {
  buildPath(path: Path, idl: ItemIDList): void;
};

const ControlPanel = new class implements Item {
  buildPath(path: Path, idl: ItemIDList): void {
    path.append(getClassName(CLSID_ControlPanel));

    if (idl.isDesktop()) {
      return;
    }

    const clsid = idl.getCLSID();
    if (clsid !== undefined) {
      path.append(getClassName(clsid));
    } else {
      path.append(idl.getText());
    }

    const next = idl.getNext();
    if (next !== undefined) {
      FS.buildPath(path, next);
    }
  }
};

const Desktop = new class implements Item {
  buildPath(path: Path, idl: ItemIDList): void {
    if (idl.isDesktop()) {
      path.append(getClassName(CLSID_ShellDesktop));
      return;
    }

    const next = idl.getNext();
    const clsid = idl.getCLSID();

    if (next === undefined) {
      // 単要素ならそのまま文字列化
      if (clsid !== undefined) {
        path.append(getClassName(clsid));
      } else {
        path.append(idl.getText());
      }
      return;
    }

    if (clsid !== undefined) {
      const item = getItem(clsid);
      if (item !== undefined) {
        // 登録済みCLSIDならそっちで処理
        item.buildPath(path, next);
        return;
      }

      // 未登録CLSIDならパスに追加して次に回す
      path.append(getClassName(clsid));
    }

    FS.buildPath(path, next);
  }
};

const MyComputer = new class implements Item {
  buildPath(path: Path, idl: ItemIDList): void {
    if (idl.isDesktop()) {
      path.append(getClassName(CLSID_MyComputer));
      return;
    }

    path.append(idl.getText());

    const next = idl.getNext();
    if (next !== undefined) {
      FS.buildPath(path, next);
    }
  }
};

const FS = new class implements Item {
  buildPath(path: Path, idl: ItemIDList): void {
    if (idl.isDesktop()) {
      return;
    }

    path.append(idl.getText());

    const next = idl.getNext();
    if (next !== undefined) {
      this.buildPath(path, next);
    }
  }
};

const NetworkExplorerFolder = new class implements Item {
  buildPath(path: Path, idl: ItemIDList): void {
    const next = idl.getNext();
    if (idl.isDesktop() || !next || next.isDesktop()) {
      path.append(getClassName(CLSID_NetworkExplorerFolder));
      return;
    }

    if (next.type === 0xC3) {
      path.append(next.NetworkStruct_name());
    } else {
      path.append(next.getText());
    }

    const next2 = next.getNext();
    if (next2 !== undefined) {
      FS.buildPath(path, next2);
    }
  }
};

const UsersLibraries = new class implements Item {
  readonly #REGISTRY: Array<[CLSID, string]> = [
    [new CLSID("{7B0DB17D-9CD2-4A93-9733-46CC89022E7C}"), "ドキュメント"],
    [new CLSID("{2112AB0A-C86A-4FFE-A368-0DE96E47012E}"), "ミュージック"],
    [new CLSID("{A990AE9F-A03B-4E80-94BC-9912D7504104}"), "ピクチャ"],
    [new CLSID("{491E922F-5643-4AF4-A7EB-4E7A138D8174}"), "ビデオ"],
    //
  ];

  #getLibraryName(clsid: CLSID): string | undefined {
    for (const [target, name] of this.#REGISTRY) {
      if (target.equals(clsid)) {
        return name;
      }
    }
    return undefined;
  }

  buildPath(path: Path, idl: ItemIDList): void {
    path.append(getClassName(Known_CLSID_UsersLibraries));
    if (idl.isDesktop()) {
      return;
    }

    if (idl.type === 0x00) {
      const clsid = idl.ExtGUIDStruct_guid();
      path.append(this.#getLibraryName(clsid) ?? `::${clsid}`);
    } else {
      path.append(idl.getText());
    }

    const next = idl.getNext();
    if (next !== undefined) {
      FS.buildPath(path, next);
    }
  }
};

const UsersFiles = new class implements Item {
  readonly #REGISTRY: Array<[CLSID, string]> = [
    [FOLDERID_Favorites, "お気に入り"],
    //
  ];

  #getFolderName(clsid: CLSID): string | undefined {
    for (const [target, name] of this.#REGISTRY) {
      if (target.equals(clsid)) {
        return name;
      }
    }
    return undefined;
  }

  buildPath(path: Path, idl: ItemIDList): void {
    path.append(getClassName(Known_CLSID_UsersFiles));
    if (idl.isDesktop()) {
      return;
    }

    if (idl.type === 0x00) {
      const clsid = idl.ExtGUIDStruct_guid();
      path.append(this.#getFolderName(clsid) ?? `::${clsid}`);
    } else {
      path.append(idl.getText());
    }

    const next = idl.getNext();
    if (next !== undefined) {
      FS.buildPath(path, next);
    }
  }
};

const ControlPanel2 = new class implements Item {
  buildPath(path: Path, idl: ItemIDList): void {
    path.append(getClassName(Known_CLSID_ControlPanel));

    if (idl.isDesktop()) {
      return;
    }

    const next = idl.getNext()?.getNext();
    if (next !== undefined) {
      FS.buildPath(path, next);
    }
  }
};

const CLSIDTable: Array<[CLSID, Item]> = [
  // [CLSID_ApplicationAssociationRegistration, ApplicationAssociationRegistration_Constructor],
  // [CLSID_ApplicationDestinations, ApplicationDestinations_Constructor],
  // [CLSID_ApplicationDocumentLists, ApplicationDocumentLists_Constructor],
  // [CLSID_AutoComplete, IAutoComplete_Constructor],
  [CLSID_ControlPanel, ControlPanel],
  // [CLSID_DragDropHelper, IDropTargetHelper_Constructor],
  // [CLSID_FolderShortcut, FolderShortcut_Constructor],
  [CLSID_MyComputer, MyComputer],
  // [CLSID_MyDocuments, MyDocuments_Constructor],
  // [CLSID_NetworkPlaces, ISF_NetworkPlaces],
  // [CLSID_Printers, Printers_Constructor],
  // [CLSID_QueryAssociations, QueryAssociations_Constructor],
  // [CLSID_RecycleBin, RecycleBin_Constructor],
  [CLSID_ShellDesktop, Desktop],
  // [CLSID_ShellFSFolder, IFSFolder_Constructor],
  // [CLSID_ShellItem, IShellItem_Constructor],
  // [CLSID_ShellLink, IShellLink_Constructor],
  // [CLSID_UnixDosFolder, UnixDosFolder_Constructor],
  // [CLSID_UnixFolder, UnixFolder_Constructor],
  // [CLSID_ExplorerBrowser, ExplorerBrowser_Constructor],
  // [CLSID_KnownFolderManager, KnownFolderManager_Constructor],
  // [CLSID_Shell, IShellDispatch_Constructor],
  // [CLSID_DestinationList, CustomDestinationList_Constructor],
  // [CLSID_ShellImageDataFactory, ShellImageDataFactory_Constructor],
  // [CLSID_FileOperation, IFileOperation_Constructor],
  // [CLSID_ActiveDesktop, ActiveDesktop_Constructor],

  // Wineにないやつ
  [CLSID_NetworkExplorerFolder, NetworkExplorerFolder],
  [Known_CLSID_UsersLibraries, UsersLibraries],
  [Known_CLSID_UsersFiles, UsersFiles],
  [Known_CLSID_ControlPanel, ControlPanel2],
];

const REGISTRY: Array<[CLSID, string]> = [
  [CLSID_MyComputer, "PC（マイコンピュータ）"],
  [CLSID_ShellDesktop, "デスクトップ"],
  [CLSID_RecycleBin, "ごみ箱"],
  [CLSID_ControlPanel, "すべてのコントロール パネル項目"],
  [CLSID_NetworkExplorerFolder, "ネットワーク"],
  [new CLSID("{B4FB3F98-C1EA-428D-A78A-D1F5659CBA93}"), "ホームグループ"],
  [new CLSID("{A8CDFF1C-4878-43BE-B5FD-F8091C1C60D0}"), "ドキュメント"],
  [new CLSID("{3ADD1653-EB32-4CB0-BBD7-DFA0ABB5ACCA}"), "ピクチャ"],
  [new CLSID("{1CF1260C-4DD0-4EBB-811F-33C572699FDE}"), "ミュージック"],
  [new CLSID("{A0953C92-50DC-43BF-BE83-3742FED03C9C}"), "ビデオ"],
  [new CLSID("{D20EA4E1-3957-11D2-A40B-0C5020524153}"), "管理ツール"],
  [CLSID_Printers, "プリンタ"],

  // 自信ないやつ
  [Known_CLSID_UsersLibraries, "ライブラリ"],
  [Known_CLSID_UsersFiles, "ユーザープロファイル"],
  [Known_CLSID_ControlPanel, "コントロールパネル"],
  [new CLSID("{088E3905-0323-4B02-9826-5D99428E115F}"), "ダウンロード"],
];

function getItem(clsid: CLSID): Item | undefined {
  for (const [target, item] of CLSIDTable) {
    if (target.equals(clsid)) {
      return item;
    }
  }

  return undefined;
}

export function getClassName(clsid: CLSID): string {
  for (const [t, s] of REGISTRY) {
    if (t.equals(clsid)) {
      return s;
    }
  }

  return `::${clsid}`;
}

export function getPathFromIDList(idl: ItemIDList): string {
  const path = new Path();
  Desktop.buildPath(path, idl);
  return path.path;
}

export function getPathFromItemID(itemID: Uint8Array): string {
  return getPathFromIDList(new ItemIDList(itemID));
}
