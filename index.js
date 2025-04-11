const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Hello from Puppeteer + Express on Render!');
});

// API chụp ảnh màn hình của URL được truyền qua query string
app.get('/screenshot', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send("Vui lòng cung cấp URL hợp lệ bằng query parameter 'url'.");
  }

  try {
    // Cấu hình Puppeteer với các flag cần thiết để chạy trong môi trường server (không sandbox)
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const screenshotBuffer = await page.screenshot({ fullPage: true });
    await browser.close();

    res.type('image/png');
    res.send(screenshotBuffer);
  } catch (error) {
    console.error('Lỗi khi chụp ảnh màn hình:', error);
    res.status(500).send('Đã xảy ra lỗi khi chụp ảnh màn hình.');
  }
});

// Lắng nghe server
app.listen(PORT, () => {
  console.log('Server đang chạy trên cổng ${PORT}');
});
