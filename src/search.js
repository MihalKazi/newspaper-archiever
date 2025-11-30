const fs = require('fs').promises;
const path = require('path');
const Fuse = require('fuse.js');

class SearchEngine {
  constructor() {
    this.searchIndex = null;
    this.articles = [];
  }

  async buildIndex(archivesDir) {
    this.articles = [];
    
    try {
      const domains = await fs.readdir(archivesDir);
      
      for (const domain of domains) {
        const domainPath = path.join(archivesDir, domain);
        const stat = await fs.stat(domainPath);
        
        if (!stat.isDirectory()) continue;
        
        // Try to read articles.json
        try {
          const articlesPath = path.join(domainPath, 'articles.json');
          const articlesData = await fs.readFile(articlesPath, 'utf-8');
          const domainArticles = JSON.parse(articlesData);
          
          // Add domain info to each article
          domainArticles.forEach(article => {
            this.articles.push({
              ...article,
              domain: domain,
              searchContent: this.createSearchableContent(article)
            });
          });
        } catch (e) {
          // No articles.json or invalid JSON
          console.log('Skipping ' + domain + ': ' + e.message);
        }
      }
      
      // Create Fuse.js search index
      this.searchIndex = new Fuse(this.articles, {
        keys: [
          { name: 'title', weight: 3 },
          { name: 'content', weight: 2 },
          { name: 'author', weight: 1 },
          { name: 'tags', weight: 1.5 }
        ],
        threshold: 0.4,
        includeScore: true,
        includeMatches: true,
        minMatchCharLength: 3
      });
      
      console.log('Search index built: ' + this.articles.length + ' articles');
      return this.articles.length;
    } catch (error) {
      console.error('Failed to build search index:', error);
      throw error;
    }
  }

  createSearchableContent(article) {
    return [
      article.title || '',
      article.content || '',
      article.author || '',
      (article.tags || []).join(' ')
    ].join(' ').toLowerCase();
  }

  search(query, filters = {}) {
    if (!this.searchIndex) {
      throw new Error('Search index not built. Call buildIndex() first.');
    }

    if (!query || query.trim().length === 0) {
      // Return all articles if no query
      return this.filterArticles(this.articles, filters);
    }

    // Perform fuzzy search
    const results = this.searchIndex.search(query);
    
    // Extract articles from search results
    let articles = results.map(result => ({
      ...result.item,
      score: result.score,
      matches: result.matches
    }));

    // Apply additional filters
    articles = this.filterArticles(articles, filters);

    return articles;
  }

  filterArticles(articles, filters) {
    let filtered = [...articles];

    // Filter by domain
    if (filters.domain) {
      filtered = filtered.filter(a => a.domain === filters.domain);
    }

    // Filter by author
    if (filters.author) {
      const authorLower = filters.author.toLowerCase();
      filtered = filtered.filter(a => 
        (a.author || '').toLowerCase().includes(authorLower)
      );
    }

    // Filter by date range
    if (filters.dateFrom) {
      const fromDate = new Date(filters.dateFrom);
      filtered = filtered.filter(a => 
        new Date(a.publishDate) >= fromDate
      );
    }

    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo);
      filtered = filtered.filter(a => 
        new Date(a.publishDate) <= toDate
      );
    }

    // Filter by tags
    if (filters.tags && filters.tags.length > 0) {
      filtered = filtered.filter(a => {
        const articleTags = (a.tags || []).map(t => t.toLowerCase());
        return filters.tags.some(filterTag => 
          articleTags.includes(filterTag.toLowerCase())
        );
      });
    }

    // Sort results
    if (filters.sortBy === 'date') {
      filtered.sort((a, b) => 
        new Date(b.publishDate) - new Date(a.publishDate)
      );
    } else if (filters.sortBy === 'title') {
      filtered.sort((a, b) => 
        (a.title || '').localeCompare(b.title || '')
      );
    }
    // Default: sort by relevance (score)

    return filtered;
  }

  getStatistics() {
    const stats = {
      totalArticles: this.articles.length,
      domains: [...new Set(this.articles.map(a => a.domain))],
      authors: [...new Set(this.articles.map(a => a.author))].filter(Boolean),
      dateRange: {
        earliest: null,
        latest: null
      },
      tags: []
    };

    if (this.articles.length > 0) {
      const dates = this.articles.map(a => new Date(a.publishDate)).sort();
      stats.dateRange.earliest = dates[0].toISOString();
      stats.dateRange.latest = dates[dates.length - 1].toISOString();

      // Get top tags
      const tagCounts = {};
      this.articles.forEach(article => {
        (article.tags || []).forEach(tag => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      });

      stats.tags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([tag, count]) => ({ tag, count }));
    }

    return stats;
  }

  highlightMatches(text, query) {
    if (!query || !text) return text;

    const words = query.toLowerCase().split(/\s+/);
    let highlighted = text;

    words.forEach(word => {
      if (word.length < 3) return; // Skip short words
      
      const regex = new RegExp('(' + word + ')', 'gi');
      highlighted = highlighted.replace(regex, '<mark>$1</mark>');
    });

    return highlighted;
  }

  getExcerpt(content, query, maxLength = 200) {
    if (!content) return '';

    if (!query) {
      return content.substring(0, maxLength) + '...';
    }

    // Find the first occurrence of any query word
    const words = query.toLowerCase().split(/\s+/);
    const contentLower = content.toLowerCase();
    
    let bestIndex = -1;
    for (const word of words) {
      const index = contentLower.indexOf(word);
      if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
        bestIndex = index;
      }
    }

    if (bestIndex === -1) {
      return content.substring(0, maxLength) + '...';
    }

    // Get context around the match
    const start = Math.max(0, bestIndex - 100);
    const end = Math.min(content.length, bestIndex + maxLength);
    
    let excerpt = content.substring(start, end);
    if (start > 0) excerpt = '...' + excerpt;
    if (end < content.length) excerpt = excerpt + '...';

    return excerpt;
  }
}

module.exports = SearchEngine;