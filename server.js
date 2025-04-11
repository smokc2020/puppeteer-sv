// Giữ nguyên phần import và cấu hình Express
import express from "express";
import puppeteer from "puppeteer";
import axios from "axios";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = 4000;

app.use(express.json());

const tempDir = path.resolve(__dirname, "temp");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

function formatDriveLink(link) {
  const fileIdMatch = link.match(/(?:\/d\/|id=)([\w-]{25,})/);
  if (fileIdMatch && fileIdMatch[1]) {
    return `https://drive.google.com/uc?id=${fileIdMatch[1]}`;
  }
  return link;
}

async function downloadFileFromUrl(fileUrl) {
  const fileExt = path.extname(fileUrl.split("?")[0]) || ".jpg";
  const fileName = uuidv4() + fileExt;
  const filePath = path.resolve(tempDir, fileName);
  const writer = fs.createWriteStream(filePath);

  const response = await axios({
    method: "GET",
    url: fileUrl,
    responseType: "stream",
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", () => resolve(filePath));
    writer.on("error", reject);
  });
}

function extractIdsFromPostUrl(url) {
  try {
    if (!url) return { pageId: null, postId: null };
    const permalinkMatch = url.match(/permalink\.php\?story_fbid=([\w-]+)&id=(\d+)/);
    if (permalinkMatch) return { pageId: permalinkMatch[2], postId: permalinkMatch[1] };

    const postsMatch = url.match(/facebook\.com\/(\d+)\/posts\/([\w-]+)/);
    if (postsMatch) return { pageId: postsMatch[1], postId: postsMatch[2] };

    const pageNameMatch = url.match(/facebook\.com\/([^\/]+)\/posts\/([\w-]+)/);
    if (pageNameMatch) return { pageName: pageNameMatch[1], pageId: null, postId: pageNameMatch[2] };

    const photoMatch = url.match(/fbid=([\w-]+).*?id=(\d+)/);
    if (photoMatch) return { pageId: photoMatch[2], postId: photoMatch[1] };

    return { pageId: null, postId: null };
  } catch (error) {
    console.error("❌ Lỗi khi trích xuất ID từ URL:", error);
    return { pageId: null, postId: null };
  }
}

app.post("/post-to-facebook", async (req, res) => {
  const { pages, content, images } = req.body;
  if (!pages || !content || !Array.isArray(pages)) {
    return res.status(400).json({ error: "Thiếu thông tin hoặc pages không hợp lệ!" });
  }

  const browser = await puppeteer.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: false,
    userDataDir: "C:\\Users\\smokc\\AppData\\Local\\Google\\Chrome\\User Data\\1",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--lang=vi-VN",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--start-maximized",
      "--disable-extensions",
    ],
    slowMo: 50,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const resultList = [];

  try {
    // Đầu tiên, đi đến trang quản lý Facebook Pages
    console.log("🌐 Đang truy cập trang quản lý Facebook Pages...");
    await page.goto('https://www.facebook.com/pages/?category=your_pages&ref=bookmarks', { 
      waitUntil: "networkidle2",
      timeout: 30000
    });
    await new Promise(r => setTimeout(r, 3000));

    for (let i = 0; i < pages.length; i++) {
      const pageID = pages[i];
      console.log(`🔹 Đang chuẩn bị đăng bài lên trang ID: ${pageID}`);
      
      // Tìm và click vào nút "Chuyển" cho trang hiện tại từ trang quản lý
      let switchClicked = false;
      
      try {
        // Phương pháp tìm và click nút "Chuyển" bằng evaluate
        switchClicked = await page.evaluate((pageID) => {
          // Tìm tất cả các phần tử chứa pageID
          const pageLinks = document.querySelectorAll(`a[href*="${pageID}"]`);
          
          for (const link of pageLinks) {
            // Tìm container cha và nút "Chuyển" trong đó
            let parent = link;
            
            // Di chuyển lên tối đa 5 cấp cha
            for (let i = 0; i < 5; i++) {
              if (!parent) break;
              parent = parent.parentElement;
              
              // Tìm nút "Chuyển" trong container này
              const buttons = parent.querySelectorAll('div[role="button"]');
              for (const button of buttons) {
                if (button.textContent && button.textContent.includes('Chuyển')) {
                  button.click();
                  return true;
                }
              }
            }
          }
          return false;
        }, pageID);
        
        if (switchClicked) {
          console.log(`✅ Đã click vào nút Chuyển cho trang ID: ${pageID}`);
          // Đợi lâu hơn để chuyển trang hoàn toàn
          await new Promise(r => setTimeout(r, 5000));
        }
      } catch (evalError) {
        console.log(`⚠️ Lỗi khi tìm nút Chuyển: ${evalError.message}`);
      }
      
      // Nếu không tìm thấy nút "Chuyển", truy cập trực tiếp URL trang
      if (!switchClicked) {
        console.log(`⚠️ Không tìm thấy nút Chuyển, truy cập trực tiếp...`);
        await page.goto(`https://www.facebook.com/profile.php?id=${pageID}`, { waitUntil: "networkidle2" });
        await new Promise(r => setTimeout(r, 3000));
        
        // Tìm và nhấn nút "Chuyển" nếu có trên trang
        try {
          const switchButtonExists = await page.$('div[aria-label="Chuyển ngay"], div[role="button"][aria-label*="quản trị viên"]');
          if (switchButtonExists) {
            await switchButtonExists.click();
            await new Promise(r => setTimeout(r, 1000));
          }
        } catch (switchError) {
          console.log(`⚠️ Lỗi khi tìm nút Chuyển trực tiếp: ${switchError.message}`);
        }
      }

      // Mở hộp soạn bài viết
      try {
        const openTextBoxExists = await page.$('::-p-text(Bạn đang nghĩ)');
        if (openTextBoxExists) {
          await openTextBoxExists.click();
          await new Promise(r => setTimeout(r, 1500));
        } else {
          console.log("⚠️ Không tìm thấy hộp soạn bài, thử cách khác...");
          const altTextBoxExists = await page.$('::-p-text(Bạn đang nghĩ)');
          if (altTextBoxExists) {
            await altTextBoxExists.click();
            await new Promise(r => setTimeout(r, 1500));
          } else {
            console.log("❌ Không thể mở hộp soạn bài viết cho trang này");
            continue; // Chuyển sang trang tiếp theo
          }
        }
      } catch (textBoxError) {
        console.log(`⚠️ Lỗi khi mở hộp soạn bài: ${textBoxError.message}`);
        continue; // Chuyển sang trang tiếp theo nếu không mở được hộp soạn bài
      }

      // Nhập nội dung bài viết
      await page.keyboard.type(content, { delay: 20 });
      await new Promise(r => setTimeout(r, 4000));

      // Tải và đăng ảnh nếu có
      if (images && images.length > 0) {
        const downloadedPaths = [];
        for (const rawUrl of images) {
          const formatted = formatDriveLink(rawUrl);
          const filePath = await downloadFileFromUrl(formatted);
          downloadedPaths.push(filePath);
        }

        try {
          const fileChooserPromise = page.waitForFileChooser();
          const uploadButtonExists = await page.$('::-p-text(Thêm ảnh/video)');
          if (uploadButtonExists) {
            await uploadButtonExists.click();
            const fileChooser = await fileChooserPromise;
            await fileChooser.accept(downloadedPaths);
            await new Promise(r => setTimeout(r, 5000));
          }

          // Xóa file tạm
          for (const path of downloadedPaths) {
            fs.unlink(path, () => {});
          }
        } catch (imageError) {
          console.log(`⚠️ Lỗi khi tải ảnh: ${imageError.message}`);
        }
      }

      await new Promise(r => setTimeout(r, 2000));

      // Nhấn nút Tiếp nếu có
      try {
        const continueButtonExists = await page.$('::-p-text(Tiếp), ::-p-text(Next)');
        if (continueButtonExists) {
          await continueButtonExists.click();
          await new Promise(r => setTimeout(r, 2000));
        }
      } catch (e) {
        console.log("⚠️ Không tìm thấy nút Tiếp");
      }

      // Nhấn nút Đăng
      try {
        const postButtonExists = await page.$('div[aria-label="Đăng"], div[role="button"][aria-label*="Đăng"]');
        if (postButtonExists) {
          await postButtonExists.click();
          console.log(`✅ Đã nhấn nút Đăng`);
          await new Promise(r => setTimeout(r, 3000));
        } else {
          throw new Error("Không tìm thấy nút Đăng");
        }
      } catch (e) {
        console.log("❌ Không tìm thấy nút Đăng!");
        // Thử dùng Enter để đăng bài
        await page.keyboard.press('Enter');
        console.log("⚠️ Đã thử nhấn Enter để đăng bài");
        await new Promise(r => setTimeout(r, 3000));
      }

      // Lấy URL bài đăng
      let postUrl = null;
      try {
        await page.waitForSelector('a[href*="permalink.php?story_fbid="]', { timeout: 8000 }).catch(() => {});
        
        // Sử dụng page.$ thay vì page.locator
        const postLinks = await page.$$('a[href*="permalink.php?story_fbid="]');
        if (postLinks.length > 0) {
          postUrl = await page.evaluate(el => el.href, postLinks[0]);
        }
      } catch (urlError1) {
        console.log(`⚠️ Lỗi khi tìm URL bài đăng (cách 1): ${urlError1.message}`);
      }

      if (!postUrl) {
        try {
          const postLinkHandles = await page.$$('a[href*="/posts/"], a[href*="/permalink/"]');
          if (postLinkHandles.length > 0) {
            postUrl = await page.evaluate(el => el.href, postLinkHandles[0]);
          }
        } catch (urlError2) {
          console.log(`⚠️ Lỗi khi tìm URL bài đăng (cách 2): ${urlError2.message}`);
        }
      }

      if (!postUrl) {
        try {
          await page.goto(`https://www.facebook.com/profile.php?id=${pageID}`, { waitUntil: "networkidle2" });
          await new Promise(r => setTimeout(r, 3000));
          
          const firstPostLinks = await page.$$('div[role="article"] a[href*="/posts/"], div[role="article"] a[href*="/permalink/"]');
          if (firstPostLinks.length > 0) {
            postUrl = await page.evaluate(el => el.href, firstPostLinks[0]);
          }
        } catch (urlError3) {
          console.log(`⚠️ Lỗi khi tìm URL bài đăng (cách 3): ${urlError3.message}`);
        }
      }

      let extractedPageId = null;
      let extractedPostId = null;
      let postIdWithPageId = null;

      if (postUrl) {
        const extracted = extractIdsFromPostUrl(postUrl);
        extractedPageId = extracted.pageId;
        extractedPostId = extracted.postId;

        if (extractedPageId && extractedPostId) {
          postIdWithPageId = `${extractedPageId}_${extractedPostId}`;
        } else if (pageID && extractedPostId) {
          postIdWithPageId = `${pageID}_${extractedPostId}`;
        }
      }

      resultList.push({
        requestedPageId: pageID,
        actualPageId: extractedPageId || pageID,
        postId: extractedPostId,
        fullPostId: postIdWithPageId,
        postUrl: postUrl || null
      });

      // Quay về trang quản lý Facebook Pages để tiếp tục với trang tiếp theo
      console.log(`🔄 Quay về trang quản lý Facebook Pages...`);
      await page.goto('https://www.facebook.com/pages/?category=your_pages&ref=bookmarks', { 
        waitUntil: "networkidle2",
        timeout: 30000
      });
      await new Promise(r => setTimeout(r, 3000));
    }

    await browser.close();

    res.json({
      success: true,
      message: "🎉 Đăng bài thành công!",
      results: resultList
    });

  } catch (error) {
    console.error("❌ Lỗi:", error);
    await browser.close();
    res.status(500).json({
      success: false,
      message: "❗ Có lỗi xảy ra!",
      error: error.message || "Unknown error"
    });
  }
});

app.listen(port, () => {
  console.log(`🚀 API đang chạy tại http://localhost:${port}`);
});
