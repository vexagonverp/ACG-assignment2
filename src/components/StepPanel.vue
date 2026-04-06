<script setup lang="ts">
defineProps<{
  currentStep: number
  kValue: number
  fillCount: number
}>()

defineEmits<{
  addHole: []
  detectBoundary: []
  detectHoles: []
  fillPoints: []
  triangulate: []
  reset: []
  'update:kValue': [value: number]
}>()

const steps = [
  { num: 1, label: 'Create Holes', desc: 'Click on dots or add random holes to the grid' },
  { num: 2, label: 'Detect Boundary', desc: 'BoundaryExterior: k-ring clockwise walk' },
  { num: 3, label: 'Detect Holes', desc: 'BoundaryHole: O(N) empty 4-neighbor check' },
  { num: 4, label: 'Fill Points', desc: 'Insert grid points inside detected holes' },
  { num: 5, label: 'Triangulate', desc: 'Delaunay triangulation of the complete point set' },
]
</script>

<template>
  <div class="step-panel">
    <div class="steps">
      <div
        v-for="s in steps"
        :key="s.num"
        class="step"
        :class="{
          active: s.num === currentStep,
          done: s.num < currentStep,
          pending: s.num > currentStep,
        }"
      >
        <div class="step-marker">
          <span v-if="s.num < currentStep" class="checkmark">&#10003;</span>
          <span v-else>{{ s.num }}</span>
        </div>
        <div class="step-info">
          <div class="step-label">{{ s.label }}</div>
          <div class="step-desc" v-if="s.num === currentStep">{{ s.desc }}</div>
        </div>
      </div>
    </div>

    <div class="actions">
      <!-- Step 1: Create holes -->
      <template v-if="currentStep === 1">
        <button @click="$emit('detectBoundary')" class="primary">
          Next: Detect Boundary
        </button>
        <button @click="$emit('addHole')">Random Hole</button>
        <label class="k-control">
          k = {{ kValue }}
          <input
            type="range"
            min="1"
            max="5"
            :value="kValue"
            @input="$emit('update:kValue', Number(($event.target as HTMLInputElement).value))"
          />
        </label>
      </template>

      <!-- Step 2: Boundary detected -->
      <template v-else-if="currentStep === 2">
        <button @click="$emit('detectHoles')" class="primary">
          Next: Detect Holes
        </button>
      </template>

      <!-- Step 3: Holes detected -->
      <template v-else-if="currentStep === 3">
        <button @click="$emit('fillPoints')" class="primary">
          Next: Fill Points
        </button>
      </template>

      <!-- Step 4: Points filled -->
      <template v-else-if="currentStep === 4">
        <button @click="$emit('triangulate')" class="primary">
          Next: Triangulate
        </button>
        <span class="stat">+{{ fillCount }} points filled</span>
      </template>

      <!-- Step 5: Done -->
      <template v-else-if="currentStep === 5">
        <span class="stat done-text">Triangulation complete</span>
      </template>

      <button class="secondary" @click="$emit('reset')">Reset</button>
    </div>
  </div>
</template>

<style scoped>
.step-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  width: 100%;
  max-width: 700px;
}

.steps {
  display: flex;
  gap: 0.25rem;
}

.step {
  flex: 1;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  background: #f3f4f6;
  transition: all 0.2s;
}

.step.active {
  background: #eff6ff;
  border: 1px solid #3b82f6;
}

.step.done {
  background: #f0fdf4;
  border: 1px solid #86efac;
}

.step.pending {
  opacity: 0.5;
  border: 1px solid transparent;
}

.step-marker {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  flex-shrink: 0;
  background: #d1d5db;
  color: white;
}

.step.active .step-marker {
  background: #3b82f6;
}

.step.done .step-marker {
  background: #22c55e;
}

.checkmark {
  font-size: 0.8rem;
}

.step-info {
  min-width: 0;
}

.step-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: #374151;
  white-space: nowrap;
}

.step-desc {
  font-size: 0.65rem;
  color: #6b7280;
  margin-top: 2px;
  line-height: 1.3;
}

.actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.stat {
  font-size: 0.85rem;
  color: #6b7280;
}

.done-text {
  color: #22c55e;
  font-weight: 600;
}

.k-control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: #374151;
  margin-left: auto;
}

.k-control input {
  width: 80px;
}

button {
  padding: 0.4rem 1rem;
  font-size: 0.85rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  background: #e5e7eb;
  color: #374151;
  font-weight: 500;
  transition: background 0.15s;
}

button:hover {
  background: #d1d5db;
}

button.primary {
  background: #3b82f6;
  color: white;
}

button.primary:hover {
  background: #2563eb;
}

button.secondary {
  background: #6b7280;
  color: white;
}

button.secondary:hover {
  background: #4b5563;
}
</style>
