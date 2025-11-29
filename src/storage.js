const fs = require('fs').promises;
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');
const crypto = require('crypto');
const sanitize = require('sanitize-filename');
const config = require('../config.json');

class StorageManager {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    const domain = new URL(baseUrl).hostname.replace(/^www\./, '');
    this.archiveDir = path.join(config.archiveDir, sanitize(domain));
    this.articlesFile = path.join(this.archiveDir, 'articles.json');
    this.csvFile = path.join(this.archiveDir, 'articles.csv');
    this.indexFile = path.join(this.archiveDir, 'index.json');
    this.articles = [];
    this.index = { urls: new Set(), titles: new Set() };
  }

  async initialize() {
    // Create directory structure
    await fs.mkdir(this.archiveDir, { recursive: true });
    await fs.mkdir(path.join(this.archiveDir, 'articles'), { recursive: true });
    await fs.mkdir(path.join(this.archiveDir, 'media'), { recursive: true });
    await fs.mkdir(path.join(this.archiveDir, 'media', 'images'), { recursive: true });
    await fs.mkdir(path.join(this.archiveDir, 'media', 'videos'), { recursive: true });
    await fs.mkdir(path.join(this.archiveDir, 'media', 'pdfs'), { recursive: true });

    // Load existing index
    await this.loadIndex();
  }

  async loadIndex() {
    try {
      const data = await fs.readFile(this.indexFile, 'utf-8');
      const index = JSON.parse(data);
      this.index.urls = new Set(index.urls || []);
      this.index.titles = new Set(index.titles || []);
    } catch (error) {
      // Index doesn't exist yet, that's okay
      this.index = { urls: new Set(), titles: new Set() };
    }
  }

  async saveIndex() {
    const indexData = {
      urls: Array.from(this.index.urls),
      titles: Array.from(this.index.titles),
      lastUpdated: new Date().toISOString(),
      totalArticles: this.articles.length
    };
    await fs.writeFile(this.indexFile, JSON.stringify(indexData, null, 2));
  }

  isDuplicate(article) {
    // Check by URL
    if (this.index.urls.has(article.url)) {
      return true;
    }

    // Check by title (normalized)
    const normalizedTitle = article.title.toLowerCase().trim();
    if (this.index.titles.has(normalizedTitle)) {
      return true;
    }

    return false;
  }

  generateArticleId(article) {
    const hash = crypto.createHash('md5')
      .update(article.url)
      .digest('hex')
      .substring(0, 12);
    return `article_${hash}`;
  }

  async saveArticle(article, mediaFiles) {
    const articleId = this.generateArticleId(article);
    
    const articleData = {
      id: articleId,
      url: article.url,
      title: article.title,
      author: article.author,
      publishDate: article.publishDate,
      content: article.content,
      tags: article.tags,
      mediaFiles: mediaFiles,
      scrapedAt: article.scrapedAt,
      wordCount: article.content.split(/\s+/).length
    };

    // Save individual article JSON
    const articleJsonPath = path.join(this.archiveDir, 'articles', `${articleId}.json`);
    await fs.writeFile(articleJsonPath, JSON.stringify(articleData, null, 2));

    // Save article HTML if available
    if (config.saveHTML && article.html) {
      const htmlPath = path.join(this.archiveDir, 'articles', `${articleId}.html`);
      await fs.writeFile(htmlPath, article.html);
    }

    // Save as Markdown if enabled
    if (config.saveMarkdown) {
      const markdown = this.convertToMarkdown(articleData);
      const mdPath = path.join(this.archiveDir, 'articles', `${articleId}.md`);
      await fs.writeFile(mdPath, markdown);
    }

    // Add to collection
    this.articles.push(articleData);

    // Update index
    this.index.urls.add(article.url);
    this.index.titles.add(article.title.toLowerCase().trim());

    return articleData;
  }

  async saveAllFormats() {
    // Save master JSON file
    await fs.writeFile(
      this.articlesFile,
      JSON.stringify(this.articles, null, 2)
    );

    // Save CSV
    await this.saveCSV();

    // Save index
    await this.saveIndex();

    // Create summary report
    await this.createSummaryReport();
  }

  async saveCSV() {
    if (this.articles.length === 0) return;

    const csvWriter = createObjectCsvWriter({
      path: this.csvFile,
      header: [
        { id: 'id', title: 'ID' },
        { id: 'title', title: 'Title' },
        { id: 'author', title: 'Author' },
        { id: 'publishDate', title: 'Publish Date' },
        { id: 'url', title: 'URL' },
        { id: 'wordCount', title: 'Word Count' },
        { id: 'tags', title: 'Tags' },
        { id: 'imageCount', title: 'Images' },
        { id: 'videoCount', title: 'Videos' },
        { id: 'scrapedAt', title: 'Scraped At' }
      ]
    });

    const records = this.articles.map(article => ({
      id: article.id,
      title: article.title,
      author: article.author,
      publishDate: article.publishDate,
      url: article.url,
      wordCount: article.wordCount,
      tags: article.tags.join('; '),
      imageCount: article.mediaFiles?.images?.length || 0,
      videoCount: article.mediaFiles?.videos?.length || 0,
      scrapedAt: article.scrapedAt
    }));

    await csvWriter.writeRecords(records);
  }

  async createSummaryReport() {
    const summary = {
      archiveCreated: new Date().toISOString(),
      sourceUrl: this.baseUrl,
      totalArticles: this.articles.length,
      totalImages: this.articles.reduce((sum, a) => sum + (a.mediaFiles?.images?.length || 0), 0),
      totalVideos: this.articles.reduce((sum, a) => sum + (a.mediaFiles?.videos?.length || 0), 0),
      totalWords: this.articles.reduce((sum, a) => sum + a.wordCount, 0),
      authors: [...new Set(this.articles.map(a => a.author))],
      tags: [...new Set(this.articles.flatMap(a => a.tags))],
      dateRange: {
        earliest: this.articles.reduce((min, a) => a.publishDate < min ? a.publishDate : min, this.articles[0]?.publishDate),
        latest: this.articles.reduce((max, a) => a.publishDate > max ? a.publishDate : max, this.articles[0]?.publishDate)
      }
    };

    const summaryPath = path.join(this.archiveDir, 'summary.json');
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));

    // Create human-readable summary
    const readmePath = path.join(this.archiveDir, 'README.md');
    const readme = this.generateReadme(summary);
    await fs.writeFile(readmePath, readme);
  }

  generateReadme(summary) {
    return `# Archive Summary

**Source:** ${summary.sourceUrl}  
**Created:** ${new Date(summary.archiveCreated).toLocaleString()}  
**Total Articles:** ${summary.totalArticles}

## Statistics

- **Total Words:** ${summary.totalWords.toLocaleString()}
- **Total Images:** ${summary.totalImages}
- **Total Videos:** ${summary.totalVideos}
- **Authors:** ${summary.authors.length}
- **Tags:** ${summary.tags.length}

## Date Range

- **Earliest Article:** ${new Date(summary.dateRange.earliest).toLocaleDateString()}
- **Latest Article:** ${new Date(summary.dateRange.latest).toLocaleDateString()}

## Files

- \`articles.json\` - Complete archive in JSON format
- \`articles.csv\` - Spreadsheet-friendly format
- \`articles/\` - Individual article files (JSON, HTML, Markdown)
- \`media/\` - Downloaded images, videos, and other media
- \`index.json\` - Quick lookup index

## Authors

${summary.authors.slice(0, 20).map(a => `- ${a}`).join('\n')}
${summary.authors.length > 20 ? `\n... and ${summary.authors.length - 20} more` : ''}

## Popular Tags

${summary.tags.slice(0, 30).map(t => `- ${t}`).join('\n')}
${summary.tags.length > 30 ? `\n... and ${summary.tags.length - 30} more` : ''}
`;
  }

  convertToMarkdown(article) {
    let md = `# ${article.title}\n\n`;
    md += `**Author:** ${article.author}  \n`;
    md += `**Published:** ${new Date(article.publishDate).toLocaleString()}  \n`;
    md += `**URL:** ${article.url}  \n`;
    md += `**Scraped:** ${new Date(article.scrapedAt).toLocaleString()}  \n\n`;

    if (article.tags && article.tags.length > 0) {
      md += `**Tags:** ${article.tags.join(', ')}  \n\n`;
    }

    md += `---\n\n`;
    md += article.content;

    if (article.mediaFiles?.images?.length > 0) {
      md += `\n\n## Images\n\n`;
      article.mediaFiles.images.forEach((img, i) => {
        md += `${i + 1}. ![${img.alt}](../${img.localPath})\n`;
        if (img.alt) md += `   *${img.alt}*\n`;
      });
    }

    return md;
  }

  getArchiveDir() {
    return this.archiveDir;
  }

  getArticleCount() {
    return this.articles.length;
  }
}

module.exports = StorageManager;