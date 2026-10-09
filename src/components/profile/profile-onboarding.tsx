"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PhoneVerification } from "@/components/verification/phone-verification";
import { FACE_FAILURE_MESSAGES, VERIFICATION_PROMPTS, type FaceFailureCode } from "@/lib/face-verification-shared";
import { DIDIT_FAILURE_MESSAGES, type DiditFailureCode } from "@/lib/didit-biometric";

type Step = "profile" | "photo" | "camera" | "phone" | "result";
type Status = { status: string; photoUrl: string | null; consented: boolean; displayName: string; bio: string; location: string; providerConfigured: boolean; provider: "persona" | "http" | "didit-biometric" | null; diditConfigured: boolean; identityState: string | null; identityFailure: string | null; attemptsRemaining: number; phoneVerification: string; phoneVerifiedAt: string | null; phone: string | null; phoneConfigured: boolean };
type Outcome =
  | { kind: "passed" }
  | { kind: "failed"; code: FaceFailureCode | DiditFailureCode | null; message?: string; attemptsRemaining?: number }
  | { kind: "unavailable"; message: string }
  | { kind: "pending" };

const STEPS: { id: Step; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "photo", label: "Photo" },
  { id: "camera", label: "Verify" },
  { id: "phone", label: "Phone" },
  { id: "result", label: "Result" },
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const IDENTITY_FAILURE_MESSAGES: Record<string, string> = {
  DECLINED: "We couldn't verify your identity. Make sure your ID and face are clearly visible and try again.",
  FAILED: "The identity check didn't pass. Try again with good lighting and a valid, unexpired ID.",
  EXPIRED: "Your verification session expired. Please start again.",
  CANCELLED: "Verification was cancelled. You can start it again whenever you're ready.",
};

export function ProfileOnboarding() {
  const [step, setStep] = useState<Step>("profile");
  const [info, setInfo] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ displayName: "", location: "", bio: "" });
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile/verification", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Could not load your profile."))))
      .then((data: Status) => {
        if (cancelled) return;
        setInfo(data);
        setForm({ displayName: data.displayName, location: data.location, bio: data.bio });
        setConsent(data.consented);
        if (data.status === "VERIFIED") { setOutcome({ kind: "passed" }); setStep("result"); }
        else if (data.provider === "persona" && data.status === "PENDING" && data.identityState === "PENDING") { setOutcome({ kind: "pending" }); setStep("result"); }
        else if (data.provider === "persona" && data.status === "FAILED") { setOutcome({ kind: "failed", code: null, message: IDENTITY_FAILURE_MESSAGES[data.identityFailure ?? ""] ?? IDENTITY_FAILURE_MESSAGES.FAILED, attemptsRemaining: data.attemptsRemaining }); setStep("result"); }
      })
      .catch((err: Error) => { if (!cancelled) setLoadError(err.message); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((track) => track.stop()); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) return setError(data.error ?? "Could not save your profile.");
    setStep("photo");
  }

  function pickFile(selected: File | null) {
    setFile(selected);
    setPreview(selected ? URL.createObjectURL(selected) : null);
  }

  async function uploadPhoto() {
    setError(null);
    if (!consent) return setError("Please confirm that you're using a real photo of yourself.");
    if (!file && !info?.photoUrl) return setError("Choose a photo of yourself to continue.");
    if (file) {
      setBusy(true);
      const body = new FormData();
      body.append("file", file);
      body.append("consent", "true");
      const response = await fetch("/api/profile/photo", { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      setBusy(false);
      if (!response.ok) return setError(data.error ?? "Could not upload your photo.");
      setInfo((current) => (current ? { ...current, photoUrl: data.photoUrl, consented: true, status: "NOT_VERIFIED" } : current));
      setFile(null);
    }
    setStep("camera");
  }

  async function startCamera() {
    setError(null);
    if (!window.isSecureContext) {
      return setError("Camera verification needs a secure (HTTPS) connection. Please open Vera Market using its https:// address.");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return setError("This browser or device doesn't support camera access. Try a current version of Chrome, Safari, Edge or Firefox on a device with a camera.");
    }
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("Camera permission was denied. Please allow camera access for this site in your browser settings, then try again. On iOS: Settings > Safari > Camera > Allow.");
      } else if (name === "NotFoundError") {
        setError("No camera was found on this device.");
      } else if (name === "NotReadableError") {
        setError("Your camera is in use by another app. Close other apps using the camera and try again.");
      } else if (name === "OverconstrainedError") {
        // Retry with simpler constraints
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
          streamRef.current = fallbackStream;
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream;
            await videoRef.current.play();
          }
          setCameraOn(true);
          return;
        } catch {
          setError("Your camera doesn't support the required resolution. Please try a different device.");
        }
      } else if (isSafari && name === "AbortError") {
        setError("Camera access was blocked. On iOS, go to Settings > Safari > Camera and set to 'Allow'.");
      } else {
        setError("We couldn't start your camera. Please try again or use a different browser.");
      }
    }
  }

  function captureFrame(): Promise<Blob | null> {
    const video = videoRef.current;
    if (!video) return Promise.resolve(null);

    return new Promise((resolve) => {
      if (video.readyState < 2 || !video.videoWidth) {
        const onCanPlay = () => {
          video.removeEventListener("canplay", onCanPlay);
          doCapture().then(resolve);
        };
        video.addEventListener("canplay", onCanPlay, { once: true });
        return;
      }
      doCapture().then(resolve);
    });

    function doCapture(): Promise<Blob | null> {
      const v = videoRef.current;
      if (!v || !v.videoWidth) return Promise.resolve(null);
      const size = Math.min(v.videoWidth, v.videoHeight, 720);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      if (!context) return Promise.resolve(null);
      const sx = (v.videoWidth - size) / 2;
      const sy = (v.videoHeight - size) / 2;
      context.drawImage(v, sx, sy, size, size, 0, 0, size, size);
      return new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.9));
    }
  }

  async function refreshStatus(): Promise<Status | null> {
    const response = await fetch("/api/profile/verification", { cache: "no-store" }).catch(() => null);
    return response?.ok ? ((await response.json()) as Status) : null;
  }

  // The result shown here always comes from the server (which only changes status on a signed Persona webhook).
  async function settleIdentityResult() {
    setPrompt("Checking your result...");
    for (let i = 0; i < 20; i++) {
      const latest = await refreshStatus();
      if (latest) {
        setInfo(latest);
        if (latest.status === "VERIFIED") {
          if (info?.phoneVerification === "VERIFIED") {
            setOutcome({ kind: "passed" });
            setStep("result");
          } else if (info?.phoneConfigured) {
            setOutcome({ kind: "passed" });
            setStep("phone");
          } else {
            setOutcome({ kind: "passed" });
            setStep("result");
          }
          break;
        }
        if (latest.status === "FAILED") { setOutcome({ kind: "failed", code: null, message: IDENTITY_FAILURE_MESSAGES[latest.identityFailure ?? ""] ?? IDENTITY_FAILURE_MESSAGES.FAILED, attemptsRemaining: latest.attemptsRemaining }); break; }
      }
      if (i === 19) setOutcome({ kind: "pending" });
      else await wait(3000);
    }
    setPrompt(null);
    setBusy(false);
    setStep("result");
  }

  async function runIdentityVerification() {
    setBusy(true);
    setError(null);
    // Release our preview so the verification window can use the camera.
    stopCamera();
    const response = await fetch("/api/profile/identity/start", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setBusy(false);
      if (response.status === 503) { setOutcome({ kind: "unavailable", message: data.error }); setStep("result"); return; }
      return setError(data.error ?? "We couldn't start verification. Please try again.");
    }
    try {
      const { Client } = await import("persona");
      const client = new Client({
        inquiryId: data.inquiryId,
        sessionToken: data.sessionToken,
        onReady: () => client.open(),
        onComplete: () => { void settleIdentityResult(); },
        onCancel: () => {
          void fetch("/api/profile/identity/cancel", { method: "POST" });
          setBusy(false);
          setError(IDENTITY_FAILURE_MESSAGES.CANCELLED);
        },
        onError: () => { setBusy(false); setError("The verification window ran into a problem. Please try again."); },
      });
    } catch {
      setBusy(false);
      setError("We couldn't load the verification window. Check your connection and try again.");
    }
  }

  async function runDiditBiometricVerification() {
    setBusy(true);
    setError(null);

    const blob = await captureFrame();
    if (!blob) {
      setBusy(false);
      return setError("We couldn't capture from your camera. Please try again.");
    }

    stopCamera();

    const body = new FormData();
    body.append("user_image", blob, "selfie.jpg");

    const response = await fetch("/api/verify/didit-biometric", { method: "POST", body });
    const data = await response.json().catch(() => ({}));
    setBusy(false);

    if (response.ok && data.passed) {
      // Face verification passed, check if phone verification is needed
      if (info?.phoneVerification === "VERIFIED") {
        setOutcome({ kind: "passed" });
        setStep("result");
      } else if (info?.phoneConfigured) {
        setOutcome({ kind: "passed" });
        setStep("phone");
      } else {
        setOutcome({ kind: "passed" });
        setStep("result");
      }
    } else if (response.status === 503) {
      setOutcome({ kind: "unavailable", message: data.error });
    } else if (response.status === 429 || response.status === 400) {
      setOutcome({ kind: "failed", code: null, message: data.error });
    } else {
      setOutcome({ kind: "failed", code: data.failureCode ?? null, message: data.message, attemptsRemaining: data.attemptsRemaining });
    }
    setStep("result");
  }

  async function runVerification() {
    if (info?.provider === "persona") return runIdentityVerification();
    if (info?.provider === "didit-biometric") return runDiditBiometricVerification();
    setBusy(true);
    setError(null);
    const body = new FormData();
    for (let i = 0; i < VERIFICATION_PROMPTS.length; i++) {
      setPrompt(VERIFICATION_PROMPTS[i]);
      await wait(2200);
      const blob = await captureFrame();
      if (!blob) {
        setPrompt(null);
        setBusy(false);
        return setError("We couldn't capture from your camera. Please try again.");
      }
      body.append(`capture_${i}`, blob, `capture_${i}.jpg`);
    }
    setPrompt("Checking...");
    stopCamera();
    const response = await fetch("/api/profile/verify-face", { method: "POST", body });
    const data = await response.json().catch(() => ({}));
    setPrompt(null);
    setBusy(false);
    if (response.ok && data.passed) {
      // Face verification passed, check if phone verification is needed
      if (info?.phoneVerification === "VERIFIED") {
        setOutcome({ kind: "passed" });
        setStep("result");
      } else if (info?.phoneConfigured) {
        setOutcome({ kind: "passed" });
        setStep("phone");
      } else {
        setOutcome({ kind: "passed" });
        setStep("result");
      }
    } else if (response.status === 503) setOutcome({ kind: "unavailable", message: data.error });
    else if (response.status === 429 || response.status === 400) setOutcome({ kind: "failed", code: null, message: data.error });
    else setOutcome({ kind: "failed", code: data.failureCode ?? null, attemptsRemaining: data.attemptsRemaining });
    setStep("result");
  }

  const stepIndex = STEPS.findIndex((item) => item.id === step);

  if (loadError) return <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-red-700">{loadError}</div>;
  if (!info) return <div className="mx-auto max-w-md px-4 py-16 text-center text-sm text-slate-500">Loading...</div>;

  return (
    <div className="mx-auto max-w-md px-4 py-8 sm:py-12">
      <ol className="mb-8 flex items-center gap-2" aria-label="Progress">
        {STEPS.map((item, index) => (
          <li key={item.id} className="flex flex-1 flex-col gap-1">
            <span className={`h-1.5 rounded-full ${index <= stepIndex ? "bg-brand" : "bg-slate-200"}`} />
            <span className={`text-[11px] font-medium ${index === stepIndex ? "text-brand" : "text-slate-400"}`}>{item.label}</span>
          </li>
        ))}
      </ol>

      {step === "profile" && (
        <form onSubmit={saveProfile} className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Create your personal profile</h1>
          <p className="text-sm text-slate-500">VeraMarket is built around real people. Your profile sits behind everything you buy, sell or run as a Virtual Store.</p>
          <label className="block text-sm font-medium">Full name
            <input required minLength={2} maxLength={60} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="mt-1 w-full rounded-md border border-border px-3 py-2.5 text-sm outline-none focus:border-brand" />
          </label>
          <label className="block text-sm font-medium">Location <span className="font-normal text-slate-400">(optional)</span>
            <input maxLength={120} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Pretoria" className="mt-1 w-full rounded-md border border-border px-3 py-2.5 text-sm outline-none focus:border-brand" />
          </label>
          <label className="block text-sm font-medium">About you <span className="font-normal text-slate-400">(optional)</span>
            <textarea maxLength={500} rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} className="mt-1 w-full rounded-md border border-border px-3 py-2.5 text-sm outline-none focus:border-brand" />
          </label>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button disabled={busy} className="w-full rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60">{busy ? "Saving..." : "Continue"}</button>
        </form>
      )}

      {step === "photo" && (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Add a real photo of you</h1>
          <div className="rounded-lg border border-brand/20 bg-brand-light p-4 text-sm text-slate-700">
            <p className="font-semibold text-brand">Your profile must use a real photo of you.</p>
            <p className="mt-2">VeraMarket is built around safer buying and selling between real people. Your profile photo will be verified using your device&apos;s front camera to help confirm that you are the person in the photo.</p>
            <p className="mt-2">Your photo should clearly show your face and should not be a logo, avatar, illustration, or photo of another person.</p>
          </div>
          <div className="flex items-center gap-4">
            {preview || info.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview ?? info.photoUrl ?? ""} alt="Your profile photo" className="h-24 w-24 rounded-full bg-slate-100 object-cover" />
            ) : (
              <span className="flex h-24 w-24 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-400">No photo</span>
            )}
            <label className="cursor-pointer rounded-md border border-border px-4 py-2 text-sm font-semibold text-brand hover:bg-brand-light">
              {preview || info.photoUrl ? "Change photo" : "Choose photo"}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4" />
            <span>I understand that I must use a real photo of myself.</span>
          </label>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("profile")} className="rounded-md border border-border px-4 py-3 text-sm font-semibold text-slate-700">Back</button>
            <button type="button" onClick={uploadPhoto} disabled={busy || !consent} className="flex-1 rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">{busy ? "Uploading..." : "Continue"}</button>
          </div>
        </div>
      )}

      {step === "camera" && (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Verify that you&apos;re really you</h1>
          <p className="text-sm text-slate-500">
            {info.provider === "persona"
              ? "We use Persona, a secure identity-verification service, to check your ID and a live selfie. First, turn on your camera to allow access in your browser."
              : info.provider === "didit-biometric"
                ? "We&apos;ll take a single selfie to check liveness and match it with your profile photo. No ID document needed."
                : "We&apos;ll use your front camera to compare you with your profile photo."}
            This helps VeraMarket create a marketplace where people know there is a real person behind an account.
          </p>
          {!info.providerConfigured && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Verification isn&apos;t configured on this server yet, so verification can&apos;t be completed right now.</p>
          )}
          <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-slate-900">
            <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
            {!cameraOn && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80">Turn on your camera, then position your face inside the frame.</div>}
            {cameraOn && <div className="pointer-events-none absolute inset-[12%] rounded-[50%] border-4 border-white/80" aria-hidden="true" />}
            {prompt && <div className="absolute inset-x-0 bottom-0 bg-black/60 p-3 text-center text-sm font-semibold text-white">{prompt}</div>}
          </div>
          <ul className="list-inside list-disc text-xs text-slate-500">
            <li>Make sure only you are in the frame and your face is well lit.</li>
            <li>{info.provider === "didit-biometric" ? "Look straight at the camera for a single capture." : "Follow the prompts on screen."} VeraMarket doesn&apos;t store your camera images.</li>
          </ul>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => { stopCamera(); setStep("photo"); }} className="rounded-md border border-border px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Back</button>
            {cameraOn ? (
              <button type="button" disabled={busy} onClick={runVerification} className="flex-1 rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60">{busy ? "Verifying..." : "Start verification"}</button>
            ) : (
              <button type="button" onClick={startCamera} className="flex-1 rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark">Turn on camera</button>
            )}
          </div>
        </div>
      )}

      {step === "phone" && (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Verify your phone number</h1>
          <p className="text-sm text-slate-500">We&apos;ll send a one-time code via SMS to confirm your phone number. This helps keep your account secure.</p>
          {!info.phoneConfigured && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Phone verification isn&apos;t configured on this server yet, so this step can&apos;t be completed right now.</p>
          )}
          <PhoneVerification verified={info.phoneVerification === "VERIFIED"} />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => { setStep("camera"); }} className="rounded-md border border-border px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Back</button>
            {info.phoneVerification === "VERIFIED" ? (
              <button type="button" disabled={busy} onClick={() => { setOutcome({ kind: "passed" }); setStep("result"); }} className="flex-1 rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60">{busy ? "Continuing..." : "Continue"}</button>
            ) : (
              <></>
            )}
          </div>
        </div>
      )}

      {step === "result" && outcome && (
        <div className="space-y-4 text-center">
          {outcome.kind === "passed" && (
            <>
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-3xl text-emerald-600">✓</span>
              <h1 className="text-2xl font-semibold tracking-tight">Identity Verified</h1>
              <p className="text-sm text-slate-500">
                You&apos;re now a Verified Person. This means you appear to match your real profile photo.
                {info.provider === "persona"
                  ? " Your identity was confirmed by our verification provider."
                  : info.provider === "didit-biometric"
                    ? " Liveness and face match were confirmed."
                    : " It isn&apos;t a government ID check."}
              </p>
              <div className="flex flex-col gap-2 pt-2">
                <Link href="/" className="rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark">Go to the marketplace</Link>
                <Link href="/sell" className="rounded-md border border-border px-4 py-3 text-sm font-semibold text-brand">Sell something</Link>
              </div>
            </>
          )}
          {outcome.kind === "unavailable" && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Verification isn&apos;t available yet</h1>
              <p className="text-sm text-slate-600">{outcome.message}</p>
              <p className="text-xs text-slate-400">Your profile and photo are saved. You can come back and verify once the service is set up.</p>
            </>
          )}
          {outcome.kind === "pending" && (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Verification in progress</h1>
              <p className="text-sm text-slate-600">Your verification is being reviewed. You&apos;ll be marked as verified once it&apos;s confirmed. This can take a few minutes.</p>
              <button type="button" onClick={() => window.location.reload()} className="rounded-md border border-border px-4 py-3 text-sm font-semibold text-slate-700">Check again</button>
            </>
          )}
          {outcome.kind === "failed" && (
            <div className="space-y-4 text-left">
              <h1 className="text-center text-2xl font-semibold tracking-tight">We couldn&apos;t verify your photo</h1>
              <p className="text-center text-sm text-slate-600">
                {outcome.message ??
                  (outcome.code
                    ? (outcome.code in DIDIT_FAILURE_MESSAGES
                        ? DIDIT_FAILURE_MESSAGES[outcome.code as DiditFailureCode]
                        : FACE_FAILURE_MESSAGES[outcome.code as FaceFailureCode])
                    : "We couldn't complete verification.")}
              </p>
              <div className="rounded-lg border border-border bg-white p-4 text-sm text-slate-600">
                <p className="font-semibold text-foreground">Try again</p>
                <ul className="mt-2 list-inside list-disc space-y-1">
                  <li>Move somewhere with better lighting</li>
                  <li>Remove anything covering your face</li>
                  <li>Make sure only you are in the camera frame</li>
                  <li>Look directly at the camera</li>
                  <li>Use a clear, recent profile photograph</li>
                </ul>
                {typeof outcome.attemptsRemaining === "number" && <p className="mt-3 text-xs text-slate-400">{outcome.attemptsRemaining} attempt(s) left today.</p>}
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep("photo")} className="flex-1 rounded-md border border-border px-4 py-3 text-sm font-semibold text-slate-700">Change photo</button>
                <button type="button" onClick={() => { setOutcome(null); setStep("camera"); }} className="flex-1 rounded-md bg-brand px-4 py-3 text-sm font-semibold text-white hover:bg-brand-dark">Try again</button>
              </div>
              <p className="text-center text-xs text-slate-400">Still stuck? Contact VeraMarket support to recover access to verification.</p>
            </div>
          )}
          {outcome.kind === "unavailable" && (
            <button type="button" onClick={() => { setOutcome(null); setStep("camera"); }} className="rounded-md border border-border px-4 py-3 text-sm font-semibold text-slate-700">Back</button>
          )}
        </div>
      )}
    </div>
  );
}
