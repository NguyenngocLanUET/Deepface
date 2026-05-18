import { useCallback, useEffect, useRef, useState } from "react";

type FaceApiGlobal = {
  nets: {
    tinyFaceDetector: {
      loadFromUri: (modelUrl: string) => Promise<void>;
    };
  };
  TinyFaceDetectorOptions: new () => unknown;
  detectSingleFace: (input: HTMLVideoElement | HTMLCanvasElement, options: unknown) => Promise<unknown | null>;
};

declare global {
  interface Window {
    faceapi?: FaceApiGlobal;
  }
}

const FACE_API_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/dist/face-api.min.js";
const FACE_API_MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";

type DetectorStatus = "idle" | "loading-model" | "ready" | "camera-on" | "error";

export function useTinyFaceRegister() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<DetectorStatus>("idle");
  const [message, setMessage] = useState("Chưa bật camera.");
  const [cameraOn, setCameraOn] = useState(false);
  const faceApiRef = useRef<FaceApiGlobal | null>(null);
  const modelLoadedRef = useRef(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOn(false);
    setMessage("Camera đã tắt.");
    setStatus(modelLoadedRef.current ? "ready" : "idle");
  }, []);

  useEffect(() => stop, [stop]);

  const ensureFaceApi = useCallback(async () => {
    if (window.faceapi && modelLoadedRef.current) {
      faceApiRef.current = window.faceapi;
      return window.faceapi;
    }

    setStatus("loading-model");
    setMessage("Đang tải TinyFaceDetector...");

    if (!window.faceapi) {
      await new Promise<void>((resolve, reject) => {
        const existingScript = document.querySelector<HTMLScriptElement>(`script[data-faceapi="true"]`);
        if (existingScript) {
          existingScript.addEventListener("load", () => resolve(), { once: true });
          existingScript.addEventListener(
            "error",
            () => reject(new Error("Không tải được thư viện face-api.")),
            { once: true },
          );
          if (existingScript.dataset.loaded === "true") {
            resolve();
          }
          return;
        }

        const script = document.createElement("script");
        script.src = FACE_API_SCRIPT_URL;
        script.async = true;
        script.dataset.faceapi = "true";
        script.onload = () => {
          script.dataset.loaded = "true";
          resolve();
        };
        script.onerror = () => reject(new Error("Không tải được thư viện face-api."));
        document.head.appendChild(script);
      });
    }

    if (!window.faceapi) {
      throw new Error("Không khởi tạo được face-api.");
    }

    faceApiRef.current = window.faceapi;
    await window.faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL);
    modelLoadedRef.current = true;
    setStatus("ready");
    setMessage("TinyFaceDetector sẵn sàng.");
    return window.faceapi;
  }, []);

  const start = useCallback(async () => {
    try {
      await ensureFaceApi();
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
      setStatus("camera-on");
      setMessage("Camera sẵn sàng. Bấm chụp để kiểm tra khuôn mặt.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Không thể bật TinyFaceDetector.");
      throw error;
    }
  }, [ensureFaceApi]);

  const getDetectionInfo = useCallback(async () => {
    if (!videoRef.current || !cameraOn) return null;
    const faceApi = await ensureFaceApi();
    const video = videoRef.current;
    const detection = await faceApi.detectSingleFace(video, new faceApi.TinyFaceDetectorOptions());
    return detection;
  }, [cameraOn, ensureFaceApi]);

  const captureValidatedFace = useCallback(async () => {
    if (!videoRef.current || !cameraOn) {
      throw new Error("Camera chưa bật.");
    }

    const faceApi = await ensureFaceApi();
    const video = videoRef.current;
    const detection = await faceApi.detectSingleFace(video, new faceApi.TinyFaceDetectorOptions());

    if (!detection) {
      setMessage("Tìm khuôn mặt... Hãy nhìn camera");
      throw new Error("Không phát hiện khuôn mặt.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Không thể tạo ảnh chụp từ camera.");
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) {
      throw new Error("Không thể chụp ảnh từ camera.");
    }

    return new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
  }, [cameraOn, ensureFaceApi]);

  return {
    videoRef,
    cameraOn,
    status,
    message,
    start,
    stop,
    captureValidatedFace,
    getDetectionInfo,
  };
}
