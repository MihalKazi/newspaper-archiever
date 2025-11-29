const fs = require('fs').promises;
const path = require('path');
const { createObjectCsvWriter } = require('csv-writer');
const crypto = require('crypto');
const sanitize = require('sanitize-filename');
const { format, parse } = require('date-fns');
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
    await fs.mkdir(this.archiveDir, { recursive: true });
    await fs.mkdir(path.join(this.archiveDir, 'media'), { recursive: true });
    await this.loadIndex();
  }

  async loadIndex() {
    try {
      const data = await fs.readFile(this.indexFile, 'utf-8');
      const index = JSON.parse(data);
      this.index.urls = new Set(index.urls || []);
      this.index.titles = new Set(index.titles || []);
    } catch (error) {
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
    if (this.index.urls.has(article.url)) {
      return true;
    }
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
      .substring(0, 8);
    return 'article_' + hash;
  }

  parseArticleDate(dateString) {
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return new Date();
      }
      return date;
    } catch {
      return new Date();
    }
  }

  sanitizeTitle(title) {
    let sanitized = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 60);
    
    sanitized = sanitized.replace(/^-+|-+$/g, '');
    return sanitized || 'untitled';
  }

  async saveArticle(article, mediaFiles) {
    const articleId = this.generateArticleId(article);
    
    const articleDate = this.parseArticleDate(article.publishDate);
    const year = format(articleDate, 'yyyy');
    const month = format(articleDate, 'MM-MMMM');
    const day = format(articleDate, 'dd');
    
    const sanitizedTitle = this.sanitizeTitle(article.title);
    const articleHash = articleId.split('_')[1];
    const uniqueFolderName = sanitizedTitle + '-' + articleHash;
    
    const articleFolder = path.join(
      this.archiveDir,
      'articles',
      year,
      month,
      day,
      uniqueFolderName
    );
    
    await fs.mkdir(articleFolder, { recursive: true });
    
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
      wordCount: article.content.split(/\s+/).length,
      folderPath: path.relative(this.archiveDir, articleFolder)
    };

    const articleJsonPath = path.join(articleFolder, 'article.json');
    await fs.writeFile(articleJsonPath, JSON.stringify(articleData, null, 2));

    if (config.saveHTML && article.html) {
      const htmlPath = path.join(articleFolder, 'article.html');
      await fs.writeFile(htmlPath, article.html);
    }

    if (config.saveMarkdown) {
      const markdown = this.convertToMarkdown(articleData);
      const mdPath = path.join(articleFolder, 'article.md');
      await fs.writeFile(mdPath, markdown);
    }

    const readmePath = path.join(articleFolder, 'README.txt');
    const readme = this.generateArticleReadme(articleData);
    await fs.writeFile(readmePath, readme);

    if (mediaFiles.images && mediaFiles.images.length > 0) {
      const mediaFolder = path.join(articleFolder, 'media');
      await fs.mkdir(mediaFolder, { recursive: true });
      
      for (let img of mediaFiles.images) {
        const oldPath = path.join(this.archiveDir, img.localPath);
        const fileName = path.basename(img.localPath);
        const newPath = path.join(mediaFolder, fileName);
        
        try {
          await fs.rename(oldPath, newPath);
          img.localPath = path.relative(this.archiveDir, newPath);
        } catch (e) {
          // File might not exist or already moved
        }
      }
    }

    this.articles.push(articleData);
    this.index.urls.add(article.url);
    this.index.titles.add(article.title.toLowerCase().trim());

    return articleData;
  }

  async saveAllFormats() {
    await fs.writeFile(
      this.articlesFile,
      JSON.stringify(this.articles, null, 2)
    );
    await this.saveCSV();
    await this.saveIndex();
    await this.createSummaryReport();
    await this.createDateIndex();
  }

  async saveCSV() {
    if (this.articles.length === 0) return;

    const csvWriter = createObjectCsvWriter({
      path: this.csvFile,
      header: [
        { id: 'id', title: 'ID' },
        { id: 'publishDate', title: 'Publish Date' },
        { id: 'title', title: 'Title' },
        { id: 'author', title: 'Author' },
        { id: 'url', title: 'URL' },
        { id: 'wordCount', title: 'Word Count' },
        { id: 'tags', title: 'Tags' },
        { id: 'imageCount', title: 'Images' },
        { id: 'videoCount', title: 'Videos' },
        { id: 'folderPath', title: 'Folder Path' },
        { id: 'scrapedAt', title: 'Scraped At' }
      ]
    });

    const records = this.articles.map(article => ({
      id: article.id,
      publishDate: article.publishDate,
      title: article.title,
      author: article.author,
      url: article.url,
      wordCount: article.wordCount,
      tags: article.tags.join('; '),
      imageCount: article.mediaFiles?.images?.length || 0,
      videoCount: article.mediaFiles?.videos?.length || 0,
      folderPath: article.folderPath,
      scrapedAt: article.scrapedAt
    }));

    await csvWriter.writeRecords(records);
  }

  async createDateIndex() {
    const dateIndex = {};
    
    for (const article of this.articles) {
      const date = this.parseArticleDate(article.publishDate);
      const year = format(date, 'yyyy');
      const month = format(date, 'MM-MMMM');
      
      if (!dateIndex[year]) {
        dateIndex[year] = {};
      }
      
      if (!dateIndex[year][month]) {
        dateIndex[year][month] = [];
      }
      
      dateIndex[year][month].push({
        title: article.title,
        date: article.publishDate,
        folderPath: article.folderPath,
        url: article.url
      });
    }
    
    const dateIndexPath = path.join(this.archiveDir, 'date-index.json');
    await fs.writeFile(dateIndexPath, JSON.stringify(dateIndex, null, 2));
    
    let dateIndexMd = '# Articles by Date\n\n';
    
    for (const year of Object.keys(dateIndex).sort().reverse()) {
      dateIndexMd += '## ' + year + '\n\n';
      
      for (const month of Object.keys(dateIndex[year]).sort().reverse()) {
        const articles = dateIndex[year][month];
        dateIndexMd += '### ' + month + ' (' + articles.length + ' articles)\n\n';
        
        articles.forEach(article => {
          const date = format(this.parseArticleDate(article.date), 'MMM dd, yyyy');
          dateIndexMd += '- **' + date + '** - [' + article.title + '](' + article.folderPath + '/article.md)\n';
        });
        
        dateIndexMd += '\n';
      }
    }
    
    const dateIndexMdPath = path.join(this.archiveDir, 'ARTICLES-BY-DATE.md');
    await fs.writeFile(dateIndexMdPath, dateIndexMd);
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

    const readmePath = path.join(this.archiveDir, 'README.md');
    const readme = this.generateReadme(summary);
    await fs.writeFile(readmePath, readme);
  }

  generateReadme(summary) {
    return '# Archive Summary\n\n' +
      '**Source:** ' + summary.sourceUrl + '  \n' +
      '**Created:** ' + new Date(summary.archiveCreated).toLocaleString() + '  \n' +
      '**Total Articles:** ' + summary.totalArticles + '\n\n' +
      '## 📁 Folder Structure\n\n' +
      'Articles are organized by publication date with unique IDs:\n\n' +
      '```\n' +
      'articles/\n' +
      '├── 2024/\n' +
      '│   ├── 01-January/\n' +
      '│   │   ├── 15/\n' +
      '│   │   │   ├── article-title-here-a1b2c3d4/\n' +
      '│   │   │   │   ├── article.json\n' +
      '│   │   │   │   ├── article.html\n' +
      '│   │   │   │   ├── article.md\n' +
      '│   │   │   │   ├── README.txt\n' +
      '│   │   │   │   └── media/\n' +
      '│   │   │   │       ├── image1.jpg\n' +
      '│   │   │   │       └── image2.jpg\n' +
      '│   │   │   └── another-article-e5f6g7h8/\n' +
      '│   │   └── 16/\n' +
      '│   └── 02-February/\n' +
      '└── 2023/\n' +
      '```\n\n' +
      '**Note:** Each article folder has a unique ID suffix (e.g., `-a1b2c3d4`) to prevent conflicts.\n\n' +
      '## 📊 Statistics\n\n' +
      '- **Total Words:** ' + summary.totalWords.toLocaleString() + '\n' +
      '- **Total Images:** ' + summary.totalImages + '\n' +
      '- **Total Videos:** ' + summary.totalVideos + '\n' +
      '- **Authors:** ' + summary.authors.length + '\n' +
      '- **Tags:** ' + summary.tags.length + '\n\n' +
      '## 📅 Date Range\n\n' +
      '- **Earliest Article:** ' + new Date(summary.dateRange.earliest).toLocaleDateString() + '\n' +
      '- **Latest Article:** ' + new Date(summary.dateRange.latest).toLocaleDateString() + '\n\n' +
      '## 📄 Files\n\n' +
      '- `articles.json` - Complete archive in JSON format\n' +
      '- `articles.csv` - Spreadsheet-friendly format\n' +
      '- `ARTICLES-BY-DATE.md` - Chronological listing\n' +
      '- `date-index.json` - Articles grouped by year/month\n' +
      '- `articles/` - Individual article folders\n' +
      '- `index.json` - Quick lookup index\n\n' +
      '## 👥 Authors\n\n' +
      summary.authors.slice(0, 20).map(a => '- ' + a).join('\n') +
      (summary.authors.length > 20 ? '\n\n... and ' + (summary.authors.length - 20) + ' more' : '') + '\n\n' +
      '## 🏷️ Popular Tags\n\n' +
      summary.tags.slice(0, 30).map(t => '- ' + t).join('\n') +
      (summary.tags.length > 30 ? '\n\n... and ' + (summary.tags.length - 30) + ' more' : '');
  }

  generateArticleReadme(article) {
    const date = format(this.parseArticleDate(article.publishDate), 'MMMM dd, yyyy');
    
    return '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      'ARTICLE DETAILS\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      'Title:      ' + article.title + '\n' +
      'Author:     ' + article.author + '\n' +
      'Published:  ' + date + '\n' +
      'URL:        ' + article.url + '\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      'STATISTICS\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      'Words:      ' + article.wordCount + '\n' +
      'Images:     ' + (article.mediaFiles?.images?.length || 0) + '\n' +
      'Videos:     ' + (article.mediaFiles?.videos?.length || 0) + '\n' +
      'Tags:       ' + (article.tags.length > 0 ? article.tags.join(', ') : 'None') + '\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      'FILES IN THIS FOLDER\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      'article.json  - Complete article data in JSON format\n' +
      'article.html  - Original HTML from the website\n' +
      'article.md    - Markdown formatted article\n' +
      'media/        - All images and videos from this article\n' +
      'README.txt    - This file\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      'ARCHIVED\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
      'Scraped:    ' + new Date(article.scrapedAt).toLocaleString() + '\n' +
      'Article ID: ' + article.id + '\n\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  }

  convertToMarkdown(article) {
    const date = format(this.parseArticleDate(article.publishDate), 'MMMM dd, yyyy');
    
    let md = '# ' + article.title + '\n\n';
    md += '**Author:** ' + article.author + '  \n';
    md += '**Published:** ' + date + '  \n';
    md += '**URL:** [' + article.url + '](' + article.url + ')  \n';
    md += '**Archived:** ' + new Date(article.scrapedAt).toLocaleString() + '  \n\n';

    if (article.tags && article.tags.length > 0) {
      md += '**Tags:** ' + article.tags.join(', ') + '  \n\n';
    }

    md += '---\n\n';
    md += article.content;

    if (article.mediaFiles?.images?.length > 0) {
      md += '\n\n## Images\n\n';
      article.mediaFiles.images.forEach((img, i) => {
        const imgPath = 'media/' + path.basename(img.localPath);
        md += (i + 1) + '. ![' + img.alt + '](' + imgPath + ')\n';
        if (img.alt) md += '   *' + img.alt + '*\n';
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