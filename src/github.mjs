const REPO = process.env.GITHUB_REPO || 'sals-sec/sals-irf-online';
const BRANCH = process.env.GITHUB_BRANCH || 'master';

export function getGitHubToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PAT || '';
}

export function getGitHubConfig() {
  const token = getGitHubToken();
  return {
    repo: REPO,
    branch: BRANCH,
    hasToken: Boolean(token),
    registryRawUrl: `https://raw.githubusercontent.com/${REPO}/${BRANCH}/database/db_registry.json`,
    usersRawUrl: `https://raw.githubusercontent.com/${REPO}/${BRANCH}/database/db_users.json`,
  };
}

/**
 * Fetch latest file content from GitHub raw or GitHub API
 */
export async function fetchFromGitHub(fileSubPath) {
  const token = getGitHubToken();
  const headers = {
    'User-Agent': 'SALS-Incident-Statement-App',
    'Cache-Control': 'no-cache',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const rawUrl = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${fileSubPath}?t=${Date.now()}`;
    const res = await fetch(rawUrl, { headers });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn(`[GitHub] Raw fetch failed for ${fileSubPath}:`, err.message);
  }

  if (token) {
    try {
      const apiUrl = `https://api.github.com/repos/${REPO}/contents/${fileSubPath}?ref=${BRANCH}`;
      const res = await fetch(apiUrl, { headers: { ...headers, Accept: 'application/vnd.github+json' } });
      if (res.ok) {
        const data = await res.json();
        if (data.content) {
          const str = Buffer.from(data.content, 'base64').toString('utf8');
          return JSON.parse(str);
        }
      }
    } catch (err) {
      console.warn(`[GitHub] API fetch failed for ${fileSubPath}:`, err.message);
    }
  }
  return null;
}

/**
 * Commit and push a file to GitHub repository via REST API
 */
export async function pushFileToGitHub(fileSubPath, contentString, commitMessage) {
  const token = getGitHubToken();
  if (!token) {
    return {
      success: false,
      skipped: true,
      reason: 'GITHUB_TOKEN is not configured. Saved to local /database files only.'
    };
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'SALS-Incident-Statement-App',
    'Content-Type': 'application/json',
  };

  try {
    // 1. Get current file SHA on branch
    const getUrl = `https://api.github.com/repos/${REPO}/contents/${fileSubPath}?ref=${BRANCH}`;
    const getRes = await fetch(getUrl, { headers });
    let sha = null;
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha;
      if (existing.content) {
        const existingClean = existing.content.replace(/\r?\n/g, '');
        const newBase64 = Buffer.from(contentString).toString('base64');
        if (existingClean === newBase64) {
          return { success: true, skipped: true, message: 'Content is identical to GitHub remote' };
        }
      }
    }

    // 2. Put file to create commit
    const putUrl = `https://api.github.com/repos/${REPO}/contents/${fileSubPath}`;
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: commitMessage || `Auto-commit: update ${fileSubPath}`,
        content: Buffer.from(contentString).toString('base64'),
        sha: sha || undefined,
        branch: BRANCH,
      }),
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      console.error(`[GitHub] Push failed for ${fileSubPath}: ${putRes.status}`, errText);
      return { success: false, status: putRes.status, error: errText };
    }

    const resData = await putRes.json();
    console.log(`[GitHub] Successfully committed ${fileSubPath} to ${REPO}@${BRANCH}:`, resData.commit?.sha);
    return { success: true, commitSha: resData.commit?.sha };
  } catch (err) {
    console.error(`[GitHub] Error committing ${fileSubPath}:`, err.message);
    return { success: false, error: err.message };
  }
}
