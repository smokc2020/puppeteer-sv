import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(express.json({ limit: "50mb" }));

async function postToFacebook(content, imageUrl, pageUrl) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--lang=vi-VN"]
  });
  const page = await browser.newPage();

  try {
    await page.goto("https://www.facebook.com", { waitUntil: "networkidle0" });

    await page.goto(pageUrl, { waitUntil: "networkidle0" });

    const menuBtn = page.locator("div[aria-label='Menu']");
    await menuBtn.first().click();

    const switchBtn = await page.waitForSelector("text='Chuyển sang trang'");
    await switchBtn.click();

    await page.waitForNavigation({ waitUntil: "networkidle0" });

    const createBtn = page.locator("div[role='button']:has-text('Tạo bài viết')");
    await createBtn.first().click();

    const inputLocator = page.locator("div[role='dialog'] div[role='textbox']");
    await inputLocator.fill(content);

    if (imageUrl) {
      const imgRes = await fetch(imageUrl);
      const buffer = await imgRes.buffer();
      const tempDir = "/tmp";
      const fileName = `fb-image-${uuidv4()}.jpg`;
      const filePath = path.join(tempDir, fileName);

      fs.writeFileSync(filePath, buffer);

      const inputUploadHandle = await page.waitForSelector("input[type=file]", { visible: true });
      await inputUploadHandle.uploadFile(filePath);
      await page.waitForTimeout(3000);
    }

    const postBtnLocator = page.locator("div[aria-label='Đăng']");
    await Promise.race([
      postBtnLocator.first().click(),
      new Promise(resolve => setTimeout(resolve, 10000))
    ]);

    await page.waitForTimeout(5000);

    const postUrl = page.url();

    await browser.close();
    return { success: true, postUrl };
  } catch (err) {
    await browser.close();
    return { success: false, error: err.message };
  }
}

app.post("/post", async (req, res) => {
  const { content, imageUrl, pageUrl } = req.body;
  if (!content || !pageUrl) {
    return res.status(400).json({ success: false, error: "Thiếu content hoặc pageUrl" });
  }

  const result = await postToFacebook(content, imageUrl, pageUrl);
  res.json(result);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
