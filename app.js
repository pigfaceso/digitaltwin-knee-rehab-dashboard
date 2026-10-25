const $ = selector => document.querySelector(selector);
const angleValue = $('#angleValue');
const phaseValue = $('#phaseValue');
const repValue = $('#repValue');
const repTarget = $('#repTarget');
const repProgress = $('#repProgress');
const angleProgress = $('#angleProgress');
const targetValue = $('#targetValue');
const targetLabel = $('#targetLabel');
const rangeBadge = $('#rangeBadge');
const thighValue = $('#thighValue');
const shankValue = $('#shankValue');
const shank = $('#shank');
const ankle = $('#ankle');
const ankleLabel = $('#ankleLabel');
const chart = $('#angleChart');
const ctx = chart.getContext('2d');
const startButton = $('#startButton');
const resetButton = $('#resetButton');
const manualAngle = $('#manualAngle');
const targetAngle = $('#targetAngle');
const manualOutput = $('#manualOutput');
const targetOutput = $('#targetOutput');
const autoToggle = $('#autoToggle');
const telemetryJson = $('#telemetryJson');
const sequenceValue = $('#sequenceValue');
const startThreshold = $('#startThreshold');
const movementThreshold = $('#movementThreshold');
const programmeProgress = $('#programmeProgress');
const sampleForm = $('#sampleForm');
const storageStatus = $('#storageStatus');

const exercises = {
  heelSlide: {
    name: 'Heel Slide', category: 'Basic knee ROM', direction: 'flexion',
    startAngle: 5, minAngle: 5, maxAngle: 105, target: 90,
    readyThreshold: 20, duration: 5.8, goal: 5, thighBase: 7, thighAmplitude: 3
  },
  kneeExtension: {
    name: 'Knee Extension', category: 'Extension control', direction: 'extension',
    startAngle: 85, minAngle: 5, maxAngle: 85, target: 10,
    readyThreshold: 70, duration: 5.0, goal: 5, thighBase: 82, thighAmplitude: 2
  },
  sitToStand: {
    name: 'Sit-to-Stand', category: 'Functional movement', direction: 'extension',
    startAngle: 95, minAngle: 12, maxAngle: 95, target: 20,
    readyThreshold: 75, duration: 6.2, goal: 5, thighBase: 36, thighAmplitude: 24
  },
  squat: {
    name: 'Squat', category: 'Weight-bearing movement', direction: 'flexion',
    startAngle: 10, minAngle: 10, maxAngle: 100, target: 85,
    readyThreshold: 25, duration: 6.6, goal: 5, thighBase: 12, thighAmplitude: 28
  }
};

const exerciseState = Object.fromEntries(Object.keys(exercises).map(key => [key, {
  repetitions: 0,
  reachedTarget: false,
  status: key === 'heelSlide' ? 'ready' : 'idle'
}]));

const state = {
  selected: 'heelSlide',
  running: false,
  angle: exercises.heelSlide.startAngle,
  startTime: performance.now(),
  sequence: 0,
  history: Array(120).fill(exercises.heelSlide.startAngle),
  lastSample: 0,
  lastPersist: 0,
  thighAngle: 0
};

function currentExercise() { return exercises[state.selected]; }
function currentExerciseState() { return exerciseState[state.selected]; }

function statusText(status) {
  return {
    idle: 'Not started', ready: 'Ready', progress: 'In progress',
    target: 'Target reached', paused: 'Paused', complete: 'Complete'
  }[status];
}

function updateExerciseCards() {
  document.querySelectorAll('.exercise-card').forEach(card => {
    card.classList.toggle('active', card.dataset.exercise === state.selected);
  });
  Object.entries(exerciseState).forEach(([key, item]) => {
    const badge = document.querySelector(`[data-status="${key}"]`);
    badge.textContent = item.status === 'complete'
      ? `Complete · ${item.repetitions}/${exercises[key].goal}`
      : `${statusText(item.status)} · ${item.repetitions}/${exercises[key].goal}`;
    badge.className = `exercise-state ${item.status === 'paused' ? 'progress' : item.status}`;
  });
  const completed = Object.values(exerciseState).filter(item => item.status === 'complete').length;
  programmeProgress.textContent = `${completed} / 4 complete`;
}

function selectExercise(key) {
  if (state.running) {
    const previous = currentExerciseState();
    if (previous.status !== 'complete') previous.status = 'paused';
  }
  state.running = false;
  state.selected = key;
  const exercise = currentExercise();
  const item = currentExerciseState();
  if (item.status === 'idle' || item.status === 'paused') item.status = 'ready';
  item.reachedTarget = false;
  state.angle = exercise.startAngle;
  state.thighAngle = exercise.thighBase;
  state.startTime = performance.now();
  state.history.fill(exercise.startAngle);
  startButton.textContent = 'Start';

  targetAngle.min = exercise.direction === 'flexion' ? 45 : 0;
  targetAngle.max = exercise.direction === 'flexion' ? 120 : 45;
  targetAngle.value = exercise.target;
  targetOutput.textContent = `${exercise.target}°`;
  targetLabel.textContent = exercise.direction === 'flexion' ? 'Target flexion' : 'Target extension';
  startThreshold.textContent = exercise.direction === 'flexion'
    ? `Extension / start: < ${exercise.readyThreshold}°`
    : `Flexed / start: > ${exercise.readyThreshold}°`;
  movementThreshold.textContent = exercise.direction === 'flexion'
    ? `Flexion target: ≥ ${exercise.target}°`
    : `Extension target: ≤ ${exercise.target}°`;
  storageStatus.setAttribute('hx-get', `/fragments/storage-status?exercise=${encodeURIComponent(key)}`);
  updateExerciseCards();
  updateDisplay();
  drawChart();
  if (window.htmx) {
    htmx.ajax('GET', `/fragments/storage-status?exercise=${encodeURIComponent(key)}`, {
      target: '#storageStatus',
      swap: 'innerHTML'
    });
  }
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const rect = chart.getBoundingClientRect();
  chart.width = Math.max(600, Math.floor(rect.width * ratio));
  chart.height = Math.max(260, Math.floor(rect.height * ratio));
  drawChart();
}

function drawChart() {
  const exercise = currentExercise();
  const width = chart.width;
  const height = chart.height;
  const pad = { left: 52, right: 18, top: 18, bottom: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const y = value => pad.top + plotH - (value / 120) * plotH;

  ctx.clearRect(0, 0, width, height);
  ctx.font = `${Math.max(11, width / 80)}px system-ui`;
  ctx.fillStyle = '#7896aa';
  ctx.strokeStyle = 'rgba(117, 175, 204, .16)';
  ctx.lineWidth = 1;
  [0, 20, 40, 60, 80, 100, 120].forEach(value => {
    ctx.beginPath();
    ctx.moveTo(pad.left, y(value));
    ctx.lineTo(width - pad.right, y(value));
    ctx.stroke();
    ctx.fillText(`${value}°`, 8, y(value) + 4);
  });

  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = 'rgba(255, 201, 107, .6)';
  [exercise.readyThreshold, exercise.target].forEach(value => {
    ctx.beginPath();
    ctx.moveTo(pad.left, y(value));
    ctx.lineTo(width - pad.right, y(value));
    ctx.stroke();
  });
  ctx.setLineDash([]);

  const gradient = ctx.createLinearGradient(pad.left, 0, width - pad.right, 0);
  gradient.addColorStop(0, '#42d6c4');
  gradient.addColorStop(1, '#65a8ff');
  ctx.strokeStyle = gradient;
  ctx.lineWidth = Math.max(2, width / 350);
  ctx.beginPath();
  state.history.forEach((value, index) => {
    const x = pad.left + (index / (state.history.length - 1)) * plotW;
    index === 0 ? ctx.moveTo(x, y(value)) : ctx.lineTo(x, y(value));
  });
  ctx.stroke();
  ctx.fillStyle = '#7896aa';
  ctx.textAlign = 'center';
  ctx.fillText(`${exercise.name} · last 12 seconds`, pad.left + plotW / 2, height - 8);
  ctx.textAlign = 'left';
}

function updateLeg(angle) {
  const radians = angle * Math.PI / 180;
  const kneeX = 180;
  const kneeY = 225;
  const length = 180;
  const ankleX = kneeX + Math.sin(radians) * length;
  const ankleY = kneeY + Math.cos(radians) * length;
  shank.setAttribute('x2', ankleX.toFixed(1));
  shank.setAttribute('y2', ankleY.toFixed(1));
  ankle.setAttribute('cx', ankleX.toFixed(1));
  ankle.setAttribute('cy', ankleY.toFixed(1));
  ankleLabel.setAttribute('x', Math.min(310, ankleX + 16).toFixed(1));
  ankleLabel.setAttribute('y', Math.min(420, ankleY + 5).toFixed(1));
}

function targetReached(angle, exercise) {
  return exercise.direction === 'flexion' ? angle >= exercise.target : angle <= exercise.target;
}

function returnedToReady(angle, exercise) {
  return exercise.direction === 'flexion'
    ? angle <= exercise.readyThreshold
    : angle >= exercise.readyThreshold;
}

function processAngle(angle) {
  const exercise = currentExercise();
  const item = currentExerciseState();
  if (targetReached(angle, exercise)) {
    item.reachedTarget = true;
    if (item.status !== 'complete') item.status = 'target';
  }
  if (item.reachedTarget && returnedToReady(angle, exercise)) {
    item.repetitions += 1;
    item.reachedTarget = false;
    item.status = item.repetitions >= exercise.goal ? 'complete' : 'progress';
    if (item.status === 'complete') {
      state.running = false;
      startButton.textContent = 'Start';
    }
  }
  updateExerciseCards();
}

function progressPercent(angle, exercise) {
  if (exercise.direction === 'flexion') {
    return Math.max(0, Math.min(100, (angle - exercise.minAngle) / (exercise.target - exercise.minAngle) * 100));
  }
  return Math.max(0, Math.min(100, (exercise.startAngle - angle) / (exercise.startAngle - exercise.target) * 100));
}

function buildPayload() {
  const exercise = currentExercise();
  const item = currentExerciseState();
  const shankAngle = state.thighAngle + state.angle;
  return {
    timestamp_ms: Date.now(),
    sequence: state.sequence,
    exercise_key: state.selected,
    exercise_name: exercise.name,
    exercise_status: statusText(item.status),
    calibrated: true,
    thigh_angle: Number(state.thighAngle.toFixed(1)),
    shank_angle: Number(shankAngle.toFixed(1)),
    knee_angle: Number(state.angle.toFixed(1)),
    repetitions: item.repetitions
  };
}

function persistSample() {
  if (!window.htmx || !sampleForm) return;
  const payload = buildPayload();
  Object.entries(payload).forEach(([key, value]) => {
    const input = sampleForm.elements.namedItem(key);
    if (input) input.value = String(value);
  });
  htmx.trigger(sampleForm, 'submit');
}

function updateDisplay() {
  const exercise = currentExercise();
  const item = currentExerciseState();
  const angle = state.angle;
  const shankAngle = state.thighAngle + angle;
  angleValue.textContent = angle.toFixed(0);
  manualAngle.value = angle.toFixed(0);
  manualOutput.textContent = `${angle.toFixed(0)}°`;
  repValue.textContent = item.repetitions;
  repTarget.textContent = ` / ${exercise.goal}`;
  repProgress.style.width = `${Math.min(100, item.repetitions / exercise.goal * 100)}%`;
  angleProgress.style.width = `${progressPercent(angle, exercise)}%`;
  targetValue.textContent = exercise.target;
  thighValue.textContent = `${state.thighAngle.toFixed(1)}°`;
  shankValue.textContent = `${shankAngle.toFixed(1)}°`;
  updateLeg(angle);

  const atTarget = targetReached(angle, exercise);
  const atReady = returnedToReady(angle, exercise);
  if (item.status === 'complete') {
    phaseValue.textContent = `${exercise.name} complete`;
    rangeBadge.textContent = 'Exercise complete';
  } else if (atTarget) {
    phaseValue.textContent = exercise.direction === 'flexion' ? 'Flexion target reached' : 'Extension target reached';
    rangeBadge.textContent = 'Target reached';
  } else if (atReady) {
    phaseValue.textContent = exercise.direction === 'flexion' ? 'Ready / extended' : 'Ready / flexed';
    rangeBadge.textContent = 'Start position';
  } else {
    phaseValue.textContent = exercise.direction === 'flexion' ? 'Flexing knee' : 'Extending knee';
    rangeBadge.textContent = 'Active movement';
  }

  const payload = buildPayload();
  telemetryJson.textContent = JSON.stringify(payload, null, 2);
  sequenceValue.textContent = `seq ${state.sequence}`;
}

function tick(now) {
  const exercise = currentExercise();
  if (state.running && autoToggle.checked) {
    const elapsed = (now - state.startTime) / 1000;
    const cycle = (elapsed % exercise.duration) / exercise.duration;
    const movement = (1 - Math.cos(cycle * Math.PI * 2)) / 2;
    state.angle = exercise.direction === 'flexion'
      ? exercise.minAngle + (exercise.maxAngle - exercise.minAngle) * movement
      : exercise.maxAngle - (exercise.maxAngle - exercise.minAngle) * movement;
    state.thighAngle = exercise.thighBase + exercise.thighAmplitude * movement;
  }

  if (state.running && now - state.lastSample > 100) {
    processAngle(state.angle);
    state.history.push(state.angle);
    state.history.shift();
    state.sequence += 1;
    state.lastSample = now;
    drawChart();
  }
  if (state.running && now - state.lastPersist > 500) {
    persistSample();
    state.lastPersist = now;
  }
  updateDisplay();
  requestAnimationFrame(tick);
}

document.querySelectorAll('.exercise-card').forEach(card => {
  card.addEventListener('click', () => selectExercise(card.dataset.exercise));
});

startButton.addEventListener('click', () => {
  const item = currentExerciseState();
  if (item.status === 'complete') {
    item.repetitions = 0;
    item.reachedTarget = false;
  }
  state.running = !state.running;
  state.startTime = performance.now();
  item.status = state.running ? 'progress' : 'paused';
  startButton.textContent = state.running ? 'Pause' : 'Start';
  updateExerciseCards();
});

resetButton.addEventListener('click', () => {
  const exercise = currentExercise();
  const item = currentExerciseState();
  state.running = false;
  state.angle = exercise.startAngle;
  state.thighAngle = exercise.thighBase;
  item.repetitions = 0;
  item.reachedTarget = false;
  item.status = 'ready';
  state.sequence = 0;
  state.history.fill(exercise.startAngle);
  startButton.textContent = 'Start';
  updateExerciseCards();
  drawChart();
});

manualAngle.addEventListener('input', event => {
  autoToggle.checked = false;
  state.angle = Number(event.target.value);
  const item = currentExerciseState();
  if (item.status === 'ready' || item.status === 'paused') item.status = 'progress';
  processAngle(state.angle);
  state.history.push(state.angle);
  state.history.shift();
  state.sequence += 1;
  persistSample();
  updateDisplay();
  drawChart();
});

targetAngle.addEventListener('input', event => {
  const exercise = currentExercise();
  exercise.target = Number(event.target.value);
  targetOutput.textContent = `${exercise.target}°`;
  movementThreshold.textContent = exercise.direction === 'flexion'
    ? `Flexion target: ≥ ${exercise.target}°`
    : `Extension target: ≤ ${exercise.target}°`;
  updateDisplay();
  drawChart();
});

autoToggle.addEventListener('change', () => {
  state.startTime = performance.now();
});

window.addEventListener('resize', resizeCanvas);

function configurePresentationSnapshot() {
  const parameters = new URLSearchParams(window.location.search);
  const requestedExercise = parameters.get('exercise');
  const exerciseKey = Object.hasOwn(exercises, requestedExercise) ? requestedExercise : 'heelSlide';
  selectExercise(exerciseKey);

  if (parameters.get('snapshot') !== 'target') return;

  const exercise = currentExercise();
  const item = currentExerciseState();
  state.angle = exercise.direction === 'flexion' ? exercise.maxAngle : exercise.minAngle;
  state.thighAngle = exercise.thighBase + exercise.thighAmplitude;
  state.sequence = 24;
  item.reachedTarget = true;
  item.status = 'target';
  state.history = Array.from({ length: 120 }, (_, index) => {
    const cycle = (index % 60) / 60;
    const movement = (1 - Math.cos(cycle * Math.PI * 2)) / 2;
    return exercise.direction === 'flexion'
      ? exercise.minAngle + (exercise.maxAngle - exercise.minAngle) * movement
      : exercise.maxAngle - (exercise.maxAngle - exercise.minAngle) * movement;
  });
  updateExerciseCards();
  updateDisplay();
  drawChart();

  // Optional query flag for storing this reproducible snapshot through HTMX.
  if (parameters.get('store') === '1') window.setTimeout(persistSample, 300);
}

configurePresentationSnapshot();
resizeCanvas();
requestAnimationFrame(tick);
