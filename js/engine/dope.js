/**
 * BallisticPro — D.O.P.E. Manager (Data On Previous Engagements)
 * 
 * Persists shooting log entries in localStorage.
 * Each entry records: distance, conditions, adjustments, POI result,
 * and optionally the calculated vs actual comparison.
 */
const DOPE = (() => {
  const STORAGE_KEY = 'ballisticpro_dope';

  /**
   * Get all DOPE entries sorted by date (newest first).
   * @returns {Array} entries
   */
  function getAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return data.sort((a, b) => b.timestamp - a.timestamp);
    } catch (e) {
      console.warn('DOPE: Error reading data', e);
      return [];
    }
  }

  /**
   * Add a new DOPE entry.
   * @param {Object} entry
   * @returns {Object} the saved entry with generated id
   */
  function add(entry) {
    const entries = getAll();
    entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    entry.timestamp = Date.now();
    entries.push(entry);
    _save(entries);
    return entry;
  }

  /**
   * Delete a DOPE entry by id.
   * @param {string} id
   */
  function remove(id) {
    const entries = getAll().filter(e => e.id !== id);
    _save(entries);
  }

  /**
   * Clear all DOPE data.
   */
  function clearAll() {
    localStorage.removeItem(STORAGE_KEY);
  }

  /**
   * Export all entries as CSV string.
   * @param {string} units - 'imperial' or 'metric'
   * @returns {string} CSV content
   */
  function exportCSV(units) {
    const entries = getAll();
    if (!entries.length) return '';
    const m = units === 'metric';
    const du = m ? 'm' : 'yd';
    const header = [
      'Date', 'Weapon', 'Ammo', 'Scope',
      `Distance (${du})`, 'Temp', 'Pressure', 'Humidity%',
      'Wind Speed', 'Wind Dir',
      'Elev Clicks', 'Wind Clicks', 'Elev (MOA)', 'Wind (MOA)',
      'Calc Drop (MOA)', 'Calc Wind (MOA)',
      'Group Size (MOA)', 'POI Result', 'Notes'
    ].join(',');

    const rows = entries.map(e => [
      e.date, _csvEscape(e.weapon), _csvEscape(e.ammo), _csvEscape(e.scope),
      e.distance, e.temp, e.pressure, e.humidity,
      e.windSpeed, e.windDir,
      e.elevClicks, e.windClicks, e.elevMoa, e.windMoa,
      e.calcDropMoa || '', e.calcWindMoa || '',
      e.groupSize || '', _csvEscape(e.poiResult || ''), _csvEscape(e.notes || '')
    ].join(','));

    return [header, ...rows].join('\n');
  }

  function _csvEscape(str) {
    if (!str) return '';
    str = String(str);
    // Neutralise spreadsheet formula injection (=, +, -, @ at the start of a cell)
    if (/^[=+\-@]/.test(str)) str = "'" + str;
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function _save(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch (e) {
      console.error('DOPE: Error saving data', e);
    }
  }

  /**
   * Get summary stats from DOPE entries.
   * @returns {Object} stats
   */
  function getStats() {
    const entries = getAll();
    if (!entries.length) return { count: 0 };
    const distances = entries.map(e => e.distance).filter(d => d > 0);
    const groups = entries.map(e => e.groupSize).filter(g => g > 0);
    return {
      count: entries.length,
      maxDistance: distances.length ? Math.max(...distances) : 0,
      avgDistance: distances.length ? distances.reduce((a, b) => a + b, 0) / distances.length : 0,
      avgGroupSize: groups.length ? groups.reduce((a, b) => a + b, 0) / groups.length : 0,
      sessions: [...new Set(entries.map(e => e.date))].length
    };
  }

  return { getAll, add, remove, clearAll, exportCSV, getStats };
})();

if (typeof module !== 'undefined') module.exports = DOPE;
