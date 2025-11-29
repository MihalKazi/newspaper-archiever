const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');
const sanitize = require('sanitize-filename');

class MediaDownloader {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.downloadedHashes = new Set();
  }

  async downloadMedia(article, articleId) {
    const mediaFiles = {
      images: [],
      videos: [],
      pdfs: []
    };

    // Download images
    if (article.images && article.images.length > 0) {
      for (const image of article.images) {
        try {
          const filePath = await this.downloadFile(
            image.url,
            'images',
            articleId,
            image.alt || image.title
          );
          if (filePath) {
            mediaFiles.images.push({
              originalUrl: image.url,
              localPath: filePath,
              alt: image.alt,
              title: image.title
            });
          }
        } catch (error) {
          console.error(`Failed to download image ${image.url}:`, error.message);
        }
      }
    }

    // Download videos
    if (article.videos && article.videos.length > 0) {
      for (const video of article.videos) {
        if (video.type !== 'embed') {
          try {
            const filePath = await this.downloadFile(
              video.url,
              'videos',
              articleId
            );
            if (filePath) {
              mediaFiles.videos.push({
                originalUrl: video.url,
                localPath: filePath
              });
            }
          } catch (error) {
            console.error(`Failed to download video ${video.url}:`, error.message);
          }
        } else {
          // For embeds, just save the URL
          mediaFiles.videos.push({
            originalUrl: video.url,
            type: 'embed'
          });
        }
      }
    }

    return mediaFiles;
  }

  async downloadFile(url, type, articleId, description = '') {
    try {
      // Check if we've already downloaded this file
      const fileHash = this.hashUrl(url);
      if (this.downloadedHashes.has(fileHash)) {
        return null; // Skip duplicate
      }

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxContentLength: 100 * 1024 * 1024, // 100MB max
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      // Determine file extension
      const contentType = response.headers['content-type'];
      let extension = mime.extension(contentType);
      
      if (!extension) {
        // Try to get extension from URL
        const urlPath = new URL(url).pathname;
        extension = path.extname(urlPath).substring(1) || 'bin';
      }

      // Create filename
      const timestamp = Date.now();
      const sanitizedDesc = description ? sanitize(description.substring(0, 50)) : '';
      const filename = sanitizedDesc 
        ? `${articleId}_${sanitizedDesc}_${timestamp}.${extension}`
        : `${articleId}_${timestamp}.${extension}`;

      // Create directory structure
      const typeDir = path.join(this.baseDir, 'media', type);
      await fs.mkdir(typeDir, { recursive: true });

      const filePath = path.join(typeDir, filename);
      await fs.writeFile(filePath, response.data);

      this.downloadedHashes.add(fileHash);
      return path.relative(this.baseDir, filePath);
    } catch (error) {
      throw new Error(`Download failed: ${error.message}`);
    }
  }

  hashUrl(url) {
    return crypto.createHash('md5').update(url).digest('hex');
  }

  async saveThumbnail(screenshot, articleId) {
    if (!screenshot) return null;

    try {
      const thumbDir = path.join(this.baseDir, 'media', 'thumbnails');
      await fs.mkdir(thumbDir, { recursive: true });

      const filename = `${articleId}_screenshot.png`;
      const filePath = path.join(thumbDir, filename);
      
      await fs.writeFile(filePath, screenshot);
      return path.relative(this.baseDir, filePath);
    } catch (error) {
      console.error('Failed to save screenshot:', error.message);
      return null;
    }
  }
}

module.exports = MediaDownloader;