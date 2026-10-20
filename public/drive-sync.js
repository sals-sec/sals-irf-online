/* Google Drive Sync module powered by Firebase Auth & Google Drive API */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';

let app = null;
let auth = null;
let cachedAccessToken = null;
let isSigningIn = false;
let driveConfig = null;

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

async function initFirebase() {
  if (app && auth) return { app, auth };
  if (!driveConfig) {
    const res = await fetch('/firebase-applet-config.json');
    if (!res.ok) throw new Error('Could not load Firebase configuration.');
    driveConfig = await res.json();
  }
  app = initializeApp(driveConfig);
  auth = getAuth(app);

  onAuthStateChanged(auth, (user) => {
    if (!user && !isSigningIn) {
      cachedAccessToken = null;
    }
    if (typeof window.onDriveAuthStateChanged === 'function') {
      window.onDriveAuthStateChanged(user, cachedAccessToken);
    }
  });

  return { app, auth };
}

export async function connectGoogleDrive() {
  const { auth: currentAuth } = await initFirebase();
  const provider = new GoogleAuthProvider();
  provider.addScope(DRIVE_SCOPE);

  try {
    isSigningIn = true;
    const result = await signInWithPopup(currentAuth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to retrieve access token from Google.');
    }
    cachedAccessToken = credential.accessToken;
    if (typeof window.onDriveAuthStateChanged === 'function') {
      window.onDriveAuthStateChanged(result.user, cachedAccessToken);
    }
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export async function disconnectGoogleDrive() {
  if (auth) {
    await signOut(auth);
  }
  cachedAccessToken = null;
  if (typeof window.onDriveAuthStateChanged === 'function') {
    window.onDriveAuthStateChanged(null, null);
  }
}

export function getCachedToken() {
  return cachedAccessToken;
}

export function getCurrentGoogleUser() {
  return auth?.currentUser || null;
}

export async function searchDriveRegistryFiles() {
  if (!cachedAccessToken) {
    throw new Error('Please sign in with Google to access your Google Drive.');
  }
  const query = encodeURIComponent("name contains 'db_registry' and trashed = false");
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,mimeType,modifiedTime,size)&orderBy=modifiedTime desc`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cachedAccessToken}` }
  });
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google session expired. Please sign in again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to search Google Drive files.');
  }
  const data = await res.json();
  return data.files || [];
}

export async function updateDriveFileContent(fileId, reports) {
  if (!cachedAccessToken) throw new Error('Not authenticated with Google.');
  const payload = JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    reports
  }, null, 2);

  const url = `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${cachedAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: payload
  });

  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google session expired. Please sign in again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to update Google Drive file.');
  }
  return await res.json();
}

export async function createDriveFile(reports, fileName = 'db_registry.json') {
  if (!cachedAccessToken) throw new Error('Not authenticated with Google.');
  const metadata = {
    name: fileName,
    mimeType: 'application/json'
  };
  const content = JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    reports
  }, null, 2);

  const boundary = '-------314159265358979323846';
  const delimiter = "\r\n--" + boundary + "\r\n";
  const closeDelim = "\r\n--" + boundary + "--";

  const multipartBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    content +
    closeDelim;

  const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cachedAccessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: multipartBody
  });

  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google session expired. Please sign in again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to create file on Google Drive.');
  }
  return await res.json();
}

export async function readDriveFileContent(fileId) {
  if (!cachedAccessToken) throw new Error('Not authenticated with Google.');
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${cachedAccessToken}` }
  });
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google session expired. Please sign in again.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Failed to read file from Google Drive.');
  }
  return await res.json();
}

export function isGoogleSigningIn() {
  return isSigningIn;
}

// Attach to window for global access from public/index.html
window.driveSync = {
  initFirebase,
  connectGoogleDrive,
  disconnectGoogleDrive,
  getCachedToken,
  getCurrentGoogleUser,
  isGoogleSigningIn,
  searchDriveRegistryFiles,
  updateDriveFileContent,
  createDriveFile,
  readDriveFileContent
};

// Initialize listener eagerly
initFirebase().catch(e => console.warn('Drive sync initialization notice:', e.message));
