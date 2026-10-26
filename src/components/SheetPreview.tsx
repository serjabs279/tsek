import { useEffect, useState } from 'react';
import type { Exam, Learner } from '../types';
import { buildExamLayout, markerRect } from '../omr/layout';
import { makeQrDataUrl, makeSheetQrPayload } from '../omr/qr';

export function SheetPreview({
  exam,
  learner,
  schoolName,
  includeQr = true,
  includeName = true,
}: {
  exam: Exam;
  learner: Learner | null;
  schoolName: string;
  includeQr?: boolean;
  includeName?: boolean;
}) {
  const layout = buildExamLayout(exam);
  const [qr, setQr] = useState<string | null>(null);
  const lrn = learner?.lrn ?? '000000000000';
  const s = layout.scale;
  const left = layout.contentLeft;

  useEffect(() => {
    let active = true;
    setQr(null);
    if (!includeQr) return;
    makeQrDataUrl(makeSheetQrPayload(exam.code, lrn))
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => {
        if (active) setQr(null);
      });
    return () => {
      active = false;
    };
  }, [exam.code, lrn, includeQr]);

  const textWidth = (includeQr ? layout.qr.x - 6 : layout.width - left) - left;
  const name = includeName && learner ? learner.name : '______________________________________________';

  return (
    <div className="sheet-paper">
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label={`Answer sheet preview for ${learner?.name ?? 'a blank sheet'}`}
      >
        <rect x="0" y="0" width={layout.width} height={layout.height} fill="#ffffff" />
        <rect
          x={7.5 * s}
          y={7.5 * s}
          width={layout.width - 15 * s}
          height={layout.height - 15 * s}
          fill="none"
          stroke="#9a9284"
          strokeWidth={0.5 * s}
        />

        {layout.markers.map((marker, index) => {
          const rect = markerRect(marker, layout.markerSize);
          return (
            <rect
              key={index}
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              fill="#17140f"
            />
          );
        })}

        <text
          x={left}
          y={layout.header.schoolY}
          fontSize={Math.min(4.1 * s, (textWidth / Math.max(1, schoolName.length)) * 1.55)}
          fontWeight="700"
          fill="#211d17"
        >
          {schoolName.toUpperCase()}
        </text>
        <text x={left} y={layout.header.answerSheetY} fontSize={2.25 * s} fontWeight="700" fill="#9c4a2c">
          ANSWER SHEET
        </text>
        <text x={left} y={layout.header.titleY} fontSize={3.1 * s} fill="#6b6357">
          {exam.title}
        </text>

        <text x={left} y={layout.header.nameLabelY} fontSize={1.9 * s} fontWeight="700" fill="#6b6357">
          NAME
        </text>
        <text
          x={left}
          y={layout.header.nameY}
          fontSize={Math.min(4.5 * s, (textWidth / Math.max(1, name.length)) * 1.7)}
          fontWeight="700"
          fill="#211d17"
        >
          {name}
        </text>

        <text x={left} y={layout.header.lrnLabelY} fontSize={1.9 * s} fontWeight="700" fill="#6b6357">
          LRN
        </text>
        <text x={left} y={layout.header.lrnY} fontSize={3.7 * s} fontWeight="700" fill="#211d17">
          {learner?.lrn ?? '____________________'}
        </text>
        <text
          x={left + Math.min(textWidth * 0.52, 72 * s)}
          y={layout.header.lrnY}
          fontSize={2.4 * s}
          fontWeight="700"
          fill="#9c4a2c"
        >
          EXAM CODE {exam.code}
        </text>

        <line
          x1={left}
          y1={layout.header.dividerY}
          x2={layout.width - left}
          y2={layout.header.dividerY}
          stroke="#9a9284"
          strokeWidth={0.45 * s}
        />
        <text
          x={left}
          y={layout.header.instructionY}
          fontSize={2.15 * s}
          fill="#6b6357"
        >
          Shade the circle completely with a dark pencil. Erase changes cleanly. Do not fold or staple through the black corner marks.
        </text>

        {includeQr && qr && (
          <image
            x={layout.qr.x}
            y={layout.qr.y}
            width={layout.qr.size}
            height={layout.qr.size}
            href={qr}
          />
        )}
        {includeQr && !qr && (
          <rect
            x={layout.qr.x}
            y={layout.qr.y}
            width={layout.qr.size}
            height={layout.qr.size}
            fill="#f4efe5"
            stroke="#d8d0c2"
            strokeWidth="0.2"
          />
        )}

        {Array.from({ length: layout.grid.cols }, (_, col) => {
          const firstItem = layout.items[col * layout.grid.rows];
          if (!firstItem) return null;
          const signature = firstItem.bubbles.map((bubble) => bubble.choice).join('');
          const columnItems = layout.items.filter((_, index) => Math.floor(index / layout.grid.rows) === col);
          if (!columnItems.every((item) => item.bubbles.map((bubble) => bubble.choice).join('') === signature)) return null;
          return firstItem.bubbles.map((bubble) => (
            <text
              key={`${col}-${bubble.choice}`}
              x={bubble.x}
              y={layout.grid.legendY}
              fontSize={2.6 * s}
              fontWeight="700"
              textAnchor="middle"
              fill="#4b463d"
            >
              {bubble.choice}
            </text>
          ));
        })}

        {layout.items.map((item) => (
          <g key={item.item}>
            <text x={item.numberX} y={item.numberY + 1 * s} fontSize={2.8 * s} fill="#4b463d">
              {item.item}
            </text>
            {item.bubbles.map((bubble) => (
              <g key={bubble.choice}>
                <circle
                  cx={bubble.x}
                  cy={bubble.y}
                  r={bubble.r}
                  fill="#ffffff"
                  stroke="#4b463d"
                  strokeWidth={layout.grid.bubbleStroke}
                />
                <text
                  x={bubble.x}
                  y={bubble.y}
                  fontSize={layout.grid.bubbleLetterSize}
                  fontWeight="700"
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#4b463d"
                >
                  {bubble.choice}
                </text>
              </g>
            ))}
          </g>
        ))}

        <text x={left} y={layout.footerY} fontSize={2.1 * s} fill="#6b6357">
          {exam.subject} · {exam.quarterKey} · {exam.assessmentName}
        </text>
        <text
          x={layout.width / 2}
          y={layout.footerY}
          fontSize={2.1 * s}
          fontWeight="700"
          fill="#9c4a2c"
          textAnchor="middle"
        >
          TSEK
        </text>
        <text x={layout.width - left} y={layout.footerY} fontSize={2.1 * s} fill="#6b6357" textAnchor="end">
          {exam.code} · {exam.itemCount} items
        </text>
      </svg>
    </div>
  );
}
