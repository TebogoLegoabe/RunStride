// Phone version of photoFile.ts.
//
// Expo's fetch (the default since SDK 5x) only uploads standard Blobs: React Native's old
// { uri, name, type } FormData objects are rejected before anything is sent. expo-file-system's
// File is a Blob backed by the picked file on disk, so it uploads without copying it into memory.
import { File } from "expo-file-system";

export async function photoFile(uri: string): Promise<Blob> {
  return new File(uri);
}
