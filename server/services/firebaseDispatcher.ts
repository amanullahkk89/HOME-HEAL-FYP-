import crypto from 'node:crypto';

export interface FirebaseConfigStatus {
  fcmConfigured: boolean;
  storageConfigured: boolean;
  bucketName: string | null;
}

export function getFirebaseConfigStatus(): FirebaseConfigStatus {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET?.trim();

  const hasAuth = Boolean(projectId && clientEmail && privateKey);
  return {
    fcmConfigured: hasAuth,
    storageConfigured: Boolean(hasAuth && storageBucket),
    bucketName: storageBucket || null,
  };
}

async function getGoogleAccessToken(scope: string): Promise<string | null> {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY?.trim();
  if (!clientEmail || !privateKeyRaw) return null;

  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const claim = b64({
    iss: clientEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  });

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const sig = signer.sign(privateKey).toString('base64url');
  const jwt = `${header}.${claim}.${sig}`;

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!tokenResp.ok) return null;
  const data = (await tokenResp.json()) as { access_token?: string };
  return data.access_token ?? null;
}

export async function dispatchFcmNotification(params: {
  fcmToken: string | null;
  title: string;
  body: string;
  data?: Record<string, string>;
}): Promise<boolean> {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId || !params.fcmToken) {
    return false;
  }

  try {
    const accessToken = await getGoogleAccessToken('https://www.googleapis.com/auth/firebase.messaging');
    if (!accessToken) return false;

    const resp = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: params.fcmToken,
            notification: {
              title: params.title,
              body: params.body,
            },
            data: params.data ?? {},
          },
        }),
      },
    );
    return resp.ok;
  } catch {
    return false;
  }
}

export async function uploadToPrivateFirebaseStorage(params: {
  objectName: string;
  contentType: string;
  bytes: Buffer;
}): Promise<{ uploaded: boolean; storagePath: string }> {
  const bucket = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  if (!bucket) {
    return { uploaded: false, storagePath: params.objectName };
  }
  try {
    const accessToken = await getGoogleAccessToken('https://www.googleapis.com/auth/devstorage.read_write');
    if (!accessToken) {
      return { uploaded: false, storagePath: params.objectName };
    }
    const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(`private_credentials/${params.objectName}`)}`;
    const resp = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': params.contentType,
      },
      body: new Uint8Array(params.bytes),
    });
    if (resp.ok) {
      return { uploaded: true, storagePath: `private_credentials/${params.objectName}` };
    }
    return { uploaded: false, storagePath: params.objectName };
  } catch {
    return { uploaded: false, storagePath: params.objectName };
  }
}
