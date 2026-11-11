// Recording voice notes in the browser (MediaRecorder). lib/recorder.ts is the phone version.
// MP4 (AAC) is preferred because iPhones can play it; browsers that can't record MP4 use WebM.
import { useRef, useState } from "react";

export type Recording = { file: Blob; name: string; durationMs: number };
export type RecorderProblem = "denied" | "unsupported" | "failed";

const TYPES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const media = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);

  const start = async (): Promise<RecorderProblem | null> => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      return "unsupported";
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      return (e as DOMException)?.name === "NotAllowedError" ? "denied" : "failed";
    }
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.start(250);
    media.current = rec;
    startedAt.current = Date.now();
    setRecording(true);
    return null;
  };

  const finish = (keep: boolean): Promise<Recording | null> =>
    new Promise((resolve) => {
      const rec = media.current;
      if (!rec) return resolve(null);
      media.current = null;
      setRecording(false);
      const durationMs = Date.now() - startedAt.current;
      rec.onstop = () => {
        rec.stream.getTracks().forEach((t) => t.stop()); // turns off the browser's mic indicator
        if (!keep) return resolve(null);
        const type = rec.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        resolve({ file: new Blob(chunks.current, { type }), name: `voice.${ext}`, durationMs });
      };
      rec.stop();
    });

  return {
    recording,
    startedAt: () => startedAt.current,
    start,
    stop: () => finish(true),
    cancel: () => finish(false).then(() => undefined),
  };
}
