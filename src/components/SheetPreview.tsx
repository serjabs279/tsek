import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Exam, Learner } from '../types';
import { buildExamLayout, markerRect, pageSize } from '../omr/layout';
import { makeQrDataUrl, makeSheetQrPayload } from '../omr/qr';
import type { WrittenPagePlan } from '../lib/written';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/**
 * pdf-lib draws text in points, but this SVG is measured in millimetres. The
 * written panel shares its sizes with the PDF, so convert them here or the
 * preview shows text almost three times its printed size.
 */
const PT = 0.352778;

/** Shrink a text size until the string roughly fits the width, in millimetres. */
function fitSize(text: string, maxWidth: number, preferred: number, minimum: number): number {
  let size = preferred;
  while (size > minimum && text.length * size * 0.56 > maxWidth) size -= 0.5;
  return size;
}

/**
 * The written half of a combined folio page, drawn with the same geometry the
 * PDF uses so the preview matches the print.
 */
function WrittenPanel({
  exam,
  learner,
  page,
  totalPages,
}: {
  exam: Exam;
  learner: Learner | null;
  page: WrittenPagePlan;
  totalPages: number;
}) {
  const geom = page.geometry;
  const right = geom.width - geom.margin;
  const contentWidth = geom.width - geom.margin * 2;
  const pageLabel = `PAGE 1 OF ${totalPages}`;
  const lrn = learner?.lrn ?? '____________________';
  const rulePitch = geom.longPitch ?? 8.5;

  const partNodes: ReactNode[] = [];
  let top = geom.headerBottom;
  page.parts.forEach((part, partIndex) => {
    const heading = `PART ${ROMAN[part.sectionIndex] ?? part.sectionIndex + 1}  ·  ${part.title.toUpperCase()}${part.continued ? '  (CONTINUED)' : ''}`;
    const meta = `${part.itemCount} item${part.itemCount === 1 ? '' : 's'} · ${part.pointsPerItem} pt each`;
    const metaWidth = meta.length * 5.2 * PT * 0.56;
    const entryNodes: ReactNode[] = [];
    let entryTop = top + geom.partHeading;

    part.entries.forEach((entry, entryIndex) => {
      entryNodes.push(
        <g key={`entry-${entryIndex}`}>
          <text x={geom.margin} y={entryTop + 4.5} fontSize={6.5 * PT} fill="#6b6357">
            {entry.number}.
          </text>
          {Array.from({ length: entry.lines }, (_, line) => (
            <line
              key={line}
              x1={geom.margin + geom.numberColumn}
              y1={entryTop + 5.5 + line * rulePitch}
              x2={right}
              y2={entryTop + 5.5 + line * rulePitch}
              stroke="#9a9284"
              strokeWidth={0.45}
            />
          ))}
        </g>
      );
      entryTop += entry.height;
    });

    partNodes.push(
      <g key={`part-${partIndex}`}>
        <text
          x={geom.margin}
          y={top + 4.2}
          fontSize={fitSize(heading, contentWidth - metaWidth - 4, 6.2 * PT, 4.8 * PT)}
          fontWeight={700}
          fill="#211d17"
        >
          {heading}
        </text>
        <text x={right} y={top + 4.2} fontSize={5.2 * PT} textAnchor="end" fill="#6b6357">
          {meta}
        </text>
        <line x1={geom.margin} y1={top + 5.8} x2={right} y2={top + 5.8} stroke="#9a9284" strokeWidth={0.4} />
        {entryNodes}
      </g>
    );
    top = entryTop;
  });

  return (
    <g>
      <rect
        x={7.5}
        y={7.5}
        width={geom.width - 15}
        height={geom.height - 15}
        fill="none"
        stroke="#9a9284"
        strokeWidth={0.4}
      />
      <text x={geom.margin} y={11} fontSize={5.8 * PT} fontWeight={700} fill="#9c4a2c">
        WRITTEN ANSWERS
      </text>
      <text x={right} y={11} fontSize={5.2 * PT} textAnchor="end" fill="#6b6357">
        LRN {lrn} · {pageLabel}
      </text>
      <line x1={geom.margin} y1={14.6} x2={right} y2={14.6} stroke="#9a9284" strokeWidth={0.4} />
      {partNodes}
      <text x={geom.margin} y={geom.height - 9} fontSize={5 * PT} fill="#6b6357">
        Tsek · {exam.code}
      </text>
    </g>
  );
}

export function SheetPreview({
  exam,
  learner,
  schoolName,
  includeQr = true,
  includeName = true,
  writtenPage = null,
  writtenTotalPages = 1,
}: {
  exam: Exam;
  learner: Learner | null;
  schoolName: string;
  includeQr?: boolean;
  includeName?: boolean;
  /** Page 1 of the written plan; when present the preview is a full folio page. */
  writtenPage?: WrittenPagePlan | null;
  writtenTotalPages?: number;
}) {
  // The combined page always uses the two-up bubble layout, so both halves
  // match the printed folio.
  const sheetExam = writtenPage
    ? exam.sheetsPerPage === 2
      ? exam
      : { ...exam, sheetsPerPage: 2 as const }
    : exam;
  const layout = buildExamLayout(sheetExam);
  const [qr, setQr] = useState<string | null>(null);
  const lrn = learner?.lrn ?? '000000000000';
  const s = layout.scale;
  const left = layout.contentLeft;

  const fullPage = pageSize(exam.paper, exam.orientation);
  const combined = Boolean(writtenPage);
  const sideBySide = fullPage.width >= fullPage.height;
  // In a combined page the bubble sheet sits where the second learner would
  // have been: right half on landscape, bottom half on portrait.
  const offsetX = combined && sideBySide ? layout.width : 0;
  const offsetY = combined && !sideBySide ? layout.height : 0;
  const viewWidth = combined ? fullPage.width : layout.width;
  const viewHeight = combined ? fullPage.height : layout.height;

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
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        role="img"
        aria-label={`Answer sheet preview for ${learner?.name ?? 'a blank sheet'}${
          combined ? ', with written answers on the other half' : ''
        }`}
      >
        <rect x="0" y="0" width={viewWidth} height={viewHeight} fill="#ffffff" />

        {writtenPage && (
          <WrittenPanel
            exam={exam}
            learner={learner}
            page={writtenPage}
            totalPages={Math.max(1, writtenTotalPages)}
          />
        )}

        <g transform={`translate(${offsetX} ${offsetY})`}>
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
          <text x={left} y={layout.header.instructionY} fontSize={2.15 * s} fill="#6b6357">
            Shade the circle completely with a dark pencil. Erase changes cleanly. Do not fold or staple through the black corner marks.
          </text>

          {includeQr && qr && (
            <image x={layout.qr.x} y={layout.qr.y} width={layout.qr.size} height={layout.qr.size} href={qr} />
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
        </g>
      </svg>
    </div>
  );
}
