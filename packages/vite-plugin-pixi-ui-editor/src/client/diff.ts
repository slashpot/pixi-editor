export interface DiffLine {
  kind: ' ' | '-' | '+';
  text: string;
}

export interface Hunk {
  /** 1-based line of the hunk's first line in `before` / `after`. */
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

/** Line diff of `before` → `after`, as unified-diff hunks with `context` unchanged lines around changes. */
export function diffLines(before: string, after: string, context = 3): Hunk[] {
  const a = before.split('\n');
  const b = after.split('\n');
  // editor changes are small: trimming the common head and tail keeps the LCS table tiny
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a.at(-1 - tail) === b.at(-1 - tail)) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);

  // lcs[i][j]: longest common subsequence of x[i..] and y[j..]
  const lcs = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const same = (text: string): DiffLine => ({ kind: ' ', text });
  const ops = a.slice(0, head).map(same);
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      ops.push(same(x[i++]));
      j++;
    } else if (i < x.length && (j === y.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
      ops.push({ kind: '-', text: x[i++] });
    } else {
      ops.push({ kind: '+', text: y[j++] });
    }
  }
  ops.push(...a.slice(a.length - tail).map(same));

  let oldNo = 1;
  let newNo = 1;
  const numbered = ops.map((line) => {
    const at = { line, oldNo, newNo };
    if (line.kind !== '+') oldNo++;
    if (line.kind !== '-') newNo++;
    return at;
  });
  const hunks: Hunk[] = [];
  for (let k = 0; k < numbered.length;) {
    if (numbered[k].line.kind === ' ') {
      k++;
      continue;
    }
    // changes closer than two contexts apart share a hunk
    let last = k;
    for (let s = k; s < numbered.length && s - last <= 2 * context; s++) {
      if (numbered[s].line.kind !== ' ') last = s;
    }
    const part = numbered.slice(Math.max(0, k - context), Math.min(numbered.length, last + context + 1));
    hunks.push({ oldStart: part[0].oldNo, newStart: part[0].newNo, lines: part.map((p) => p.line) });
    k = last + context + 1;
  }
  return hunks;
}
