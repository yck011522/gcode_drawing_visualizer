# G-code Drawing Visualizer

A browser-based teaching tool that helps students learn G-code by watching a
simulated pen plotter draw their programs on paper.

> [!NOTE]
> This project is currently in requirements discovery. The behavior below is a
> working product specification, not a list of implemented features.

## Product direction

The visualizer will provide a deliberately simple, installation-free interface:

- a multiline G-code editor;
- a **Run** button rather than a live preview;
- line-by-line execution with a visible program pointer;
- an animated marker for the pen's current XY position;
- live X, Y, Z, feed-rate, and pen-state readouts; and
- a paper preview with black pen strokes on a white sheet in a gray workspace.

Advanced options will live on a separate settings page so that the main learning
experience remains approachable.

## Initial G-code model

- Support `G0` and `G1` movement commands.
- Use millimeters and absolute, positive coordinates, with the origin at the
  paper's bottom-left corner.
- Treat positive Z as motion toward the paper.
- Consider the pen down at a configurable threshold, initially `Z >= 2.0`.
- Animate `G0` using a configurable rapid-travel speed.
- Animate `G1` using a modal feed rate. An `F` word changes that rate for the
  current and subsequent `G1` movements; settings provide its initial value.
- Offer preview speed choices of 1x, 2x, 5x, and 10x without changing the
  simulated machine speed.
- Stop on invalid syntax or a movement outside the paper, highlight that source
  line, and display a student-friendly warning.

## Paper options

The default paper is **A5 landscape**. Advanced settings will also offer **A5
portrait** and **A4 portrait**.

| Paper | Logical size |
| --- | ---: |
| A5 landscape | 210 x 148 mm |
| A5 portrait | 148 x 210 mm |
| A4 portrait | 210 x 297 mm |

The on-screen preview will be responsive while preserving the selected paper's
physical aspect ratio and millimeter coordinate system.

## Export direction

PNG exports will use one fixed pixels-per-millimeter scale for every paper size,
rather than giving every format the same maximum pixel dimension. Consequently,
an A5 export contains fewer pixels than an A4 export, and a pen width expressed
in millimeters appears consistently across formats.

The basic export will contain only the paper and the completed—or partially
completed—drawing. A second, exploratory **drawing-by-coding** composition will
place the drawing over a subtle, cool-toned monospace rendering of the source
across the paper. A narrow gutter keeps line numbers and execution status visible
without losing the artistic overlay effect:

- each source line has a line number;
- successfully executed lines receive a check mark;
- the line that stops execution receives a cross mark;
- lines not reached have no status mark; and
- a failed run retains its partial drawing.

The drawing-only and drawing-by-coding compositions will be separate export
modes. The exact pixels-per-millimeter export scale and treatment of comments and
blank lines remain open design decisions.

## Interface preview

An initial static interface mockup is available in [`index.html`](index.html).
It establishes the intended editor-and-paper layout, but it does not yet parse,
execute, animate, or export G-code.
