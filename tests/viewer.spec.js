const { test, expect } = require("@playwright/test");

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
