// Turns a picked photo into something FormData can upload. Web version: the picker
// gives a blob:/data: URI, so fetch the actual bytes. (Phones use photoFile.native.ts.)
export async function photoFile(uri: string): Promise<Blob> {
  return (await fetch(uri)).blob();
}
