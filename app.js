const papers = {
  "a5-landscape": { label: "A5 landscape", width: 210, height: 148 },
  "a5-portrait": { label: "A5 portrait", width: 148, height: 210 },
  "a4-portrait": { label: "A4 portrait", width: 210, height: 297 }
};

const state = {
  running: false,
  cancelRun: 0,
  userStopped: false,
  paper: papers["a5-landscape"],
  position: { x: 0, y: 0, z: 0 },
  feed: 600,
  completedSegments: [],
  lineStatuses: [],
  annotationsActive: false,
  runBaseName: null,
  runSource: ""
};

const els = {
  runButton: document.getElementById("runButton"),
  saveButton: document.getElementById("saveButton"),
  downloadCodeButton: document.getElementById("downloadCodeButton"),
  settingsButton: document.getElementById("settingsButton"),
  settingsPanel: document.getElementById("settingsPanel"),
  paperSelect: document.getElementById("paperSelect"),
  penThresholdInput: document.getElementById("penThresholdInput"),
  penWidthInput: document.getElementById("penWidthInput"),
  rapidSpeedInput: document.getElementById("rapidSpeedInput"),
  feedRateInput: document.getElementById("feedRateInput"),
  previewSpeedSelect: document.getElementById("previewSpeedSelect"),
  codeWatermarkInput: document.getElementById("codeWatermarkInput"),
  editorBody: document.getElementById("editorBody"),
  lineGutter: document.getElementById("lineGutter"),
  codeHighlight: document.getElementById("codeHighlight"),
  codeEditor: document.getElementById("codeEditor"),
  lineReadout: document.getElementById("lineReadout"),
  message: document.getElementById("message"),
  programReadout: document.getElementById("programReadout"),
  previewTitle: document.getElementById("preview-title"),
  paper: document.getElementById("paper"),
  canvas: document.getElementById("drawingCanvas"),
  pen: document.getElementById("pen"),
  xStatus: document.getElementById("xStatus"),
  yStatus: document.getElementById("yStatus"),
  zStatus: document.getElementById("zStatus"),
  feedStatus: document.getElementById("feedStatus"),
  penStatus: document.getElementById("penStatus")
};

const ctx = els.canvas.getContext("2d");

function splitSourceLines() {
  return els.codeEditor.value.split(/\r?\n/);
}

function formatDrawingBaseName(date) {
  const pad = value => String(value).padStart(2, "0");
  return [
    "Drawing",
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  ].join("_");
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderEditorState() {
  const lines = splitSourceLines();
  while (state.lineStatuses.length < lines.length) state.lineStatuses.push("");
  if (state.lineStatuses.length > lines.length) state.lineStatuses.length = lines.length;

  els.lineGutter.innerHTML = lines.map((_, index) => {
    const status = state.lineStatuses[index] || "";
    const marker = status === "success" ? "✓" : status === "error" ? "×" : status === "current" ? "›" : "";
    return `<div class="gutter-line ${status}"><span>${index + 1}</span><span class="gutter-status ${status}">${marker}</span></div>`;
  }).join("");

  if (!state.annotationsActive) {
    els.codeHighlight.textContent = "";
    els.editorBody.classList.remove("has-run-annotations");
    return;
  }

  els.editorBody.classList.add("has-run-annotations");
  els.codeHighlight.innerHTML = lines.map((line, index) => {
    const status = state.lineStatuses[index] || "";
    return `<div class="${status}">${escapeHtml(line) || " "}</div>`;
  }).join("");
  els.codeHighlight.scrollTop = els.codeEditor.scrollTop;
  els.codeHighlight.scrollLeft = els.codeEditor.scrollLeft;
}

function clearRunAnnotations() {
  state.lineStatuses = splitSourceLines().map(() => "");
  state.annotationsActive = false;
  els.editorBody.classList.remove("has-error");
  renderEditorState();
}

function markLine(lineNumber, status) {
  state.lineStatuses[lineNumber - 1] = status;
  state.annotationsActive = true;
  renderEditorState();
}

function getSettings() {
  const paper = papers[els.paperSelect.value];
  return {
    paper,
    penThreshold: readNonNegativeNumber(els.penThresholdInput, 2),
    penWidth: readPositiveNumber(els.penWidthInput, .7),
    rapidSpeed: readPositiveNumber(els.rapidSpeedInput, 3000),
    initialFeed: readPositiveNumber(els.feedRateInput, 600),
    previewSpeed: readPositiveNumber(els.previewSpeedSelect, 5),
    codeWatermark: els.codeWatermarkInput.checked
  };
}

function readPositiveNumber(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readNonNegativeNumber(input, fallback) {
  const value = Number(input.value);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function stripComments(line) {
  // Parenthesized comments can appear inline. A semicolon comments out the
  // rest of the line after parenthesized comments have been removed.
  return line.replace(/\([^)]*\)/g, "").replace(/;.*/, "").trim();
}

class GCodeIssue extends Error {
  constructor(kind, lineNumber, lines) {
    super(lines.join("\n"));
    this.kind = kind;
    this.lineNumber = lineNumber;
    this.lines = lines;
  }
}

function syntaxIssue(lineNumber, lines) {
  return new GCodeIssue("syntax", lineNumber, lines);
}

function unsupportedIssue(lineNumber, lines) {
  return new GCodeIssue("unsupported", lineNumber, lines);
}

function simulationIssue(lineNumber, lines) {
  return new GCodeIssue("simulation", lineNumber, lines);
}

function parseLine(rawLine, lineNumber) {
  const clean = stripComments(rawLine);
  if (!clean) return { lineNumber, empty: true };

  if (clean.includes(",")) {
    throw syntaxIssue(lineNumber, [
      `Line ${lineNumber}: G-code does not use commas between words.`,
      "Use spaces, or no spaces, between words such as G1 X20 Y40."
    ]);
  }

  const compact = clean.replace(/\s+/g, "").toUpperCase();

  if (compact.startsWith("GO")) {
    throw syntaxIssue(lineNumber, [
      `Line ${lineNumber}: GO is not a supported G-code word.`,
      "G0 uses the number zero, not the letter O."
    ]);
  }

  if (compact === "PU" || compact.startsWith("PUZ") || compact.startsWith("PUX") || compact.startsWith("PUY")) {
    throw unsupportedIssue(lineNumber, [
      `Line ${lineNumber}: PU is not supported by this visualizer.`,
      "Use Z0 to raise the pen."
    ]);
  }

  if (compact === "PD" || compact.startsWith("PDZ") || compact.startsWith("PDX") || compact.startsWith("PDY")) {
    throw unsupportedIssue(lineNumber, [
      `Line ${lineNumber}: PD is not supported by this visualizer.`,
      "Use a Z value at or above the pen-down threshold to lower the pen."
    ]);
  }

  const tokens = [];
  const pattern = /([A-Z])([-+]?(?:\d+\.?\d*|\.\d+))/g;
  let match;
  let lastIndex = 0;
  while ((match = pattern.exec(compact)) !== null) {
    if (match.index !== lastIndex) {
      const problem = compact.slice(lastIndex, match.index);
      throw syntaxIssue(lineNumber, [
        `Line ${lineNumber}: G-code words use a letter followed by a number.`,
        `Problem text: ${problem}`
      ]);
    }
    tokens.push({ word: match[1], value: Number(match[2]), raw: match[0] });
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex !== compact.length) {
    const problem = compact.slice(lastIndex);
    throw syntaxIssue(lineNumber, [
      `Line ${lineNumber}: G-code words use a letter followed by a number.`,
      `Problem text: ${problem}`
    ]);
  }

  const parsed = { lineNumber, g: null, x: null, y: null, z: null, f: null };
  for (const token of tokens) {
    if (!Number.isFinite(token.value)) {
      throw syntaxIssue(lineNumber, [
        `Line ${lineNumber}: ${token.raw} does not contain a valid number.`
      ]);
    }
    if (token.word === "G") {
      if (token.value !== 0 && token.value !== 1) {
        throw unsupportedIssue(lineNumber, [
          `Line ${lineNumber}: G${token.value} is valid G-code, but it is not supported by this visualizer.`,
          "Supported movement commands: G0 and G1."
        ]);
      }
      if (parsed.g !== null) throw syntaxIssue(lineNumber, [`Line ${lineNumber}: G appears more than once on this line.`]);
      parsed.g = token.value;
    } else if (token.word === "X" || token.word === "Y" || token.word === "Z" || token.word === "F") {
      const field = token.word.toLowerCase();
      if (parsed[field] !== null) throw syntaxIssue(lineNumber, [`Line ${lineNumber}: ${token.word} appears more than once on this line.`]);
      parsed[field] = token.value;
    } else if (token.word === "M") {
      throw unsupportedIssue(lineNumber, [
        `Line ${lineNumber}: M${token.value} is valid G-code, but machine commands are not supported by this visualizer.`,
        "Use G0 and G1 movement commands with X, Y, Z, and F words."
      ]);
    } else {
      throw unsupportedIssue(lineNumber, [
        `Line ${lineNumber}: ${token.word} words are not supported by this visualizer.`,
        "Supported words: G, X, Y, Z, and F."
      ]);
    }
  }
  return parsed;
}

function makeStep(parsed, context, settings) {
  if (parsed.g !== null) context.mode = parsed.g;
  if (parsed.f !== null) {
    if (parsed.f <= 0) {
      throw syntaxIssue(parsed.lineNumber, [
        `Line ${parsed.lineNumber}: feed rate must be greater than zero.`
      ]);
    }
    context.feed = parsed.f;
  }

  const next = {
    x: parsed.x !== null ? parsed.x : context.position.x,
    y: parsed.y !== null ? parsed.y : context.position.y,
    z: parsed.z !== null ? parsed.z : context.position.z
  };

  const moved = next.x !== context.position.x || next.y !== context.position.y || next.z !== context.position.z;
  if (!moved) {
    context.position = next;
    return null;
  }

  return {
    lineNumber: parsed.lineNumber,
    mode: context.mode,
    feed: context.feed,
    from: { ...context.position },
    to: next
  };
}

function resizeCanvas() {
  const rect = els.paper.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  els.canvas.width = Math.max(1, Math.round(rect.width * ratio));
  els.canvas.height = Math.max(1, Math.round(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  redraw();
  updatePen(state.position, getSettings());
}

function mmToCanvas(point, paper = state.paper) {
  const rect = els.paper.getBoundingClientRect();
  return {
    x: point.x / paper.width * rect.width,
    y: rect.height - point.y / paper.height * rect.height
  };
}

function drawSegment(segment, progress = 1) {
  const start = mmToCanvas(segment.from);
  const endPoint = {
    x: segment.from.x + (segment.to.x - segment.from.x) * progress,
    y: segment.from.y + (segment.to.y - segment.from.y) * progress
  };
  const end = mmToCanvas(endPoint);
  const rect = els.paper.getBoundingClientRect();
  const pxPerMm = rect.width / state.paper.width;

  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, getSettings().penWidth * pxPerMm);
  ctx.strokeStyle = "#111";
  ctx.stroke();
}

function redraw(activeSegment = null, progress = 1) {
  const rect = els.paper.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  state.completedSegments.forEach(segment => drawSegment(segment));
  if (activeSegment) drawSegment(activeSegment, progress);
}

function shouldDraw(step, settings) {
  const xyMoved = step.from.x !== step.to.x || step.from.y !== step.to.y;
  return xyMoved && Math.max(step.from.z, step.to.z) >= settings.penThreshold;
}

function findPaperExit(step, paper) {
  const crossings = [];
  const dx = step.to.x - step.from.x;
  const dy = step.to.y - step.from.y;

  if (dx < 0 && step.to.x < 0) crossings.push((0 - step.from.x) / dx);
  if (dx > 0 && step.to.x > paper.width) crossings.push((paper.width - step.from.x) / dx);
  if (dy < 0 && step.to.y < 0) crossings.push((0 - step.from.y) / dy);
  if (dy > 0 && step.to.y > paper.height) crossings.push((paper.height - step.from.y) / dy);

  const progress = crossings
    .filter(value => Number.isFinite(value) && value >= 0 && value <= 1)
    .sort((a, b) => a - b)[0];

  if (progress === undefined) return null;
  return {
    progress,
    point: {
      x: step.from.x + dx * progress,
      y: step.from.y + dy * progress,
      z: step.from.z + (step.to.z - step.from.z) * progress
    }
  };
}

function makeBoundaryIssue(step, settings) {
  const problems = [];
  if (step.to.x < 0) problems.push(`X ${step.to.x}`);
  if (step.to.x > settings.paper.width) problems.push(`X ${step.to.x}`);
  if (step.to.y < 0) problems.push(`Y ${step.to.y}`);
  if (step.to.y > settings.paper.height) problems.push(`Y ${step.to.y}`);

  return simulationIssue(step.lineNumber, [
    `Line ${step.lineNumber}: the move reaches ${problems.join(" and ")}, which is outside ${settings.paper.label}.`,
    "The drawing stopped at the paper boundary."
  ]);
}

function updatePen(position, settings) {
  state.position = { ...position };
  const point = mmToCanvas(position, settings.paper);
  els.pen.style.left = `${point.x}px`;
  els.pen.style.bottom = `${els.paper.getBoundingClientRect().height - point.y}px`;

  const penDown = position.z >= settings.penThreshold;
  els.pen.classList.toggle("pen-up", !penDown);
  els.xStatus.textContent = `X ${position.x.toFixed(1)}`;
  els.yStatus.textContent = `Y ${position.y.toFixed(1)}`;
  els.zStatus.textContent = `Z ${position.z.toFixed(1)}`;
  els.penStatus.textContent = penDown ? "Pen down" : "Pen up";
}

function setMessage(text, type = "normal") {
  els.message.textContent = text;
  els.message.classList.toggle("error", type === "error");
  els.message.classList.toggle("success", type === "success");
  els.message.classList.toggle("stopped", type === "stopped");
  els.editorBody.classList.toggle("has-error", type === "error");
}

function setPaper(settings) {
  state.paper = settings.paper;
  els.paper.style.aspectRatio = `${settings.paper.width} / ${settings.paper.height}`;
  els.previewTitle.textContent = `${settings.paper.label} preview`;
  resizeCanvas();
}

function sleepFrame() {
  return new Promise(resolve => requestAnimationFrame(resolve));
}

function animateStep(step, settings, runId) {
  const dx = step.to.x - step.from.x;
  const dy = step.to.y - step.from.y;
  const dz = step.to.z - step.from.z;
  const distance = Math.hypot(dx, dy, dz);
  const speed = step.mode === 0 ? settings.rapidSpeed : step.feed;
  const duration = Math.min(8000, Math.max(80, distance / speed * 60000 / settings.previewSpeed));
  const draws = shouldDraw(step, settings);
  const startTime = performance.now();

  return new Promise(resolve => {
    function tick(now) {
      if (runId !== state.cancelRun) {
        resolve(false);
        return;
      }

      const progress = Math.min(1, (now - startTime) / duration);
      const position = {
        x: step.from.x + dx * progress,
        y: step.from.y + dy * progress,
        z: step.from.z + dz * progress
      };
      updatePen(position, settings);
      els.lineReadout.textContent = `Running line ${step.lineNumber}`;
      els.feedStatus.textContent = `F ${step.feed}`;
      redraw(draws ? step : null, progress);

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        if (draws) state.completedSegments.push(step);
        redraw();
        resolve(true);
      }
    }
    requestAnimationFrame(tick);
  });
}

async function runProgram() {
  if (state.running) {
    stopProgram();
    return;
  }

  const settings = getSettings();
  const runId = ++state.cancelRun;
  state.running = true;
  state.userStopped = false;
  state.runBaseName = formatDrawingBaseName(new Date());
  state.runSource = els.codeEditor.value;
  els.runButton.disabled = true;
  els.runButton.textContent = "Stop";
  els.runButton.disabled = false;
  els.saveButton.disabled = true;
  els.downloadCodeButton.disabled = false;
  state.completedSegments = [];
  state.lineStatuses = splitSourceLines().map(() => "");
  state.annotationsActive = true;
  setPaper(settings);
  updatePen({ x: 0, y: 0, z: 0 }, settings);
  redraw();
  renderEditorState();
  await sleepFrame();

  const lines = splitSourceLines();
  const context = {
    mode: 0,
    feed: settings.initialFeed,
    position: { x: 0, y: 0, z: 0 }
  };
  let moveCount = 0;

  els.programReadout.textContent = "Running";
  setMessage("Running program...");

  for (let index = 0; index < lines.length; index += 1) {
    if (runId !== state.cancelRun) return;

    const lineNumber = index + 1;
    markLine(lineNumber, "current");
    els.lineReadout.textContent = `Running line ${lineNumber}`;
    await sleepFrame();

    let parsed;
    try {
      parsed = parseLine(lines[index], lineNumber);
      if (parsed.empty) {
        state.lineStatuses[index] = "";
        renderEditorState();
        continue;
      }

      const step = makeStep(parsed, context, settings);
      if (step) {
        const exit = findPaperExit(step, settings.paper);
        if (exit) {
          const partialStep = { ...step, to: exit.point };
          const finished = await animateStep(partialStep, settings, runId);
          if (!finished) return;
          context.position = exit.point;
          throw makeBoundaryIssue(step, settings);
        }

        const finished = await animateStep(step, settings, runId);
        if (!finished) return;
        context.position = { ...step.to };
        moveCount += 1;
      }

      markLine(lineNumber, "success");
    } catch (error) {
      markLine(lineNumber, "error");
      state.running = false;
      els.runButton.textContent = "Run program";
      els.saveButton.disabled = true;
      els.programReadout.textContent = "Stopped";
      setMessage(error.message, "error");
      return;
    }
  }

  state.running = false;
  els.runButton.textContent = "Run program";
  els.saveButton.disabled = false;
  els.lineReadout.textContent = "Finished";
  els.programReadout.textContent = `${moveCount} move${moveCount === 1 ? "" : "s"}`;
  setMessage(`Finished ${moveCount} move${moveCount === 1 ? "" : "s"}.`, "success");
}

function stopProgram() {
  if (!state.running) return;
  state.userStopped = true;
  state.running = false;
  state.cancelRun += 1;
  els.runButton.textContent = "Run program";
  els.saveButton.disabled = true;
  const currentIndex = state.lineStatuses.findIndex(status => status === "current");
  const lineText = currentIndex >= 0 ? ` at line ${currentIndex + 1}` : "";
  els.programReadout.textContent = "Stopped";
  setMessage(`Stopped${lineText}.\nThe partial drawing remains on the page.`, "stopped");
  renderEditorState();
}

function getLineMarker(status) {
  if (status === "success") return "✓";
  if (status === "error") return "×";
  if (status === "current") return "›";
  return "";
}

function buildWatermarkRows(lines, maxLines) {
  const rows = lines.map((text, index) => ({ type: "code", text, lineNumber: index + 1, status: state.lineStatuses[index] || "" }));

  if (rows.length <= maxLines) return rows;
  if (maxLines <= 6) {
    const tailCount = Math.max(0, maxLines - 1);
    return [
      { type: "ellipsis", text: "...", lineNumber: null, status: "" },
      ...rows.slice(rows.length - tailCount)
    ].slice(0, maxLines);
  }

  const endingRows = 4;
  const ellipsisRows = 2;
  const beginningRows = maxLines - endingRows - ellipsisRows;

  return [
    ...rows.slice(0, beginningRows),
    { type: "ellipsis", text: "...", lineNumber: null, status: "" },
    { type: "ellipsis", text: "...", lineNumber: null, status: "" },
    ...rows.slice(rows.length - endingRows)
  ];
}

function drawCodeWatermark(exportCtx, exportCanvas, settings, pxPerMm) {
  const lines = splitSourceLines();
  const margin = 5 * pxPerMm;
  const gutterWidth = 18 * pxPerMm;
  const fontSize = Math.max(9, 2.8 * pxPerMm);
  const lineHeight = fontSize * 1.5;
  const maxLines = Math.floor((exportCanvas.height - margin * 2) / lineHeight);
  const rows = buildWatermarkRows(lines, maxLines);

  exportCtx.save();
  exportCtx.beginPath();
  exportCtx.rect(margin, margin, exportCanvas.width - margin * 2, exportCanvas.height - margin * 2);
  exportCtx.clip();
  exportCtx.font = `${fontSize}px Consolas, "Courier New", monospace`;
  exportCtx.textBaseline = "top";
  exportCtx.globalAlpha = .2;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const status = row.status;
    const y = margin + index * lineHeight;
    const marker = getLineMarker(status);

    if (row.lineNumber !== null) {
      exportCtx.fillStyle = "#6f8792";
      exportCtx.textAlign = "right";
      exportCtx.fillText(`${row.lineNumber}`, margin + gutterWidth * .48, y);
    }

    if (marker) {
      exportCtx.fillStyle = status === "error" ? "#9e2d25" : "#277448";
      exportCtx.fillText(marker, margin + gutterWidth * .82, y);
    }

    exportCtx.fillStyle = status === "error" ? "#9e2d25" : status === "success" ? "#277448" : "#54717c";
    exportCtx.textAlign = "left";
    exportCtx.fillText(row.text, margin + gutterWidth, y);
  }

  exportCtx.restore();
}

function drawCompletedSegments(exportCtx, exportCanvas, settings, pxPerMm) {
  exportCtx.strokeStyle = "#111";
  exportCtx.lineCap = "round";
  exportCtx.lineJoin = "round";
  exportCtx.lineWidth = Math.max(1, settings.penWidth * pxPerMm);
  state.completedSegments.forEach(segment => {
    exportCtx.beginPath();
    exportCtx.moveTo(segment.from.x * pxPerMm, exportCanvas.height - segment.from.y * pxPerMm);
    exportCtx.lineTo(segment.to.x * pxPerMm, exportCanvas.height - segment.to.y * pxPerMm);
    exportCtx.stroke();
  });
}

function createPaperExportCanvas(settings, pxPerMm) {
  const paperCanvas = document.createElement("canvas");
  paperCanvas.width = Math.round(state.paper.width * pxPerMm);
  paperCanvas.height = Math.round(state.paper.height * pxPerMm);
  const paperCtx = paperCanvas.getContext("2d");
  paperCtx.fillStyle = "#fff";
  paperCtx.fillRect(0, 0, paperCanvas.width, paperCanvas.height);

  if (settings.codeWatermark) {
    drawCodeWatermark(paperCtx, paperCanvas, settings, pxPerMm);
  }

  drawCompletedSegments(paperCtx, paperCanvas, settings, pxPerMm);
  return paperCanvas;
}

function createFramedExportCanvas(paperCanvas, pxPerMm) {
  const margin = Math.round(8 * pxPerMm);
  const shadowBlur = Math.round(4 * pxPerMm);
  const shadowOffset = Math.round(3 * pxPerMm);
  const paperX = margin + shadowBlur;
  const paperY = margin + shadowBlur;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = paperCanvas.width + margin * 2 + shadowBlur * 2 + shadowOffset;
  exportCanvas.height = paperCanvas.height + margin * 2 + shadowBlur * 2 + shadowOffset;
  const exportCtx = exportCanvas.getContext("2d");

  exportCtx.fillStyle = "#c9ced1";
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

  exportCtx.save();
  exportCtx.shadowColor = "rgba(39, 45, 48, .24)";
  exportCtx.shadowBlur = shadowBlur;
  exportCtx.shadowOffsetX = shadowOffset;
  exportCtx.shadowOffsetY = shadowOffset;
  exportCtx.fillStyle = "#fff";
  exportCtx.fillRect(paperX, paperY, paperCanvas.width, paperCanvas.height);
  exportCtx.restore();

  exportCtx.drawImage(paperCanvas, paperX, paperY);
  exportCtx.strokeStyle = "#b6babc";
  exportCtx.lineWidth = Math.max(1, Math.round(.125 * pxPerMm));
  exportCtx.strokeRect(paperX + .5, paperY + .5, paperCanvas.width - 1, paperCanvas.height - 1);

  return {
    canvas: exportCanvas,
    layout: {
      paperX,
      paperY,
      paperWidth: paperCanvas.width,
      paperHeight: paperCanvas.height,
      margin,
      shadowBlur,
      shadowOffset
    }
  };
}

function saveImage() {
  const settings = getSettings();
  const pxPerMm = 8;
  const baseName = state.runBaseName || formatDrawingBaseName(new Date());
  const paperCanvas = createPaperExportCanvas(settings, pxPerMm);
  const exportImage = createFramedExportCanvas(paperCanvas, pxPerMm);
  const exportCanvas = exportImage.canvas;

  window.__lastExportLayout = exportImage.layout;

  const link = document.createElement("a");
  link.href = exportCanvas.toDataURL("image/jpeg", .92);
  link.download = `${baseName}.jpg`;
  link.click();
}

function downloadGCode() {
  if (!state.runBaseName) return;

  const blob = new Blob([state.runSource], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${state.runBaseName}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function updateCurrentLine() {
  const textBeforeCaret = els.codeEditor.value.slice(0, els.codeEditor.selectionStart);
  const line = textBeforeCaret.split(/\r?\n/).length;
  if (!state.running) els.lineReadout.textContent = `Line ${line}`;
}

els.runButton.addEventListener("click", runProgram);
els.saveButton.addEventListener("click", saveImage);
els.downloadCodeButton.addEventListener("click", downloadGCode);
els.settingsButton.addEventListener("click", () => {
  const isOpen = els.settingsPanel.classList.toggle("is-open");
  els.settingsButton.setAttribute("aria-expanded", String(isOpen));
});
els.paperSelect.addEventListener("change", () => setPaper(getSettings()));
[els.paperSelect, els.penThresholdInput, els.penWidthInput, els.rapidSpeedInput, els.feedRateInput, els.previewSpeedSelect].forEach(input => {
  input.addEventListener("change", () => {
    els.saveButton.disabled = true;
    if (!state.running) setMessage("Settings changed. Run program again.");
  });
});
els.codeEditor.addEventListener("input", () => {
  els.saveButton.disabled = true;
  els.downloadCodeButton.disabled = true;
  state.runBaseName = null;
  state.runSource = "";
  clearRunAnnotations();
  setMessage("Ready.");
  updateCurrentLine();
});
els.codeEditor.addEventListener("scroll", () => {
  els.lineGutter.scrollTop = els.codeEditor.scrollTop;
  els.codeHighlight.scrollTop = els.codeEditor.scrollTop;
  els.codeHighlight.scrollLeft = els.codeEditor.scrollLeft;
});
els.codeEditor.addEventListener("keyup", updateCurrentLine);
els.codeEditor.addEventListener("click", updateCurrentLine);
window.addEventListener("resize", resizeCanvas);

clearRunAnnotations();
setPaper(getSettings());
updateCurrentLine();
