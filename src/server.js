const express = require('express');
const path = require('path');
const NewspaperScraper = require('./scraper');
const MediaDownloader = require('./downloader');
const StorageManager = require('./storage');
const config = require('../config.json');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/archives', express.static(path.join(__dirname, '..', 'archives')));

// Active scraping jobs
const activeJobs = new Map();

app.post('/api/scrape', async (req, res) => {
  const { url, mode = 'single' } = req.body; // mode: 'single' or 'bulk'

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  const jobId = Date.now().toString();
  
  res.json({ 
    jobId, 
    message: mode === 'single' ? 'Scraping article...' : 'Scraping website...',
    status: 'started',
    mode 
  });

  // Start scraping in background
  if (mode === 'single') {
    scrapeSingleArticle(jobId, url);
  } else {
    scrapeBulk(jobId, url);
  }
});

app.get('/api/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = activeJobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(job);
});

app.get('/api/jobs', (req, res) => {
  const jobs = Array.from(activeJobs.entries()).map(([id, job]) => ({
    jobId: id,
    ...job
  }));
  res.json(jobs);
});

async function scrapeSingleArticle(jobId, articleUrl) {
  const job = {
    status: 'initializing',
    url: articleUrl,
    mode: 'single',
    progress: 0,
    articlesFound: 1,
    articlesScraped: 0,
    articlesFailed: 0,
    currentArticle: articleUrl,
    startTime: Date.now(),
    logs: []
  };

  activeJobs.set(jobId, job);

  const scraper = new NewspaperScraper();
  let storage = null;
  let downloader = null;

  try {
    await scraper.initialize();
    
    // Get domain from article URL for storage
    const domain = new URL(articleUrl).hostname;
    const baseUrl = `https://${domain}`;
    
    storage = new StorageManager(baseUrl);
    await storage.initialize();
    downloader = new MediaDownloader(storage.getArchiveDir());

    job.status = 'scraping';
    job.progress = 10;
    job.logs.push({ time: new Date().toISOString(), message: 'Extracting article content...' });

    // Scrape the single article
    const article = await scraper.scrapeArticle(articleUrl, (progress) => {
      job.logs.push({ time: new Date().toISOString(), message: progress.status || 'Processing...' });
      job.progress = 30;
    });

    if (!article) {
      throw new Error('Failed to extract article content');
    }

    job.progress = 50;
    job.logs.push({ 
      time: new Date().toISOString(), 
      message: `Article extracted: ${article.title}` 
    });

    // Check for duplicates
    if (storage.isDuplicate(article)) {
      job.logs.push({ 
        time: new Date().toISOString(), 
        message: `Article already exists in archive - updating...` 
      });
    }

    job.progress = 60;
    job.logs.push({ time: new Date().toISOString(), message: 'Downloading media files...' });

    // Download media
    const mediaFiles = config.downloadMedia 
      ? await downloader.downloadMedia(article, storage.generateArticleId(article))
      : { images: [], videos: [], pdfs: [] };

    job.progress = 80;
    job.logs.push({ 
      time: new Date().toISOString(), 
      message: `Downloaded ${mediaFiles.images.length} images, ${mediaFiles.videos.length} videos` 
    });

    // Save screenshot if available
    if (article.screenshot) {
      mediaFiles.screenshot = await downloader.saveThumbnail(
        article.screenshot, 
        storage.generateArticleId(article)
      );
    }

    // Save article
    job.logs.push({ time: new Date().toISOString(), message: 'Saving article...' });
    await storage.saveArticle(article, mediaFiles);
    await storage.saveAllFormats();

    job.articlesScraped = 1;
    job.status = 'completed';
    job.progress = 100;
    job.endTime = Date.now();
    job.duration = Math.round((job.endTime - job.startTime) / 1000);
    job.archiveDir = storage.getArchiveDir();
    
    job.articleData = {
      title: article.title,
      author: article.author,
      publishDate: article.publishDate,
      wordCount: article.content.split(/\s+/).length,
      imageCount: mediaFiles.images.length,
      videoCount: mediaFiles.videos.length
    };

    job.logs.push({ 
      time: new Date().toISOString(), 
      message: `✓ Article archived successfully in ${job.duration}s!` 
    });

  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    job.articlesFailed = 1;
    job.logs.push({ 
      time: new Date().toISOString(), 
      message: `Error: ${error.message}`,
      level: 'error'
    });
  } finally {
    await scraper.close();
  }
}

async function scrapeBulk(jobId, url) {
  const job = {
    status: 'initializing',
    url,
    mode: 'bulk',
    progress: 0,
    articlesFound: 0,
    articlesScraped: 0,
    articlesFailed: 0,
    currentArticle: null,
    startTime: Date.now(),
    logs: []
  };

  activeJobs.set(jobId, job);

  const scraper = new NewspaperScraper();
  let storage = null;
  let downloader = null;

  try {
    await scraper.initialize();
    storage = new StorageManager(url);
    await storage.initialize();
    downloader = new MediaDownloader(storage.getArchiveDir());

    job.status = 'discovering';
    job.logs.push({ time: new Date().toISOString(), message: 'Discovering articles...' });

    // Discover articles
    const articleLinks = await scraper.scrapeWebsite(url, (progress) => {
      job.logs.push({ time: new Date().toISOString(), message: progress.message });
      if (progress.count) {
        job.articlesFound = progress.count;
      }
    });

    job.articlesFound = articleLinks.length;
    job.status = 'scraping';
    job.logs.push({ 
      time: new Date().toISOString(), 
      message: `Found ${articleLinks.length} articles. Starting extraction...` 
    });

    // Scrape each article
    for (let i = 0; i < articleLinks.length; i++) {
      const articleUrl = articleLinks[i];
      job.currentArticle = articleUrl;
      job.progress = Math.round(((i + 1) / articleLinks.length) * 100);

      try {
        job.logs.push({ 
          time: new Date().toISOString(), 
          message: `Scraping article ${i + 1}/${articleLinks.length}: ${articleUrl}` 
        });

        const article = await scraper.scrapeArticle(articleUrl, (progress) => {
          // Progress callback
        });

        if (!article) {
          job.articlesFailed++;
          continue;
        }

        // Check for duplicates
        if (storage.isDuplicate(article)) {
          job.logs.push({ 
            time: new Date().toISOString(), 
            message: `Skipped duplicate: ${article.title}` 
          });
          continue;
        }

        // Download media
        const mediaFiles = config.downloadMedia 
          ? await downloader.downloadMedia(article, storage.generateArticleId(article))
          : { images: [], videos: [], pdfs: [] };

        // Save screenshot if available
        if (article.screenshot) {
          mediaFiles.screenshot = await downloader.saveThumbnail(
            article.screenshot, 
            storage.generateArticleId(article)
          );
        }

        // Save article
        await storage.saveArticle(article, mediaFiles);

        job.articlesScraped++;
        job.logs.push({ 
          time: new Date().toISOString(), 
          message: `Saved: ${article.title}` 
        });

      } catch (error) {
        job.articlesFailed++;
        job.logs.push({ 
          time: new Date().toISOString(), 
          message: `Error scraping ${articleUrl}: ${error.message}`,
          level: 'error'
        });
      }
    }

    // Save all formats
    job.status = 'saving';
    job.logs.push({ time: new Date().toISOString(), message: 'Saving archive files...' });
    await storage.saveAllFormats();

    job.status = 'completed';
    job.progress = 100;
    job.endTime = Date.now();
    job.duration = Math.round((job.endTime - job.startTime) / 1000);
    job.archiveDir = storage.getArchiveDir();
    job.logs.push({ 
      time: new Date().toISOString(), 
      message: `Archive completed! ${job.articlesScraped} articles saved in ${job.duration}s` 
    });

  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    job.logs.push({ 
      time: new Date().toISOString(), 
      message: `Fatal error: ${error.message}`,
      level: 'error'
    });
  } finally {
    await scraper.close();
  }
}

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║                                                    ║
║       📰 Newspaper Archiver Server Running         ║
║                                                    ║
║       http://localhost:${PORT}                       ║
║                                                    ║
║   Open this URL in your browser to start          ║
║   archiving newspaper articles!                   ║
║                                                    ║
╚════════════════════════════════════════════════════╝
  `);
});