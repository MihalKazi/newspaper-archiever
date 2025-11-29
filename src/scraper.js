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
    this.browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.context = await this.browser.newContext({
      userAgent: config.userAgent,
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true
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
      
      // Try different wait strategies
      try {
        await page.goto(url, { 
          waitUntil: 'domcontentloaded',
          timeout: config.pageTimeout 
        });
      } catch (e) {
        // If domcontentloaded fails, try networkidle
        console.log('Retrying with networkidle...');
        await page.goto(url, { 
          waitUntil: 'networkidle',
          timeout: config.pageTimeout 
        });
      }

      // Wait for content to load
      await page.waitForTimeout(Math.min(config.waitForContent, 3000));

      // Scroll to load lazy content
      await this.autoScroll(page);

      // Wait a bit more after scrolling
      await page.waitForTimeout(2000);

      const html = await page.content();
      const $ = cheerio.load(html);

      progressCallback({ status: 'discovering', message: 'Discovering articles...' });
      
      // Get all links from the page
      const allLinks = await this.getAllLinks(page);
      const articleLinks = this.filterArticleLinks(allLinks, url);

      // If no articles found, try alternative discovery
      if (articleLinks.length === 0) {
        progressCallback({ status: 'discovering', message: 'Using alternative discovery methods...' });
        const alternativeLinks = await this.discoverArticleLinksAlternative($, url);
        articleLinks.push(...alternativeLinks);
      }

      // Remove duplicates
      const uniqueLinks = [...new Set(articleLinks)];

      progressCallback({ 
        status: 'found', 
        message: `Found ${uniqueLinks.length} articles`,
        count: uniqueLinks.length 
      });

      await page.close();
      return uniqueLinks;
    } catch (error) {
      throw new Error(`Failed to scrape website: ${error.message}`);
    }
  }

  async getAllLinks(page) {
    return await page.evaluate(() => {
      const links = [];
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.href;
        if (href && href.startsWith('http')) {
          links.push(href);
        }
      });
      return links;
    });
  }

  filterArticleLinks(links, baseUrl) {
    const domain = new URL(baseUrl).hostname.replace(/^www\./, '');
    const articleLinks = [];

    for (const link of links) {
      try {
        const linkUrl = new URL(link);
        const linkDomain = linkUrl.hostname.replace(/^www\./, '');

        // Must be same domain
        if (linkDomain !== domain) continue;

        // Check if it looks like an article
        if (this.looksLikeArticle(link)) {
          articleLinks.push(link);
        }
      } catch (e) {
        // Invalid URL, skip
      }
    }

    return articleLinks;
  }

  async scrapeArticle(articleUrl, progressCallback) {
    let retries = 0;
    
    while (retries < config.retryAttempts) {
      try {
        const page = await this.context.newPage();
        page.setDefaultTimeout(config.pageTimeout);

        progressCallback({ status: 'loading', url: articleUrl });
        
        // Try multiple strategies
        try {
          await page.goto(articleUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: config.pageTimeout 
          });
        } catch (e) {
          console.log('  Retrying with load event...');
          await page.goto(articleUrl, { 
            waitUntil: 'load',
            timeout: config.pageTimeout 
          });
        }
        
        await page.waitForTimeout(Math.min(config.waitForContent, 2000));

        // Scroll page to load lazy content
        await this.autoScroll(page);

        const html = await page.content();
        const $ = cheerio.load(html);

        const article = await this.extractArticleData($, articleUrl, page);
        
        await page.close();
        
        // Validate article has content
        if (!article.content || article.content.length < 100) {
          throw new Error('Insufficient content extracted');
        }
        
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
      try {
        article.screenshot = await page.screenshot({ fullPage: false });
      } catch (e) {
        console.error('Screenshot failed:', e.message);
      }
    }

    return article;
  }

  extractTitle($) {
    const selectors = [
      'h1[class*="title"]',
      'h1[class*="headline"]',
      'h1[class*="head"]',
      '.article-title',
      '.post-title',
      '.entry-title',
      'article h1',
      'h1',
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'title'
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        const text = selector.includes('meta') 
          ? element.attr('content') 
          : selector === 'title'
          ? element.text().split('|')[0].split('-')[0].trim()
          : element.text().trim();
        
        if (text && text.length > 10 && text.length < 300) {
          return text;
        }
      }
    }

    return 'Untitled Article';
  }

  extractAuthor($) {
    const selectors = [
      'a[rel="author"]',
      '[class*="author-name"]',
      '[class*="author"] a',
      '.author',
      '.byline',
      '[class*="byline"]',
      '[itemprop="author"]',
      '[itemprop="author"] [itemprop="name"]',
      'meta[name="author"]',
      'meta[property="article:author"]',
      '.writer',
      '.contributor'
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        const text = selector.includes('meta') 
          ? element.attr('content') 
          : element.text().trim();
        
        if (text && text.length > 2 && text.length < 100) {
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
      '[class*="publish-date"]',
      '[class*="published"]',
      '[class*="date"]',
      'meta[property="article:published_time"]',
      'meta[name="publish_date"]',
      'meta[property="article:published"]'
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length) {
        const datetime = element.attr('datetime') || 
                        element.attr('content') || 
                        element.text().trim();
        if (datetime && datetime.length > 0) {
          return datetime;
        }
      }
    }

    return new Date().toISOString();
  }

  extractContent($) {
    // Remove unwanted elements first
    $('script, style, nav, header, footer, aside, .ad, .advertisement, .social-share, .related-articles, .comments').remove();

    const contentSelectors = [
      'article[class*="content"]',
      'div[class*="article-content"]',
      'div[class*="article-body"]',
      'div[class*="post-content"]',
      'div[class*="entry-content"]',
      '.article__body',
      '.story-body',
      '[itemprop="articleBody"]',
      'article',
      'main article',
      'main',
      '.content'
    ];

    let bestContent = '';
    let maxParagraphs = 0;

    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length) {
        // Clone to avoid modifying original
        const clone = element.clone();
        
        // Remove unwanted nested elements
        clone.find('script, style, .ad, .advertisement').remove();
        
        const paragraphs = [];
        clone.find('p').each((i, el) => {
          const text = $(el).text().trim();
          // Only include paragraphs with substantial text
          if (text.length > 40) {
            paragraphs.push(text);
          }
        });

        if (paragraphs.length > maxParagraphs) {
          maxParagraphs = paragraphs.length;
          bestContent = paragraphs.join('\n\n');
        }
      }
    }

    // If still no content, try getting all paragraphs
    if (!bestContent || bestContent.length < 200) {
      const allParagraphs = [];
      $('p').each((i, el) => {
        const text = $(el).text().trim();
        if (text.length > 40 && text.length < 1000) {
          allParagraphs.push(text);
        }
      });
      
      if (allParagraphs.length > maxParagraphs) {
        bestContent = allParagraphs.slice(0, 50).join('\n\n');
      }
    }

    return bestContent || 'No content extracted';
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
            text.split(',').forEach(tag => {
              const cleaned = tag.trim();
              if (cleaned.length > 2 && cleaned.length < 50) {
                tags.add(cleaned);
              }
            });
          } else if (text.length > 2 && text.length < 50) {
            tags.add(text);
          }
        }
      });
    });

    return Array.from(tags);
  }

  extractImages($, baseUrl) {
    const images = [];
    const seen = new Set();

    // Find all images
    $('img').each((i, el) => {
      const src = $(el).attr('src') || 
                  $(el).attr('data-src') || 
                  $(el).attr('data-lazy-src') ||
                  $(el).attr('data-original');
      
      if (src) {
        const absoluteUrl = this.makeAbsoluteUrl(src, baseUrl);
        if (!seen.has(absoluteUrl) && this.isValidMediaUrl(absoluteUrl)) {
          // Filter out small images (likely icons/logos)
          const width = parseInt($(el).attr('width')) || 0;
          const height = parseInt($(el).attr('height')) || 0;
          
          if (width < 100 && height < 100 && (width > 0 || height > 0)) {
            return; // Skip small images
          }

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

    // HTML5 videos
    $('video source, video').each((i, el) => {
      const src = $(el).attr('src');
      if (src) {
        const absoluteUrl = this.makeAbsoluteUrl(src, baseUrl);
        if (!seen.has(absoluteUrl) && this.isValidMediaUrl(absoluteUrl)) {
          seen.add(absoluteUrl);
          videos.push({ url: absoluteUrl, type: 'video' });
        }
      }
    });

    // Video embeds
    $('iframe').each((i, el) => {
      const src = $(el).attr('src');
      if (src && (src.includes('youtube.com') || 
                  src.includes('vimeo.com') || 
                  src.includes('dailymotion.com'))) {
        if (!seen.has(src)) {
          seen.add(src);
          videos.push({ url: src, type: 'embed' });
        }
      }
    });

    return videos;
  }

  async discoverArticleLinksAlternative($, baseUrl) {
    const links = new Set();
    const domain = new URL(baseUrl).hostname.replace(/^www\./, '');

    // More aggressive article link patterns
    const articleSelectors = [
      'article a[href]',
      '.article a[href]',
      '.post a[href]',
      '.story a[href]',
      'a[href*="/article"]',
      'a[href*="/news"]',
      'a[href*="/story"]',
      'a[href*="/post"]',
      'a[href*="/blog"]',
      '[class*="article"] a[href]',
      '[class*="post"] a[href]',
      '[class*="story"] a[href]',
      'h1 a[href]',
      'h2 a[href]',
      'h3 a[href]',
      'h4 a[href]'
    ];

    articleSelectors.forEach(selector => {
      $(selector).each((i, el) => {
        const href = $(el).attr('href');
        if (href) {
          try {
            const absoluteUrl = this.makeAbsoluteUrl(href, baseUrl);
            const linkDomain = new URL(absoluteUrl).hostname.replace(/^www\./, '');
            
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
      /\/article[s]?[\/\-]/i,
      /\/news[\/\-]/i,
      /\/story[\/\-]/i,
      /\/stories[\/\-]/i,
      /\/post[s]?[\/\-]/i,
      /\/blog[\/\-]/i,
      /\/\d{4}\/\d{1,2}\/\d{1,2}\//,  // Date-based: /2024/01/15/
      /\/\d{4}-\d{2}-\d{2}/,           // Date-based: /2024-01-15
      /\/press[\/\-]/i,
      /\/report[s]?[\/\-]/i,
      /\/feature[s]?[\/\-]/i,
      /\/opinion[s]?[\/\-]/i,
      /\/analysis[\/\-]/i,
      /-\d{6,}$/,                       // Ends with ID: article-123456
      /\/id\/\d+/i,
      /\/p\/[\w-]+/i
    ];

    const excludePatterns = [
      /\/(tag|category|author|search|page|about|contact|privacy|terms|subscribe)[\/\?]/i,
      /\.(jpg|jpeg|png|gif|pdf|xml|json|css|js)$/i,
      /#$/,
      /\/gallery\//i,
      /\/video[s]?\/?$/i,
      /\/podcast[s]?\/?$/i,
      /\/feed/i,
      /\/rss/i,
      /login|signin|signup|register/i
    ];

    const hasArticlePattern = articlePatterns.some(pattern => pattern.test(url));
    const hasExcludePattern = excludePatterns.some(pattern => pattern.test(url));

    // Must have article pattern AND not have exclude pattern
    return hasArticlePattern && !hasExcludePattern;
  }

  makeAbsoluteUrl(url, baseUrl) {
    try {
      if (!url) return '';
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      if (url.startsWith('//')) return 'https:' + url;
      if (url.startsWith('/')) {
        const base = new URL(baseUrl);
        return `${base.protocol}//${base.host}${url}`;
      }
      return new URL(url, baseUrl).href;
    } catch {
      return '';
    }
  }

  isValidMediaUrl(url) {
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
             !url.includes('data:image') &&
             !url.includes('placeholder');
    } catch {
      return false;
    }
  }

  async autoScroll(page) {
    try {
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          const distance = 300;
          const maxScroll = 5000; // Don't scroll forever
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if (totalHeight >= scrollHeight || totalHeight >= maxScroll) {
              clearInterval(timer);
              resolve();
            }
          }, 200);
        });
      });
      await page.waitForTimeout(config.scrollDelay);
    } catch (e) {
      console.error('Scroll failed:', e.message);
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = NewspaperScraper;