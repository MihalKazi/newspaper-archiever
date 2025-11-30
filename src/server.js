const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const NewspaperScraper = require('./scraper');
const MediaDownloader = require('./downloader');
const StorageManager = require('./storage');
const SearchEngine = require('./search');

const app = express();
const PORT = process.env.PORT || 3000;
const searchEngine = new SearchEngine();

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/archives', express.static(path.join(__dirname, '../archives')));

// Browse all archives
app.get('/browse', async (req, res) => {
  try {
    const archivesDir = path.join(__dirname, '../archives');
    const domains = await fs.readdir(archivesDir);
    
    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Browse Archives</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .header {
      text-align: center;
      color: white;
      margin-bottom: 40px;
    }
    .header h1 { font-size: 2.5em; margin-bottom: 10px; }
    .card {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      margin-bottom: 20px;
    }
    .domain-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
    }
    .domain-card {
      background: #f9fafb;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      padding: 20px;
      transition: all 0.3s;
      text-decoration: none;
      color: inherit;
      display: block;
    }
    .domain-card:hover {
      border-color: #667eea;
      box-shadow: 0 5px 15px rgba(102, 126, 234, 0.3);
      transform: translateY(-2px);
    }
    .domain-name {
      font-size: 1.2em;
      font-weight: 600;
      color: #333;
      margin-bottom: 10px;
    }
    .domain-stats {
      font-size: 0.9em;
      color: #666;
    }
    .back-btn {
      display: inline-block;
      padding: 10px 20px;
      background: white;
      color: #667eea;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .back-btn:hover {
      background: #f0f0f0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📚 Browse Archives</h1>
      <p>View your archived articles</p>
    </div>
    
    <a href="/" class="back-btn">← Back to Archiver</a>
    
    <div class="card">
      <div class="domain-list">
    `;

    for (const domain of domains) {
      const domainPath = path.join(archivesDir, domain);
      const stat = await fs.stat(domainPath);
      
      if (stat.isDirectory()) {
        let articleCount = '?';
        try {
          const summaryPath = path.join(domainPath, 'summary.json');
          const summary = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
          articleCount = summary.totalArticles || '?';
        } catch (e) {
          // Summary doesn't exist
        }

        html += `
        <a href="/browse/${domain}" class="domain-card">
          <div class="domain-name">📰 ${domain}</div>
          <div class="domain-stats">
            ${articleCount} articles archived
          </div>
        </a>
        `;
      }
    }

    html += `
      </div>
    </div>
  </div>
</body>
</html>
    `;

    res.send(html);
  } catch (error) {
    res.status(500).send('Error loading archives: ' + error.message);
  }
});

// View specific domain archives
app.get('/browse/:domain', async (req, res) => {
  try {
    const domain = req.params.domain;
    const domainPath = path.join(__dirname, '../archives', domain);
    const articlesPath = path.join(domainPath, 'articles');
    
    const articles = [];
    
    async function scanDirectory(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          try {
            const articleJsonPath = path.join(fullPath, 'article.json');
            const articleData = JSON.parse(await fs.readFile(articleJsonPath, 'utf-8'));
            articles.push({
              ...articleData,
              relativePath: path.relative(domainPath, fullPath)
            });
          } catch (e) {
            await scanDirectory(fullPath);
          }
        }
      }
    }
    
    await scanDirectory(articlesPath);
    articles.sort((a, b) => new Date(b.publishDate) - new Date(a.publishDate));

    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${domain} - Archives</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { text-align: center; color: white; margin-bottom: 40px; }
    .header h1 { font-size: 2.5em; margin-bottom: 10px; }
    .card {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      margin-bottom: 20px;
    }
    .back-btn {
      display: inline-block;
      padding: 10px 20px;
      background: white;
      color: #667eea;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .back-btn:hover { background: #f0f0f0; }
    .article-item { border-bottom: 1px solid #e5e7eb; padding: 20px 0; }
    .article-item:last-child { border-bottom: none; }
    .article-title {
      font-size: 1.3em;
      font-weight: 600;
      color: #333;
      margin-bottom: 10px;
    }
    .article-meta {
      display: flex;
      gap: 20px;
      font-size: 0.9em;
      color: #666;
      margin-bottom: 10px;
    }
    .article-excerpt {
      color: #666;
      margin-bottom: 15px;
      line-height: 1.6;
    }
    .article-links { display: flex; gap: 10px; }
    .view-btn {
      padding: 8px 16px;
      background: #667eea;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-size: 0.9em;
      font-weight: 600;
    }
    .view-btn:hover { background: #5568d3; }
    .view-btn.secondary { background: #e5e7eb; color: #333; }
    .view-btn.secondary:hover { background: #d1d5db; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📰 ${domain}</h1>
      <p>${articles.length} articles archived</p>
    </div>
    
    <a href="/browse" class="back-btn">← Back to All Archives</a>
    
    <div class="card">
    `;

    articles.forEach(article => {
      const date = new Date(article.publishDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      
      const excerpt = article.content.substring(0, 200) + '...';
      const articlePath = '/archives/' + domain + '/' + article.relativePath;

      html += `
      <div class="article-item">
        <div class="article-title">${article.title}</div>
        <div class="article-meta">
          <span>📅 ${date}</span>
          <span>✍️ ${article.author}</span>
          <span>📝 ${article.wordCount} words</span>
        </div>
        <div class="article-excerpt">${excerpt}</div>
        <div class="article-links">
          <a href="${articlePath}/article.html" class="view-btn" target="_blank">📄 View HTML</a>
          <a href="${articlePath}/article.md" class="view-btn secondary" target="_blank">📝 Markdown</a>
          <a href="${articlePath}/article.json" class="view-btn secondary" target="_blank">💾 JSON</a>
          <a href="${article.url}" class="view-btn secondary" target="_blank">🔗 Original</a>
        </div>
      </div>
      `;
    });

    html += `</div></div></body></html>`;
    res.send(html);
  } catch (error) {
    res.status(500).send('Error loading domain archives: ' + error.message);
  }
});

// Search API
app.get('/api/search', async (req, res) => {
  try {
    const { q, domain, author, dateFrom, dateTo, sortBy } = req.query;
    
    if (!searchEngine.searchIndex) {
      const archivesDir = path.join(__dirname, '../archives');
      await searchEngine.buildIndex(archivesDir);
    }

    const results = searchEngine.search(q, {
      domain,
      author,
      dateFrom,
      dateTo,
      sortBy: sortBy || 'relevance'
    });

    res.json({
      query: q,
      count: results.length,
      results: results.slice(0, 100)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get search statistics
app.get('/api/search/stats', async (req, res) => {
  try {
    if (!searchEngine.searchIndex) {
      const archivesDir = path.join(__dirname, '../archives');
      await searchEngine.buildIndex(archivesDir);
    }

    const stats = searchEngine.getStatistics();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rebuild search index
app.post('/api/search/rebuild', async (req, res) => {
  try {
    const archivesDir = path.join(__dirname, '../archives');
    const count = await searchEngine.buildIndex(archivesDir);
    res.json({ success: true, articlesIndexed: count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search page
app.get('/search', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/search.html'));
});

const jobs = new Map();

app.post('/api/scrape', async (req, res) => {
  const { url, mode = 'single' } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const jobId = Date.now().toString();
  const job = {
    id: jobId,
    url: url,
    mode: mode,
    status: 'started',
    progress: 0,
    logs: [],
    articleData: null,
    error: null
  };

  jobs.set(jobId, job);

  const addLog = (message, level = 'info') => {
    job.logs.push({
      time: new Date().toISOString(),
      message: message,
      level: level
    });
    console.log('[' + new Date().toLocaleTimeString() + ']' + message);
  };

  (async () => {
    const scraper = new NewspaperScraper();
    
    try {
      addLog('Initializing browser...');
      job.status = 'initializing';
      await scraper.initialize();
      job.progress = 10;

      if (mode === 'single') {
        addLog('Extracting article content...');
        job.status = 'scraping';
        job.progress = 30;

        const article = await scraper.scrapeArticle(url, (update) => {
          if (update.status === 'loading') {
            addLog('loading');
          } else if (update.status === 'error') {
            addLog('Error: ' + update.error, 'error');
          }
        });

        if (!article) {
          throw new Error('Failed to extract article content');
        }

        addLog('Article extracted: ' + article.title);
        job.progress = 60;

        const storage = new StorageManager(url);
        await storage.initialize();

        if (storage.isDuplicate(article)) {
          addLog('Article already exists in archive - updating...');
        }

        addLog('Downloading media files...');
        const downloader = new MediaDownloader(storage.getArchiveDir());
        const mediaFiles = await downloader.downloadMedia(article, url);
        addLog('Downloaded ' + mediaFiles.images.length + ' images, ' + mediaFiles.videos.length + ' videos');
        job.progress = 80;

        addLog('Saving article...');
        job.status = 'saving';
        const savedArticle = await storage.saveArticle(article, mediaFiles);
        await storage.saveAllFormats();
        job.progress = 100;

        addLog('✅ Article archived successfully!');
        job.status = 'completed';
        job.articleData = {
          title: savedArticle.title,
          author: savedArticle.author,
          publishDate: savedArticle.publishDate,
          wordCount: savedArticle.wordCount,
          imageCount: mediaFiles.images.length,
          videoCount: mediaFiles.videos.length
        };
        job.archiveDir = storage.getArchiveDir();

        // Rebuild search index
        try {
          const archivesDir = path.join(__dirname, '../archives');
          await searchEngine.buildIndex(archivesDir);
          addLog('Search index updated');
        } catch (e) {
          // Ignore index rebuild errors
        }

      } else {
        addLog('Discovering articles...');
        job.status = 'discovering';
        job.progress = 20;

        const articleLinks = await scraper.scrapeWebsite(url, (update) => {
          if (update.message) {
            addLog(update.message);
          }
          if (update.count) {
            job.progress = 40;
          }
        });

        if (articleLinks.length === 0) {
          throw new Error('No articles found on this page');
        }

        const storage = new StorageManager(url);
        await storage.initialize();

        let scraped = 0;
        const total = Math.min(articleLinks.length, 20);

        for (let i = 0; i < total; i++) {
          const articleUrl = articleLinks[i];
          addLog('Scraping article ' + (i + 1) + '/' + total + '...');
          
          const article = await scraper.scrapeArticle(articleUrl, () => {});
          
          if (article && !storage.isDuplicate(article)) {
            const downloader = new MediaDownloader(storage.getArchiveDir());
            const mediaFiles = await downloader.downloadMedia(article, articleUrl);
            await storage.saveArticle(article, mediaFiles);
            scraped++;
          }

          job.progress = 40 + Math.floor((i / total) * 50);
        }

        await storage.saveAllFormats();
        job.progress = 100;
        job.status = 'completed';
        addLog('✅ Archived ' + scraped + ' articles successfully!');
        job.archiveDir = storage.getArchiveDir();

        // Rebuild search index
        try {
          const archivesDir = path.join(__dirname, '../archives');
          await searchEngine.buildIndex(archivesDir);
          addLog('Search index updated');
        } catch (e) {
          // Ignore index rebuild errors
        }
      }

    } catch (error) {
      addLog('Fatal error: ' + error.message, 'error');
      job.status = 'failed';
      job.error = error.message;
    } finally {
      await scraper.close();
    }
  })();

  res.json({ jobId: jobId });
});

app.get('/api/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(job);
});

app.listen(PORT, async () => {
  console.log('');
  console.log('🚀 Newspaper Archiver is running!');
  console.log('📰 Archive articles: http://localhost:' + PORT);
  console.log('📚 Browse archives: http://localhost:' + PORT + '/browse');
  console.log('🔍 Search archives: http://localhost:' + PORT + '/search');
  console.log('');
  
  try {
    const archivesDir = path.join(__dirname, '../archives');
    await searchEngine.buildIndex(archivesDir);
    console.log('✅ Search index ready!');
  } catch (error) {
    console.log('⚠️  No archives found yet. Search will be available after archiving articles.');
  }
  console.log('');
});