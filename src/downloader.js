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

  generateSafeId(url) {
    // Generate a safe ID from URL (hash only)
    return crypto.createHash('md5').update(url).digest('hex').substring(0, 12);
  }

  async downloadMedia(article, articleUrl) {
    const mediaFiles = {
      images: [],
      videos: [],
      pdfs: []
    };

    // Create safe article ID from URL
    const safeArticleId = this.generateSafeId(articleUrl);
    
    // Create temporary media directory with SAFE name
    const tempMediaDir = path.join(this.baseDir, 'media', 'temp', safeArticleId);
    await fs.mkdir(tempMediaDir, { recursive: true });

    // Download images
    if (article.images && article.images.length > 0) {
      for (let i = 0; i < article.images.length; i++) {
        const image = article.images[i];
        try {
          const filePath = await this.downloadFile(
            image.url,
            tempMediaDir,
            'image_' + (i + 1),
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
          console.error('Failed to download image ' + image.url + ': ' + error.message);
        }
      }
    }

    // Download videos
    if (article.videos && article.videos.length > 0) {
      for (let i = 0; i < article.videos.length; i++) {
        const video = article.videos[i];
        if (video.type !== 'embed') {
          try {
            const filePath = await this.downloadFile(
              video.url,
              tempMediaDir,
              'video_' + (i + 1)
            );
            if (filePath) {
              mediaFiles.videos.push({
                originalUrl: video.url,
                localPath: filePath
              });
            }
          } catch (error) {
            console.error('Failed to download video ' + video.url + ': ' + error.message);
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

  async downloadFile(url, targetDir, baseName, description = '') {
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
        try {
          const urlPath = new URL(url).pathname;
          extension = path.extname(urlPath).substring(1) || 'bin';
        } catch (e) {
          extension = 'bin';
        }
      }

      // Create filename - sanitize description
      let filename;
      if (description) {
        const sanitizedDesc = sanitize(description.substring(0, 30).replace(/[^a-zA-Z0-9]/g, '-'));
        filename = baseName + '_' + sanitizedDesc + '.' + extension;
      } else {
        filename = baseName + '.' + extension;
      }

      // Clean up filename (remove double extensions, multiple dashes, etc.)
      filename = filename.replace(/\.\./g, '.').replace(/--+/g, '-');

      const filePath = path.join(targetDir, filename);
      await fs.writeFile(filePath, response.data);

      this.downloadedHashes.add(fileHash);
      return path.relative(this.baseDir, filePath);
    } catch (error) {
      throw new Error('Download failed: ' + error.message);
    }
  }

  hashUrl(url) {
    return crypto.createHash('md5').update(url).digest('hex');
  }

  async saveThumbnail(screenshot, articleUrl) {
    if (!screenshot) return null;

    try {
      // Generate safe ID from URL
      const safeArticleId = this.generateSafeId(articleUrl);
      const tempMediaDir = path.join(this.baseDir, 'media', 'temp', safeArticleId);
      await fs.mkdir(tempMediaDir, { recursive: true });

      const filename = 'screenshot.png';
      const filePath = path.join(tempMediaDir, filename);
      
      await fs.writeFile(filePath, screenshot);
      return path.relative(this.baseDir, filePath);
    } catch (error) {
      console.error('Failed to save screenshot: ' + error.message);
      return null;
    }
  }
}

module.exports = MediaDownloader;