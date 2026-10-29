/**
 * dsh-git4idea — commit-graph layout test (IDEA "plan A").
 *
 * IDEA does not stamp lanes newest-first. It builds a global layout index from
 * a DFS over the branch heads, ordered by branch importance, and then ranks the
 * elements VISIBLE IN EACH ROW (the commit node plus the edges that cross the
 * row) with GraphElementComparatorByLayoutIndex. A column is therefore a dense
 * per-row rank, and it compacts as soon as a wire dies.
 *
 * The port lives in buildRows + edgeSegments, both pure and closed over
 * nothing, so they are lifted straight out of the client half and driven here.
 * The reference is IntelliJ's log on the repo the user compared: lanes
 * 0,0,1,2,3,1,1,2,4,4,... for the merge head, master and its trunk.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'src', 'client.js'), 'utf8')

/** Lift a factory-level function out of the client half (it closes over nothing). */
function liftedFunction(functionName) {
  const marker = 'function ' + functionName + '('
  const start = source.indexOf(marker)
  assert.ok(start >= 0, functionName + ' is gone from the client half')
  let depth = 0
  let end = -1
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) { end = index + 1; break }
    }
  }
  assert.ok(end > start, functionName + ' has unbalanced braces')
  return new Function(source.slice(start, end) + '; return ' + functionName + ';')()
}

const buildRows = liftedFunction('buildRows')
const edgeSegments = liftedFunction('edgeSegments')
const laneX = (lane) => 8 + lane * 16
const segmentsOf = (row) => edgeSegments(row, laneX, 13, 26)

/**
 * v0.5.4 near-miss: GraphCell was taught to read GRAPH_MAX_LANES but the
 * constant itself never made it into the file — the empty-state render and the
 * pure layout test both passed, while every real page died with a
 * ReferenceError that the panel's error boundary swallowed. The graph is
 * not exercised by either of those, so the reference check lives here.
 */
function assertIdentifiersDeclared(functionName) {
  const start = source.indexOf('function ' + functionName + '(props) {')
  assert.ok(start >= 0, functionName + ' is gone from the client half')
  let depth = 0
  let end = -1
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) { end = index + 1; break }
    }
  }
  assert.ok(end > start, functionName + ' has unbalanced braces')
  const body = source.slice(start, end)
    // identifiers only: drop comments and string literals first, or 'HEAD' and
    // prose words inside a comment read as constant references.
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  const names = new Set()
  for (const match of body.matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)) names.add(match[1])
  for (const name of names) {
    assert.ok(
      source.indexOf('const ' + name + ' =') >= 0,
      functionName + ' reads ' + name + ', but nothing in the client half declares it',
    )
  }
}

test('every module-level constant GraphCell reads is actually declared', () => {
  assertIdentifiersDeclared('GraphCell')
})

const commit = (hash, parents, refs) => ({ hash, parents, refs: refs === undefined ? [] : refs, subject: hash })

test('a straight line stays on column 0 and draws no stray wire', () => {
  const rows = buildRows([
    commit('a', ['b']),
    commit('b', ['c']),
    commit('c', []),
  ])
  assert.deepEqual(rows.map((row) => row.lane), [0, 0, 0])
  assert.deepEqual(rows[0].top, [], 'the tip has nothing above it')
  assert.deepEqual(rows[2].bottom, [], 'a root commit has nothing below it')
  assert.equal(rows[0].bottom.length, 1, 'one edge leaves the tip')
  assert.deepEqual([rows[0].bottom[0].from, rows[0].bottom[0].to], [0, 0], 'adjacent parents ride the same column')
})

/* IDEA ranks a merge so the side branch opens a NEW column to the RIGHT of the
   trunk, then closes it: the exact shape of the report. */
test('a merge opens a column right of the trunk and closes it again', () => {
  const rows = buildRows([
    commit('m', ['a', 'b']),
    commit('a', ['base']),
    commit('b', ['base']),
    commit('base', []),
  ])
  assert.deepEqual(rows.map((row) => row.lane), [0, 0, 1, 0], 'm and a on column 0, b on column 1, base back on 0')
  const opened = rows[0].bottom.find((piece) => piece.to !== 0)
  assert.ok(opened !== undefined, 'the second parent opens a diagonal')
  assert.equal(opened.from, 0, 'it starts at the merge node on column 0')
  assert.equal(opened.to, 0.5, 'its half ends on the border halfway to column 1')
  const landing = rows[1].top.find((piece) => piece.from === 0.5)
  assert.ok(landing !== undefined, 'column 1 continues in the next row from the same border x')
})

/* The real regression: master (origin/master) is laid out LEFT of the current
   branch even when the merge commit that names HEAD was loaded first. */
test('branch importance decides the column, not load order', () => {
  const rows = buildRows([
    commit('mergeTip', ['side', 'master'], ['HEAD -> merge/20261020']),
    commit('master', ['base'], ['origin/master', 'master']),
    commit('side', ['base'], ['origin/merge/20261020']),
    commit('base', []),
  ])
  assert.equal(rows[0].lane, 0, 'HEAD keeps the leftmost visible column')
  assert.equal(rows[1].lane, 0, 'master stays on column 0 under HEAD')
  assert.equal(rows[2].lane, 1, 'the merge side branch moves to column 1')
  assert.equal(rows[3].lane, 0, 'the shared base returns to the trunk column')
})

test('a wire passing several rows keeps one column in every crossed row', () => {
  const rows = buildRows([
    commit('tip', ['side', 'trunk'], ['HEAD -> main']),
    commit('side', ['trunk'], ['origin/side']),
    commit('trunk', ['base'], ['origin/master']),
    commit('base', []),
  ])
  const trunkEdge = rows[0].bottom.find((piece) => piece.from === 0 && piece.to === 0)
  assert.ok(trunkEdge !== undefined, 'the first parent leaves on column 0')
  for (let row = 1; row < 3; row += 1) {
    const wire = rows[row].top.find((piece) => piece.to === rows[row].lane)
    assert.ok(wire !== undefined, 'the trunk enters the node centre in row ' + row)
  }
})

/* IDEA colours an edge with the UP (child) commit's column; the node keeps its
   own. A merge edge therefore never repaints the trunk it joins. */
test('an edge takes the child colour, the node keeps its own', () => {
  const rows = buildRows([
    commit('m', ['a', 'b'], ['HEAD -> main']),
    commit('a', ['base']),
    commit('b', ['base']),
    commit('base', []),
  ])
  const side = rows[0].bottom.find((piece) => piece.to !== 0)
  assert.equal(side.color, rows[0].lane, 'the merge edge carries the child column colour')
  const trunk = rows[1].top.find((piece) => piece.to === rows[1].lane && piece.from === piece.to)
  assert.equal(trunk.color, 0, 'the trunk wire keeps the colour it was opened with')
})

/* IDEA paints one straight line from a node centre to the next node centre and
   clips it to the cell, so each row draws one half: the halves meet on the row
   border at the midpoint of the two columns and share one slope. */
test('the two halves of a lane change are one straight line across the border', () => {
  const rows = buildRows([
    commit('m', ['a', 'b']),
    commit('a', ['base']),
    commit('b', ['base']),
    commit('base', []),
  ])
  const bottom = segmentsOf(rows[0]).find((segment) => segment.y1 === 13 && segment.x2 !== laneX(0))
  assert.ok(bottom !== undefined, 'the diagonal leaves the merge node')
  const top = segmentsOf(rows[1]).find((segment) => segment.y1 === 0 && segment.x1 === bottom.x2)
  assert.ok(top !== undefined, 'the next row continues from the same border x')
  assert.equal(
    (bottom.x2 - bottom.x1) / (bottom.y2 - bottom.y1),
    (top.x2 - top.x1) / (top.y2 - top.y1),
    'both halves share one slope',
  )
})

test('every bottom piece meets the next row top piece at the border', () => {
  const rows = buildRows([
    commit('tip', ['a', 'b'], ['HEAD -> main']),
    commit('a', ['c']),
    commit('b', ['c'], ['origin/b']),
    commit('c', ['d']),
    commit('d', []),
  ])
  for (let row = 0; row + 1 < rows.length; row += 1) {
    for (const piece of rows[row].bottom) {
      const next = rows[row + 1].top.filter((candidate) => candidate.wire === piece.wire)
      if (next.length === 0) continue // the wire ends at the node one row below
      assert.equal(next[0].from, piece.to, 'wire ' + piece.wire + ' meets at the border between rows ' + row + ' and ' + (row + 1))
      assert.equal(next[0].color, piece.color, 'a wire keeps its colour across the border')
    }
  }
})

/* The log is a WINDOW: a parent that was never loaded contributes no edge, and
   the column simply ends at its commit instead of parking a ghost. */
test('a parent beyond the loaded window ends its column', () => {
  const rows = buildRows([commit('a', ['ghost'])])
  assert.equal(rows[0].lane, 0)
  assert.deepEqual(rows[0].bottom, [], 'no edge can land on an unloaded parent')
  assert.deepEqual(rows[0].top, [], 'nothing above the first row')
})

test('a merge whose second parent is unloaded opens no extra column', () => {
  const rows = buildRows([
    commit('m', ['ghost', 'a']),
    commit('a', []),
  ])
  assert.equal(rows[0].width, 1, 'the ghost must not widen the graph')
  assert.equal(rows[0].bottom.length, 1, 'only the loaded parent gets an edge')
  assert.deepEqual([rows[0].bottom[0].from, rows[0].bottom[0].to], [0, 0])
  assert.equal(rows[1].lane, 0)
})

test('a side branch that merges back compacts the freed column', () => {
  const rows = buildRows([
    commit('m', ['a', 'b']),
    commit('a', ['base']),
    commit('b', ['base'], ['origin/b']),
    commit('base', ['root']),
    commit('root', []),
  ])
  assert.equal(rows[1].lane, 1, 'the merge side branch opens column 1')
  assert.equal(rows[2].lane, 0, "origin/b wins the trunk column because it outranks the unnamed head")
  assert.equal(rows[3].lane, 0, 'base returns to the trunk column')
  assert.equal(rows[3].width, 2, 'no ghost column survives the merge-back')
  assert.equal(rows[4].lane, 0, 'the trunk continues on column 0')
  for (const row of rows) {
    for (const piece of row.top.concat(row.bottom)) {
      assert.ok(piece.from >= 0 && piece.to >= 0, 'a column is never negative')
      assert.ok(piece.from <= row.width && piece.to <= row.width, 'a column stays inside the row width')
    }
  }
})
