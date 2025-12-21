export const ftpConfig = {
  host: process.env.FTP_HOST,
  user: process.env.FTP_USER,
  password: process.env.FTP_PASSWORD,
  filePath: process.env.FTP_FILE_PATH,
};

export const catalogConfig = {
  productsPerPage: 2,
  eanField: "Index",
  maxProducts: 10000,
};
