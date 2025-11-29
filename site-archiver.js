const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const sanitize = require('sanitize-filename');
const ora = require('ora');
const chalk = require('chalk');

class SiteArchiver {
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl;
    this.domain = new URL(baseUrl).hostname;
    this.baseDomain = this.domain.replace(/^www\./, '');
    this.visitedUrls = new Set();
    this.downloadedFiles = new Set();
    this.maxDepth = options.maxDepth || 3;
    this.maxPages = options.maxPages || 100;
    this.includeExternal = options.includeExternal || false;
    this.archiveDir = path.join('./site-archives', sanitize(this.baseDomain));
    this.browser = null;
    this.context = null;
  }

  async initialize() {
    await fs.mkdir(this.archiveDir, { recursive: true });
    await fs.mkdir(path.join(this.archiveDir, 'pages'), { recursive: true });
    await fs.mkdir(path.join(this.archiveDir, 'assets'), { recursive: true });
    await fs.mkdir(path.join(this.archiveDir, 'assets', 'images'), { recursive: true });
    await fs.mkdir(path.join(this.archiveDir, 'assets', 'css'), { recursive: true });
    await fs.mkdir(path.join(this.archiveDir, 'assets', 'js'), { recursive: true });
    await fs.mkdir(path.join(this.archiveDir, 'assets', 'fonts'), { recursive: true });
    
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async archiveSite() {
    console.log(chalk.blue.bold('\n🌐 Website Archiver\n'));
    console.log(chalk.gray(`Target: ${this.baseUrl}`));
    console.log(chalk.gray(`Max Depth: ${this.maxDepth}`));
    console.log(chalk.gray(`Max Pages: ${this.maxPages}`));
    console.log(chalk.gray(`Archive Location: ${this.archiveDir}\n`));

    const spinner = ora('Initializing...').start();

    try {
      await this.initialize();
      spinner.succeed('Initialized');

      // Start crawling from base URL
      await this.crawlPage(this.baseUrl, 0);

      // Create index
      spinner.text = 'Creating index...';
      await this.createIndex();
      spinner.succeed('Index created');

      // Create summary
      await this.createSummary();

      console.log(chalk.green.bold('\n✅ Site Archive Complete!\n'));
      console.log(chalk.blue('📊 Statistics:'));
      console.log(chalk.gray(`  Pages archived: ${this.visitedUrls.size}`));
      console.log(chalk.gray(`  Files downloaded: ${this.downloadedFiles.size}`));
      console.log(chalk.blue(`\n📁 Archive location: ${this.archiveDir}`));
      console.log(chalk.gray(`\nOpen ${path.join(this.archiveDir, 'index.html')} in your browser to view\n`));

    } catch (error) {
      spinner.fail('Error occurred');
      console.error(chalk.red(`\n❌ Error: ${error.message}`));
    } finally {
      await this.close();
    }
  }

  async crawlPage(url, depth) {
    // Check limits
    if (depth > this.maxDepth) return;
    if (this.visitedUrls.size >= this.maxPages) return;
    if (this.visitedUrls.has(url)) return;

    // Check if same domain
    const urlDomain = new URL(url).hostname.replace(/^www\./, '');
    if (!this.includeExternal && urlDomain !== this.baseDomain) return;

    this.visitedUrls.add(url);

    const spinner = ora(`[${this.visitedUrls.size}/${this.maxPages}] ${url.substring(0, 60)}...`).start();

    try {
      const page = await this.context.newPage();
      
      await page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: 60000 
      });

      await page.waitForTimeout(2000);

      // Get page content
      const html = await page.content();
      const $ = cheerio.load(html);

      // Download assets
      await this.downloadAssets($, url);

      // Modify HTML to use local assets
      const modifiedHtml = this.modifyHtmlForOffline($, url);

      // Save page
      const pagePath = this.getPagePath(url);
      await fs.writeFile(pagePath, modifiedHtml);

      spinner.succeed(chalk.green(`[${this.visitedUrls.size}] Saved: ${this.getPageName(url)}`));

      // Find all links on this page
      const links = [];
      $('a[href]').each((i, el) => {
        const href = $(el).attr('href');
        if (href) {
          const absoluteUrl = this.makeAbsolute(href, url);
          if (absoluteUrl && this.shouldCrawl(absoluteUrl)) {
            links.push(absoluteUrl);
          }
        }
      });

      await page.close();

      // Crawl linked pages (depth-first)
      for (const link of links.slice(0, 20)) { // Limit links per page
        if (this.visitedUrls.size >= this.maxPages) break;
        await this.crawlPage(link, depth + 1);
      }

    } catch (error) {
      spinner.fail(chalk.red(`Failed: ${error.message}`));
    }
  }

  async downloadAssets($, pageUrl) {
    // Download images
    $('img[src]').each(async (i, el) => {
      const src = $(el).attr('src');
      if (src) {
        await this.downloadFile(src, 'images', pageUrl);
      }
    });

    // Download CSS
    $('link[rel="stylesheet"]').each(async (i, el) => {
      const href = $(el).attr('href');
      if (href) {
        await this.downloadFile(href, 'css', pageUrl);
      }
    });

    // Download JS
    $('script[src]').each(async (i, el) => {
      const src = $(el).attr('src');
      if (src) {
        await this.downloadFile(src, 'js', pageUrl);
      }
    });

    // Download background images from inline styles
    $('[style*="background"]').each(async (i, el) => {
      const style = $(el).attr('style');
      const matches = style.match(/url\(['"]?([^'")\s]+)['"]?\)/g);
      if (matches) {
        for (const match of matches) {
          const url = match.match(/url\(['"]?([^'")\s]+)['"]?\)/)[1];
          await this.downloadFile(url, 'images', pageUrl);
        }
      }
    });
  }

  async downloadFile(url, type, baseUrl) {
    try {
      const absoluteUrl = this.makeAbsolute(url, baseUrl);
      if (!absoluteUrl || this.downloadedFiles.has(absoluteUrl)) return;

      const response = await axios.get(absoluteUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024 // 50MB
      });

      const urlObj = new URL(absoluteUrl);
      const filename = path.basename(urlObj.pathname) || 'index';
      const filePath = path.join(this.archiveDir, 'assets', type, sanitize(filename));

      await fs.writeFile(filePath, response.data);
      this.downloadedFiles.add(absoluteUrl);

    } catch (error) {
      // Silent fail for assets
    }
  }

  modifyHtmlForOffline($, pageUrl) {
    // Modify image sources
    $('img[src]').each((i, el) => {
      const src = $(el).attr('src');
      if (src) {
        const absoluteUrl = this.makeAbsolute(src, pageUrl);
        if (absoluteUrl) {
          const filename = path.basename(new URL(absoluteUrl).pathname) || 'image';
          $(el).attr('src', `../assets/images/${sanitize(filename)}`);
        }
      }
    });

    // Modify CSS links
    $('link[rel="stylesheet"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href) {
        const absoluteUrl = this.makeAbsolute(href, pageUrl);
        if (absoluteUrl) {
          const filename = path.basename(new URL(absoluteUrl).pathname) || 'style.css';
          $(el).attr('href', `../assets/css/${sanitize(filename)}`);
        }
      }
    });

    // Modify JS sources
    $('script[src]').each((i, el) => {
      const src = $(el).attr('src');
      if (src) {
        const absoluteUrl = this.makeAbsolute(src, pageUrl);
        if (absoluteUrl) {
          const filename = path.basename(new URL(absoluteUrl).pathname) || 'script.js';
          $(el).attr('src', `../assets/js/${sanitize(filename)}`);
        }
      }
    });

    // Modify internal links
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      if (href && !href.startsWith('http') && !href.startsWith('#')) {
        const absoluteUrl = this.makeAbsolute(href, pageUrl);
        if (absoluteUrl && this.shouldCrawl(absoluteUrl)) {
          const pageName = this.getPageName(absoluteUrl);
          $(el).attr('href', `./${pageName}`);
        }
      }
    });

    // Add archive notice
    $('body').prepend(`
      <div style="background: #fef3c7; border-bottom: 2px solid #f59e0b; padding: 10px; text-align: center; font-family: sans-serif;">
        📦 <strong>Archived Version</strong> - Original: <a href="${pageUrl}" target="_blank">${pageUrl}</a>
      </div>
    `);

    return $.html();
  }

  getPagePath(url) {
    const pageName = this.getPageName(url);
    return path.join(this.archiveDir, 'pages', pageName);
  }

  getPageName(url) {
    try {
      const urlObj = new URL(url);
      let pathname = urlObj.pathname;
      
      if (pathname === '/' || pathname === '') {
        return 'index.html';
      }

      // Remove leading/trailing slashes
      pathname = pathname.replace(/^\/+|\/+$/g, '');
      
      // Replace slashes with underscores
      pathname = pathname.replace(/\//g, '_');
      
      // Add .html if no extension
      if (!path.extname(pathname)) {
        pathname += '.html';
      }

      return sanitize(pathname);
    } catch {
      return 'page_' + Date.now() + '.html';
    }
  }

  makeAbsolute(url, baseUrl) {
    try {
      if (!url) return null;
      if (url.startsWith('data:')) return null;
      if (url.startsWith('//')) return 'https:' + url;
      if (url.startsWith('http')) return url;
      return new URL(url, baseUrl).href;
    } catch {
      return null;
    }
  }

  shouldCrawl(url) {
    try {
      const urlObj = new URL(url);
      const urlDomain = urlObj.hostname.replace(/^www\./, '');
      
      // Must be same domain (unless external is allowed)
      if (!this.includeExternal && urlDomain !== this.baseDomain) return false;

      // Exclude certain file types
      const excludeExtensions = ['.pdf', '.zip', '.exe', '.dmg', '.jpg', '.png', '.gif', '.mp4', '.mp3'];
      const ext = path.extname(urlObj.pathname).toLowerCase();
      if (excludeExtensions.includes(ext)) return false;

      // Exclude certain paths
      const excludePaths = ['/api/', '/admin/', '/login', '/logout', '/signup'];
      if (excludePaths.some(p => urlObj.pathname.includes(p))) return false;

      return true;
    } catch {
      return false;
    }
  }

  async createIndex() {
    const pages = Array.from(this.visitedUrls).map(url => ({
      url,
      name: this.getPageName(url),
      title: url
    }));

    const indexHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Archive: ${this.baseDomain}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
    }
    .meta {
      color: #666;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #eee;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat {
      background: #f9f9f9;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-value {
      font-size: 2em;
      font-weight: bold;
      color: #667eea;
    }
    .stat-label {
      color: #666;
      margin-top: 5px;
    }
    .page-list {
      list-style: none;
    }
    .page-list li {
      padding: 12px;
      border-bottom: 1px solid #eee;
    }
    .page-list li:hover {
      background: #f9f9f9;
    }
    .page-list a {
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
    }
    .page-list a:hover {
      text-decoration: underline;
    }
    .original-link {
      color: #999;
      font-size: 0.9em;
      margin-left: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📦 Archived Website: ${this.baseDomain}</h1>
    <div class="meta">
      <p>Original URL: <a href="${this.baseUrl}" target="_blank">${this.baseUrl}</a></p>
      <p>Archived: ${new Date().toLocaleString()}</p>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">${this.visitedUrls.size}</div>
        <div class="stat-label">Pages Archived</div>
      </div>
      <div class="stat">
        <div class="stat-value">${this.downloadedFiles.size}</div>
        <div class="stat-label">Files Downloaded</div>
      </div>
      <div class="stat">
        <div class="stat-value">${this.maxDepth}</div>
        <div class="stat-label">Max Depth</div>
      </div>
    </div>

    <h2>📄 Archived Pages</h2>
    <ul class="page-list">
      ${pages.map(page => `
        <li>
          <a href="./pages/${page.name}">${page.title}</a>
          <span class="original-link">(${page.url})</span>
        </li>
      `).join('')}
    </ul>
  </div>
</body>
</html>
    `;

    await fs.writeFile(path.join(this.archiveDir, 'index.html'), indexHtml);
  }

  async createSummary() {
    const summary = {
      domain: this.baseDomain,
      baseUrl: this.baseUrl,
      archivedAt: new Date().toISOString(),
      pagesArchived: this.visitedUrls.size,
      filesDownloaded: this.downloadedFiles.size,
      maxDepth: this.maxDepth,
      pages: Array.from(this.visitedUrls)
    };

    await fs.writeFile(
      path.join(this.archiveDir, 'archive-info.json'),
      JSON.stringify(summary, null, 2)
    );
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(chalk.red('Error: Please provide a website URL'));
    console.log(chalk.yellow('\nUsage: node site-archiver.js <URL> [OPTIONS]'));
    console.log(chalk.gray('\nOptions:'));
    console.log(chalk.gray('  --depth=N       Maximum crawl depth (default: 3)'));
    console.log(chalk.gray('  --max-pages=N   Maximum pages to archive (default: 100)'));
    console.log(chalk.gray('  --external      Include external links'));
    console.log(chalk.yellow('\nExamples:'));
    console.log(chalk.gray('  node site-archiver.js https://example.com'));
    console.log(chalk.gray('  node site-archiver.js https://example.com --depth=5 --max-pages=200'));
    process.exit(1);
  }

  const url = args[0];
  const options = {
    maxDepth: 3,
    maxPages: 100,
    includeExternal: false
  };

  // Parse options
  args.slice(1).forEach(arg => {
    if (arg.startsWith('--depth=')) {
      options.maxDepth = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--max-pages=')) {
      options.maxPages = parseInt(arg.split('=')[1]);
    } else if (arg === '--external') {
      options.includeExternal = true;
    }
  });

  const archiver = new SiteArchiver(url, options);
  await archiver.archiveSite();
}

main();