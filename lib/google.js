import { google } from 'googleapis';
import fs from 'fs';

export function buildGoogleClients(clientId, clientSecret, tokenPath) {
  if (!fs.existsSync(tokenPath)) {
    throw new Error(
      `google-token.json não encontrado em "${tokenPath}". Execute: node auth-google.js`,
    );
  }
  const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  const auth = new google.auth.OAuth2(clientId, clientSecret, 'http://localhost:4000/callback');
  auth.setCredentials(tokens);
  return {
    docs : google.docs({ version: 'v1', auth }),
    drive: google.drive({ version: 'v3', auth }),
  };
}

export async function createGoogleDoc(docs, drive, docTitle, newsItems, folderId = null) {
  const createRes = await docs.documents.create({ requestBody: { title: docTitle } });
  const docId = createRes.data.documentId;

  const today = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

  const requests = [];
  let cursor = 1;

  const header = `CLIPPING DE NOTÍCIAS — ${today}\n\n`;
  requests.push({ insertText: { location: { index: cursor }, text: header } });
  requests.push({
    updateParagraphStyle: {
      range         : { startIndex: cursor, endIndex: cursor + header.length - 1 },
      paragraphStyle: { namedStyleType: 'HEADING_1' },
      fields        : 'namedStyleType',
    },
  });
  cursor += header.length;

  newsItems.forEach((item, i) => {
    const chamadaText = `${i + 1}. ${item.chamada}\n`;
    const resumoText  = `${item.resumo}\n`;
    const linkText    = `Link: ${item.link}\n\n`;

    requests.push({ insertText: { location: { index: cursor }, text: chamadaText } });
    requests.push({
      updateParagraphStyle: {
        range         : { startIndex: cursor, endIndex: cursor + chamadaText.length - 1 },
        paragraphStyle: { namedStyleType: 'HEADING_2' },
        fields        : 'namedStyleType',
      },
    });
    cursor += chamadaText.length;

    requests.push({ insertText: { location: { index: cursor }, text: resumoText } });
    cursor += resumoText.length;

    requests.push({ insertText: { location: { index: cursor }, text: linkText } });
    requests.push({
      updateTextStyle: {
        range    : { startIndex: cursor + 6, endIndex: cursor + linkText.length - 2 },
        textStyle: {
          foregroundColor: { color: { rgbColor: { blue: 0.8, red: 0.1, green: 0.3 } } },
          underline: true,
        },
        fields: 'foregroundColor,underline',
      },
    });
    cursor += linkText.length;
  });

  await docs.documents.batchUpdate({ documentId: docId, requestBody: { requests } });

  await drive.permissions.create({
    fileId     : docId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  if (folderId) {
    await drive.files.update({ fileId: docId, addParents: folderId, fields: 'id, parents' });
  }

  return `https://docs.google.com/document/d/${docId}/edit`;
}
