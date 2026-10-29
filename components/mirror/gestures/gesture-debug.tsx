'use client';

import type { GestureAction } from '@/lib/gestures';
import { cameraLine } from '@/lib/mirror/camera';
import {
  CAMERA_DEBUG_TEXT,
  actionLabel,
  debugDrawing,
  handsLabel,
  presenceLabel,
  recognizedLabel,
} from '@/lib/mirror/gestures';
import type { CameraFrame, CameraState } from './camera';
import { useStore, type Store } from './store';

// ?gestures=debug sur le miroir (docs/conception.md §5) : pour régler les seuils derrière la vitre. Sur noir, les
// zones (traits gris), les mains (point plein : armée ; cercle : au repos ou bloquée), et en texte le
// délégué, les images/s, la présence, le geste reconnu et son score, l'état des mains (avec le |u|
// le plus petit de leur dernier armement) et le dernier geste parti. Jamais
// l'image de la caméra : seulement des repères, retournés comme un miroir (x écran = 1 − x caméra).

export type DebugSnapshot = {
  frame: CameraFrame;
  /** Dernier résultat du Gesture Recognizer (il tourne moins souvent que PoseLandmarker). */
  recognized: { category: string; score: number } | null;
  lastAction: GestureAction | null;
};

const ZONE = '#cccccc';
const FAINT = '#777777';
const HAND = '#ffffff';

export function GestureDebug({
  debug,
  camera,
}: {
  debug: Store<DebugSnapshot | null>;
  camera: Store<CameraState>;
}) {
  const snapshot = useStore(debug, null);
  const state = useStore(camera, { status: 'off', delegate: null });
  const frame = snapshot?.frame ?? null;
  const drawing = frame ? debugDrawing(frame.output, frame.aspect) : null;
  const running = state.status === 'running';
  const mirrorLine = cameraLine(state.status) !== null;

  return (
    // Le texte en haut, sous la ligne de la caméra du miroir (elle finit au haut de la toile) ; le
    // cadre de l'image analysée dans la place qui reste dessous : aucun trait ne traverse le texte,
    // quel que soit le format de l'image (paysage sur le PC, portrait sur la tablette).
    <div data-testid="mirror-gestures-debug" className="pointer-events-none fixed inset-0 z-10 flex flex-col pt-44">
      {/* Quand le miroir dit déjà ce qui ne va pas (refusée, occupée, gestes indisponibles), le debug
          ne le répète pas par-dessus. */}
      <div className="flex flex-col px-10 text-left text-mirror-sm text-mirror-dim">
        {!mirrorLine && (
          <p data-testid="debug-camera">
            {running && frame
              ? `${frame.delegate} · ${frame.poseFps} im/s · gestes ${frame.recognizerFps} im/s`
              : running
                ? `${state.delegate ?? ''} · en attente d’une image`
                : CAMERA_DEBUG_TEXT[state.status]}
          </p>
        )}
        {running && frame && (
          <>
            <p data-testid="debug-presence">{presenceLabel(frame.output)}</p>
            <p data-testid="debug-recognized">
              {snapshot?.recognized ? recognizedLabel(snapshot.recognized) : 'Aucune main reconnue'}
            </p>
            <p data-testid="debug-hands">{handsLabel(frame.output.hands)}</p>
            <p data-testid="debug-action">
              Dernier geste : {snapshot?.lastAction ? actionLabel(snapshot.lastAction) : '—'}
            </p>
          </>
        )}
      </div>

      {drawing && running && (
        <svg
          data-testid="mirror-gestures-zones"
          viewBox={`0 0 ${drawing.width} 1`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden
          focusable={false}
          className="mt-4 min-h-0 w-full flex-1"
        >
          {/* Le cadre de l'image analysée, sans l'image. */}
          <rect
            data-testid="debug-frame"
            x={0}
            y={0}
            width={drawing.width}
            height={1}
            fill="none"
            stroke={FAINT}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {drawing.rects.map((rect) => (
            <rect
              key={rect.id}
              data-zone={rect.id}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              fill="none"
              stroke={ZONE}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {drawing.lines.map((line) => (
            <line
              key={line.id}
              data-zone={line.id}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke={line.id === 'waist' ? FAINT : ZONE}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {drawing.hands.map((hand) => (
            <circle
              key={hand.side}
              data-hand={hand.side}
              data-state={hand.state}
              cx={hand.x}
              cy={hand.y}
              r={0.018}
              fill={hand.state === 'armed' ? HAND : 'none'}
              stroke={HAND}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}
    </div>
  );
}
