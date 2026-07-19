import React, { useState, useEffect } from 'react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

function App() {
  const [portals, setPortals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scrapingStates, setScrapingStates] = useState({}); // Tracks scraping per portal_id
  const [activeDrawer, setActiveDrawer] = useState(null); // { portalId, type: 'current' | 'new', listings: [], title: '' }
  const [searchQuery, setSearchQuery] = useState('');
  const [viewJson, setViewJson] = useState(false);
  const [toast, setToast] = useState(null); // { message, type: 'success' | 'error' | 'info' }

  // Auto-clear Toast notifications
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
  };

  // Fetch portals state on mount
  const fetchPortals = async () => {
    try {
      const response = await fetch(`${API_BASE}/portals`);
      if (!response.ok) throw new Error('Failed to fetch portals');
      const data = await response.json();
      setPortals(data);
    } catch (err) {
      console.error(err);
      showToast('Could not load portal statuses from backend.', 'error');
    }
  };

  useEffect(() => {
    fetchPortals();
  }, []);

  // Trigger scrape for all portals
  const handleScrapeAll = async () => {
    setLoading(true);
    showToast('Triggered scraping on all portals...', 'info');
    
    // Set all portals to scraping state
    const scrapingInitial = {};
    portals.forEach(p => {
      scrapingInitial[p.id] = true;
    });
    setScrapingStates(scrapingInitial);

    try {
      const response = await fetch(`${API_BASE}/trigger-scrape`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Scraping request failed');
      const data = await response.json();
      
      // Parse response summaries
      const results = data.results || {};
      let totalNew = 0;
      let summaries = [];

      Object.entries(results).forEach(([id, res]) => {
        if (res.status === 'error') {
          summaries.push(`${res.portal_name} failed: ${res.error}`);
        } else {
          totalNew += res.new_listings_count || 0;
        }
      });

      if (summaries.length > 0) {
        showToast(`Scrape completed with errors: ${summaries.join(', ')}`, 'error');
      } else {
        showToast(`Scrape completed! Found ${totalNew} new listings overall.`, 'success');
      }
      
      await fetchPortals();
    } catch (err) {
      console.error(err);
      showToast('Failed to trigger scraping.', 'error');
    } finally {
      setLoading(false);
      setScrapingStates({});
    }
  };

  // Trigger scrape for a single portal
  const handleScrapeSingle = async (portalId, portalName) => {
    setScrapingStates(prev => ({ ...prev, [portalId]: true }));
    showToast(`Scraping ${portalName}...`, 'info');

    try {
      const response = await fetch(`${API_BASE}/trigger-scrape/${portalId}`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Portal scraping failed');
      const data = await response.json();
      
      showToast(
        `Scraped ${portalName}! Found ${data.new_listings_count} new listing(s).`,
        data.new_listings_count > 0 ? 'success' : 'success'
      );
      
      await fetchPortals();
    } catch (err) {
      console.error(err);
      showToast(`Scraping failed for ${portalName}.`, 'error');
    } finally {
      setScrapingStates(prev => ({ ...prev, [portalId]: false }));
    }
  };

  // Fetch and show current/new listings in the drawer
  const handleShowListings = async (portalId, portalName, type) => {
    try {
      const endpoint = type === 'current' ? 'listings' : 'new-listings';
      const response = await fetch(`${API_BASE}/${endpoint}/${portalId}`);
      if (!response.ok) throw new Error(`Failed to load ${type} listings`);
      const data = await response.json();
      
      setActiveDrawer({
        portalId,
        type,
        listings: data.listings || [],
        title: `${type === 'current' ? 'Current' : 'New'} Listings - ${portalName}`
      });
      setSearchQuery('');
      setViewJson(false);
    } catch (err) {
      console.error(err);
      showToast(`Could not load job listings from storage.`, 'error');
    }
  };

  // Filter listings inside the drawer
  const filteredListings = activeDrawer 
    ? activeDrawer.listings.filter(job => 
        job.role_name.toLowerCase().includes(searchQuery.toLowerCase()) || 
        job.jobid.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="brand-section">
          <h1>Job Tracker</h1>
          <p>Scrape, monitor, and identify newly released job opportunities using Playwright</p>
        </div>
        <div className="global-actions">
          <button 
            className="btn-primary" 
            onClick={handleScrapeAll} 
            disabled={loading || Object.values(scrapingStates).some(Boolean)}
          >
            {loading ? (
              <>
                <span className="spinner">↻</span> Scraping All Portals...
              </>
            ) : (
              <>
                ⚡ Trigger All Adapters
              </>
            )}
          </button>
        </div>
      </header>

      {/* Grid List of Job Portals */}
      <main className="portals-grid">
        {portals.map(portal => {
          const isScraping = scrapingStates[portal.id];
          return (
            <div className="portal-card" key={portal.id}>
              <div className="card-header">
                <div>
                  <h3 className="portal-title">{portal.name}</h3>
                  <span className="portal-slug">{portal.id}</span>
                </div>
                <div className={`status-badge ${isScraping ? 'scraping' : 'idle'}`}>
                  <span className="status-dot"></span>
                  {isScraping ? 'scraping' : 'idle'}
                </div>
              </div>

              <div className="card-stats">
                <div className="stat-item">
                  <div className="stat-value">{portal.current_listings_count}</div>
                  <div className="stat-label">Current Jobs</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value new-count">{portal.new_listings_count}</div>
                  <div className="stat-label">New Diff</div>
                </div>
              </div>

              <div className="card-actions">
                <button 
                  className="btn-secondary" 
                  onClick={() => handleShowListings(portal.id, portal.name, 'current')}
                  disabled={isScraping}
                >
                  Current Listings
                </button>
                <button 
                  className="btn-secondary" 
                  onClick={() => handleShowListings(portal.id, portal.name, 'new')}
                  disabled={isScraping}
                >
                  New Listings
                </button>
                <button 
                  className="btn-icon" 
                  title="Run Single Scrape" 
                  onClick={() => handleScrapeSingle(portal.id, portal.name)}
                  disabled={isScraping}
                >
                  {isScraping ? <span className="spinner">↻</span> : '⚡'}
                </button>
              </div>
            </div>
          );
        })}
      </main>

      {/* Overlay Drawer Modal */}
      {activeDrawer && (
        <div className="drawer-overlay" onClick={() => setActiveDrawer(null)}>
          <div className="drawer-content" onClick={e => e.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h3>{activeDrawer.title}</h3>
                <p>Showing {filteredListings.length} of {activeDrawer.listings.length} items</p>
              </div>
              <button className="btn-close" onClick={() => setActiveDrawer(null)}>×</button>
            </div>

            <div className="drawer-toolbar">
              <input 
                type="text" 
                placeholder="Filter by title or job ID..." 
                className="search-input"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <button 
                className="toggle-view-btn"
                onClick={() => setViewJson(!viewJson)}
              >
                {viewJson ? 'List View' : 'JSON View'}
              </button>
            </div>

            <div className="drawer-body">
              {filteredListings.length === 0 ? (
                <div className="no-listings">
                  No job entries found matching the query.
                </div>
              ) : viewJson ? (
                <pre className="json-viewer">
                  {JSON.stringify(filteredListings, null, 2)}
                </pre>
              ) : (
                filteredListings.map(job => (
                  <div className="job-item" key={job.jobid}>
                    <div className="job-info">
                      <div className="job-role" title={job.role_name}>{job.role_name}</div>
                      <div className="job-meta-row">
                        <span>Job ID: <span className="job-badge-id">{job.jobid}</span></span>
                      </div>
                    </div>
                    <a 
                      href={job.job_listing_link} 
                      className="btn-apply" 
                      target="_blank" 
                      rel="noopener noreferrer"
                    >
                      Apply ↗
                    </a>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast Alert Banner */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✗' : 'ℹ'} {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
