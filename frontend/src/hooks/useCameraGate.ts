import { useCallback, useEffect, useRef, useState } from "react";
import {
  FaceDetector as MediaPipeFaceDetector,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

type GateStatus = "idle" | "loading" | "ready" | "detecting" | "error";
type DetectorKind = "mediapipe" | "browser" | "frame-signal" | "none";
type FaceBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type NativeFaceDetector = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ boundingBox?: DOMRectReadOnly }>>;
};

type NativeFaceDetectorConstructor = new (options?: {
  fastMode?: boolean;
  maxDetectedFaces?: number;
}) => NativeFaceDetector;

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

export function useCameraGate() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<MediaPipeFaceDetector | NativeFaceDetector | null>(null);
  const detectorKindRef = useRef<DetectorKind>("none");
  const loopRef = useRef<number | null>(null);
  const lastSignalRef = useRef<number | null>(null);

  const [status, setStatus] = useState<GateStatus>("idle");
  const [detectorKind, setDetectorKind] = useState<DetectorKind>("none");
  const [confidence, setConfidence] = useState(0);
  const [stableFrames, setStableFrames] = useState(0);
  const [faceBox, setFaceBox] = useState<FaceBox | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (loopRef.current) {
      window.cancelAnimationFrame(loopRef.current);
      loopRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStatus("idle");
    setStableFrames(0);
    setConfidence(0);
    setFaceBox(null);
  }, []);

  const normalizeFaceBox = useCallback(
    (video: HTMLVideoElement, rawBox?: { originX?: number; originY?: number; width?: number; height?: number; x?: number; y?: number; left?: number; top?: number }) => {
      if (!rawBox) return null;

      const videoWidth = video.videoWidth || 1;
      const videoHeight = video.videoHeight || 1;
      const left = rawBox.originX ?? rawBox.x ?? rawBox.left ?? 0;
      const top = rawBox.originY ?? rawBox.y ?? rawBox.top ?? 0;
      const width = rawBox.width ?? 0;
      const height = rawBox.height ?? 0;

      if (width <= 0 || height <= 0) return null;

      const normalizedLeft = left / videoWidth;
      const normalizedTop = top / videoHeight;
      const normalizedWidth = width / videoWidth;
      const normalizedHeight = height / videoHeight;

      return {
        left: Math.max(0, Math.min(1, normalizedLeft)),
        top: Math.max(0, Math.min(1, normalizedTop)),
        width: Math.max(0, Math.min(1, normalizedWidth)),
        height: Math.max(0, Math.min(1, normalizedHeight)),
      };
    },
    [],
  );

  const loadDetector = useCallback(async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      const detector = await MediaPipeFaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.55,
      });
      detectorRef.current = detector;
      detectorKindRef.current = "mediapipe";
      setDetectorKind("mediapipe");
      return;
    } catch (mediaPipeError) {
      console.warn("MediaPipe detector unavailable, trying browser detector", mediaPipeError);
    }

    const maybeWindow = window as unknown as {
      FaceDetector?: NativeFaceDetectorConstructor;
    };

    if (maybeWindow.FaceDetector) {
      detectorRef.current = new maybeWindow.FaceDetector({
        fastMode: true,
        maxDetectedFaces: 1,
      });
      detectorKindRef.current = "browser";
      setDetectorKind("browser");
      return;
    }

    detectorRef.current = null;
    detectorKindRef.current = "frame-signal";
    setDetectorKind("frame-signal");
  }, []);

  const estimateFrameSignal = useCallback((video: HTMLVideoElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;

    const width = 96;
    const height = 72;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return 0;

    context.drawImage(video, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    let signal = 0;

    for (let index = 0; index < pixels.length; index += 16) {
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      signal += Math.abs(r - g) + Math.abs(g - b) + Math.abs(b - r);
    }

    const normalized = Math.min(1, signal / 260000);
    const lastSignal = lastSignalRef.current;
    lastSignalRef.current = normalized;

    if (lastSignal === null) return normalized > 0.22 ? 0.62 : 0;
    const delta = Math.abs(normalized - lastSignal);
    return normalized > 0.22 && delta < 0.12 ? 0.62 : 0;
  }, []);

  const detect = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      loopRef.current = window.requestAnimationFrame(() => void detect());
      return;
    }

    let nextConfidence = 0;
    let nextFaceBox: FaceBox | null = null;

    try {
      if (detectorKindRef.current === "mediapipe") {
        const detector = detectorRef.current as MediaPipeFaceDetector;
        const result = detector.detectForVideo(video, performance.now());
        const detection = result.detections[0];
        nextConfidence = detection?.categories?.[0]?.score ?? 0;
        nextFaceBox = normalizeFaceBox(video, detection?.boundingBox);
      } else if (detectorKindRef.current === "browser") {
        const detector = detectorRef.current as NativeFaceDetector;
        const result = await detector.detect(video);
        nextConfidence = result.length > 0 ? 0.7 : 0;
        nextFaceBox = normalizeFaceBox(video, result[0]?.boundingBox);
      } else {
        nextConfidence = estimateFrameSignal(video);
      }
    } catch (detectError) {
      console.warn("Camera gate detection failed", detectError);
      nextConfidence = 0;
    }

    setConfidence(nextConfidence);
    setFaceBox(nextFaceBox);
    setStableFrames((current) => (nextConfidence >= 0.55 ? Math.min(current + 1, 5) : 0));
    setStatus("detecting");
    loopRef.current = window.requestAnimationFrame(() => void detect());
  }, [estimateFrameSignal, normalizeFaceBox]);

  const start = useCallback(async () => {
    setError(null);
    setStatus("loading");

    try {
      await loadDetector();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setStatus("ready");
      loopRef.current = window.requestAnimationFrame(() => void detect());
    } catch (startError) {
      const message =
        startError instanceof Error ? startError.message : "Không thể mở camera";
      setError(message);
      setStatus("error");
      stop();
    }
  }, [detect, loadDetector, stop]);

  const captureBlob = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.88);
    });
  }, []);

  const resetDetection = useCallback(() => {
    setStableFrames(0);
    setConfidence(0);
    setFaceBox(null);
  }, []);

  useEffect(() => stop, [stop]);

  return {
    videoRef,
    canvasRef,
    status,
    detectorKind,
    confidence,
    stableFrames,
    faceBox,
    canSubmit: stableFrames >= 2,
    error,
    start,
    stop,
    captureBlob,
    resetDetection,
  };
}
