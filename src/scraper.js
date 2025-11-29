const { chromium } = require('playwright');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config.json');

class NewspaperScraper {
  constructor() {
    this.browser = null;
    this.context = null;
  }

  async initialize() {
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({
      userAgent: config.userAgent,
      viewport: { width: 1920, height: 1080 }
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async scrapeWebsite(url, progressCallback) {
    try {
      const page = await this.context.newPage();
      page.setDefaultTimeout(config.pageTimeout);

      progressCallback({ status: 'loading', message: `Loading ${url}...` });
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });

      // Wait for content to load
      await page.waitForTimeout(config.waitForContent);

      // Scroll to load lazy content
      await this.autoScroll(page);

      const html = await page.content();
      const $ = cheerio.load(html);

      progressCallback({ status: 'discovering', message: 'Discovering articles...' });
      const articleLinks = await this.discoverArticleLinks($, url);

      progressCallback({ 
        status: 'found', 
        message: `Found ${articleLinks.length} articles`,
        count: articleLinks.length 
      });

      await page.close();
      return articleLinks;
    } catch (error) {
      throw new Error(`Failed to scrape website: ${error.message}`);
    }
  }

  async scrapeArticle(articleUrl, progressCallback) {
    let retries = 0;
    
    while (retries < config.retryAttempts) {
      try {
        const page = await this.context.newPage();
        page.setDefaultTimeout(config.pageTimeout);

        progressCallback({ status: 'loading', url: articleUrl });
        await page.goto(articleUrl, { 
          waitUntil: 'domcontentloaded',
          timeout: 60000 
        });
        await page.waitForTimeout(config.waitForContent);

        const html = await page.content();
        const $ = cheerio.load(html);

        const article = await this.extractArticleData($, articleUrl, page);
        
        await page.close();
        return article;
      } catch (error) {
        retries++;
        if (retries >= config.retryAttempts) {
          progressCallback({ 
            status: 'error', 
            url: articleUrl, 
            error: error.message 
          });
          return null;
        }
        await this.delay(config.retryDelay);
      }
    }
  }

  async extractArticleData($, url, page) {
    const article = {
      url: url,
      title: this.extractTitle($),
      author: this.extractAuthor($),
      publishDate: this.extractPublishDate($),
      content: this.extractContent($),
      tags: this.extractTags($),
      images: this.extractImages($, url),
      videos: this.extractVideos($, url),
      scrapedAt: new Date().toISOString(),
      html: config.saveHTML ? $.html() : null
    };

    // Take screenshot if enabled
    if (config.takeScreenshots) {
      article.screenshot = await page.screenshot({ fullPage: true });
    }

    return article;
  }

  extractTitle($) {
    const selectors = [
      'h1',
      '[class*="title"]',
      '[class*="headline"]',
      'article h1',
      '.article-title',
      'meta[property="og:title"]',
      'meta[name="twitter:title"]'
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        const text = selector.includes('meta') 
          ? element.attr('content') 
          : element.text().trim();
        if (text && text.length > 0) return text;
      }
    }

    return 'Untitled Article';
  }

  extractAuthor($) {
    const selectors = [
      '[rel="author"]',
      '.author',
      '.byline',
      '[class*="author"]',
      '[itemprop="author"]',
      'meta[name="author"]',
      'meta[property="article:author"]'
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        const text = selector.includes('meta') 
          ? element.attr('content') 
          : element.text().trim();
        if (text && text.length > 0) {
          return text.replace(/^by\s+/i, '').trim();
        }
      }
    }

    return 'Unknown';
  }

  extractPublishDate($) {
    const selectors = [
      'time[datetime]',
      '[itemprop="datePublished"]',
      '.publish-date',
      '.published',
      'meta[property="article:published_time"]',
      'meta[name="publish_date"]'
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        const datetime = element.attr('datetime') || element.attr('content') || element.text().trim();
        if (datetime) return datetime;
      }
    }

    return new Date().toISOString();
  }

  extractContent($) {
    const selectors = [
      'article',
      '.article-content',
      '.article-body',
      '[class*="article"][class*="content"]',
      '[class*="post-content"]',
      'main',
      '.content'
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        // Remove unwanted elements
        element.find('script, style, nav, header, footer, aside, .ad, .advertisement').remove();
        
        const paragraphs = [];
        element.find('p').each((i, el) => {
          const text = $(el).text().trim();
          if (text.length > 50) { // Avoid short promotional text
            paragraphs.push(text);
          }
        });

        if (paragraphs.length > 0) {
          return paragraphs.join('\n\n');
        }
      }
    }

    // Fallback: get all paragraphs
    const allParagraphs = [];
    $('p').each((i, el) => {
      const text = $(el).text().trim();
      if (text.length > 50) {
        allParagraphs.push(text);
      }
    });

    return allParagraphs.join('\n\n') || 'No content extracted';
  }

  extractTags($) {
    const tags = new Set();
    
    const selectors = [
      'a[rel="tag"]',
      '.tag',
      '.tags a',
      '[class*="tag"] a',
      'meta[property="article:tag"]',
      'meta[name="keywords"]'
    ];

    selectors.forEach(selector => {
      $(selector).each((i, el) => {
        const text = selector.includes('meta') 
          ? $(el).attr('content') 
          : $(el).text().trim();
        
        if (text) {
          if (text.includes(',')) {
            text.split(',').forEach(tag => tags.add(tag.trim()));
          } else {
            tags.add(text);
          }
        }
      });
    });

    return Array.from(tags).filter(tag => tag.length > 0);
  }

  extractImages($, baseUrl) {
    const images = [];
    const seen = new Set();

    $('img').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src) {
        const absoluteUrl = this.makeAbsoluteUrl(src, baseUrl);
        if (!seen.has(absoluteUrl) && this.isValidMediaUrl(absoluteUrl)) {
          seen.add(absoluteUrl);
          images.push({
            url: absoluteUrl,
            alt: $(el).attr('alt') || '',
            title: $(el).attr('title') || ''
          });
        }
      }
    });

    return images;
  }

  extractVideos($, baseUrl) {
    const videos = [];
    const seen = new Set();

    $('video source, video').each((i, el) => {
      const src = $(el).attr('src');
      if (src) {
        const absoluteUrl = this.makeAbsoluteUrl(src, baseUrl);
        if (!seen.has(absoluteUrl) && this.isValidMediaUrl(absoluteUrl)) {
          seen.add(absoluteUrl);
          videos.push({ url: absoluteUrl });
        }
      }
    });

    // Check for iframe embeds (YouTube, Vimeo, etc.)
    $('iframe').each((i, el) => {
      const src = $(el).attr('src');
      if (src && (src.includes('youtube.com') || src.includes('vimeo.com'))) {
        if (!seen.has(src)) {
          seen.add(src);
          videos.push({ url: src, type: 'embed' });
        }
      }
    });

    return videos;
  }

  async discoverArticleLinks($, baseUrl) {
    const links = new Set();
    const domain = new URL(baseUrl).hostname;

    // Common article link patterns
    const articleSelectors = [
      'article a[href]',
      '.article a[href]',
      'a[href*="/article/"]',
      'a[href*="/news/"]',
      'a[href*="/story/"]',
      'a[href*="/post/"]',
      '[class*="article"] a[href]',
      '[class*="post"] a[href]',
      'h2 a[href]',
      'h3 a[href]'
    ];

    articleSelectors.forEach(selector => {
      $(selector).each((i, el) => {
        const href = $(el).attr('href');
        if (href) {
          const absoluteUrl = this.makeAbsoluteUrl(href, baseUrl);
          const linkDomain = new URL(absoluteUrl).hostname;
          
          // Only include links from the same domain
          if (linkDomain === domain && this.looksLikeArticle(absoluteUrl)) {
            links.add(absoluteUrl);
          }
        }
      });
    });

    return Array.from(links);
  }

  looksLikeArticle(url) {
    const articlePatterns = [
      /\/article\//,
      /\/news\//,
      /\/story\//,
      /\/post\//,
      /\/\d{4}\/\d{2}\/\d{2}\//,  // Date-based URLs
      /\/blog\//,
      /\/press\//
    ];

    const excludePatterns = [
      /\/(tag|category|author|search|page)\//,
      /\.(jpg|png|gif|pdf|xml|json)$/i,
      /#/,
      /\?/
    ];

    const hasArticlePattern = articlePatterns.some(pattern => pattern.test(url));
    const hasExcludePattern = excludePatterns.some(pattern => pattern.test(url));

    return hasArticlePattern && !hasExcludePattern;
  }

  makeAbsoluteUrl(url, baseUrl) {
    try {
      if (url.startsWith('http')) return url;
      if (url.startsWith('//')) return 'https:' + url;
      return new URL(url, baseUrl).href;
    } catch {
      return url;
    }
  }

  isValidMediaUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async autoScroll(page) {
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });
    await page.waitForTimeout(config.scrollDelay);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = NewspaperScraper;