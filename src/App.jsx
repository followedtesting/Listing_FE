import React, { useState, useEffect } from 'react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

function App() {
  const [portals, setPortals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sequentialLoading, setSequentialLoading] = useState(false);
  const [scrapingStates, setScrapingStates] = useState({}); // Tracks scraping per portal_id
  const [selectedPortals, setSelectedPortals] = useState({}); // Tracks selection per portal_id
  const [sendEmailOnComplete, setSendEmailOnComplete] = useState(true); // Email toggle checkbox
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

      // Initialize selectedPortals for any newly discovered portal_ids
      setSelectedPortals(prev => {
        const nextState = { ...prev };
        data.forEach(p => {
          if (nextState[p.id] === undefined) {
            nextState[p.id] = true;
          }
        });
        return nextState;
      });
    } catch (err) {
      console.error(err);
      showToast('Could not load portal statuses from backend.', 'error');
    }
  };

  useEffect(() => {
    fetchPortals();
  }, []);

  const togglePortalSelection = (portalId, isChecked) => {
    setSelectedPortals(prev => ({
      ...prev,
      [portalId]: isChecked
    }));
  };

  const toggleFromHere = (portalIndex, isChecked) => {
  setSelectedPortals(prev => {
    const nextState = { ...prev };

    portals.forEach((portal, index) => {
      if (index >= portalIndex) {
        nextState[portal.id] = isChecked;
      }
    });

    return nextState;
  });
};

  const handleSelectAll = () => {
    const allChecked = {};
    portals.forEach(p => {
      allChecked[p.id] = true;
    });
    setSelectedPortals(allChecked);
  };

  const handleDeselectAll = () => {
    const allUnchecked = {};
    portals.forEach(p => {
      allUnchecked[p.id] = false;
    });
    setSelectedPortals(allUnchecked);
  };

  // Trigger sequential scan for selected portals
  const handleRunSelectedScans = async () => {
    const selectedList = portals.filter(p => selectedPortals[p.id] !== false);
    if (selectedList.length === 0) {
      showToast('Please select at least one portal to scrape.', 'error');
      return;
    }

    setSequentialLoading(true);
    showToast(`Starting sequential scan of ${selectedList.length} selected portal(s)...`, 'info');

    let totalNew = 0;
    let errors = [];

    try {
      for (let i = 0; i < selectedList.length; i++) {
        const portal = selectedList[i];
        setScrapingStates({ [portal.id]: true });
        showToast(`[${i + 1}/${selectedList.length}] Scraping ${portal.name}...`, 'info');

        try {
          const response = await fetch(`${API_BASE}/trigger-scrape/${portal.id}`, {
            method: 'POST',
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          totalNew += data.new_listings_count || 0;
        } catch (err) {
          console.error(`Scrape error for ${portal.name}:`, err);
          errors.push(`${portal.name}`);
        }

        await fetchPortals();

        if (i < selectedList.length - 1) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      setScrapingStates({});

      if (sendEmailOnComplete) {
        showToast('Scan complete. Generating & sending email digest...', 'info');
        try {
          const emailRes = await fetch(`${API_BASE}/send-digest-email`, {
            method: 'POST',
          });
          if (!emailRes.ok) throw new Error(`Email dispatch failed with status ${emailRes.status}`);
          const emailData = await emailRes.json();
          showToast(
            `Sequential scan complete! Scraped ${selectedList.length} portal(s), ${totalNew} new job(s). Email status: ${emailData.email_message}`,
            'success'
          );
        } catch (emailErr) {
          console.error('Email error:', emailErr);
          showToast(`Scan complete (${totalNew} new jobs), but email dispatch failed.`, 'error');
        }
      } else {
        if (errors.length > 0) {
          showToast(`Sequential scan completed with errors on: ${errors.join(', ')}. Total new jobs: ${totalNew}`, 'error');
        } else {
          showToast(`Sequential scan completed! Scraped ${selectedList.length} portal(s), ${totalNew} new job(s). (Email skipped)`, 'success');
        }
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to complete sequential scan.', 'error');
    } finally {
      setSequentialLoading(false);
      setScrapingStates({});
      await fetchPortals();
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
        'success'
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

  const selectedCount = portals.filter(p => selectedPortals[p.id] !== false).length;

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="app-header">
        <div className="brand-section">
          <h1>Job Tracker</h1>
          <p>Scrape, monitor, and identify newly released job opportunities using Playwright</p>
        </div>
        <div className="global-actions">
          <label className="checkbox-toggle" title="Send email digest when sequential scan finishes">
            <input
              type="checkbox"
              checked={sendEmailOnComplete}
              onChange={e => setSendEmailOnComplete(e.target.checked)}
              disabled={sequentialLoading || loading}
            />
            <span className="toggle-label">✉ Send Email Digest</span>
          </label>

          <button
            className="btn-sequential"
            onClick={handleRunSelectedScans}
            disabled={loading || sequentialLoading || Object.values(scrapingStates).some(Boolean)}
          >
            {sequentialLoading ? (
              <>
                <span className="spinner">↻</span> Running Scans ({selectedCount}/{portals.length})...
              </>
            ) : (
              <>
                🔄 Run Selected Scans ({selectedCount}/{portals.length})
              </>
            )}
          </button>
        </div>
      </header>

      {/* Selection Toolbar */}
      <div className="selection-toolbar">
        <div className="toolbar-info">
          <span className="selection-badge">
            {selectedCount} of {portals.length} portals included for scan
          </span>
        </div>
        <div className="toolbar-controls">
          <button
            className="btn-text"
            onClick={handleSelectAll}
            disabled={sequentialLoading || loading}
          >
            ✓ Select All
          </button>
          <span className="divider">|</span>
          <button
            className="btn-text"
            onClick={handleDeselectAll}
            disabled={sequentialLoading || loading}
          >
            ✕ Deselect All
          </button>
        </div>
      </div>

      {/* Grid List of Job Portals */}
      <main className="portals-grid">
        {portals.map((portal, index) => {
          const isScraping = scrapingStates[portal.id];
          const isSelected = selectedPortals[portal.id] !== false;

          const formatDate = (isoString) => {
            if (!isoString) return 'Never';
            try {
              const d = new Date(isoString);
              if (isNaN(d.getTime())) return 'Never';
              return d.toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              });
            } catch (e) {
              return 'Never';
            }
          };

          return (
            <div className={`portal-card ${!isSelected ? 'deselected' : ''}`} key={portal.id}>
              <div className="card-header">
                <div className="header-title-row">
                  <label className="portal-select-label" title={isSelected ? "Include in scan" : "Excluded from scan"}>
                    <input
                      type="checkbox"
                      className="portal-checkbox"
                      checked={isSelected}
                      onChange={e => togglePortalSelection(portal.id, e.target.checked)}
                      disabled={sequentialLoading || loading || isScraping}
                    />
                  </label>
                  <label
                    className="cascade-select-label"
                    title="Toggle this adapter and all following adapters"
                  >
                    <input
                      type="checkbox"
                      checked={portals
                        .slice(index)
                        .every(p => selectedPortals[p.id] !== false)}
                      onChange={e => toggleFromHere(index, e.target.checked)}
                      disabled={sequentialLoading || loading || isScraping}
                    />
                    <span>From here</span>
                  </label>
                  <div>
                    <h3 className="portal-title">{portal.name}</h3>
                    <span className="portal-slug">{portal.id}</span>
                  </div>
                </div>
                <div className={`status-badge ${isScraping ? 'scraping' : isSelected ? 'idle' : 'excluded'}`}>
                  <span className="status-dot"></span>
                  {isScraping ? 'scraping' : isSelected ? 'included' : 'excluded'}
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

              <div className="card-run-info">
                <div className="run-time-container" title={portal.last_run_at ? new Date(portal.last_run_at).toString() : 'No run recorded'}>
                  <span className="run-icon">🕒</span>
                  <span className="run-label">Last Run:</span>
                  <span className="run-time">{formatDate(portal.last_run_at)}</span>
                </div>
                <div className="run-status-container">
                  {portal.last_status === 'success' && (
                    <span className="run-badge success" title="Last adapter run succeeded">
                      <span className="badge-dot"></span> Success
                    </span>
                  )}
                  {portal.last_status === 'failed' && (
                    <span className="run-badge failed" title={portal.error_message ? `Failed: ${portal.error_message}` : 'Last adapter run failed'}>
                      <span className="badge-dot"></span> Failed
                    </span>
                  )}
                  {!portal.last_status && (
                    <span className="run-badge never">
                      <span className="badge-dot"></span> Never
                    </span>
                  )}
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
