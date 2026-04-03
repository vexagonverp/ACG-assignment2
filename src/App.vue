<script setup lang="ts">
import { ref, computed } from 'vue'
import { safe, circumcircle, triangleArea, minAngle, pointInTriangle } from './geometry'
import type { Point, TriangleInfo } from './geometry'
import { bowyerWatson } from './triangulation'
import { convexHull } from './hull'
import { refineOnce } from './refinement'

// ─── State ──────────────────────────────────────────────────────────

function generateRandom(): Point[] {
  return Array.from({ length: 28 }, () => ({
    x: 50 + Math.random() * 600,
    y: 50 + Math.random() * 500
  }))
}

const points = ref<Point[]>(generateRandom())          // original user points
const addedPoints = ref<Point[]>([])                    // points added by refinement
const maxArea = ref(8000)                               // area threshold for "bad" triangles
const minAngleThreshold = ref(20)                       // angle threshold (degrees) for "bad" triangles
const showCircumcircles = ref(false)                    // toggle circumcircle overlay
const selectedTriIdx = ref(-1)                          // index of clicked triangle (-1 = none)
const originalHull = ref<Point[]>(convexHull(points.value)) // boundary of original points

// ─── Computed ───────────────────────────────────────────────────────

// All points = original + refinement-added
const allPoints = computed(() => [...points.value, ...addedPoints.value])

// Run Bowyer-Watson on all points, then compute quality metrics per triangle
const triangleData = computed<TriangleInfo[]>(() => {
  return bowyerWatson(allPoints.value).map(tri => {
    const [p1, p2, p3] = tri.p
    const area = triangleArea(p1, p2, p3)
    const angle = minAngle(p1, p2, p3)
    const cc = circumcircle(p1, p2, p3)
    const bigArea = area > maxArea.value
    const smallAngle = angle < minAngleThreshold.value
    return { p1, p2, p3, area, angle, cc, bigArea, smallAngle, bad: bigArea || smallAngle }
  })
})

// Summary statistics for the stats bar
const stats = computed(() => {
  const tris = triangleData.value
  const badCount = tris.filter(t => t.bad).length
  const avgAngle = tris.length > 0
    ? tris.reduce((sum, t) => sum + t.angle, 0) / tris.length
    : 0
  return {
    pointCount: allPoints.value.length,
    addedCount: addedPoints.value.length,
    triCount: tris.length,
    badCount,
    avgAngle: avgAngle.toFixed(1)
  }
})

// Info panel for the currently selected (clicked) triangle
const selectedTri = computed(() => {
  const idx = selectedTriIdx.value
  if (idx < 0 || idx >= triangleData.value.length) return null
  const t = triangleData.value[idx]
  return {
    area: t.area.toFixed(1),
    angle: t.angle.toFixed(1),
    circumR: t.cc ? t.cc.r.toFixed(1) : 'N/A'
  }
})

// ─── Actions ────────────────────────────────────────────────────────

function randomize() {
  points.value = generateRandom()
  addedPoints.value = []
  originalHull.value = convexHull(points.value)
  selectedTriIdx.value = -1
}

function refineStep() {
  const newPts = refineOnce(triangleData.value, allPoints.value, originalHull.value)
  if (newPts.length > 0) {
    addedPoints.value = [...addedPoints.value, ...newPts]
    selectedTriIdx.value = -1
  }
}

function refineAll() {
  for (let i = 0; i < 100; i++) {
    if (triangleData.value.every(t => !t.bad)) break
    const before = addedPoints.value.length
    refineStep()
    if (addedPoints.value.length === before) break // no progress, stop
  }
}

function resetAdded() {
  addedPoints.value = []
  selectedTriIdx.value = -1
}

// Convert mouse click to SVG coordinates, then select a triangle or add a point
function handleSvgClick(e: MouseEvent) {
  const svg = e.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  const x = (e.clientX - rect.left) * (700 / rect.width)
  const y = (e.clientY - rect.top) * (600 / rect.height)

  // Try to select a triangle under the cursor
  for (let i = 0; i < triangleData.value.length; i++) {
    const t = triangleData.value[i]
    if (pointInTriangle(x, y, t.p1, t.p2, t.p3)) {
      selectedTriIdx.value = i
      return
    }
  }

  // No triangle hit — add a new point at click location
  points.value = [...points.value, { x, y }]
  originalHull.value = convexHull(points.value)
  selectedTriIdx.value = -1
}

// ─── SVG helpers ────────────────────────────────────────────────────

// Color-code triangles: green=good, orange=big, yellow=skinny, red=both, purple=selected
function triColor(t: TriangleInfo, idx: number): string {
  if (idx === selectedTriIdx.value) return 'rgba(124,58,237,0.25)'  // purple (selected)
  if (t.bigArea && t.smallAngle) return 'rgba(220,38,38,0.18)'     // red (both bad)
  if (t.bigArea) return 'rgba(234,88,12,0.15)'                     // orange (too big)
  if (t.smallAngle) return 'rgba(202,138,4,0.15)'                  // yellow (too skinny)
  return 'rgba(16,185,129,0.08)'                                    // green (good)
}

function triStroke(idx: number): string {
  return idx === selectedTriIdx.value ? 'rgba(124,58,237,0.7)' : 'rgba(100,116,139,0.35)'
}

function triPoints(t: TriangleInfo): string {
  return [[t.p1.x, t.p1.y], [t.p2.x, t.p2.y], [t.p3.x, t.p3.y]]
    .map(([x, y]) => `${safe(x)},${safe(y)}`)
    .join(' ')
}

function isAddedPoint(p: Point): boolean {
  return addedPoints.value.includes(p)
}
</script>

<template>
  <div class="app">
    <h1>Delaunay Triangulation Refinement</h1>

    <div class="controls">
      <div class="control-row">
        <button @click="randomize">Random</button>
        <button class="accent" @click="refineStep">Refine Step</button>
        <button class="accent" @click="refineAll">Refine All</button>
        <button @click="resetAdded">Reset</button>
        <label class="checkbox-label">
          <input type="checkbox" v-model="showCircumcircles" /> Circumcircles
        </label>
      </div>

      <div class="control-row">
        <label>
          Max Area: {{ maxArea }}
          <input type="range" :min="500" :max="25000" v-model.number="maxArea" />
        </label>
        <label>
          Min Angle: {{ minAngleThreshold }}°
          <input type="range" :min="5" :max="30" v-model.number="minAngleThreshold" />
        </label>
      </div>
    </div>

    <svg viewBox="0 0 700 600" class="canvas" @click="handleSvgClick">
      <rect x="0" y="0" width="700" height="600" fill="#f8fafc" />

      <!-- Triangles (color-coded by quality) -->
      <polygon
        v-for="(t, i) in triangleData"
        :key="'tri-' + i"
        :points="triPoints(t)"
        :fill="triColor(t, i)"
        :stroke="triStroke(i)"
        stroke-width="1"
      />

      <!-- Optional circumcircle overlay (dashed circles + center dots) -->
      <template v-if="showCircumcircles">
        <template v-for="(t, i) in triangleData" :key="'cc-' + i">
          <circle
            v-if="t.cc && isFinite(t.cc.x) && isFinite(t.cc.y) && isFinite(t.cc.r) && t.cc.r < 500"
            :cx="safe(t.cc.x)" :cy="safe(t.cc.y)" :r="safe(t.cc.r)"
            fill="none" stroke="rgba(59,130,246,0.25)" stroke-width="0.8" stroke-dasharray="4 3"
          />
          <circle
            v-if="t.cc && isFinite(t.cc.x) && isFinite(t.cc.y) && t.cc.r < 500"
            :cx="safe(t.cc.x)" :cy="safe(t.cc.y)" r="2" fill="rgba(59,130,246,0.4)"
          />
        </template>
      </template>

      <!-- Points (white = original, purple = added by refinement) -->
      <circle
        v-for="(p, i) in allPoints"
        :key="'pt-' + i"
        :cx="safe(p.x)" :cy="safe(p.y)"
        :r="isAddedPoint(p) ? 3 : 3.5"
        :fill="isAddedPoint(p) ? '#7c3aed' : '#1e293b'"
        stroke="#fff" stroke-width="0.8"
      />
    </svg>

    <div class="stats-bar">
      <span>Points: <b>{{ stats.pointCount }}</b></span>
      <span>Added: <b>{{ stats.addedCount }}</b></span>
      <span>Triangles: <b>{{ stats.triCount }}</b></span>
      <span>Bad: <b :class="{ warn: stats.badCount > 0 }">{{ stats.badCount }}</b></span>
      <span>Avg min angle: <b>{{ stats.avgAngle }}°</b></span>
    </div>

    <div v-if="selectedTri" class="selected-info">
      <span>Area: <b>{{ selectedTri.area }}</b></span>
      <span>Min angle: <b>{{ selectedTri.angle }}°</b></span>
      <span>Circumradius: <b>{{ selectedTri.circumR }}</b></span>
    </div>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background: #ffffff;
  color: #475569;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 14px;
}

.app {
  max-width: 780px;
  margin: 0 auto;
  padding: 24px 16px;
}

h1 {
  color: #0f172a;
  font-size: 22px;
  font-weight: 600;
  margin-bottom: 16px;
  text-align: center;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

button {
  background: #f1f5f9;
  color: #334155;
  border: 1px solid #cbd5e1;
  padding: 6px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}

button:hover {
  background: #e2e8f0;
}

button.accent {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
}

button.accent:hover {
  background: #dbeafe;
}

label {
  color: #475569;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

input[type="range"] {
  width: 140px;
  accent-color: #3b82f6;
}

.checkbox-label {
  cursor: pointer;
  user-select: none;
}

input[type="checkbox"] {
  accent-color: #3b82f6;
}

.canvas {
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: crosshair;
  display: block;
}

.stats-bar {
  display: flex;
  gap: 16px;
  padding: 10px 0;
  flex-wrap: wrap;
  font-size: 13px;
}

.stats-bar b {
  color: #0f172a;
}

.stats-bar .warn {
  color: #dc2626;
}

.selected-info {
  display: flex;
  gap: 16px;
  padding: 8px 12px;
  background: #f1f5f9;
  border-radius: 6px;
  font-size: 13px;
  flex-wrap: wrap;
}

.selected-info b {
  color: #6d28d9;
}
</style>
