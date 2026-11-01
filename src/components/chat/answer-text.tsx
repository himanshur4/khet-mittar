"use client";

import { Fragment } from "react";

/** Inline: **bold** and citation markers [S1] / [S1, S2] rendered as small superscript badges. */
function renderInline(text: string, onCite?: (id: string) => void) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[S\d+(?:\s*,\s*S\d+)*\])/g);
  return parts.map((part, i) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const cite = /^\[(S\d+(?:\s*,\s*S\d+)*)\]$/.exec(part);
    if (cite) {
      return (
        <sup key={i} className="ml-0.5 whitespace-nowrap">
          {cite[1]!.split(/\s*,\s*/).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onCite?.(id)}
              className="mx-px rounded bg-primary/10 px-1 text-[0.65rem] font-semibold text-primary hover:bg-primary/20"
              aria-label={`Source ${id}`}
            >
              {id}
            </button>
          ))}
        </sup>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d{1,2}[.)]\s+/;

/** Small, safe markdown subset (no HTML injection: everything is rendered as React text). */
export function AnswerText({ text, onCite }: { text: string; onCite?: (id: string) => void }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim());
        if (lines.length > 0 && lines.every((l) => BULLET.test(l))) {
          return (
            <ul key={bi} className="list-disc space-y-1 pl-5">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(BULLET, ""), onCite)}</li>
              ))}
            </ul>
          );
        }
        if (lines.length > 0 && lines.every((l) => NUMBERED.test(l))) {
          return (
            <ol key={bi} className="list-decimal space-y-1 pl-5">
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(NUMBERED, ""), onCite)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {BULLET.test(l) ? (
                  <>• {renderInline(l.replace(BULLET, ""), onCite)}</>
                ) : (
                  renderInline(l, onCite)
                )}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
