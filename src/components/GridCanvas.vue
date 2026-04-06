<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import type { Point } from '../types'
import { SPACING, POINT_RADIUS, CANVAS_SIZE } from '../grid'

const props = defineProps<{
  visiblePoints: Point[]
  insertedPoints: Point[]
  outerHull: Point[]
  holeHulls: Point[][]
  triangles: [Point, Point, Point][]
  clickable: boolean
}>()

const emit = defineEmits<{
  dotClick: [col: number, row: number, px: number, py: number]
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)

function toScreen(gx: number, gy: number): [number, number] {
  return [(gx + 1) * SPACING, (gy + 1) * SPACING]
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

  // Grid points
  ctx.fillStyle = '#3b82f6'
  for (const [x, y] of props.visiblePoints) {
    const [sx, sy] = toScreen(x, y)
    ctx.beginPath()
    ctx.arc(sx, sy, POINT_RADIUS, 0, Math.PI * 2)
    ctx.fill()
  }

  // Filled points
  if (props.insertedPoints.length > 0) {
    ctx.fillStyle = '#f59e0b'
    for (const [x, y] of props.insertedPoints) {
      const [sx, sy] = toScreen(x, y)
      ctx.beginPath()
      ctx.arc(sx, sy, POINT_RADIUS, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Triangles
  if (props.triangles.length > 0) {
    ctx.strokeStyle = '#10b981'
    ctx.lineWidth = 0.5
    for (const [p0, p1, p2] of props.triangles) {
      ctx.beginPath()
      ctx.moveTo(...toScreen(p0[0], p0[1]))
      ctx.lineTo(...toScreen(p1[0], p1[1]))
      ctx.lineTo(...toScreen(p2[0], p2[1]))
      ctx.closePath()
      ctx.stroke()
    }
  }

  // Outer hull
  if (props.outerHull.length > 2) {
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(...toScreen(props.outerHull[0][0], props.outerHull[0][1]))
    for (let i = 1; i < props.outerHull.length; i++) {
      ctx.lineTo(...toScreen(props.outerHull[i][0], props.outerHull[i][1]))
    }
    ctx.closePath()
    ctx.stroke()
  }

  // Hole hulls
  if (props.holeHulls.length > 0) {
    ctx.strokeStyle = '#f59e0b'
    ctx.lineWidth = 2
    for (const hull of props.holeHulls) {
      if (hull.length < 3) continue
      ctx.beginPath()
      ctx.moveTo(...toScreen(hull[0][0], hull[0][1]))
      for (let i = 1; i < hull.length; i++) {
        ctx.lineTo(...toScreen(hull[i][0], hull[i][1]))
      }
      ctx.closePath()
      ctx.stroke()
    }
  }
}

function onClick(e: MouseEvent) {
  if (!props.clickable) return
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const px = e.clientX - rect.left
  const py = e.clientY - rect.top
  const col = Math.round(px / SPACING) - 1
  const row = Math.round(py / SPACING) - 1
  emit('dotClick', col, row, px, py)
}

onMounted(draw)
watch(() => [
  props.visiblePoints,
  props.insertedPoints,
  props.outerHull,
  props.holeHulls,
  props.triangles,
], draw, { deep: true })
</script>

<template>
  <div class="canvas-wrapper">
    <canvas
      ref="canvasRef"
      :width="CANVAS_SIZE"
      :height="CANVAS_SIZE"
      :class="{ clickable }"
      @click="onClick"
    />
  </div>
</template>

<style scoped>
.canvas-wrapper {
  overflow: auto;
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  background: white;
  max-width: 90vw;
  max-height: 80vh;
}

canvas {
  display: block;
}

canvas.clickable {
  cursor: crosshair;
}
</style>
