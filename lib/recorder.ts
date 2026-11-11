// Recording voice notes on phones (expo-audio). lib/recorder.web.ts is the browser version.
import { useRef, useState } from "react";
import { File } from "expo-file-system";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";

export type Recording = { file: Blob; name: string; durationMs: number };
// Why recording couldn't start
export type RecorderProblem = "denied" | "unsupported" | "failed";

export function useVoiceRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const startedAt = useRef(0);

  const start = async (): Promise<RecorderProblem | null> => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return "denied";
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      setRecording(true);
      return null;
    } catch {
      return "failed";
    }
  };

  const finish = async (keep: boolean): Promise<Recording | null> => {
    if (!recording) return null;
    setRecording(false);
    const durationMs = Date.now() - startedAt.current;
    try {
      await recorder.stop();
    } finally {
      // Back to normal playback (on iPhone, recording mode sends sound to the earpiece)
      setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    }
    if (!keep || !recorder.uri) return null;
    return { file: new File(recorder.uri), name: "voice.m4a", durationMs };
  };

  return {
    recording,
    startedAt: () => startedAt.current,
    start,
    stop: () => finish(true),
    cancel: () => finish(false).then(() => undefined),
  };
}
