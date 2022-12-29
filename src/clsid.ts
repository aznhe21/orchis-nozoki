// 本当は型レベルで正しいCLSIDであることを確認したい：https://github.com/microsoft/TypeScript/issues/43335
export type CLSIDString = `{${string}}`;

function parseInt16(n: string): number {
  return Number.parseInt(n, 16);
}

export class CLSID {
  data1: number;
  data2: number;
  data3: number;
  data4: Uint8Array;

  static fromArray(arr: Uint8Array): CLSID | undefined {
    if (arr.length !== 16) {
      return undefined;
    }
    const data1 = (arr[0] | (arr[1] << 8) | (arr[2] << 16) | (arr[3] << 24)) >>> 0;
    const data2 = arr[4] | (arr[5] << 8);
    const data3 = arr[6] | (arr[7] << 8);
    const data4 = arr.slice(8, 16);
    return new CLSID(data1, data2, data3, data4);
  }

  static fromString(s: string): CLSID | undefined {
    if (!/^{[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}}$/i.test(s)) {
      return undefined;
    }
    const [a, b, c, d, e] = s.slice(1, 37).split("-");
    const data1 = parseInt16(a);
    const data2 = parseInt16(b);
    const data3 = parseInt16(c);
    const data4 = Uint8Array.of(
      parseInt16(d.slice(0, 2)),
      parseInt16(d.slice(2, 4)),
      parseInt16(e.slice(0, 2)),
      parseInt16(e.slice(2, 4)),
      parseInt16(e.slice(4, 6)),
      parseInt16(e.slice(6, 8)),
      parseInt16(e.slice(8, 10)),
      parseInt16(e.slice(10, 12)),
    );
    return new CLSID(data1, data2, data3, data4);
  }

  static parse(s: string): CLSID {
    const clsid = CLSID.fromString(s);
    if (clsid === undefined) {
      throw new Error("invalid CLSID format");
    }
    return clsid;
  }

  constructor(data1: number, data2: number, data3: number, data4: Uint8Array) {
    this.data1 = data1;
    this.data2 = data2;
    this.data3 = data3;
    this.data4 = data4;
  }

  equals(other: CLSID): boolean {
    return (
      this.data1 === other.data1 &&
      this.data2 === other.data2 &&
      this.data3 === other.data3 &&
      this.data4[0] === other.data4[0] &&
      this.data4[1] === other.data4[1] &&
      this.data4[2] === other.data4[2] &&
      this.data4[3] === other.data4[3] &&
      this.data4[4] === other.data4[4] &&
      this.data4[5] === other.data4[5] &&
      this.data4[6] === other.data4[6] &&
      this.data4[7] === other.data4[7]
    );
  }

  toString(): CLSIDString {
    function toUpperHexWithPad(n: number, pad: number): string {
      return n.toString(16).toUpperCase().padStart(pad, "0").slice(-pad);
    }

    const s1 = toUpperHexWithPad(this.data1, 8);
    const s2 = toUpperHexWithPad(this.data2, 4);
    const s3 = toUpperHexWithPad(this.data3, 4);
    const s4 = toUpperHexWithPad(this.data4[0], 2);
    const s5 = toUpperHexWithPad(this.data4[1], 2);
    const s6 = Array.from(this.data4.slice(2), (n) => toUpperHexWithPad(n, 2)).join("");
    return `{${s1}-${s2}-${s3}-${s4}${s5}-${s6}}`;
  }
}

// ShlGuid.h
export const CLSID_NetworkDomain = CLSID.parse("{46e06680-4bf0-11d1-83ee-00a0c90dc849}");
export const CLSID_NetworkServer = CLSID.parse("{c0542a90-4bf0-11d1-83ee-00a0c90dc849}");
export const CLSID_NetworkShare = CLSID.parse("{54a754c0-4bf1-11d1-83ee-00a0c90dc849}");
export const CLSID_MyComputer = CLSID.parse("{20D04FE0-3AEA-1069-A2D8-08002B30309D}");
export const CLSID_Internet = CLSID.parse("{871C5380-42A0-1069-A2EA-08002B30309D}");
export const CLSID_RecycleBin = CLSID.parse("{645FF040-5081-101B-9F08-00AA002F954E}");
export const CLSID_ControlPanel = CLSID.parse("{21EC2020-3AEA-1069-A2DD-08002B30309D}");
export const CLSID_Printers = CLSID.parse("{2227A280-3AEA-1069-A2DE-08002B30309D}");
export const CLSID_MyDocuments = CLSID.parse("{450D8FBA-AD25-11D0-98A8-0800361B1103}");

// ShObjIdl_core.h
export const CLSID_ShellDesktop = CLSID.parse("{00021400-0000-0000-C000-000000000046}");
export const CLSID_NetworkExplorerFolder = CLSID.parse("{F02C1A0D-BE21-4350-88B0-7367FC96EF3C}");

// KnownFolders.h
export const FOLDERID_Favorites = CLSID.parse("{1777F761-68AD-4D8A-87BD-30B759FA33DD}");

// Windows SDKで定義されていないもの

export const Known_CLSID_UsersLibraries = CLSID.parse("{031E4825-7B94-4DC3-B131-E946B44C8DD5}");
export const Known_CLSID_UsersFiles = CLSID.parse("{59031A47-3F72-44A7-89C5-5595FE6B30EE}");
export const Known_CLSID_ControlPanel = CLSID.parse("{26EE0668-A00A-44D7-9371-BEB064C98683}");
