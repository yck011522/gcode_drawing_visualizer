const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, expect } = require("@playwright/test");

test("runs a G-code program, draws on the canvas, and enables JPEG export", async ({ page }) => {
  await page.goto(pathToFileURL(path.join(process.cwd(), "index.html")).href);

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
