<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Point, Hole } from './types'
import {
  generateBoundaryRadii,
  isInsideBoundary,
  isInHole,
  createHole,
  getVisiblePoints,
  detectOuterBoundary,
  detectHoleBoundaries,
  fillHolePoints,
  triangulatePoints,
  OFFSET,
  FILL_GRID_SIZE,
  SPACING,
} from './grid'
import StepPanel from './components/StepPanel.vue'
import GridCanvas from './components/GridCanvas.vue'

// ── State ───────────────────────────────────────────────────

const step = ref(1)
const holes = ref<Hole[]>([])
const kValue = ref(1)
const boundaryRadii = ref<number[]>([])

const outerHull = ref<Point[]>([])
const holeHulls = ref<Point[][]>([])
const emptyRegions = ref<Point[][]>([])
const insertedPoints = ref<Point[]>([])
const triangles = ref<[Point, Point, Point][]>([])

// ── Derived ─────────────────────────────────────────────────

const visiblePoints = computed(() =>
  getVisiblePoints(boundaryRadii.value, holes.value)
)

const allPoints = computed(() =>
  [...visiblePoints.value, ...insertedPoints.value]
)

// ── Step 1: Create holes ────────────────────────────────────

function addRandomHole() {
  if (step.value !== 1) return
  let cx: number, cy: number
  do {
    cx = Math.random() * FILL_GRID_SIZE
    cy = Math.random() * FILL_GRID_SIZE
  } while (!isInsideBoundary(cx, cy, boundaryRadii.value))
  holes.value.push(createHole(cx + OFFSET, cy + OFFSET))
}

function onDotClick(col: number, row: number, px: number, py: number) {
  if (step.value !== 1) return
  const localCol = col - OFFSET
  const localRow = row - OFFSET
  if (localCol < 0 || localCol >= FILL_GRID_SIZE) return
  if (localRow < 0 || localRow >= FILL_GRID_SIZE) return
  if (!isInsideBoundary(localCol, localRow, boundaryRadii.value)) return
  const dotX = (col + 1) * SPACING
  const dotY = (row + 1) * SPACING
  const dist = Math.sqrt((px - dotX) ** 2 + (py - dotY) ** 2)
  if (dist > SPACING / 2) return
  if (isInHole(col, row, holes.value)) return
  holes.value.push(createHole(col, row))
}

// ── Step 2: Detect outer boundary ───────────────────────────

function onDetectBoundary() {
  if (visiblePoints.value.length < 3) return
  outerHull.value = detectOuterBoundary(visiblePoints.value, kValue.value)
  step.value = 2
}

// ── Step 3: Detect holes ────────────────────────────────────

function onDetectHoles() {
  const result = detectHoleBoundaries(visiblePoints.value, outerHull.value, kValue.value)
  holeHulls.value = result.hulls
  emptyRegions.value = result.emptyRegions
  step.value = 3
}

// ── Step 4: Fill points ─────────────────────────────────────

function onFillPoints() {
  insertedPoints.value = fillHolePoints(emptyRegions.value, visiblePoints.value)
  step.value = 4
}

// ── Step 5: Triangulate ─────────────────────────────────────

function onTriangulate() {
  triangles.value = triangulatePoints(allPoints.value, outerHull.value)
  step.value = 5
}

// ── Reset ───────────────────────────────────────────────────

function reset() {
  step.value = 1
  holes.value = []
  outerHull.value = []
  holeHulls.value = []
  emptyRegions.value = []
  insertedPoints.value = []
  triangles.value = []
  boundaryRadii.value = generateBoundaryRadii()
}

// ── Init ────────────────────────────────────────────────────

onMounted(() => {
  boundaryRadii.value = generateBoundaryRadii()
})
</script>

<template>
  <div class="app">
    <h1>2D Point Cloud — Filling &amp; Triangulation</h1>

    <StepPanel
      :currentStep="step"
      :kValue="kValue"
      :fillCount="insertedPoints.length"
      @addHole="addRandomHole"
      @detectBoundary="onDetectBoundary"
      @detectHoles="onDetectHoles"
      @fillPoints="onFillPoints"
      @triangulate="onTriangulate"
      @reset="reset"
      @update:kValue="kValue = $event"
    />

    <GridCanvas
      :visiblePoints="visiblePoints"
      :insertedPoints="insertedPoints"
      :outerHull="outerHull"
      :holeHulls="holeHulls"
      :triangles="triangles"
      :clickable="step === 1"
      @dotClick="onDotClick"
    />
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #f9fafb;
}

.app {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1.5rem;
  gap: 1.25rem;
}

h1 {
  font-size: 1.25rem;
  color: #1f2937;
  font-weight: 700;
}
</style>
