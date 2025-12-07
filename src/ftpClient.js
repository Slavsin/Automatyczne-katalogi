import ftp from "basic-ftp";
import path from "path";
import os from "os";
import { ftpConfig } from "./config.js";

export async function downloadFeed() {
  const client = new ftp.Client();
  const ext = path.extname(ftpConfig.filePath) || ".xml";
  const tempPath = path.join(os.tmpdir(), `feed${ext}`);

  try {
    await client.access({
      host: ftpConfig.host,
      user: ftpConfig.user,
      password: ftpConfig.password,
      secure: false,
    });

    console.log(`Pobieranie pliku z FTP: ${ftpConfig.filePath}`);
    await client.downloadTo(tempPath, ftpConfig.filePath);
    console.log(`Plik zapisany tymczasowo: ${tempPath}`);

    return tempPath;
  } finally {
    client.close();
  }
}
