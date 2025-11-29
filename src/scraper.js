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

      progressCallback({ status: 'loading', message: 'Loading ' + url + '...' });
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });

      await page.waitForTimeout(config.waitForContent);
      await this.autoScroll(page);

      const html = await page.content();
      const $ = cheerio.load(html);

      progressCallback({ status: 'discovering', message: 'Discovering articles...' });
      const articleLinks = await this.discoverArticleLinks($, url);

      progressCallback({ 
        status: 'found', 
        message: 'Found ' + articleLinks.length + ' articles',
        count: articleLinks.length 
      });

      await page.close();
      return articleLinks;
    } catch (error) {
      throw new Error('Failed to scrape website: ' + error.message);
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

        // Wait for content to appear
        try {
          await page.waitForSelector('article, .article, [class*="article"], [class*="content"]', {
            timeout: 10000
          });
        } catch (e) {
          // Content might be elsewhere, continue anyway
        }

        const html = await page.content();
        const $ = cheerio.load(html);

        const article = await this.extractArticleData($, articleUrl, page);
        
        // Validate that we got meaningful content
        if (!article.content || article.content.length < 100) {
          throw new Error('Article content too short or empty');
        }
        
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

    if (config.takeScreenshots) {
      article.screenshot = await page.screenshot({ fullPage: true });
    }

    return article;
  }

  extractTitle($) {
    const selectors = [
      'h1',
      'h1[class*="title"]',
      'h1[class*="headline"]',
      'article h1',
      '.article-title',
      '.post-title',
      '.entry-title',
      '[itemprop="headline"]',
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'title'
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        const text = selector.includes('meta') 
          ? element.attr('content') 
          : element.text().trim();
        if (text && text.length > 0 && text.length < 300) {
          return text;
        }
      }
    }

    return 'Untitled Article';
  }

  extractAuthor($) {
    const selectors = [
      '[rel="author"]',
      '.author',
      '.byline',
      '.author-name',
      '[class*="author"]',
      '[itemprop="author"]',
      '[itemprop="author"] [itemprop="name"]',
      'meta[name="author"]',
      'meta[property="article:author"]'
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        const text = selector.includes('meta') 
          ? element.attr('content') 
          : element.text().trim();
        if (text && text.length > 0 && text.length < 100) {
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
      '.date',
      '[class*="date"]',
      'meta[property="article:published_time"]',
      'meta[name="publish_date"]',
      'meta[name="date"]'
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
    // Strategy 1: Look for article-specific containers
    const articleSelectors = [
      'article',
      '[role="article"]',
      '.article-content',
      '.article-body',
      '.story-body',
      '.post-content',
      '.entry-content',
      '[class*="article"][class*="content"]',
      '[class*="article"][class*="body"]',
      '[class*="post-content"]',
      '[class*="story"][class*="body"]',
      '[itemprop="articleBody"]',
      'main article',
      'main'
    ];

    for (const selector of articleSelectors) {
      const element = $(selector).first();
      if (element.length) {
        // Clone and clean
        const clone = element.clone();
        
        // Remove unwanted elements
        clone.find('script, style, nav, header, footer, aside, .ad, .advertisement, .social-share, .related-articles, .comments, iframe, [class*="ad"], [class*="promo"], [class*="widget"]').remove();
        
        const paragraphs = [];
        clone.find('p').each((i, el) => {
          const text = $(el).text().trim();
          if (text.length > 30) { // Minimum paragraph length
            paragraphs.push(text);
          }
        });

        if (paragraphs.length >= 3) { // At least 3 paragraphs
          return paragraphs.join('\n\n');
        }
      }
    }

    // Strategy 2: Find all paragraphs and filter intelligently
    const allParagraphs = [];
    const seenText = new Set();
    
    $('p').each((i, el) => {
      const text = $(el).text().trim();
      
      // Skip if too short, duplicate, or looks like navigation/footer
      if (text.length < 30 || seenText.has(text)) return;
      
      // Skip common non-article text patterns
      const skipPatterns = [
        /^(share|tweet|comment|subscribe|follow us)/i,
        /^(read more|continue reading|click here)/i,
        /^(advertisement|sponsored)/i,
        /^[\d\s]+$/,  // Just numbers
        /^[^\w]+$/    // Just punctuation
      ];
      
      if (skipPatterns.some(pattern => pattern.test(text))) return;
      
      seenText.add(text);
      allParagraphs.push(text);
    });

    // Strategy 3: If we have enough paragraphs, use them
    if (allParagraphs.length >= 5) {
      return allParagraphs.join('\n\n');
    }

    // Strategy 4: Last resort - get all text from main content area
    const bodySelectors = ['main', 'body', '#content', '.content'];
    for (const selector of bodySelectors) {
      const element = $(selector).first();
      if (element.length) {
        const clone = element.clone();
        clone.find('script, style, nav, header, footer, aside').remove();
        const text = clone.text().trim();
        if (text.length > 200) {
          return text.replace(/\s+/g, ' ').trim();
        }
      }
    }

    return 'No content extracted - website may require login or has unusual structure';
  }

  extractTags($) {
    const tags = new Set();
    
    const selectors = [
      'a[rel="tag"]',
      '.tag',
      '.tags a',
      '[class*="tag"] a',
      '[class*="category"] a',
      'meta[property="article:tag"]',
      'meta[name="keywords"]',
      'meta[name="news_keywords"]'
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

    return Array.from(tags).filter(tag => tag.length > 0 && tag.length < 50);
  }

  extractImages($, baseUrl) {
    const images = [];
    const seen = new Set();

    // Look for images in article content first
    $('article img, .article img, [class*="article"] img, main img').each((i, el) => {
      this.processImage($, el, baseUrl, images, seen);
    });

    // If no images found, look everywhere
    if (images.length === 0) {
      $('img').each((i, el) => {
        this.processImage($, el, baseUrl, images, seen);
      });
    }

    return images;
  }

  processImage($, el, baseUrl, images, seen) {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
    if (src) {
      const absoluteUrl = this.makeAbsoluteUrl(src, baseUrl);
      
      // Skip tiny images (likely icons/logos)
      const width = parseInt($(el).attr('width')) || 0;
      const height = parseInt($(el).attr('height')) || 0;
      if (width > 0 && height > 0 && (width < 100 || height < 100)) {
        return;
      }
      
      if (!seen.has(absoluteUrl) && this.isValidMediaUrl(absoluteUrl)) {
        seen.add(absoluteUrl);
        images.push({
          url: absoluteUrl,
          alt: $(el).attr('alt') || '',
          title: $(el).attr('title') || ''
        });
      }
    }
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

    $('iframe').each((i, el) => {
      const src = $(el).attr('src');
      if (src && (src.includes('youtube.com') || src.includes('vimeo.com') || src.includes('dailymotion'))) {
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
      'h3 a[href]',
      'h4 a[href]'
    ];

    articleSelectors.forEach(selector => {
      $(selector).each((i, el) => {
        const href = $(el).attr('href');
        if (href) {
          const absoluteUrl = this.makeAbsoluteUrl(href, baseUrl);
          try {
            const linkDomain = new URL(absoluteUrl).hostname;
            if (linkDomain === domain && this.looksLikeArticle(absoluteUrl)) {
              links.add(absoluteUrl);
            }
          } catch (e) {
            // Invalid URL, skip
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
      /\/\d{4}\/\d{2}\/\d{2}\//,
      /\/blog\//,
      /\/press\//,
      /\/\d{4}\//
    ];

    const excludePatterns = [
      /\/(tag|category|author|search|page|archive)\//,
      /\.(jpg|png|gif|pdf|xml|json|css|js)$/i,
      /#$/,
      /\?p=/,
      /\/feed\//,
      /\/wp-/
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