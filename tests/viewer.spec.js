const { test, expect } = require("@playwright/test");

async function captureNextExport(page) {
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toDataURL;
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      const context = this.getContext("2d");
      const corner = Array.from(context.getImageData(0, 0, 1, 1).data);
      const layout = window.__lastExportLayout;
      let paperTopNonWhitePixels = 0;

      if (layout) {
        const sampleX = layout.paperX + 8;
        const sampleY = layout.paperY + 8;
        const sampleWidth = layout.paperWidth - 16;
        const sampleHeight = Math.floor(layout.paperHeight * .25);
        const pixels = context.getImageData(sampleX, sampleY, sampleWidth, sampleHeight).data;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250) paperTopNonWhitePixels += 1;
        }
      }

      window.__lastExportStats = {
        width: this.width,
        height: this.height,
        corner,
        layout,
        paperTopNonWhitePixels
      };
      return original.apply(this, args);
    };
    HTMLAnchorElement.prototype.click = function(...args) {
      window.__lastAnchorDownload = this.download;
      window.__lastAnchorHref = this.href;
      if (this.href.startsWith("data:")) return undefined;
      return originalClick.apply(this, args);
    };
  });
}

async function useFixedBrowserClock(page) {
  await page.addInitScript(() => {
    const RealDate = Date;
    const fixedDate = new RealDate("2026-09-03T19:30:21");
    class FixedDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) return new RealDate(fixedDate);
        return new RealDate(...args);
      }

      static now() {
        return fixedDate.getTime();
      }
    }

    FixedDate.UTC = RealDate.UTC;
    FixedDate.parse = RealDate.parse;
    window.Date = FixedDate;
  });
}

test("runs a G-code program, draws on the canvas, and enables JPEG export", async ({ page }) => {
  await page.goto("/");

  const saveButton = page.getByRole("button", { name: "Save image" });
  await expect(saveButton).toBeDisabled();

  await page.getByRole("textbox", { name: "G-code editor" }).fill([
    "G0 X10 Y10 Z0",
    "G1 Z5 F6000",
    "G1 X40 Y10"
  ].join("\n"));

  await page.getByRole("button", { name: "Run program" }).click();
  await expect(page.getByText("Finished 3 moves.")).toBeVisible();
  await expect(saveButton).toBeEnabled();
  await expect(page.locator("#codeHighlight .success")).toHaveCount(3);

  const hasInk = await page.locator("#drawingCanvas").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      const red = pixels[i];
      const green = pixels[i + 1];
      const blue = pixels[i + 2];
      const alpha = pixels[i + 3];
      if (alpha > 0 && red < 80 && green < 80 && blue < 80) return true;
    }
    return false;
  });

  expect(hasInk).toBe(true);
});

test("uses the editor text and gutter as an export watermark by default", async ({ page }) => {
  await page.goto("/");

  const saveButton = page.getByRole("button", { name: "Save image" });
  await page.getByRole("textbox", { name: "G-code editor" }).fill([
    "; student code watermark",
    "G0 X10 Y10 Z0",
    "G1 Z5 F6000",
    "G1 X40 Y10"
  ].join("\n"));

  await page.getByRole("button", { name: "Run program" }).click();
  await expect(page.locator("#message")).toContainText("Finished 3 moves.");

  await captureNextExport(page);

  await saveButton.click();
  const stats = await page.evaluate(() => window.__lastExportStats);
  expect(stats.width).toBeGreaterThan(stats.layout.paperWidth);
  expect(stats.height).toBeGreaterThan(stats.layout.paperHeight);
  expect(stats.corner.slice(0, 3)).toEqual([201, 206, 209]);
  expect(stats.paperTopNonWhitePixels).toBeGreaterThan(100);
});

test("uses the Run-click timestamp for JPEG and G-code text downloads", async ({ page }) => {
  await useFixedBrowserClock(page);
  await page.goto("/");

  const source = [
    "G0 X10 Y10 Z0",
    "G1 Z5 F6000",
    "G1 X40 Y10 ; student line"
  ].join("\n");
  const saveButton = page.getByRole("button", { name: "Save image" });
  const downloadCodeButton = page.getByRole("button", { name: "Download G-code" });

  await expect(downloadCodeButton).toBeDisabled();
  await page.getByRole("textbox", { name: "G-code editor" }).fill(source);
  await page.getByRole("button", { name: "Run program" }).click();
  await expect(page.locator("#message")).toContainText("Finished 3 moves.");
  await expect(saveButton).toBeEnabled();
  await expect(downloadCodeButton).toBeEnabled();

  await captureNextExport(page);
  await saveButton.click();
  await expect.poll(() => page.evaluate(() => window.__lastAnchorDownload)).toBe("Drawing_20260903_193021.jpg");

  await page.evaluate(() => {
    URL.createObjectURL = (blob) => {
      blob.text().then(text => { window.__lastTextDownload = text; });
      return "blob:captured-gcode";
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function() {
      window.__lastAnchorDownload = this.download;
      window.__lastAnchorHref = this.href;
    };
  });

  await downloadCodeButton.click();
  await expect.poll(() => page.evaluate(() => window.__lastAnchorDownload)).toBe("Drawing_20260903_193021.txt");
  await expect.poll(() => page.evaluate(() => window.__lastTextDownload)).toBe(source);

  await page.getByRole("textbox", { name: "G-code editor" }).press("End");
  await page.getByRole("textbox", { name: "G-code editor" }).press("Enter");
  await expect(saveButton).toBeDisabled();
  await expect(downloadCodeButton).toBeDisabled();
});

test("can save without the code watermark when the export option is off", async ({ page }) => {
  await page.goto("/");

  const saveButton = page.getByRole("button", { name: "Save image" });
  await page.getByRole("button", { name: "Advanced settings" }).click();
  await page.getByLabel("Code watermark").uncheck();
  await page.getByRole("textbox", { name: "G-code editor" }).fill([
    "; this comment should not appear in the export",
    "G0 X10 Y10 Z0",
    "G1 Z5 F6000",
    "G1 X40 Y10"
  ].join("\n"));

  await page.getByRole("button", { name: "Run program" }).click();
  await expect(page.locator("#message")).toContainText("Finished 3 moves.");
  await expect(saveButton).toBeEnabled();

  await captureNextExport(page);

  await saveButton.click();
  const stats = await page.evaluate(() => window.__lastExportStats);
  expect(stats.width).toBeGreaterThan(stats.layout.paperWidth);
  expect(stats.height).toBeGreaterThan(stats.layout.paperHeight);
  expect(stats.corner.slice(0, 3)).toEqual([201, 206, 209]);
  expect(stats.paperTopNonWhitePixels).toBe(0);
});

test("shortens long export watermarks with an ellipsis and final source lines", async ({ page }) => {
  await page.goto("/");

  const source = Array.from({ length: 40 }, (_, index) => {
    const line = index + 1;
    return line === 1 ? "G0 X10 Y10 Z0" : `G1 X${10 + line} Y10 Z5 F6000`;
  });

  await page.getByRole("textbox", { name: "G-code editor" }).fill(source.join("\n"));
  await page.getByRole("button", { name: "Run program" }).click();
  await expect(page.locator("#message")).toContainText("Finished 40 moves.");

  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    window.__watermarkText = [];
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      window.__watermarkText.push(String(text));
      return original.call(this, text, ...args);
    };
  });

  await page.getByRole("button", { name: "Save image" }).click();
  const drawnText = await page.evaluate(() => window.__watermarkText);

  expect(drawnText.filter(text => text === "...")).toHaveLength(2);
  expect(drawnText).toContain("G0 X10 Y10 Z0");
  expect(drawnText).toContain(source[36]);
  expect(drawnText).toContain(source[37]);
  expect(drawnText).toContain(source[38]);
  expect(drawnText).toContain(source[39]);
  expect(drawnText).not.toContain(source[35]);
  expect(drawnText).not.toContain(source[34]);
});

test("shows teacher-style syntax feedback and clears run colors only after editing", async ({ page }) => {
  await page.goto("/");

  const editor = page.getByRole("textbox", { name: "G-code editor" });
  await editor.fill("G0 X10 Y10 Z0\nG1 X20, Y20 Z5");
  await page.getByRole("button", { name: "Run program" }).click();

  await expect(page.locator("#message")).toContainText("Line 2: G-code does not use commas between words.");
  await expect(page.locator("#codeHighlight .success")).toHaveCount(1);
  await expect(page.locator("#codeHighlight .error")).toContainText("G1 X20, Y20 Z5");

  await editor.click();
  await expect(page.locator("#editorBody")).toHaveClass(/has-run-annotations/);
  await expect(page.locator("#codeHighlight .error")).toHaveCount(1);

  await editor.press("End");
  await editor.press("Backspace");
  await expect(page.locator("#editorBody")).not.toHaveClass(/has-run-annotations/);
  await expect(page.locator("#codeHighlight .error")).toHaveCount(0);
});

test("ignores semicolon and parenthesized comments in G-code", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("textbox", { name: "G-code editor" }).fill([
    "; this whole line is a comment with G2 X? and commas, commas",
    "G0 X10 Y10 Z0 ; move to the start",
    "G1 Z5 F6000 (lower the pen)",
    "G1 X40 Y10 (this comment can mention PU, M3, or G2)",
    "(another full-line comment)",
    "Y40 ; modal G1 movement continues here"
  ].join("\n"));

  await page.getByRole("button", { name: "Run program" }).click();

  await expect(page.locator("#message")).toContainText("Finished 4 moves.");
  await expect(page.locator("#codeHighlight .success")).toHaveCount(4);
  await expect(page.locator("#codeHighlight .error")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save image" })).toBeEnabled();
});

test("uses the Run button as a Stop button during execution", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("textbox", { name: "G-code editor" }).fill([
    "G0 X10 Y10 Z0",
    "G1 X100 Y10 Z5 F1"
  ].join("\n"));

  await page.getByRole("button", { name: "Run program" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();

  await expect(page.getByRole("button", { name: "Run program" })).toBeVisible();
  await expect(page.locator("#message")).toContainText("Stopped");
  await expect(page.getByRole("button", { name: "Save image" })).toBeDisabled();
});

test("keeps line feedback usable in a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 820 });
  await page.goto("/");

  const editor = page.getByRole("textbox", { name: "G-code editor" });
  await editor.fill("G0 X10 Y10 Z0\nG1 X20, Y20 Z5");
  await page.getByRole("button", { name: "Run program" }).click();

  await expect(page.locator("#lineGutter .gutter-line.success")).toHaveCount(1);
  await expect(page.locator("#lineGutter .gutter-line.error")).toHaveCount(1);
  await editor.click();
  await expect(page.locator("#editorBody")).toHaveClass(/has-run-annotations/);
});
