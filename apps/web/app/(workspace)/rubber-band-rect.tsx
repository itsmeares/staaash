export type RubberBand = {
  currentX: number;
  currentY: number;
  startX: number;
  startY: number;
};

export function RubberBandRect({
  rubberBand,
}: {
  rubberBand: RubberBand | null;
}) {
  if (!rubberBand) return null;

  return (
    <div
      className="rubber-band-rect"
      style={{
        left: Math.min(rubberBand.startX, rubberBand.currentX),
        top: Math.min(rubberBand.startY, rubberBand.currentY),
        width: Math.abs(rubberBand.currentX - rubberBand.startX),
        height: Math.abs(rubberBand.currentY - rubberBand.startY),
      }}
      aria-hidden
    />
  );
}
