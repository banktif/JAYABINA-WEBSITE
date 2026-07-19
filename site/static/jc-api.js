// JAYABINA API Client for the public website booking form.
// Query-builder style client that talks to the Worker API.
// Usage: var JC = JCApi.create('https://<worker-host>');
// Then: JC.from('bookings').select('*').eq('id',x) etc.
// Auth: JC.auth.signInWithPassword({email,pwd}) → token in localStorage

(function() {
  'use strict';

  var JCApi = window.JCApi = {};

  JCApi.create = function(apiUrl, opts) {
    opts = opts || {};
    return new JCApiClient(apiUrl, opts);
  };

  function JCApiClient(apiUrl, opts) {
    var self = this;
    self._url = apiUrl.replace(/\/+$/, '');
    self._token = opts.token || localStorage.getItem('jc_token') || null;

    // Auth subsystem
    self.auth = {
      getSession: function() {
        return self._token ? { access_token: self._token } : null;
      },
      getUser: async function() {
        if (!self._token) return null;
        try {
          var r = await self._fetch('GET', '/api/auth/me');
          var d = await parseResponse(r);
          return d.status === 'ok' ? d.data : null;
        } catch(e) { return null; }
      },
      signInWithPassword: async function(creds) {
        var body = {};
        if (creds.email) body.email = creds.email;
        if (creds.phone) body.phone = creds.phone;
        body.password = creds.password;
        var r = await self._fetch('POST', '/api/auth/login', body);
        var d = await parseResponse(r);
        if (d.status === 'ok' && d.data.token) {
          self._token = d.data.token;
          localStorage.setItem('jc_token', d.data.token);
          localStorage.setItem('jc_user', JSON.stringify(d.data.user));
        }
        return d;
      },
      signOut: function() {
        self._token = null;
        localStorage.removeItem('jc_token');
        localStorage.removeItem('jc_user');
      },
      getToken: function() { return self._token; }
    };

    // Query builder
    self.from = function(table) {
      return new QueryBuilder(self, table);
    };

    // RPC helper
    self.rpc = async function(fn, params) {
      if (fn === 'distribute_unassigned') {
        var r = await self._fetch('POST', '/api/tasks/distribute', {});
        var d = await parseResponse(r);
        if (d && d.status === 'ok') {
          return { data: Number(d.data && d.data.assigned || 0), error: null };
        }
        return { data: null, error: normalizeError(d && d.error || d) };
      }
      throw new Error('Unknown RPC: ' + fn);
    };
  }

  JCApiClient.prototype._fetch = async function(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (this._token) headers['Authorization'] = 'Bearer ' + this._token;
    var opts = { method: method, headers: headers };
    if (body !== undefined) opts.body = JSON.stringify(body);
    var r = await fetch(this._url + path, opts);
    return r;
  };

  async function parseResponse(response) {
    var text = await response.text();
    if (!text) return response.ok ? { status: 'ok', data: null } : { error: 'Empty server response' };
    try { return JSON.parse(text); }
    catch(e) { return { error: 'Invalid server response (HTTP ' + response.status + ')' }; }
  }

  function normalizeError(value) {
    if (value && value.message) return value;
    if (typeof value === 'string') return { message: value };
    return { message: value && value.error ? String(value.error) : 'Request failed' };
  }

  // ---- QueryBuilder ----
  function QueryBuilder(client, table) {
    this._client = client;
    this._table = table;
    this._action = 'select';
    this._filters = {};
    this._order = null;
    this._orderDir = 'asc';
    this._data = null;
    this._id = null;
    this._single = false;
    this._count = null;
    this._range = null;
    this._page = null;
    this._limit = null;
  }

  QueryBuilder.prototype.select = function(cols) {
    this._action = 'select';
    return this;
  };

  QueryBuilder.prototype.insert = function(data) {
    this._action = 'insert';
    this._data = data;
    return this;
  };

  QueryBuilder.prototype.update = function(data) {
    this._action = 'update';
    this._data = data;
    return this;
  };

  QueryBuilder.prototype.upsert = function(rows) {
    this._action = 'upsert';
    this._data = rows;
    return this;
  };

  QueryBuilder.prototype.delete = function() {
    this._action = 'delete';
    return this;
  };

  QueryBuilder.prototype.eq = function(col, val) {
    this._filters[col] = val;
    if (col === 'id') this._id = val;
    return this;
  };

  QueryBuilder.prototype.in = function(col, vals) {
    this._filters[col] = Array.isArray(vals) ? vals.join(',') : vals;
    return this;
  };

  QueryBuilder.prototype.ne = function(col, val) {
    this._filters[col + '!'] = val;
    return this;
  };

  QueryBuilder.prototype.gt = function(col, val) {
    this._filters[col + '>'] = val;
    return this;
  };

  QueryBuilder.prototype.lt = function(col, val) {
    this._filters[col + '<'] = val;
    return this;
  };

  QueryBuilder.prototype.order = function(col, opts) {
    this._order = col;
    this._orderDir = (opts && opts.ascending === false) ? 'desc' : 'asc';
    return this;
  };

  QueryBuilder.prototype.limit = function(n) {
    this._limit = n;
    return this;
  };

  QueryBuilder.prototype.range = function(from, to) {
    this._range = { from: from, to: to };
    return this;
  };

  QueryBuilder.prototype.single = function() {
    this._single = true;
    return this;
  };

  QueryBuilder.prototype.or = function(filter) {
    this._filters['or'] = filter;
    return this;
  };

  // Execute — returns a promise that resolves to {data, error}
  QueryBuilder.prototype.then = function(resolve, reject) {
    return this._exec().then(resolve, reject);
  };

  QueryBuilder.prototype._exec = async function() {
    var c = this._client;
    var t = this._table;

    // Map table → API path
    var apiPath;
    switch(t) {
      case 'bookings':      apiPath = '/api/bookings'; break;
      case 'tasks':         apiPath = '/api/tasks'; break;
      case 'task_photos':   apiPath = '/api/task-photos'; break;
      case 'profiles':      apiPath = '/api/profiles'; break;
      case 'app_settings':  apiPath = '/api/settings'; break;
      case 'private_settings': apiPath = '/api/settings/private'; break;
      case 'customers':     apiPath = '/api/customers'; break;
      case 'slots':         apiPath = '/api/slots'; break;
      default: throw new Error('Unknown table: ' + t);
    }

    if (this._action === 'select') {
      // GET with query params (except single-resource routes)
      if (t === 'bookings' && this._id && this._single) {
        // Single booking lookup — try auth first, fall back to public
        var token = c.auth.getToken();
        if (!token) {
          // Anon: use public endpoint (success.html style)
          var r = await c._fetch('GET', '/api/bookings/public?id=' + this._id);
          var d = await parseResponse(r);
          return this._wrap(d, t);
        }
      }
      if (t === 'customers' && this._id && this._single) {
        var r = await c._fetch('GET', '/api/customers/' + encodeURIComponent(this._id));
        var d = await parseResponse(r);
        return this._wrap(d, t);
      }

      // Build query string
      var params = [];
      for (var k in this._filters) {
        if (k === 'or') continue;
        if (t === 'bookings' && k === 'id' && String(this._filters[k]).indexOf(',') >= 0) { params.push('ids=' + encodeURIComponent(this._filters[k])); }
        else if (t === 'bookings' && k === 'id') { params.push('ids=' + encodeURIComponent(this._filters[k])); }
        else if (t === 'bookings' && k === 'customer_phone') { params.push('customer_phone=' + encodeURIComponent(this._filters[k])); }
        else if (t === 'bookings' && k === 'customer_id') { params.push('customer_id=' + encodeURIComponent(this._filters[k])); }
        else if (t === 'bookings' && k === 'booking_date') { params.push('date=' + encodeURIComponent(this._filters[k])); }
        else if (t === 'tasks' && k === 'assigned_to') { params.push('assigned_to=' + encodeURIComponent(this._filters[k])); }
        else if (t === 'tasks' && k === 'booking_id') { params.push('booking_id=' + encodeURIComponent(this._filters[k])); }
        else if (t === 'task_photos' && k === 'task_id') { params.push('task_id=' + encodeURIComponent(this._filters[k])); }
        else if (t === 'profiles' && k === 'role') { params.push('role=' + encodeURIComponent(this._filters[k])); }
        else if (k === 'status') { params.push('status=' + encodeURIComponent(this._filters[k])); }
        else { params.push('eq.' + k + '=' + encodeURIComponent(this._filters[k])); }
      }
      if (this._order) { params.push('order=' + this._order); params.push('dir=' + this._orderDir); }
      if (this._limit) params.push('limit=' + this._limit);
      if (this._range) {
        var pageSize = this._range.to - this._range.from + 1;
        params.push('limit=' + pageSize);
        params.push('page=' + (Math.floor(this._range.from / pageSize) + 1));
      }

      // Handle or filter for customers search
      if (this._filters['or']) {
        var orStr = this._filters['or'];
        var searchMatch = orStr.match(/\.ilike\.%([^%]+)%/);
        if (searchMatch) params.push('search=' + encodeURIComponent(searchMatch[1]));
      }

      var qs = params.length ? '?' + params.join('&') : '';
      var r = await c._fetch('GET', apiPath + qs);
      var d = await parseResponse(r);
      return this._wrap(d, t);
    }

    if (this._action === 'insert' || this._action === 'update') {
      if (this._action === 'update' && this._id) {
        // PATCH /api/booksings/:id
        var r = await c._fetch('PATCH', apiPath + '/' + this._id, this._data);
        var d = await parseResponse(r);
        return this._wrap(d, t);
      }
      if (this._action === 'insert' && t === 'slots') {
        // Slots are created through bookings; if direct insert needed:
        var r = await c._fetch('POST', '/api/bookings', this._data);
        var d = await parseResponse(r);
        return this._wrap(d, t);
      }
      // Standard POST
      var r = await c._fetch('POST', apiPath, this._data);
      var d = await parseResponse(r);
      return this._wrap(d, t);
    }

    if (this._action === 'upsert') {
      // PUT for settings, POST for profiles/bulk
      if (t === 'app_settings') {
        var r = await c._fetch('PUT', apiPath, { settings: Array.isArray(this._data) ? this._data : Object.entries(this._data).map(function(e) { return { key: e[0], value: e[1] }; }) });
        var d = await parseResponse(r);
        return this._wrap(d, t);
      }
      if (t === 'private_settings') {
        var r = await c._fetch('PUT', apiPath, { settings: this._data });
        var d = await parseResponse(r);
        return this._wrap(d, t);
      }
      // profils
      var r = await c._fetch('POST', apiPath, this._data);
      var d = await parseResponse(r);
      return this._wrap(d, t);
    }

    if (this._action === 'delete') {
      if (t === 'customers' && this._filters.id && String(this._filters.id).indexOf(',') >= 0) {
        var ids = String(this._filters.id).split(',').filter(Boolean);
        for (var i = 0; i < ids.length; i++) {
          var rr = await c._fetch('DELETE', apiPath + '/' + encodeURIComponent(ids[i]));
          var dd = await parseResponse(rr);
          if (!rr.ok) return this._wrap(dd, t);
        }
        return { data: ids, error: null };
      }
      var r = await c._fetch('DELETE', apiPath + '/' + this._id);
      var d = await parseResponse(r);
      return this._wrap(d, t);
    }

    throw new Error('Unknown action: ' + this._action);
  };

  QueryBuilder.prototype._wrap = function(d, table) {
    if (d.status === 'ok') {
      if (d.data && Array.isArray(d.data.data)) {
        return {
          data: d.data.data,
          count: Number(d.data.total || 0),
          error: null
        };
      }
      if (this._single && d.data) {
        return { data: Array.isArray(d.data) ? (d.data[0] || null) : d.data, error: null };
      }
      return {
        data: Array.isArray(d.data) ? d.data : (d.data ? [d.data] : []),
        count: d.data && d.data.total !== undefined ? d.data.total : (Array.isArray(d.data) ? d.data.length : 0),
        error: null
      };
    }
    return { data: null, error: normalizeError(d && d.error || d) };
  };
})();
