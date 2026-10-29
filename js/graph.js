/* Outlook (Microsoft 365) inbox access via Microsoft Graph.
   OAuth 2.0 authorization-code flow with PKCE, done by hand so there is no library to load.
   Needs an app registration (single-page application platform) whose redirect URI is this
   page's URL; it can only run from http(s), not from a file:// page. */
(function (root) {
  'use strict';

  var TOKEN_KEY = 'schoolhub:msToken';
  var PENDING_KEY = 'schoolhub:msPending';
  var SCOPES = 'openid profile offline_access User.Read Mail.Read';
  var GRAPH = 'https://graph.microsoft.com/v1.0';

  function redirectUri() {
    return location.origin + location.pathname;
  }

  function canRun() {
    return (location.protocol === 'https:' || location.protocol === 'http:') &&
      Boolean(root.crypto && root.crypto.subtle);
  }

  function authority(tenant) {
    return 'https://login.microsoftonline.com/' + encodeURIComponent(tenant || 'organizations') + '/oauth2/v2.0';
  }

  function base64url(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randomString(len) {
    var bytes = new Uint8Array(len);
    root.crypto.getRandomValues(bytes);
    return base64url(bytes);
  }

  function challengeFor(verifier) {
    return root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
      .then(function (hash) { return base64url(new Uint8Array(hash)); });
  }

  function readToken() {
    try { return JSON.parse(localStorage.getItem(TOKEN_KEY)); } catch (e) { return null; }
  }

  function saveToken(json, previous) {
    var token = {
      access: json.access_token,
      refresh: json.refresh_token || (previous && previous.refresh) || null,
      expires: Date.now() + (Number(json.expires_in) || 3600) * 1000
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
    return token;
  }

  function tokenRequest(config, params) {
    var body = new URLSearchParams(Object.assign({ client_id: config.clientId, scope: SCOPES }, params));
    return fetch(authority(config.tenant) + '/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok || !json.access_token) {
          throw new Error(json.error_description ? json.error_description.split('\r\n')[0] : 'Sign-in failed (' + res.status + ')');
        }
        return json;
      });
    });
  }

  /* Sends the browser to Microsoft's sign-in page. */
  function signIn(config) {
    if (!canRun()) return Promise.reject(new Error('Outlook sign-in only works on the hosted (https) version of the app.'));
    if (!config.clientId) return Promise.reject(new Error('Add your Microsoft app client ID in Settings first.'));
    var verifier = randomString(48);
    var state = randomString(16);
    return challengeFor(verifier).then(function (challenge) {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier: verifier, state: state, tenant: config.tenant, clientId: config.clientId }));
      var params = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: redirectUri(),
        response_mode: 'query',
        scope: SCOPES,
        state: state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        login_hint: config.email || '',
        prompt: 'select_account'
      });
      location.assign(authority(config.tenant) + '/authorize?' + params.toString());
    });
  }

  /* Call on page load. Resolves true when a sign-in just completed, false when there was nothing to do. */
  function handleRedirect() {
    if (!canRun()) return Promise.resolve(false);
    var query = new URLSearchParams(location.search);
    if (!query.has('code') && !query.has('error')) return Promise.resolve(false);
    var pending = null;
    try { pending = JSON.parse(sessionStorage.getItem(PENDING_KEY)); } catch (e) { pending = null; }
    sessionStorage.removeItem(PENDING_KEY);
    history.replaceState(null, '', redirectUri() + location.hash);
    if (query.has('error')) {
      return Promise.reject(new Error(query.get('error_description') || query.get('error')));
    }
    if (!pending || pending.state !== query.get('state')) {
      return Promise.reject(new Error('Sign-in response did not match this browser session. Try again.'));
    }
    return tokenRequest({ clientId: pending.clientId, tenant: pending.tenant }, {
      grant_type: 'authorization_code',
      code: query.get('code'),
      redirect_uri: redirectUri(),
      code_verifier: pending.verifier
    }).then(function (json) { saveToken(json, null); return true; });
  }

  function accessToken(config) {
    var token = readToken();
    if (!token) return Promise.reject(new Error('Not signed in to Outlook.'));
    if (token.expires - 60000 > Date.now()) return Promise.resolve(token.access);
    if (!token.refresh) return Promise.reject(new Error('Outlook session expired. Sign in again.'));
    return tokenRequest(config, { grant_type: 'refresh_token', refresh_token: token.refresh })
      .then(function (json) { return saveToken(json, token).access; })
      .catch(function (err) { signOut(); throw new Error('Outlook session expired. Sign in again. (' + err.message + ')'); });
  }

  function get(path, token) {
    return fetch(GRAPH + path, { headers: { Authorization: 'Bearer ' + token } }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) throw new Error((json.error && json.error.message) || 'Outlook request failed (' + res.status + ')');
        return json;
      });
    });
  }

  /* Resolves { account, messages } with the newest inbox messages. */
  function fetchInbox(config, top) {
    return accessToken(config).then(function (token) {
      var select = 'id,subject,from,receivedDateTime,bodyPreview,webLink,isRead';
      return Promise.all([
        get('/me?$select=mail,userPrincipalName,displayName', token),
        get('/me/mailFolders/inbox/messages?$top=' + (top || 50) + '&$select=' + select + '&$orderby=receivedDateTime%20desc', token)
      ]).then(function (results) {
        var me = results[0];
        return {
          account: String(me.mail || me.userPrincipalName || '').toLowerCase(),
          name: me.displayName || '',
          messages: results[1].value || []
        };
      });
    });
  }

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
  }

  function signedIn() {
    return Boolean(readToken());
  }

  root.Graph = {
    canRun: canRun,
    redirectUri: redirectUri,
    signIn: signIn,
    handleRedirect: handleRedirect,
    fetchInbox: fetchInbox,
    signOut: signOut,
    signedIn: signedIn
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
