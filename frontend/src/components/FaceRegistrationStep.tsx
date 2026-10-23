import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Check, Circle, Upload, ScanFace, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Modal, Button, Badge } from '@/components/ui';
import { peopleService } from '@/services/peopleService';
import type { FaceRegistrationResult, Person } from '@/types';

/**
 * Face registration workflow for one person.
 *
 * The five steps the specification asks for:
 *   1. Enter personal information  — already done; the person record exists.
 *   2. Upload a face photograph    — file picker, or the device camera.
 *   3. Validate the photograph     — local courtesy checks, then the AI service.
 *   4. Register the face           — the AI service generates the embedding.
 *   5. Confirm registration status — the backend's own outcome, verbatim.
 *
 * HONESTY RULES THIS COMPONENT FOLLOWS:
 *  - The backend is authoritative. The type/size checks here only save a
 *    round-trip; whether a usable face exists is decided by the AI service.
 *  - The operator-facing outcome messages ('Face detected successfully.',
 *    'Registration photograph contains multiple faces.', 'No usable face was
 *    detected. Please upload another image.', 'Face registration completed
 *    successfully.') come from the backend and are displayed verbatim.
 *  - If recognition is unavailable, that is said plainly and the person is left
 *    visibly NOT recognition-ready. Nothing here ever implies success.
 *  - No embedding is requested, received, displayed or logged. The response
 *    carries only derived readiness flags.
 *
 * Capture-or-upload is handled by the native `capture` attribute on the file
 * input rather than a bespoke webcam pipeline.
 */

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
/** Mirrors the backend default FACE_UPLOAD_MAX_BYTES (5,000,000 decoded bytes). */
const MAX_BYTES = 5_000_000;

type Phase = 'upload' | 'ready' | 'registering' | 'done' | 'failed';

interface StepDef {
  label: string;
  done: boolean;
  current: boolean;
}

export function FaceRegistrationStep({
  open,
  person,
  onClose,
  onRegistered,
}: {
  open: boolean;
  person: Person | null;
  onClose: () => void;
  onRegistered: (person: Person) => void;
}) {
  const [phase, setPhase] = useState<Phase>('upload');
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string>('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverHint, setServerHint] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [result, setResult] = useState<FaceRegistrationResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPhase('upload');
    setImageDataUrl(null);
    setFileLabel('');
    setLocalError(null);
    setServerError(null);
    setServerHint(null);
    setUnavailable(false);
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  }, [open, person?.id]);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    setLocalError(null);
    setServerError(null);
    setServerHint(null);
    setUnavailable(false);
    setResult(null);

    const file = event.target.files?.[0];
    if (!file) return;

    // Step 3, local half. These are courtesy checks only.
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setImageDataUrl(null);
      setPhase('upload');
      setLocalError('Choose a PNG, JPEG, or WebP image.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setImageDataUrl(null);
      setPhase('upload');
      setLocalError(
        `That image is ${(file.size / 1_000_000).toFixed(1)} MB. Maximum size is ${(
          MAX_BYTES / 1_000_000
        ).toFixed(1)} MB.`
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : null;
      if (!value) {
        setLocalError('That image could not be read. Try a different file.');
        return;
      }
      setImageDataUrl(value);
      setFileLabel(file.name);
      setPhase('ready');
    };
    reader.onerror = () => setLocalError('That image could not be read. Try a different file.');
    reader.readAsDataURL(file);
  }

  async function handleRegister() {
    if (!person || !imageDataUrl) return;
    setPhase('registering');
    setServerError(null);
    setServerHint(null);
    setUnavailable(false);
    try {
      const registration = await peopleService.registerFace(person.id, imageDataUrl);
      setResult(registration);
      setPhase('done');
      onRegistered(registration.person);
    } catch (err) {
      const normalized = err as { message?: string; status?: number; details?: unknown };
      // The backend's message is already operator-facing and exact — relay it.
      setServerError(normalized.message ?? 'Face registration could not be completed.');
      const details = normalized.details;
      if (details && typeof details === 'object') {
        const hint = (details as { hint?: unknown }).hint;
        if (typeof hint === 'string') setServerHint(hint);
      }
      setUnavailable(normalized.status === 503);
      setPhase('failed');
    }
  }

  if (!person) return null;

  const registering = phase === 'registering';
  const steps: StepDef[] = [
    { label: 'Enter personal information', done: true, current: false },
    {
      label: 'Upload a face photograph',
      done: !!imageDataUrl,
      current: phase === 'upload',
    },
    {
      label: 'Validate the photograph',
      done: phase === 'done',
      current: phase === 'ready' || registering,
    },
    { label: 'Register the face', done: phase === 'done', current: registering },
    {
      label: 'Confirm registration status',
      done: phase === 'done',
      current: phase === 'done' || phase === 'failed',
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Face registration · ${person.name}`}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={registering}>
            {phase === 'done' ? 'Close' : 'Cancel'}
          </Button>
          {phase !== 'done' && (
            <Button
              size="sm"
              leftIcon={<ScanFace className="h-4 w-4" />}
              onClick={handleRegister}
              loading={registering}
              disabled={!imageDataUrl || registering}
            >
              Validate &amp; register face
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <ol className="space-y-1.5">
          {steps.map((step, index) => (
            <li key={step.label} className="flex items-center gap-2 text-xs">
              {step.done ? (
                <Check className="h-3.5 w-3.5 text-safe" aria-hidden="true" />
              ) : (
                <Circle
                  className={step.current ? 'h-3.5 w-3.5 text-brand' : 'h-3.5 w-3.5 text-content-faint'}
                  aria-hidden="true"
                />
              )}
              <span
                className={
                  step.done
                    ? 'text-content'
                    : step.current
                      ? 'text-content'
                      : 'text-content-faint'
                }
              >
                {index + 1}. {step.label}
              </span>
            </li>
          ))}
        </ol>

        <div className="rounded-lg border border-border bg-surface p-4">
          <label
            htmlFor="face-photo"
            className="mb-1.5 block text-xs font-medium text-content-muted"
          >
            Registration photograph
          </label>
          <input
            id="face-photo"
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            // Lets a phone or tablet operator capture directly instead of
            // picking a file. Desktop browsers ignore it and show the picker.
            capture="user"
            onChange={handleFile}
            disabled={registering}
            className="w-full cursor-pointer rounded-lg border border-border bg-panel px-3 py-2 text-xs text-content-muted file:mr-3 file:rounded-md file:border-0 file:bg-raised file:px-3 file:py-1.5 file:text-xs file:text-content"
          />
          <p className="mt-2 text-xs text-content-faint">
            One clearly visible face, PNG/JPEG/WebP, up to{' '}
            {(MAX_BYTES / 1_000_000).toFixed(1)} MB. These checks are a convenience — the AI
            service decides whether a usable face is present.
          </p>

          {imageDataUrl && (
            <div className="mt-3 flex items-start gap-3">
              <img
                src={imageDataUrl}
                alt={`Selected registration photograph for ${person.name}`}
                className="h-24 w-24 rounded-lg border border-border object-cover"
              />
              <div className="min-w-0 text-xs">
                <p className="flex items-center gap-1.5 text-content">
                  <Upload className="h-3.5 w-3.5 text-content-faint" aria-hidden="true" />
                  <span className="truncate">{fileLabel}</span>
                </p>
                <p className="mt-1 text-content-faint">
                  Preview only — this image has not been submitted yet.
                </p>
              </div>
            </div>
          )}

          {localError && (
            <p className="mt-3 rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-xs text-critical">
              {localError}
            </p>
          )}
        </div>

        {phase === 'done' && result && (
          <div className="space-y-2 rounded-lg border border-safe/30 bg-safe/10 p-4 text-xs">
            <p className="flex items-center gap-2 font-medium text-safe">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              {result.detectionMessage}
            </p>
            <p className="text-content">{result.message}</p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge tone={result.person.recognitionReady ? 'safe' : 'warning'}>
                {result.person.recognitionReady ? 'Recognition ready' : 'Recognition not ready'}
              </Badge>
              {result.person.embeddingModel && (
                <span className="text-content-faint">
                  Model: {result.person.embeddingModel}
                  {result.person.embeddingDim ? ` · ${result.person.embeddingDim}-d vector` : ''}
                </span>
              )}
            </div>
            {!result.person.recognitionEnabled && (
              <p className="text-warning">
                Recognition is currently disabled for this person, so they will not be matched until
                it is enabled.
              </p>
            )}
          </div>
        )}

        {phase === 'failed' && serverError && (
          <div className="space-y-2 rounded-lg border border-critical/30 bg-critical/10 p-4 text-xs">
            <p className="flex items-center gap-2 font-medium text-critical">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {serverError}
            </p>
            {serverHint && <p className="text-content">{serverHint}</p>}
            <p className="text-content-muted">
              {unavailable
                ? 'No face data was stored. This person is not recognition-ready, and the system will not pretend otherwise.'
                : 'Nothing was stored. Upload a different photograph and try again.'}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
