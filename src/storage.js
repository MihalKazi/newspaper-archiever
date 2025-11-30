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
    // Create base directory structure
    await fs.mkdir(this.archiveDir, { recursive: true });
    await fs.mkdir(path.join(this.archiveDir, 'media'), { recursive: true });

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
      .substring(0, 8);
    return `article_${hash}`;
  }

  parseArticleDate(dateString) {
    try {
      // Try to parse the date
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        // Invalid date, use current date
        return new Date();
      }
      return date;
    } catch {
      return new Date();
    }
  }

  sanitizeTitle(title) {
    // Remove special characters and limit length
    let sanitized = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-')          // Replace spaces with hyphens
      .replace(/-+/g, '-')           // Remove multiple hyphens
      .substring(0, 80);             // Limit length
    
    // Remove leading/trailing hyphens
    sanitized = sanitized.replace(/^-+|-+$/g, '');
    
    return sanitized || 'untitled';
  }

  async saveArticle(article, mediaFiles) {
    const articleId = this.generateArticleId(article);
    
    // Parse the article date
    const articleDate = this.parseArticleDate(article.publishDate);
    const year = format(articleDate, 'yyyy');
    const month = format(articleDate, 'MM-MMMM'); // e.g., "01-January"
    const day = format(articleDate, 'dd');
    
    // Create sanitized title for folder/file names
    const sanitizedTitle = this.sanitizeTitle(article.title);
    
    // Create unique ID from publication date/time if available
    // If publishDate has time info, use it; otherwise use article URL hash for uniqueness
    let uniqueId;
    try {
      const pubDate = new Date(article.publishDate);
      // Check if the date has time information (not just 00:00:00)
      if (pubDate.getHours() !== 0 || pubDate.getMinutes() !== 0 || pubDate.getSeconds() !== 0) {
        // Has time info - use publication timestamp
        uniqueId = format(pubDate, 'yyyyMMdd-HHmmss');
      } else {
        // No time info - use hash from URL for uniqueness
        uniqueId = articleId.substring(8); // Last 8 chars of article hash
      }
    } catch (e) {
      // Fallback to hash if date parsing fails
      uniqueId = articleId.substring(8);
    }
    
    const uniqueFolderName = `${sanitizedTitle}-${uniqueId}`;
    
    // Create date-based folder structure: 2024/01-January/15/article-title-20240115-143022/
    const articleFolder = path.join(
      this.archiveDir,
      'articles',
      year,
      month,
      day,
      uniqueFolderName
    );
    
    // Create the folder structure
    await fs.mkdir(articleFolder, { recursive: true });
    
    // IMPORTANT: Move media files from temp folder to article folder
    const mediaFolder = path.join(articleFolder, 'media');
    await fs.mkdir(mediaFolder, { recursive: true });
    
    // Move images to article folder
    if (mediaFiles.images && mediaFiles.images.length > 0) {
      for (let i = 0; i < mediaFiles.images.length; i++) {
        const img = mediaFiles.images[i];
        if (img.localPath) {
          const oldPath = path.join(this.archiveDir, img.localPath);
          const fileName = path.basename(img.localPath);
          const newPath = path.join(mediaFolder, fileName);
          
          try {
            // Check if source file exists before moving
            await fs.access(oldPath);
            await fs.rename(oldPath, newPath);
            img.localPath = path.relative(this.archiveDir, newPath);
          } catch (e) {
            console.error(`Failed to move image ${fileName}:`, e.message);
            // Keep original path if move fails
          }
        }
      }
    }
    
    // Move videos to article folder
    if (mediaFiles.videos && mediaFiles.videos.length > 0) {
      for (let i = 0; i < mediaFiles.videos.length; i++) {
        const vid = mediaFiles.videos[i];
        if (vid.type !== 'embed' && vid.localPath) {
          const oldPath = path.join(this.archiveDir, vid.localPath);
          const fileName = path.basename(vid.localPath);
          const newPath = path.join(mediaFolder, fileName);
          
          try {
            await fs.access(oldPath);
            await fs.rename(oldPath, newPath);
            vid.localPath = path.relative(this.archiveDir, newPath);
          } catch (e) {
            console.error(`Failed to move video ${fileName}:`, e.message);
          }
        }
      }
    }
    
    // Clean up temporary media directory
    try {
      const tempDir = path.join(this.archiveDir, 'media', 'temp', articleId);
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
    
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

    // Save individual article JSON with descriptive name
    const articleJsonPath = path.join(articleFolder, 'article.json');
    await fs.writeFile(articleJsonPath, JSON.stringify(articleData, null, 2));

    // Save article HTML if available
    if (config.saveHTML && article.html) {
      const htmlPath = path.join(articleFolder, 'article.html');
      await fs.writeFile(htmlPath, article.html);
    }

    // Save as Markdown if enabled
    if (config.saveMarkdown) {
      const markdown = this.convertToMarkdown(articleData);
      const mdPath = path.join(articleFolder, 'article.md');
      await fs.writeFile(mdPath, markdown);
    }

    // Create a README for the article folder
    const readmePath = path.join(articleFolder, 'README.txt');
    const readme = this.generateArticleReadme(articleData);
    await fs.writeFile(readmePath, readme);

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

    // Create date-based index
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
    // Group articles by year and month
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
    
    // Save date index
    const dateIndexPath = path.join(this.archiveDir, 'date-index.json');
    await fs.writeFile(dateIndexPath, JSON.stringify(dateIndex, null, 2));
    
    // Create human-readable date index
    let dateIndexMd = '# Articles by Date\n\n';
    
    for (const year of Object.keys(dateIndex).sort().reverse()) {
      dateIndexMd += `## ${year}\n\n`;
      
      for (const month of Object.keys(dateIndex[year]).sort().reverse()) {
        const articles = dateIndex[year][month];
        dateIndexMd += `### ${month} (${articles.length} articles)\n\n`;
        
        articles.forEach(article => {
          const date = format(this.parseArticleDate(article.date), 'MMM dd, yyyy');
          dateIndexMd += `- **${date}** - [${article.title}](${article.folderPath}/article.md)\n`;
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

## 📁 Folder Structure

Articles are organized by publication date:

\`\`\`
articles/
├── 2024/
│   ├── 01-January/
│   │   ├── 15/
│   │   │   └── article-title-here/
│   │   │       ├── article.json
│   │   │       ├── article.html
│   │   │       ├── article.md
│   │   │       ├── README.txt
│   │   │       └── media/
│   │   │           ├── image1.jpg
│   │   │           └── image2.jpg
│   │   └── 16/
│   └── 02-February/
└── 2023/
\`\`\`

## 📊 Statistics

- **Total Words:** ${summary.totalWords.toLocaleString()}
- **Total Images:** ${summary.totalImages}
- **Total Videos:** ${summary.totalVideos}
- **Authors:** ${summary.authors.length}
- **Tags:** ${summary.tags.length}

## 📅 Date Range

- **Earliest Article:** ${new Date(summary.dateRange.earliest).toLocaleDateString()}
- **Latest Article:** ${new Date(summary.dateRange.latest).toLocaleDateString()}

## 📄 Files

- \`articles.json\` - Complete archive in JSON format
- \`articles.csv\` - Spreadsheet-friendly format
- \`ARTICLES-BY-DATE.md\` - Chronological listing of all articles
- \`date-index.json\` - Articles grouped by year/month
- \`articles/\` - Individual article folders organized by date
- \`index.json\` - Quick lookup index

## 🔍 Finding Articles

### By Date
Browse the \`articles/\` folder structure or check \`ARTICLES-BY-DATE.md\`

### By Title
Article folders use sanitized titles for easy browsing

### By Spreadsheet
Open \`articles.csv\` in Excel or Google Sheets

## 👥 Authors

${summary.authors.slice(0, 20).map(a => `- ${a}`).join('\n')}
${summary.authors.length > 20 ? `\n... and ${summary.authors.length - 20} more` : ''}

## 🏷️ Popular Tags

${summary.tags.slice(0, 30).map(t => `- ${t}`).join('\n')}
${summary.tags.length > 30 ? `\n... and ${summary.tags.length - 30} more` : ''}
`;
  }

  generateArticleReadme(article) {
    const date = format(this.parseArticleDate(article.publishDate), 'MMMM dd, yyyy');
    
    return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ARTICLE DETAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Title:      ${article.title}
Author:     ${article.author}
Published:  ${date}
URL:        ${article.url}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STATISTICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Words:      ${article.wordCount}
Images:     ${article.mediaFiles?.images?.length || 0}
Videos:     ${article.mediaFiles?.videos?.length || 0}
Tags:       ${article.tags.length > 0 ? article.tags.join(', ') : 'None'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FILES IN THIS FOLDER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

article.json  - Complete article data in JSON format
article.html  - Original HTML from the website
article.md    - Markdown formatted article
media/        - All images and videos from this article
README.txt    - This file

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ARCHIVED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Scraped:    ${new Date(article.scrapedAt).toLocaleString()}
Article ID: ${article.id}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }

  convertToMarkdown(article) {
    const date = format(this.parseArticleDate(article.publishDate), 'MMMM dd, yyyy');
    
    let md = `# ${article.title}\n\n`;
    md += `**Author:** ${article.author}  \n`;
    md += `**Published:** ${date}  \n`;
    md += `**URL:** [${article.url}](${article.url})  \n`;
    md += `**Archived:** ${new Date(article.scrapedAt).toLocaleString()}  \n\n`;

    if (article.tags && article.tags.length > 0) {
      md += `**Tags:** ${article.tags.join(', ')}  \n\n`;
    }

    md += `---\n\n`;
    md += article.content;

    if (article.mediaFiles?.images?.length > 0) {
      md += `\n\n## Images\n\n`;
      article.mediaFiles.images.forEach((img, i) => {
        const imgPath = `media/${path.basename(img.localPath)}`;
        md += `${i + 1}. ![${img.alt}](${imgPath})\n`;
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