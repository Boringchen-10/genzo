import { describe, expect, it } from "vitest";
import { folderRelocations, locationFolders, relativeLocation, type Location } from "./libraryMaintenance";
const file = (id: string, path: string, rootPath: string, workId: string | null = "work", size=8) => ({ id,path,rootPath,workId,size,missing:false,mediaType:"video",contentFingerprint:null } as Location);
describe("relocation candidate preview", () => {
  it("compares extended UNC and RaiDrive keys with directory boundaries", () => {
    expect(relativeLocation(file("a", "\\\\?\\UNC\\Server\\Share\\Season 2\\01.mkv", "\\\\server\\share"))).toBe("season 2/01.mkv");
    expect(relativeLocation(file("a", "C:\\AnimeOther\\01.mkv", "C:\\Anime"))).toBeNull();
  });
  it("pairs relative folders and leaves unmatched files for manual review", () => {
    const old=[file("a","C:\\Old\\S1\\01.mkv","C:\\Old"),file("b","C:\\Old\\S1\\02.mkv","C:\\Old")];
    const current=[file("n","D:\\New\\Show\\01.mkv","D:\\New",null)];
    expect(folderRelocations(old,current,"s1","show")).toEqual({pairs:[{oldId:"a",newId:"n"}],unmatched:1});
    expect(locationFolders(old)).toEqual(["","s1"]);
  });
  it("rejects duplicate targets, mismatched size, fingerprints and existing owners", () => {
    const old=[file("a","C:\\Old\\01.mkv","C:\\Old")];
    const current=file("n","D:\\New\\01.mkv","D:\\New",null);
    expect(folderRelocations(old,[current,{...current,id:"duplicate"}],"","").pairs).toEqual([]);
    expect(folderRelocations(old,[{...current,size:9}],"","").pairs).toEqual([]);
    expect(folderRelocations(old,[{...current,workId:"other"}],"","").pairs).toEqual([]);
    expect(folderRelocations([{...old[0]!,contentFingerprint:"a"}],[{...current,contentFingerprint:"b"}],"","").pairs).toEqual([]);
  });
  it("retains WebDAV case sensitivity and never matches a file to itself", () => {
    const old=file("a","webdav://old/A.mkv","webdav://old");
    expect(folderRelocations([old],[file("b","webdav://new/a.mkv","webdav://new",null)],"","").pairs).toEqual([]);
    expect(folderRelocations([old],[{...old,workId:null}],"","").pairs).toEqual([]);
  });
});
